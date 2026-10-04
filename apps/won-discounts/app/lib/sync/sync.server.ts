// syncShop: writes a saved Won Discounts config into Shopify (spec §1 "Sync
// vrstva, jediný zapisovač do Shopify", §3 "Emise per uzel" + "Transport
// configu", §9). Every step is recorded; the result is persisted as a SyncRun
// (last SYNC_RUNS_KEPT per shop, with the work left `pending`) for the Přehled.
// The config is synced AS SAVED: market countries were resolved at save time
// (markets.ts), nothing is swapped here.
//
// Order (T1 function-payload.ts "Sync sequences"; the shop config is the flip):
//   0. read the shop (id, time zone, currency, current function_config); with
//      margin protection on and NO shop currency, STOP before any write (the
//      margin's `cur`: without it every cost would be unknown at checkout, the
//      percent ceiling alone — the previous config holds, the failed step is
//      retried); read the targeted collections' sizes (products.ts
//      collectionLimits: a margin collection over the 10 000-product limit is
//      FOLDED into the payload's global values, fail closed); build the shop
//      payload with the shop currency — if it does not fit the 9 000 B budget,
//      STOP before any write (saveConfig measured the same payload, so an
//      accepted save never stops here);
//   P1. only when the campaign version changes (another selected campaign or
//      window, or the campaign ended/was killed): write a NO-CAMPAIGN shop
//      config first (`forceNoCampaign`), read back + verified. If P1 fails, the
//      run STOPS there (M2): nothing else was written yet, the running campaign
//      stays intact on every node. Its MARGIN part is the live one, unchanged
//      (audit fix round 4, phaseOnePayload): the products still carry the refs
//      the live settings chose, so the new margin goes out only with the final
//      write, after the BEFORE lane — a held final write never leaves it live.
//      P1 is not "applied" (runs.ts): the plan is recorded with the final write
//      only;
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
//   0b. (MVP 6.1) a campaign's tier sets on the product page: when this run will not show exactly them again
//      (kill switch, another window, other breaks, the end), the base sets go back on the page first
//      (storefront.ts takeBackCampaignTiers) — the page never promises more than the checkout about to change.
//   4b. the storefront config (MVP 3, contract K5, storefront.ts): an app-data
//      metafield built by core buildStorefrontConfig from the SAME gated config
//      as the payload (`limits.payloadConfig`), `cv` = the stored config's F12
//      token; only behind a shop config that is in place, read back; a failure
//      is a failed step (retried by the next sync), never fatal;
//   5. product metafields, AFTER lane: products that carry no Won refs yet and
//      only gain some, the marginRef bridges pruned, and EVERY tierRef change's
//      final value (MVP 3 audit P2-2: the BEFORE lane put TIER_SENTINEL there —
//      no tier while the sync runs — products.ts tierWrites). `productWrites: "background"` (the admin save, item 7)
//      runs it in this process's per-shop queue after the run returned; the
//      run is recorded with pending `products_in_progress` and the lane
//      records its own SyncRun. A newer sync of the shop cancels a queued or
//      running lane at its next batch (it redoes the work). Held config →
//      the lane is skipped (nothing runs ahead of the config).
//   Steady state (campaign version unchanged) = steps 1–5, one shop write.
//   After the run (MVP 3, contract K4), whenever the shop config was written:
//   when its margin part changed, the cost mirror recomputes every variant's
//   `pdp` maximum (a full pass, coalesced with one already queued or running
//   for that margin); else the variants of products whose marginRefs changed
//   (recomputePdp).
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

import { FUNCTION_CONFIG_BUDGET_BYTES } from "@won/core/discounts/function-config";
import { CONFIG_LIMITS } from "@won/core/discounts/config";
import { readMarginPayload, type FunctionMarginPayload } from "@won/core/discounts/margin";
import { gateConfigForPlan, type ShopPlan, type StrippedCapability } from "@won/core/discounts/plan-gate";
import { campaignBoundary, campaignStatusAt, shopLocalToUtc } from "@won/core/discounts/campaigns";
import { campaignTiersShownAt } from "@won/core/discounts/campaign-tiers";

