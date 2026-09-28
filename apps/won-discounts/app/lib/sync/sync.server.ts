// syncShop: writes a saved Won Discounts config into Shopify (spec §1 "Sync
// vrstva, jediný zapisovač do Shopify", §3 "Emise per uzel" + "Transport
// configu", §9). Every step is recorded; the result is persisted as a SyncRun
// (last SYNC_RUNS_KEPT per shop, with the work left `pending`) for the Přehled.
// The config is synced AS SAVED: market countries were resolved at save time
// (markets.ts), nothing is swapped here.
//
// Order (T1 function-payload.ts "Sync sequences"; the shop config is the flip):
//   0. read the shop (id, time zone, current function_config); build the shop
//      payload — if it does not fit the 9 000 B budget, STOP before any write
//      (saveConfig measured the same payload, so an accepted save never stops here);
//   P1. only when the campaign version changes (another selected campaign or
//      window, or the campaign ended/was killed): write a NO-CAMPAIGN shop
//      config first (`forceNoCampaign`), read back + verified. If P1 fails, the
//      run STOPS there (M2): nothing else was written yet, the running campaign
//      stays intact on every node;
//   1. discount nodes (node-sync.ts): 1 automatic + 1 per code rule — create /
//      update / activate / DEACTIVATE / delete, redeem codes; new nodes get
//      their function_vars in the create;
//   2. function_vars on every other active node;
//   3. product metafields (products.ts);
//   4. the final shared shop function_config LAST, read back and checked with
//      the engine's verifyShopFunctionConfig (C7: > 10 000 B reaches the
//      function as null WITHOUT an error). It is HELD (not written) when:
//        - a campaign switch's phase 2 is incomplete (some active node lacks
//          its new vars) — the shop stays at "no campaign", consistent;
//        - the product step leaves stale refs (a product that left a rule's
//          target could not be cleared, or the step could not finish) — the
//          previous config stays, so no product receives a rule's NEW value
//          through a ref it should no longer have (M1).
//   Steady state (campaign version unchanged) = steps 1–4, one shop write.
//
// Failure behaviour (REL-3), exactly:
//   - The shop config is only ever REPLACED by a complete payload that fits the
//     budget (metafieldsSet of one value is atomic), never deleted. When its
//     write fails, the previous complete config stays in place. When the
//     read-back does not verify, the previous value (if it verifies) is written
//     back.
//   - A failed node step (one rule) does not hold the config: a node whose rule
//     the shop config does not know emits nothing; a node that lacks new vars
//     plans without the campaign (varsVersion handshake). A failed product SET
//     only leaves a product without a new ref (it lacks that discount until the
//     next sync). These windows last until the next successful sync.
//   - Remaining window: after a HELD config, nodes and product refs are
//     already the new ones while the old config runs: a NEW rule's refs and
//     nodes are inert (unknown to the old config); a product newly added to an
//     EXISTING rule gets that rule's OLD value; a code rule just DEACTIVATED or
//     DELETED stops at once (its node is expired / gone) although the old
//     config still lists it. Each such run is marked pending and retried
//     (resyncIfPending, on the next Přehled load).
//   - Everything is idempotent (unchanged state → no mutation); a lost create
//     response is recovered by lookup, never duplicated (node-sync.ts).
//   - Runs for one shop are serialised in this process. Two app instances
//     syncing the same shop at once are not coordinated [unverified: MVP 1
//     runs one instance]; adopt-before-create keeps it from duplicating nodes.

import { SHOP_CONFIG_KEY, WON_NAMESPACE } from "./graphql";
import { desiredNodes, SYNC_RUNS_KEPT, type DesiredNode } from "./nodes";
import { NodeSync } from "./node-sync";
import { syncProducts } from "./products";
import { errorText, setMetafields, Transport } from "./transport";
import type { ConfigView, PendingWork, SyncDeps, SyncResult, SyncStep } from "./types";
import { sameJson } from "./util";

