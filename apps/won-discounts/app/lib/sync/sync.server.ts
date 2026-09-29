// syncShop: writes a saved Won Discounts config into Shopify (spec §1 "Sync
// vrstva, jediný zapisovač do Shopify", §3 "Emise per uzel" + "Transport
// configu", §9). Every step is recorded; the result is persisted as a SyncRun
// (last SYNC_RUNS_KEPT per shop, with the work left `pending`) for the Přehled.
// The config is synced AS SAVED: market countries were resolved at save time
// (markets.ts), nothing is swapped here.
//
// Order (T1 function-payload.ts "Sync sequences"; the shop config is the flip):
//   0. read the shop (id, time zone, currency, current function_config); build
//      the shop payload with the shop currency (the margin's `cur`: without it
//      every cost is unknown) — if it does not fit the 9 000 B budget, STOP
//      before any write (saveConfig measured the same payload, so an accepted
//      save never stops here);
//   P1. only when the campaign version changes (another selected campaign or
//      window, or the campaign ended/was killed): write a NO-CAMPAIGN shop
//      config first (`forceNoCampaign`), read back + verified. If P1 fails, the
//      run STOPS there (M2): nothing else was written yet, the running campaign
//      stays intact on every node;
//   1. discount nodes (node-sync.ts): 1 automatic + 1 per code rule — create /
//      update / activate / DEACTIVATE / delete, redeem codes; new nodes get
//      their function_vars in the create;
//   2. function_vars on every other active node;
//   3. product metafields, BEFORE lane (products.ts): every change to a product
//      that already carries Won refs, and every clear;
//   4. the final shared shop function_config, read back and checked with
//      the engine's verifyShopFunctionConfig (C7: > 10 000 B reaches the
//      function as null WITHOUT an error). It is HELD (not written) when:
//        - a campaign switch's phase 2 is incomplete (some active node lacks
//          its new vars) — the shop stays at "no campaign", consistent;
//        - the product step leaves stale refs (a product that left a rule's
//          target could not be cleared, a write that removes a ref failed, or
//          the step could not finish) — the previous config stays, so no
//          product receives a rule's NEW value through a ref it should no
//          longer have (M1, audit P2-1);
//   5. product metafields, AFTER lane: products that carry no Won refs yet and
//      only gain some. `productWrites: "background"` (the admin save, item 7)
//      runs it in this process's per-shop queue after the run returned; the
//      run is recorded with pending `products_in_progress` and the lane
//      records its own SyncRun. A newer sync of the shop cancels a queued or
//      running lane at its next batch (it redoes the work). Held config →
//      the lane is skipped (nothing runs ahead of the config).
//   Steady state (campaign version unchanged) = steps 1–5, one shop write.
//
// BILL-1 (audit P1-1): before step 0's payload, the config is gated for the
// shop's plan (deps.plan → gateConfigForPlan): a Free shop's payload, nodes
// and product refs never carry Pro capabilities. The STORED config is never
// changed (§14a); the admin explains what is not in force (explainGate).
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
//     that only ADDS refs leaves a product without a new ref (it lacks that
//     discount until the next sync). These windows last until the next
//     successful sync.
//   - Remaining window: after a HELD config, nodes and the BEFORE lane's refs
//     are already the new ones while the old config runs: a NEW rule's nodes
//     are inert (unknown to the old config); a product that already carried
//     Won refs and gained a ref of an EXISTING rule gets that rule's OLD value;
//     a code rule just DEACTIVATED or DELETED stops at once (its node is
//     expired / gone) although the old config still lists it. Each such run is
//     marked pending and retried (resyncIfPending, on the next Přehled load).
//   - Everything is idempotent (unchanged state → no mutation); a lost create
//     response is recovered by lookup, never duplicated (node-sync.ts).
//   - Runs for one shop (and their background lanes) are serialised in this
//     process (isSyncRunning / syncIdle expose the queue). Two app instances
//     syncing the same shop at once are not coordinated [unverified: MVP 1
//     runs one instance]; adopt-before-create keeps it from duplicating nodes.