import { fullPassCovers, startCostJob, type CostJob } from "./cost-lane.server";
import { pdpMarginKey } from "./costs";
import { SHOP_CONFIG_KEY, WON_NAMESPACE } from "./graphql";
import { desiredNodes, SYNC_RUNS_KEPT, type DesiredNode } from "./nodes";
import { NodeSync } from "./node-sync";
import {
  applyAfterLane,
  applyProductChanges,
  collectionLimits,
  foldMarginCollections,
  planProducts,
  SyncCancelled,
  syncProducts,
  type FinalWrite,
  type HoldReason,
  type ProductSyncArgs,
} from "./products";
import { clearSyncProgress } from "./progress";
import {
  loadShopSyncFacts,
  recordAppliedPlan,
  recordCampaignBoundary,
  recordCampaignsFinishing,
  recordProductsSynced,
  recordShopTimezone,
} from "./sync-state.server";
import { takeBackCampaignTiers, writeStorefrontConfig } from "./storefront";
import { errorText, setMetafields, Transport } from "./transport";
import type { ConfigView, PendingWork, ShopConfigBuild, SyncDeps, SyncResult, SyncStep } from "./types";
import { foldedIn } from "./margin-fold";
import { appliedRun, parseSteps, shopConfigApplied } from "./runs";
import { canonicalJson, isoCurrency, sameJson } from "./util";

/** A held campaign switch is retried this long after (scheduler campaigns.due, K4). */
export const CAMPAIGN_HELD_RETRY_MS = 5 * 60_000;

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

/** Products per pdp recompute sent as one "items" job; more → a full pass (like the webhook queue, COST_QUEUE_MAX). */
export const PDP_ITEMS_MAX = 250;

/**
 * MVP 3 (contract K4): the variant `pdp` maximum follows the margin checkout
 * runs and each product's marginRefs, so the cost mirror recomputes it when
 * they change, in the shop's cost lane (it re-reads the stored config and
 * skips while protection is off; never awaited, never fails the sync):
 *   { margin }  the margin the shop config ships changed: a full pass — none
 *               when one for that margin is already queued or running
 *               (fullPassCovers: coalesced); else one that resumes a cursor
 *               only under the same margin (costs.ts runCostPass), so a pass
 *               cut short under the old margin starts over, and that keeps the
 *               refusal back-off;
 *   products    those whose marginRefs changed: their variants ("items"); past
 *               PDP_ITEMS_MAX one full pass from the start (refs changed, so
 *               pages already passed are stale), back-off kept.
 * Until it ran, a variant's pdp says what the previous settings allowed
 * (checkout is authoritative).
 */