/** Shop-local `YYYY-MM-DDTHH:MM:SS` (DateTimeWithoutTimezone, what the engine and C4 use). */
export function shopLocalDateTime(date: Date, timeZone: string): string {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(date)
        .map((part) => [part.type, part.value]),
    );
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
  } catch {
    return date.toISOString().slice(0, 19); // unknown zone: UTC
  }
}

const inflight = new Map<string, Promise<unknown>>();

export interface SyncShopOptions {
  /**
   * The ConfigVersion `config` was saved as, recorded on the SyncRun (the
   * version link the admin's "Běží" compares with; null/absent = unknown).
   */
  configVersionId?: string | null;
}

export interface Sync {
  syncShop(shop: string, config: ConfigView, options?: SyncShopOptions): Promise<SyncResult>;
}

export function createSync(deps: SyncDeps): Sync {
  return {
    syncShop(shop, config, options = {}) {
      const previous = inflight.get(shop) ?? Promise.resolve();
      const run = previous.catch(() => undefined).then(() => runSync(deps, shop, config, options.configVersionId ?? null));
      inflight.set(shop, run);
      void run
        .finally(() => {
          if (inflight.get(shop) === run) inflight.delete(shop);
        })
        .catch(() => undefined);
      return run;
    },
  };
}

interface ShopState {
  id: string;
  timeZone: string;
  functionConfig: string | null;
}

async function runSync(deps: SyncDeps, shop: string, config: ConfigView, configVersionId: string | null): Promise<SyncResult> {
  const startedAt = deps.now();
  const steps: SyncStep[] = [];
  const pending = new Set<PendingWork>();
  const record = (step: SyncStep) => {
    steps.push(step);
    if (!step.ok) deps.logger.warn(`sync ${shop}: ${step.step} failed: ${step.detail}`);
  };
  const transport = new Transport(deps.client, deps.retry, deps.sleep, deps.logger);
  let rethrow: unknown = null;
  try {
    await syncSteps({ deps, transport, shop, config, now: startedAt, record, pending });
  } catch (error) {
    // A thrown Response is a re-auth redirect for the embedded admin: record, then let it reach the route.
    if (error instanceof Response) rethrow = error;
    record({ step: "sync", ok: false, detail: `stopped: ${errorText(error)}` });
  }
  if (steps.some((step) => !step.ok)) pending.add("failed_steps");
  if (steps.some((step) => /still running/.test(step.detail))) pending.add("codes_in_progress");
  const result = await persist(deps, shop, startedAt, steps, [...pending], configVersionId);
  if (rethrow) throw rethrow;
  return result;
}

interface StepsArgs {
  deps: SyncDeps;
  transport: Transport;
  shop: string;
  config: ConfigView;
  now: Date;
  record: (step: SyncStep) => void;
  pending: Set<PendingWork>;
}