import { gateConfigForPlan, type ShopPlan, type StrippedCapability } from "@won/core/discounts/plan-gate";

import { SHOP_CONFIG_KEY, WON_NAMESPACE } from "./graphql";
import { desiredNodes, SYNC_RUNS_KEPT, type DesiredNode } from "./nodes";
import { NodeSync } from "./node-sync";
import { applyProductAdditions, applyProductChanges, planProducts, syncProducts, type ProductSyncArgs } from "./products";
import { clearSyncProgress } from "./progress";
import { recordAppliedPlan, recordProductsSynced, recordShopTimezone } from "./sync-state.server";
import { errorText, setMetafields, Transport } from "./transport";
import type { ConfigView, PendingWork, SyncDeps, SyncResult, SyncStep } from "./types";
import { parseSteps, shopConfigApplied } from "./runs";
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

/**
 * A queued or running background product pass of a shop: a save's AFTER lane
 * or a products-only targeting refresh. A newer sync request cancels it.
 */
interface BackgroundLane {
  cancelled: boolean;
  kind: "additions" | "refresh";
}
const lanes = new Map<string, BackgroundLane>();
/** Settings syncs (runSync) queued or running per shop — not the product lanes. */
const settingsRuns = new Map<string, number>();

/** Chain `work` after everything queued for `shop` in this process. */
function enqueue<T>(shop: string, work: () => Promise<T>): Promise<T> {
  const previous = inflight.get(shop) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  inflight.set(shop, run);
  void run
    .finally(() => {
      if (inflight.get(shop) === run) inflight.delete(shop);
    })
    .catch(() => undefined);
  return run;
}

/** True while a sync, a product refresh or a background product lane of `shop` is queued or running here. */
export function isSyncRunning(shop: string): boolean {
  return inflight.has(shop);
}

/** True while a settings sync (not only a background product pass) of `shop` is queued or running here. */
export function isSettingsSyncRunning(shop: string): boolean {
  return (settingsRuns.get(shop) ?? 0) > 0;
}

/** The background product pass of `shop` queued or running here, if any ("additions" after a save, or a targeting "refresh"). */
export function backgroundProductPass(shop: string): BackgroundLane["kind"] | null {
  const lane = lanes.get(shop);
  return lane && !lane.cancelled ? lane.kind : null;
}

/** Resolves when nothing is queued or running for `shop` any more (tests, scripts). */
export async function syncIdle(shop: string): Promise<void> {
  for (let current = inflight.get(shop); current; current = inflight.get(shop)) {
    await current.catch(() => undefined);
    if (inflight.get(shop) === current) break;
  }
}

/** Per shop: bumped by every sync / refresh request, so a lane knows a newer one came after it. */
const generations = new Map<string, number>();

/**
 * A newer sync of the shop supersedes its queued / running background lane
 * (it redoes that work) — also a lane its run has not queued yet. Returns the
 * new request's generation.
 */
function supersede(shop: string): number {
  const lane = lanes.get(shop);
  if (lane) lane.cancelled = true;
  const next = (generations.get(shop) ?? 0) + 1;
  generations.set(shop, next);
  if (generations.size > 10_000) generations.delete(generations.keys().next().value as string);
  return next;
}

export interface SyncShopOptions {
  /**
   * The ConfigVersion `config` was saved as, recorded on the SyncRun (the
   * version link the admin's "Běží" compares with; null/absent = unknown).
   */
  configVersionId?: string | null;
  /**
   * The AFTER lane (products that only gain rules): "inline" (default) waits
   * for it; "background" returns after the shop config and writes them in
   * this process's queue (the admin save, item 7).
   */
  productWrites?: "inline" | "background";
}