function recomputePdp(deps: SyncDeps, shop: string, what: { margin: string } | readonly string[]): void {
  let job: CostJob;
  if ("margin" in what) {
    if (fullPassCovers(shop, what.margin)) return;
    job = { kind: "full" };
  } else if (what.length === 0) return;
  else job = what.length > PDP_ITEMS_MAX ? { kind: "full", restart: true, retryRefused: false } : { kind: "items", productIds: [...what] };
  const lane = { client: deps.client, db: deps.db, plan: deps.plan, now: deps.now, logger: deps.logger, ...(deps.sleep ? { sleep: deps.sleep } : {}), ...(deps.retry ? { retry: deps.retry } : {}) };
  void startCostJob(shop, lane, job);
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
  let outcome: StepsOutcome | null = null;
  try {
    outcome = await syncSteps({ deps, transport, shop, config, configVersionId, now: startedAt, record, pending });
  } catch (error) {
    // A thrown Response is a re-auth redirect for the embedded admin: record, then let it reach the route.
    if (error instanceof Response) rethrow = error;
    record({ step: "sync", ok: false, detail: `stopped: ${errorText(error)}` });
  }
  const after = outcome?.after ?? null;
  let background: SyncResult["background"];
  if (after && after.additions.length + after.prunes.length + after.tierWrites.length > 0 && options.productWrites === "background" && !rethrow) {
    pending.add("products_in_progress");
    // "Produkty, které slevu nově dostanou (N)": only the products that GAIN refs; pruned bridges are not news.
    background = after.additions.length > 0 ? { products: after.additions.length } : {};
  } else if (after && !rethrow) {
    // Inline: the AFTER lane now (the shop config is already in place).
    try {
      const lane = await applyAfterLane(after.args, after);
      for (const step of lane.steps) record(step);
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
  // MVP 3 (pdp), whenever the shop config was written: the margin it ships changed → every variant's pdp floor;
  // else the products whose marginRefs changed (all written in the BEFORE lane, so they are in place now).
  if (outcome && !rethrow) recomputePdp(deps, shop, outcome.marginKey !== null ? { margin: outcome.marginKey } : (after?.pdpProducts ?? []));
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
    const done = await applyAfterLane(after.args, after, { isCancelled: () => lane.cancelled });
    if (done.cancelled) return null;
    steps.push(...done.steps);
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
 * Does the shop config live in Shopify fold EXACTLY these margin collections
 * (its applying run reported the same ones too large)? A difference either
 * way — one grew past the limit, or one the live config folds fits again —
 * means the live payload no longer matches what the admin and the product
 * refs assume (audit fix round 3).
 */
async function liveFoldMatches(deps: SyncDeps, shop: string, collectionIds: readonly string[]): Promise<boolean> {
  const run = await appliedRun(deps.db, shop);
  const live = new Set(run ? foldedIn(run.steps).map((m) => m.collectionId) : []);
  return live.size === new Set(collectionIds).size && collectionIds.every((id) => live.has(id));
}

/**
 * Products only (no shop config): the targeting refresh. Null = superseded by
 * a newer sync before it finished (nothing recorded; the newer one redoes it).
 * A margin collection that grew past the 10 000-product limit since the live
 * config was written — or one the live config folds that fits again —
 * escalates it to a full sync in the same queue slot (the fold is in the
 * payload): counted as a settings sync while it runs, the lane kept until it
 * is done, and never when a newer sync superseded the refresh meanwhile.
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
  let escalate = false;
  try {
    if (lane.cancelled) return null;
    const plan = await deps.plan(shop);
    // MVP 6 K3: the campaigns finishing after a downgrade keep their refs here too (the zone of the last sync).
    const facts = await loadShopSyncFacts(deps.db, shop);
    const laneNow = facts.timezone ? shopLocalDateTime(startedAt, facts.timezone) : undefined;
    const gated = gateConfigForPlan(config, plan, { ...(laneNow ? { now: laneNow } : {}), finishing: facts.campaignsFinishing ?? [] }).config;
    // Audit fix round 2: a margin collection that grew past the limit must be folded into the LIVE payload,
    // which a products-only refresh does not write — a full sync does it, unless the live config folds it already.
    const limits = await collectionLimits({ transport, config: gated, isCancelled: () => lane.cancelled });
    if (!(await liveFoldMatches(deps, shop, limits.marginTooLarge.map((m) => m.collectionId)))) {
      escalate = true;
    } else {
      const result = await syncProducts({
        transport,
        db: deps.db,
        shop,
        config: gated,
        productRuleIndex: deps.productRuleIndex,
        isCancelled: () => lane.cancelled,
        limits,
      });
      if (result.cancelled) return null;
      steps.push(...result.steps);
      recomputePdp(deps, shop, result.marginRefsChanged);
      if (result.staleRisk) pending.add("stale_product_refs");
      complete = !result.staleRisk && result.steps.every((step) => step.ok);
    }
  } catch (error) {
    if (error instanceof SyncCancelled) return null;
    if (error instanceof Response) rethrow = error;
    steps.push({ step: "products", ok: false, detail: `product targeting: ${errorText(error)}` });
  } finally {
    if (!escalate || rethrow) {
      if (lanes.get(shop) === lane) lanes.delete(shop);
      clearSyncProgress(shop);
    }
  }
  if (escalate && !rethrow) {
    try {
      // A newer sync superseded this refresh meanwhile: it runs the whole sync itself.
      if (lane.cancelled) return null;
      // The whole sync, in this queue slot (it folds the payload and writes the refs in the right order):
      // a settings sync while it runs (isSettingsSyncRunning), still this lane (backgroundProductPass).
      settingsRuns.set(shop, (settingsRuns.get(shop) ?? 0) + 1);
      try {
        return await runSync(deps, shop, config, { configVersionId, productWrites: "inline" }, generations.get(shop) ?? 0);
      } finally {
        const left = (settingsRuns.get(shop) ?? 1) - 1;
        if (left > 0) settingsRuns.set(shop, left);
        else settingsRuns.delete(shop);
      }
    } finally {
      if (lanes.get(shop) === lane) lanes.delete(shop);
      clearSyncProgress(shop);
    }
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
  /** The ConfigVersion `config` was saved as (the storefront config's `cv`). */
  configVersionId: string | null;
  now: Date;
  record: (step: SyncStep) => void;
  pending: Set<PendingWork>;
}

/** A run whose shop config is in place (written, or already equal): its AFTER lane and what the pdp floor needs. */
interface StepsOutcome {
  /** Null when the product plan did not finish (nothing for the AFTER lane). */
  after: AfterLane | null;
  /** The margin part of the shop config changed and protection is on: its key (MVP 3, every pdp recomputed); else null. */
  marginKey: string | null;
}

/** What is left for the AFTER lane once the shop config is written. */
interface AfterLane {
  args: ProductSyncArgs;
  /** Products whose marginRefs this run changed (MVP 3: their variants' pdp floor is recomputed). */
  pdpProducts: readonly string[];
  additions: Parameters<typeof applyAfterLane>[1]["additions"];
  /** Products that carried a marginRef bridge across the flip: their final value (products.ts bridgeMarginRefs). */
  prunes: FinalWrite[];
  /** Products whose tierRef changes: their final value, only ever after the flip (MVP 3, products.ts tierWrites). */
  tierWrites: FinalWrite[];
  /** The product plan finished and the BEFORE lane had no failure (the targeting is fresh once the lane is done). */
  productsComplete: boolean;
}

async function syncSteps({ deps, transport, shop, config: stored, configVersionId, now, record, pending }: StepsArgs): Promise<StepsOutcome | null> {
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
  const finishing = await campaignsFinishingFor(deps, shop, stored, plan, nowLocal);
  const gate = gateConfigForPlan(stored, plan, { now: nowLocal, finishing });
  const config: ConfigView = gate.config;
  record({ step: "plan", ok: true, detail: gate.stripped.length > 0 ? gateDetail(plan, gate.stripped) : `plan ${plan}: nothing to gate` });

  const shopCurrency = shopState.currency;
  if (config.modules.margin.enabled === true && !shopCurrency) {
    // Audit P2-1(d): never a margin payload without `cur` (every cost unknown, the % ceiling alone).
    record({
      step: "shop.currency",
      ok: false,
      detail: "Shopify did not say the shop currency, which margin protection needs to know the purchase costs — nothing was changed, the previous config stays; the next sync retries",
    });
    return null;
  }
  // The collection size check, once: the product refs use `limits.config`, the payload `limits.payloadConfig` (P1-1).
  // The live config's margin collections are read too (membership for the marginRef bridge, audit fix round 3).
  const liveMargin = shopState.functionConfig !== null ? liveMarginOf(shopState.functionConfig) : null;
  const alsoRead = liveMargin?.enabled && liveMargin.col ? Object.keys(liveMargin.col).map((key) => `gid://shopify/Collection/${key}`) : [];
  const limits = await collectionLimits({ transport, config, alsoRead });
  const payloadConfig = limits.payloadConfig;
  const payload = deps.buildShopFunctionConfig(payloadConfig, { now: nowLocal, shopTimezone, shopCurrency });
  if (!payload.fits) {
    record({ step: "shop_config.build", ok: false, ...overBudget(payload, "nothing was written") });
    return null;
  }
  let storedJson = shopState.functionConfig;

  // Audit C1 (K4): a held switch is retried by the scheduler (campaigns.due) 5 minutes on, even when no
  // boundary was recorded before (a first campaign, a killed one).
  const holdSwitch = async () => {
    pending.add("campaign_switch_held");
    await bookkeeping(deps, shop, () => recordCampaignBoundary(deps.db, shop, new Date(now.getTime() + CAMPAIGN_HELD_RETRY_MS)));
  };

  // MVP 6.1 (L7, E4): a campaign's tier sets leave the product page before any shop config write that changes
  // them — only looked at when a campaign with tier sets is in play (the stored config, or the live shop config).
  const shownCampaign = campaignTiersShownAt(payloadConfig, nowLocal);
  if (campaignTiersInPlay(stored, storedJson)) {
    const next = deps.buildStorefrontConfig(payloadConfig, { configVersion: "", campaignId: shownCampaign });
    await takeBackCampaignTiers({ transport, next: { tiers: next.tiers, ...(next.tc ? { tc: next.tc } : {}) }, record });
  }

  // P1. Campaign switch: no-campaign shop config first; stop if it fails (M2).
  const newVersion = campaignVersionOf(payload.json);
  const oldVersion = storedJson === null ? null : campaignVersionOf(storedJson);
  const switching = newVersion !== oldVersion;
  if (switching) {
    const noCampaign = phaseOnePayload(deps, payloadConfig, storedJson, { now: nowLocal, shopTimezone, shopCurrency });
    if (!noCampaign.fits) {
      record({ step: "shop_config.phase1.build", ok: false, ...overBudget(noCampaign, "nothing was written, the running campaign continues", "the no-campaign config") });
      await holdSwitch();
      return null;
    }
    const written = await writeShopConfig(deps, transport, shopState.id, storedJson, noCampaign, "shop_config.phase1", record);
    storedJson = written.stored;
    // No recordAppliedPlan here (audit fix round 4): phase 1 is not "applied" (runs.ts shopConfigApplied) — its
    // margin is still the one the last applying run wrote, so the fold views and the plan agree on that run.
    if (!written.ok) {
      record({
        step: "sync.stopped",
        ok: false,
        detail: "the campaign switch could not start (the no-campaign config was not written); nothing else was changed, the running campaign continues",
      });
      await holdSwitch();
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
  const bridgeFrom = storedJson !== null ? marginChange(storedJson, payload.json) : null;
  const productArgs: ProductSyncArgs = {
    transport,
    db: deps.db,
    shop,
    config,
    productRuleIndex: deps.productRuleIndex,
    // No shop config in Shopify: the first sync after an install (or a reinstall) — check the index.
    verifyIndex: shopState.functionConfig === null,
    limits,
    // The config flips after the BEFORE lane: when its MARGIN part changes, marginRef changes carry a bridge
    // across it, built with the margin settings of the config LIVE until the flip (audit fix rounds 2–4). After
    // a phase 1 that is still the live margin (phaseOnePayload).
    ...(bridgeFrom ? { bridgeFrom } : {}),
  };
  let staleRisk = false;
  let holdReason: HoldReason = "products_unread";
  let after: AfterLane | null = null;
  try {
    const plan = await planProducts(productArgs);
    for (const step of plan.steps) record(step);
    staleRisk = plan.staleRisk;
    if (plan.complete) {
      const changes = await applyProductChanges(productArgs, plan);
      for (const step of changes.steps) record(step);
      staleRisk = changes.staleRisk;
      holdReason = changes.holdReason ?? holdReason;
      after = {
        args: productArgs,
        pdpProducts: plan.marginRefsChanged,
        additions: plan.additions,
        prunes: plan.prunes,
        tierWrites: plan.tierWrites,
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
    await holdSwitch();
    record({
      step: "shop_config.write",
      ok: false,
      detail: "campaign switch held at 'no campaign': not every discount got its new variables; the next sync finishes it",
    });
    return null;
  }
  if (staleRisk) {
    pending.add("stale_product_refs");
    record({ step: "shop_config.write", ok: false, detail: HOLD_DETAIL[holdReason], params: { held: holdReason } });
    return null;
  }
  const written = await writeShopConfig(deps, transport, shopState.id, storedJson, payload, "shop_config", record);
  if (!written.ok) return null;
  // I-2: the plan the LIVE shop config was built for (a change of plan is then a reason to resync).
  await bookkeeping(deps, shop, () => recordAppliedPlan(deps.db, shop, plan));
  // MVP 6 K4: when the selected campaign changes next (its end; MVP 6.1: or the product page switches to or from
  // its tier sets) — the scheduler resyncs then.
  const boundary = campaignBoundary(payloadConfig, nowLocal);
  await bookkeeping(deps, shop, () => recordCampaignBoundary(deps.db, shop, boundary ? shopLocalToUtc(boundary, shopTimezone) : null));
  // 4b. The storefront config (MVP 3, K5) from the SAME gated config as the payload, behind it; never fatal.
  // K4 v2: its margin key from the same gated margin and the same shop currency string as the pdp keys (cost lane).
  // MVP 6.1: the campaign's tier sets only behind the shop config that runs them, a minute after its start.
  await writeStorefrontConfig({ deps, transport, shop, config: payloadConfig, stored, configVersionId, shopCurrency: isoCurrency(shopCurrency), campaignId: shownCampaign, record });
  // The pdp floor (MVP 3): did the margin the shop config ships change (also when the product plan did not finish)?
  const nextMargin = liveMarginOf(payload.json);
  const marginChanged = nextMargin.enabled && (shopState.functionConfig === null || canonicalJson(liveMarginOf(shopState.functionConfig)) !== canonicalJson(nextMargin));
  // 5. The AFTER lane (runSync runs it inline or queues it) — only behind a config that is in place.
  return { after, marginKey: marginChanged ? pdpMarginKey(payloadConfig.modules.margin) : null };
}

/**
 * Why a built shop config does not fit, for support and the admin (sync-copy.ts words it from `params`): the
 * whole payload over FUNCTION_CONFIG_BUDGET_BYTES, and/or (MVP 3 audit) the quantity tiers over their own cap —
 * `params` = {bytes, budget} and, only when the tier part is over its cap, {tiersBytes, tiersBudget} (the
 * admin's naming contract: sync-copy.ts words "využito X %" from them).
 */
function overBudget(
  built: ShopConfigBuild,
  outcome: string,
  what = "the discount function config",
): { detail: string; params: Record<string, number> } {
  const tiers = built.tiers;
  const parts = [
    ...(built.bytes > FUNCTION_CONFIG_BUDGET_BYTES ? [`${what} is ${built.bytes} B, over the ${FUNCTION_CONFIG_BUDGET_BYTES} B budget`] : []),
    ...(tiers && !tiers.fits ? [`its quantity tiers take ${tiers.bytes} B, over their ${tiers.budget} B cap`] : []),
  ];
  return {
    detail: `${parts.length > 0 ? parts.join("; ") : `${what} does not fit (${built.bytes} B)`} — ${outcome}`,
    params: { bytes: built.bytes, budget: FUNCTION_CONFIG_BUDGET_BYTES, ...(tiers && !tiers.fits ? { tiersBytes: tiers.bytes, tiersBudget: tiers.budget } : {}) },
  };
}

/** The held shop config, one line for support per reason (the admin words it from `params.held`: sync-copy.ts). */
const HOLD_DETAIL: Record<HoldReason, string> = {
  rule_refs:
    "held: some products could not be cleared of rules they no longer belong to, so the new config is not applied yet (the previous one stays); the next sync retries",
  margin_refs:
    "held: the margin collections of some products could not be written, so the new config is not applied yet (the previous one stays); the next sync retries",
  tier_refs:
    "held: some products whose quantity tier set changes could not be switched off their old set first, so the new config is not applied yet (the previous one stays); the next sync retries",
  products_unread: "held: the targeted products could not be read, so the new config is not applied yet (the previous one stays); the next sync retries",
  products_refused:
    "held: Shopify refused every product write in several batches in a row, so the new config is not applied yet (the previous one stays); the next sync retries",
};

/**
 * The margin settings of the live config when the new payload's margin part
 * differs from them, as checkout reads both (audit fix round 4); null when
 * they are the same — the product refs are then decisive under the same
 * settings on both sides of the flip, no bridge is needed.
 */
function marginChange(liveJson: string, nextJson: string): FunctionMarginPayload | null {
  const live = liveMarginOf(liveJson);
  return canonicalJson(live) === canonicalJson(liveMarginOf(nextJson)) ? null : live;
}

/**
 * The campaign switch's phase 1 (audit fix round 4): the NO-CAMPAIGN shop
 * config whose margin part is the LIVE one, unchanged — the products still
 * carry the refs the live settings chose, and the new margin must not reach
 * checkout before the BEFORE lane has written the bridges (nor stay live when
 * the final write is held). Without a live config to take it from (a first
 * sync, an unreadable one) — or when the live margin does not fit this
 * payload's budget — every margin collection is folded into the global values
 * (strictest wins): no product, whatever refs it carries, gets a looser floor
 * than any setting it may be in. Never looser than the new settings, so the
 * AFTER lane's assumptions hold too.
 */
function phaseOnePayload(
  deps: SyncDeps,
  payloadConfig: ConfigView,
  storedJson: string | null,
  options: { now: string; shopTimezone: string; shopCurrency: string | undefined },
): ShopConfigBuild {
  const noCampaign = { ...options, forceNoCampaign: true };
  // MVP 6 K5 (MVP 2 debt): the LIVE config without its campaign — nothing new (rules, tiers, margin) reaches
  // checkout before the final write, and a held switch leaves exactly the live settings minus the campaign.
  const live = storedJson !== null ? liveWithoutCampaign(storedJson) : null;
  if (live !== null && live.fits) return live;
  const liveMargin = storedJson !== null ? liveMarginPart(storedJson) : undefined;
  if (liveMargin !== undefined) {
    const built = deps.buildShopFunctionConfig(payloadConfig, noCampaign);
    const patched = withMarginPart(built, liveMargin);
    // patched === null: the build's own JSON was not patchable (fail closed, audit fix round 5) — never ship
    // the unpatched build (the NEW margin) in that case; fall through to the fold-all fallback below.
    if (patched !== null && patched.fits) return patched;
  }
  const all = new Set(payloadConfig.modules.margin.perCollection.map((o) => o.collectionId));
  return deps.buildShopFunctionConfig(all.size > 0 ? foldMarginCollections(payloadConfig, all) : payloadConfig, noCampaign);
}

/** K5: a live shop config JSON with its campaign switched off (null when it is not a function config payload). */
function liveWithoutCampaign(json: string): ShopConfigBuild | null {
  let payload: unknown;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  // Any shop config this sync wrote carries `campaignId` (core buildShopFunctionConfig); anything else → fallback.
  if (typeof payload !== "object" || payload === null || Array.isArray(payload) || !("campaignId" in payload)) return null;
  const out: Record<string, unknown> = { ...(payload as Record<string, unknown>), campaignId: null, campaignVarsVersion: null, campaigns: [] };
  const next = JSON.stringify(out);
  const bytes = new TextEncoder().encode(next).length;
  const tiersBytes = new TextEncoder().encode(JSON.stringify((out.modules as { tiers?: unknown } | undefined)?.tiers ?? null)).length;
  const tiers = { bytes: tiersBytes, budget: CONFIG_LIMITS.tierPayloadBytes, fits: tiersBytes <= CONFIG_LIMITS.tierPayloadBytes };
  // The live config already fit when it was written; dropping the campaign only shortens it.
  return { json: next, bytes, fits: bytes <= FUNCTION_CONFIG_BUDGET_BYTES, tiers };
}

/**
 * K3 (A6): the campaigns that finish on Free. On the first Free sync after a Pro one (the live config was built
 * for Pro), the campaigns running right now are recorded; later Free syncs keep those still running; Pro clears
 * the list.
 */
async function campaignsFinishingFor(deps: SyncDeps, shop: string, stored: ConfigView, plan: ShopPlan, nowLocal: string): Promise<string[]> {
  let facts;
  try {
    facts = await loadShopSyncFacts(deps.db, shop);
  } catch (error) {
    deps.logger.warn(`sync ${shop}: could not read the finishing campaigns: ${errorText(error)}`);
    return [];
  }
  if (plan === "pro") {
    if (facts.campaignsFinishing !== null) await bookkeeping(deps, shop, () => recordCampaignsFinishing(deps.db, shop, null));
    return [];
  }
  const running = (id: string) => {
    const campaign = stored.campaigns.find((c) => c.id === id);
    return campaign !== undefined && campaignStatusAt(campaign, nowLocal) === "running";
  };
  const known = facts.campaignsFinishing ?? (facts.appliedPlan === "pro" ? stored.campaigns.map((c) => c.id) : []);
  const still = known.filter(running);
  if (JSON.stringify(still) !== JSON.stringify(facts.campaignsFinishing ?? [])) {
    await bookkeeping(deps, shop, () => recordCampaignsFinishing(deps.db, shop, still.length ? still : null));
  }
  return still;
}

/** The raw `modules.margin` of a live shop config JSON (off when it has none); undefined when it is not a config at all. */
function liveMarginPart(json: string): unknown {
  try {
    const modules = (JSON.parse(json) as { modules?: unknown } | null)?.modules;
    if (typeof modules !== "object" || modules === null || Array.isArray(modules)) return undefined;
    return (modules as { margin?: unknown }).margin ?? { enabled: false };
  } catch {
    return undefined;
  }
}

/**
 * A built shop config with its margin part replaced (as it is: the engine
 * reads it exactly like the live one) — null when `built.json` does not carry
 * a patchable `modules` object (fail closed, audit fix round 5): the caller
 * (phaseOnePayload) must not ship `built` unpatched in that case, since it
 * still carries the NEW margin; it falls back to folding every margin
 * collection into the global values instead (the strictest, safe fallback).
 */
export function withMarginPart(built: ShopConfigBuild, margin: unknown): ShopConfigBuild | null {
  const payload = JSON.parse(built.json) as { modules?: Record<string, unknown> };
  if (typeof payload.modules !== "object" || payload.modules === null) return null;
  payload.modules.margin = margin;
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json).length;
  // The tiers part is untouched: its cap (MVP 3 audit) still decides with the budget.
  return { json, bytes, fits: bytes <= FUNCTION_CONFIG_BUDGET_BYTES && (built.tiers?.fits ?? true), ...(built.tiers ? { tiers: built.tiers } : {}) };
}

/** The margin settings a live shop config JSON carries, as the engine reads them (off when absent or unreadable). */
function liveMarginOf(json: string): FunctionMarginPayload {
  try {
    return readMarginPayload((JSON.parse(json) as { modules?: { margin?: unknown } } | null)?.modules?.margin);
  } catch {
    return { enabled: false };
  }
}

/**
 * MVP 6.1: could the product page be showing a campaign's tier sets? The stored config has a campaign (running,
 * killed or ended — a kill switch keeps its overrides) that overrides a tier set, or the live shop config's
 * campaign carries sets. False for every shop without such a campaign: no storefront read ahead of the run.
 */
function campaignTiersInPlay(stored: ConfigView, liveJson: string | null): boolean {
  const setIds = new Set(stored.modules.tiers.sets.map((set) => set.id));
  if (stored.campaigns.some((campaign) => campaign.overrides.some((o) => setIds.has(o.ruleId)))) return true;
  if (liveJson === null) return false;
  try {
    const campaigns = (JSON.parse(liveJson) as { campaigns?: unknown } | null)?.campaigns;
    return Array.isArray(campaigns) && campaigns.some((c) => typeof c === "object" && c !== null && typeof (c as { tiers?: unknown }).tiers === "object" && (c as { tiers?: unknown }).tiers !== null);
  } catch {
    return false;
  }
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