async function syncSteps({ deps, transport, shop, config, now, record, pending }: StepsArgs): Promise<void> {
  // 0. Shop + payload.
  let shopState: ShopState;
  try {
    const data: { shop: { id: string; ianaTimezone: string; functionConfig: { value: string } | null } } = await transport.call("shop");
    shopState = { id: data.shop.id, timeZone: data.shop.ianaTimezone, functionConfig: data.shop.functionConfig?.value ?? null };
  } catch (error) {
    if (error instanceof Response) throw error;
    record({ step: "shop.read", ok: false, detail: `could not read the shop: ${errorText(error)} — nothing was changed` });
    return;
  }
  const shopTimezone = shopState.timeZone;
  const nowLocal = shopLocalDateTime(now, shopTimezone);
  record({ step: "shop.read", ok: true, detail: `${shopState.id}, shop time ${nowLocal} (${shopTimezone})` });

  const payload = deps.buildShopFunctionConfig(config, { now: nowLocal, shopTimezone });
  if (!payload.fits) {
    record({
      step: "shop_config.build",
      ok: false,
      detail: `the discount function config is ${payload.bytes} B, over the 9000 B budget — nothing was written`,
    });
    return;
  }
  let stored = shopState.functionConfig;

  // P1. Campaign switch: no-campaign shop config first; stop if it fails (M2).
  const newVersion = campaignVersionOf(payload.json);
  const oldVersion = stored === null ? null : campaignVersionOf(stored);
  const switching = newVersion !== oldVersion;
  if (switching) {
    const noCampaign = deps.buildShopFunctionConfig(config, { now: nowLocal, shopTimezone, forceNoCampaign: true });
    const written = await writeShopConfig(deps, transport, shopState.id, stored, noCampaign, "shop_config.phase1", record);
    stored = written.stored;
    if (!written.ok) {
      record({
        step: "sync.stopped",
        ok: false,
        detail: "the campaign switch could not start (the no-campaign config was not written); nothing else was changed, the running campaign continues",
      });
      pending.add("campaign_switch_held");
      return;
    }
  }

  // 1 + 2. Nodes and their function_vars.
  const desired = desiredNodes(config, { now, shopLocalNow: nowLocal });
  const varsCache = new Map<string, string>();
  const varsJson = (node: DesiredNode) => {
    let json = varsCache.get(node.key);
    if (json === undefined) {
      json = JSON.stringify(deps.buildNodeVars(node.role, config, nowLocal));
      varsCache.set(node.key, json);
    }
    return json;
  };
  const nodes = new NodeSync({ transport, db: deps.db, shop, now, desired, varsJson, record });
  try {
    await nodes.run();
  } catch (error) {
    if (error instanceof Response) throw error;
    nodes.varsComplete = false;
    record({ step: "nodes", ok: false, detail: `discount nodes: ${errorText(error)}` });
  }

  // 3. Product metafields.
  let staleRisk = false;
  try {
    const result = await syncProducts({ transport, db: deps.db, shop, config, productRuleIndex: deps.productRuleIndex });
    for (const step of result.steps) record(step);
    staleRisk = result.staleRisk;
  } catch (error) {
    if (error instanceof Response) throw error;
    staleRisk = true;
    record({ step: "products", ok: false, detail: `product targeting: ${errorText(error)}` });
  }

  // 4. Final shop config, last (or held).
  if (switching && newVersion !== null && !nodes.varsComplete) {
    pending.add("campaign_switch_held");
    record({
      step: "shop_config.write",
      ok: false,
      detail: "campaign switch held at 'no campaign': not every discount got its new variables; the next sync finishes it",
    });
    return;
  }
  if (staleRisk) {
    pending.add("stale_product_refs");
    record({
      step: "shop_config.write",
      ok: false,
      detail:
        "held: some products could not be cleared of rules they no longer belong to, so the new config is not applied yet (the previous one stays); the next sync retries",
    });
    return;
  }
  await writeShopConfig(deps, transport, shopState.id, stored, payload, "shop_config", record);
}