export interface Sync {
  syncShop(shop: string, config: ConfigView, options?: SyncShopOptions): Promise<SyncResult>;
  /**
   * Only the product targeting (webhook-driven refresh, "Obnovit cílení", the
   * Přehled's 24 h refresh): the shop config is not touched. Recorded as its
   * own SyncRun. `productWrites: "background"` (the admin, F2 re-review I-1)
   * queues the whole pass in this process's per-shop queue and answers at
   * once — nobody waits for it, and a newer sync cancels it at its next
   * Shopify call (it redoes the work anyway).
   */
  refreshProducts(shop: string, config: ConfigView, options?: SyncShopOptions): Promise<SyncResult>;
  /** The plan the syncs of this instance gate for (the same resolver the sync itself uses, BILL-1). */
  plan(shop: string): Promise<ShopPlan>;
}

export function createSync(deps: SyncDeps): Sync {
  return {
    syncShop(shop, config, options = {}) {
      const generation = supersede(shop);
      settingsRuns.set(shop, (settingsRuns.get(shop) ?? 0) + 1);
      return enqueue(shop, () => runSync(deps, shop, config, options, generation)).finally(() => {
        const left = (settingsRuns.get(shop) ?? 1) - 1;
        if (left > 0) settingsRuns.set(shop, left);
        else settingsRuns.delete(shop);
      });
    },
    refreshProducts(shop, config, options = {}) {
      supersede(shop);
      const lane: BackgroundLane = { cancelled: false, kind: "refresh" };
      lanes.set(shop, lane);
      const run = enqueue(shop, () => runProductRefresh(deps, shop, config, options.configVersionId ?? null, lane));
      if (options.productWrites !== "background") {
        return run.then((result) => result ?? cancelledResult());
      }
      void run.catch((error: unknown) => deps.logger.error(`sync ${shop}: background targeting refresh failed: ${errorText(error)}`));
      return Promise.resolve(queuedRefreshResult());
    },
    plan: (shop) => deps.plan(shop),
  };
}

/** What a queued background refresh answers at once (its own SyncRun comes when it is done). */
function queuedRefreshResult(): SyncResult {
  return {
    ok: true,
    steps: [{ step: "products.refresh", ok: true, detail: "the product targeting is being refreshed in the background" }],
    errors: [],
    pending: ["products_in_progress"],
    runId: null,
    background: {},
  };
}

/** An inline refresh that a newer sync superseded before it finished (nothing recorded). */
function cancelledResult(): SyncResult {
  return {
    ok: true,
    steps: [{ step: "products.refresh", ok: true, detail: "superseded by a newer sync, which refreshes the targeting itself" }],
    errors: [],
    pending: [],
    runId: null,
  };
}

/** One line for support: what the plan gate took out of the payload. */
function gateDetail(plan: string, stripped: readonly StrippedCapability[]): string {
  const items = stripped.map((s) => `${s.capability}${s.ruleId ? `:${s.ruleId}` : s.entityId ? `:${s.entityId}` : ""}`);
  return `plan ${plan}: ${stripped.length} Pro setting(s) not applied (${items.slice(0, 10).join(", ")}${items.length > 10 ? ", …" : ""})`;
}

interface ShopState {
  id: string;
  timeZone: string;
  /** Shopify shop.currencyCode (undefined when Shopify did not say). */
  currency: string | undefined;
  functionConfig: string | null;
}