/** `campaignVarsVersion` of a shop config JSON (null = no campaign, or unreadable). */
function campaignVersionOf(json: string): string | null {
  try {
    const value = (JSON.parse(json) as { campaignVarsVersion?: unknown } | null)?.campaignVarsVersion;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Replace the shop function_config with `payload` (skipped when equal), read
 * it back and verify it; on a failed verify, restore `previous` when it
 * verifies. Returns whether `payload` is now in place, and what is stored.
 */
async function writeShopConfig(
  deps: SyncDeps,
  transport: Transport,
  shopId: string,
  previous: string | null,
  payload: { json: string; bytes: number },
  prefix: string,
  record: (step: SyncStep) => void,
): Promise<{ ok: boolean; stored: string | null }> {
  if (previous !== null && sameJson(previous, payload.json)) {
    const check = deps.verifyShopFunctionConfig(previous);
    record({
      step: `${prefix}.write`,
      ok: check.ok,
      detail: check.ok ? `unchanged (${check.bytes} B)` : `the stored config does not verify: ${check.reason} (${check.bytes} B)`,
    });
    return { ok: check.ok, stored: previous };
  }

  const write = (value: string) =>
    setMetafields(transport, [{ ownerId: shopId, namespace: WON_NAMESPACE, key: SHOP_CONFIG_KEY, type: "json", value }]);
  const verified = async (expected: string): Promise<{ ok: true; bytes: number } | { ok: false; reason: string }> => {
    let value: string | null;
    try {
      const data: { shop: { metafield: { value: string } | null } } = await transport.call("shopConfigReadBack");
      value = data.shop.metafield?.value ?? null;
    } catch (error) {
      if (error instanceof Response) throw error;
      return { ok: false, reason: `read-back failed: ${errorText(error)}` };
    }
    if (value === null) return { ok: false, reason: "the metafield is missing after the write" };
    const check = deps.verifyShopFunctionConfig(value);
    if (!check.ok) return { ok: false, reason: `${check.reason} (${check.bytes} B)` };
    if (!sameJson(value, expected)) return { ok: false, reason: "the stored value differs from the value written" };
    return { ok: true, bytes: check.bytes };
  };

  const error = await write(payload.json);
  if (error) {
    record({ step: `${prefix}.write`, ok: false, detail: `could not write the shop config: ${error} — the previous config stays active` });
    return { ok: false, stored: previous };
  }
  record({ step: `${prefix}.write`, ok: true, detail: `${payload.bytes} B written` });

  const check = await verified(payload.json);
  if (check.ok) {
    record({ step: `${prefix}.verify`, ok: true, detail: `read back and verified (${check.bytes} B)` });
    return { ok: true, stored: payload.json };
  }
  record({ step: `${prefix}.verify`, ok: false, detail: `the shop config did not verify: ${check.reason}` });

  if (previous === null || !deps.verifyShopFunctionConfig(previous).ok) {
    record({
      step: `${prefix}.rollback`,
      ok: false,
      detail: "no valid previous config to restore — Won discounts stay off until the next successful sync",
    });
    return { ok: false, stored: null };
  }
  const rollbackError = await write(previous);
  const rolledBack = rollbackError ? { ok: false as const, reason: rollbackError } : await verified(previous);
  record({
    step: `${prefix}.rollback`,
    ok: rolledBack.ok,
    detail: rolledBack.ok ? "the previous config was restored" : `could not restore the previous config: ${rolledBack.reason}`,
  });
  return { ok: false, stored: rolledBack.ok ? previous : null };
}

async function persist(
  deps: SyncDeps,
  shop: string,
  startedAt: Date,
  steps: SyncStep[],
  pending: PendingWork[],
  configVersionId: string | null,
): Promise<SyncResult> {
  const failed = steps.filter((step) => !step.ok);
  const ok = failed.length === 0 && steps.length > 0;
  const errors = failed.map((step) => `${step.step}: ${step.detail}`);
  let runId: string | null = null;
  try {
    const run = await deps.db.syncRun.create({
      data: {
        shop,
        startedAt,
        finishedAt: deps.now(),
        ok,
        steps: JSON.stringify(steps),
        errorCount: failed.length,
        pending: pending.length ? JSON.stringify(pending) : null,
        configVersionId,
      },
    });
    runId = run.id;
    const keep = await deps.db.syncRun.findMany({
      where: { shop },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: SYNC_RUNS_KEPT,
      select: { id: true },
    });
    await deps.db.syncRun.deleteMany({ where: { shop, id: { notIn: keep.map((row) => row.id) } } });
  } catch (error) {
    deps.logger.error(`sync ${shop}: could not record the sync run: ${errorText(error)}`);
  }
  if (ok) deps.logger.info(`sync ${shop}: ok (${steps.length} steps)`);
  else deps.logger.warn(`sync ${shop}: ${failed.length} failed step(s); pending: ${pending.join(", ") || "none"}`);
  return { ok, steps, errors, pending, runId };
}