async function runSync(deps: SyncDeps, shop: string, config: ConfigView, options: SyncShopOptions, generation: number): Promise<SyncResult> {
  const startedAt = deps.now();
  const configVersionId = options.configVersionId ?? null;
  const steps: SyncStep[] = [];
  const pending = new Set<PendingWork>();
  const record = (step: SyncStep) => {
    steps.push(step);
    if (!step.ok) deps.logger.warn(`sync ${shop}: ${step.step} failed: ${step.detail}`);
  };
  const transport = new Transport(deps.client, deps.retry, deps.sleep, deps.logger);
  let rethrow: unknown = null;
  let after: AfterLane | null = null;
  try {
    after = await syncSteps({ deps, transport, shop, config, now: startedAt, record, pending });
  } catch (error) {
    // A thrown Response is a re-auth redirect for the embedded admin: record, then let it reach the route.
    if (error instanceof Response) rethrow = error;
    record({ step: "sync", ok: false, detail: `stopped: ${errorText(error)}` });
  }
  let background: SyncResult["background"];
  if (after && after.additions.length > 0 && options.productWrites === "background" && !rethrow) {
    pending.add("products_in_progress");
    background = { products: after.additions.length };
  } else if (after && !rethrow) {
    // Inline: the AFTER lane now (the shop config is already in place).
    try {
      const added = await applyProductAdditions(after.args, after.additions);
      for (const step of added.steps) record(step);
    } catch (error) {
      if (error instanceof Response) rethrow = error;
      record({ step: "products.add", ok: false, detail: `products that get new rules: ${errorText(error)}` });
    }
  }
  if (steps.some((step) => !step.ok)) pending.add("failed_steps");
  if (steps.some((step) => /still running/.test(step.detail))) pending.add("codes_in_progress");
  const result = await persist(deps, shop, startedAt, steps, [...pending], configVersionId);
  if (after?.productsComplete && !background && result.ok) await bookkeeping(deps, shop, () => recordProductsSynced(deps.db, shop, startedAt));
  if (!background) clearSyncProgress(shop);
  if (background && after) {
    // Superseded already when a newer request came in while this run was going.
    const lane: BackgroundLane = { cancelled: generations.get(shop) !== generation, kind: "additions" };
    lanes.set(shop, lane);
    const lanePlan = after;
    void enqueue(shop, () => runBackgroundLane(deps, shop, lane, lanePlan, startedAt, configVersionId)).catch(() => undefined);
  }
  if (rethrow) throw rethrow;
  return background ? { ...result, background } : result;
}

/** Bookkeeping never fails a sync (it is a hint for the admin, not a fact the sync relies on). */
async function bookkeeping(deps: SyncDeps, shop: string, write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (error) {
    deps.logger.warn(`sync ${shop}: could not record sync state: ${errorText(error)}`);
  }
}

/** The AFTER lane in the background: its own SyncRun, unless a newer sync superseded it. */
async function runBackgroundLane(
  deps: SyncDeps,
  shop: string,
  lane: BackgroundLane,
  after: AfterLane,
  mainStartedAt: Date,
  configVersionId: string | null,
): Promise<SyncResult | null> {
  const startedAt = deps.now();
  const steps: SyncStep[] = [];
  try {
    if (lane.cancelled) return null;
    const added = await applyProductAdditions(after.args, after.additions, { isCancelled: () => lane.cancelled });
    if (added.cancelled) return null;
    steps.push(...added.steps);
  } catch (error) {
    steps.push({ step: "products.add", ok: false, detail: `products that get new rules: ${errorText(error)}` });
  } finally {
    if (lanes.get(shop) === lane) lanes.delete(shop);
    clearSyncProgress(shop);
  }
  const failed = steps.some((step) => !step.ok);
  const result = await persist(deps, shop, startedAt, steps, failed ? ["failed_steps"] : [], configVersionId);
  if (!failed && after.productsComplete) await bookkeeping(deps, shop, () => recordProductsSynced(deps.db, shop, mainStartedAt));
  return result;
}

/**
 * Products only (no shop config): the targeting refresh. Null = superseded by
 * a newer sync before it finished (nothing recorded; the newer one redoes it).
 */
async function runProductRefresh(
  deps: SyncDeps,
  shop: string,
  config: ConfigView,
  configVersionId: string | null,
  lane: BackgroundLane,
): Promise<SyncResult | null> {
  const startedAt = deps.now();
  const steps: SyncStep[] = [];
  const pending = new Set<PendingWork>();
  const transport = new Transport(deps.client, deps.retry, deps.sleep, deps.logger);
  let rethrow: unknown = null;
  let complete = false;
  try {
    if (lane.cancelled) return null;
    const plan = await deps.plan(shop);
    const gated = gateConfigForPlan(config, plan).config;
    const result = await syncProducts({
      transport,
      db: deps.db,
      shop,
      config: gated,
      productRuleIndex: deps.productRuleIndex,
      isCancelled: () => lane.cancelled,
    });
    if (result.cancelled) return null;
    steps.push(...result.steps);
    if (result.staleRisk) pending.add("stale_product_refs");
    complete = !result.staleRisk && result.steps.every((step) => step.ok);
  } catch (error) {
    if (error instanceof Response) rethrow = error;
    steps.push({ step: "products", ok: false, detail: `product targeting: ${errorText(error)}` });
  } finally {
    if (lanes.get(shop) === lane) lanes.delete(shop);
    clearSyncProgress(shop);
  }
  if (steps.length === 0) steps.push({ step: "products", ok: true, detail: "no targeted products and none to clean" });
  if (steps.some((step) => !step.ok)) pending.add("failed_steps");
  const result = await persist(deps, shop, startedAt, steps, [...pending], configVersionId);
  if (complete && result.ok) await bookkeeping(deps, shop, () => recordProductsSynced(deps.db, shop, startedAt));
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

/** What is left for the AFTER lane once the shop config is written. */
interface AfterLane {
  args: ProductSyncArgs;
  additions: Parameters<typeof applyProductAdditions>[1];
  /** The product plan finished and the BEFORE lane had no failure (the targeting is fresh once the lane is done). */
  productsComplete: boolean;
}

async function syncSteps({ deps, transport, shop, config: stored, now, record, pending }: StepsArgs): Promise<AfterLane | null> {
  // 0. Shop + payload.
  let shopState: ShopState;
  try {
    const data: { shop: { id: string; ianaTimezone: string; currencyCode?: string | null; functionConfig: { value: string } | null } } =
      await transport.call("shop");
    shopState = {
      id: data.shop.id,
      timeZone: data.shop.ianaTimezone,
      currency: typeof data.shop.currencyCode === "string" && data.shop.currencyCode ? data.shop.currencyCode : undefined,
      functionConfig: data.shop.functionConfig?.value ?? null,
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    record({ step: "shop.read", ok: false, detail: `could not read the shop: ${errorText(error)} — nothing was changed` });
    return null;
  }
  const shopTimezone = shopState.timeZone;
  const nowLocal = shopLocalDateTime(now, shopTimezone);
  record({ step: "shop.read", ok: true, detail: `${shopState.id}, shop time ${nowLocal} (${shopTimezone}), currency ${shopState.currency ?? "unknown"}` });
  await bookkeeping(deps, shop, () => recordShopTimezone(deps.db, shop, shopTimezone));

  // BILL-1: what this shop's plan may run.
  const plan = await deps.plan(shop);
  const gate = gateConfigForPlan(stored, plan, { now: nowLocal });
  const config: ConfigView = gate.config;
  record({ step: "plan", ok: true, detail: gate.stripped.length > 0 ? gateDetail(plan, gate.stripped) : `plan ${plan}: nothing to gate` });

  const shopCurrency = shopState.currency;
  const payload = deps.buildShopFunctionConfig(config, { now: nowLocal, shopTimezone, shopCurrency });
  if (!payload.fits) {
    record({
      step: "shop_config.build",
      ok: false,
      detail: `the discount function config is ${payload.bytes} B, over the 9000 B budget — nothing was written`,
    });
    return null;
  }
  let storedJson = shopState.functionConfig;

  // P1. Campaign switch: no-campaign shop config first; stop if it fails (M2).
  const newVersion = campaignVersionOf(payload.json);
  const oldVersion = storedJson === null ? null : campaignVersionOf(storedJson);
  const switching = newVersion !== oldVersion;
  if (switching) {
    const noCampaign = deps.buildShopFunctionConfig(config, { now: nowLocal, shopTimezone, shopCurrency, forceNoCampaign: true });
    const written = await writeShopConfig(deps, transport, shopState.id, storedJson, noCampaign, "shop_config.phase1", record);
    storedJson = written.stored;
    if (written.ok) await bookkeeping(deps, shop, () => recordAppliedPlan(deps.db, shop, plan));
    if (!written.ok) {
      record({
        step: "sync.stopped",
        ok: false,
        detail: "the campaign switch could not start (the no-campaign config was not written); nothing else was changed, the running campaign continues",
      });
      pending.add("campaign_switch_held");
      return null;
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

  // 3. Product metafields, BEFORE lane (products that already carry Won refs, and clears).
  const productArgs: ProductSyncArgs = {
    transport,
    db: deps.db,
    shop,
    config,
    productRuleIndex: deps.productRuleIndex,
    // No shop config in Shopify: the first sync after an install (or a reinstall) — check the index.
    verifyIndex: shopState.functionConfig === null,
  };
  let staleRisk = false;
  let after: AfterLane | null = null;
  try {
    const plan = await planProducts(productArgs);
    for (const step of plan.steps) record(step);
    staleRisk = plan.staleRisk;
    if (plan.complete) {
      const changes = await applyProductChanges(productArgs, plan);
      for (const step of changes.steps) record(step);
      staleRisk = changes.staleRisk;
      after = {
        args: productArgs,
        additions: plan.additions,
        productsComplete: !changes.staleRisk && changes.steps.every((step) => step.ok),
      };
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    staleRisk = true;
    record({ step: "products", ok: false, detail: `product targeting: ${errorText(error)}` });
  }

  // 4. Final shop config (or held).
  if (switching && newVersion !== null && !nodes.varsComplete) {
    pending.add("campaign_switch_held");
    record({
      step: "shop_config.write",
      ok: false,
      detail: "campaign switch held at 'no campaign': not every discount got its new variables; the next sync finishes it",
    });
    return null;
  }
  if (staleRisk) {
    pending.add("stale_product_refs");
    record({
      step: "shop_config.write",
      ok: false,
      detail:
        "held: some products could not be cleared of rules they no longer belong to, so the new config is not applied yet (the previous one stays); the next sync retries",
    });
    return null;
  }
  const written = await writeShopConfig(deps, transport, shopState.id, storedJson, payload, "shop_config", record);
  // I-2: the plan the LIVE shop config was built for (a change of plan is then a reason to resync).
  if (written.ok) await bookkeeping(deps, shop, () => recordAppliedPlan(deps.db, shop, plan));
  // 5. The AFTER lane (runSync runs it inline or queues it) — only behind a config that is in place.
  return written.ok ? after : null;
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
    // The newest SYNC_RUNS_KEPT runs, and ALWAYS the newest run that applied the shop config: it
    // names the config checkout runs ("Běží", "not applied"), and product refreshes must never push
    // it out of the window (F2 re-review).
    const rows = await deps.db.syncRun.findMany({
      where: { shop },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { id: true, steps: true },
    });
    const keep = new Set(rows.slice(0, SYNC_RUNS_KEPT).map((row) => row.id));
    const applying = rows.find((row) => shopConfigApplied(parseSteps(row.steps)));
    if (applying) keep.add(applying.id);
    await deps.db.syncRun.deleteMany({ where: { shop, id: { notIn: [...keep] } } });
  } catch (error) {
    deps.logger.error(`sync ${shop}: could not record the sync run: ${errorText(error)}`);
  }
  if (ok) deps.logger.info(`sync ${shop}: ok (${steps.length} steps)`);
  else deps.logger.warn(`sync ${shop}: ${failed.length} failed step(s); pending: ${pending.join(", ") || "none"}`);
  return { ok, steps, errors, pending, runId };
}
