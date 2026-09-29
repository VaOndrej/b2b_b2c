// Real sync facts for the admin (integration step):
//   - the Přehled trigger: resyncIfPending on the GET, made safe for every load
//     (prefetch, focus reloads): it takes the shop's config lock SYNCHRONOUSLY
//     at the start (so a background task that queues for the lock later in the
//     same load — the native stale-claim sweep — runs after it, never starves
//     it) and is NON-BLOCKING (a save, move, sweep or resync holding the lock,
//     or a sync still running → no second resync, the page says a sync is
//     running), debounced per shop (at most one trigger per
//     RESYNC_TRIGGER_DEBOUNCE_MS) and bounded by a deadline (REL-1: the page
//     renders even when Shopify is slow; the work goes on in the background).
//     Besides failed / pending runs it resyncs a stored config no applying run
//     synced (audit P2-2), a changed shop time zone or market countries (item
//     12), and refreshes the product targeting when the webhooks marked it
//     stale and the scheduled refresh was lost, or the last product pass is
//     older than 24 h (item 2);
//   - "Synchronizovat znovu" / "Obnovit cílení": now (under the same lock,
//     bounded by a deadline — the rest goes on in the background, item 7);
//   - the shop's sync line (SyncView) from the latest SyncRun — "pending"
//     ("Synchronizovat znovu") also when the stored config is not the one the
//     last applying run synced;
//   - the targeting line (TargetingView): fresh as of, or being refreshed;
//   - per rule "Běží" (RuleSyncMap): is THIS version of the rule in Shopify?
//     By the VERSION LINK, never by clocks: every SyncRun records the
//     ConfigVersion it synced (SyncRun.configVersionId). The newest run that
//     APPLIED the shop function config (written or unchanged, verified) names
//     the config Shopify runs. Then
//       every rule     that config holds the rule exactly as it is now, and
//                      every setting the payload is built from (engine,
//                      markets, campaigns, the other modules — all but the
//                      onboarding steps) is as it is now;
//       automatic rule AND the automatic Won node exists (WonNode "auto"), the
//                      latest run did not fail on it, and — where Přehled read
//                      it live — it is ACTIVE in Shopify (audit P2-3);
//       code rule      AND its Won node is tracked as active with the rule's
//                      current codes (WonNode.codesHash; an "inactive:" hash =
//                      deactivated node, null = codes still changing);
//       product /      AND the latest product step went through: a failed one
//       collection     → "failed"; products still being written or the
//       rule           targeting marked stale → "refreshing".
//     A run without a link (before the column existed) or whose version was
//     pruned from history proves nothing: its rules read "čeká na propsání"
//     until the next sync.

import { readStoredConfig, type DiscountRule, type WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import { loadConfig } from "../config.server";
import { codesHash, SYNC_RUNS_KEPT } from "../sync/nodes";
import { hasProductTargets } from "../sync/products";
import { syncProgress } from "../sync/progress";
import { parseSteps, storedConfigNotApplied } from "../sync/runs";
import {
  loadSyncStatus,
  refreshTargeting,
  resyncIfPending,
  resyncShop,
  type ResyncResult,
  type SyncStatus,
} from "../sync/save-and-sync.server";
import { loadShopSyncFacts } from "../sync/sync-state.server";
import { isSyncRunning, shopLocalDateTime } from "../sync/sync.server";
import type { SyncStep } from "../sync/types";
import { canonicalJson } from "../sync/util";
import type { RuleSyncMap, RuleSyncState, SyncView, TargetingView, UiResult, UiText } from "../../components/model/types";
import { nowOf, type ShopCtx } from "./context.server";
import { withinDeadline } from "./deadline";
import { isConfigLocked, withConfigLock } from "./lock.server";
import { ruleNames, shopConfigApplied, stepNodeKey, stepWarnings, syncOutcome, syncProblems } from "./sync-copy";
import { TARGETING_MAX_AGE_MS, TARGETING_REFRESH_DEBOUNCE_MS, targetingRefreshScheduled } from "./targeting.server";

/** How long the Přehled waits for a pending resync before rendering anyway. */
export const OVERVIEW_SYNC_DEADLINE_MS = 3_000;
/** Přehled loads trigger resyncIfPending at most this often per shop (prefetch / focus reloads). */
export const RESYNC_TRIGGER_DEBOUNCE_MS = 30_000;
/** "Synchronizovat znovu" / "Obnovit cílení" / a rule save wait at most this long; the rest runs in the background (item 7). */
export const ACTION_SYNC_DEADLINE_MS = 20_000;

/** When the Přehled last triggered a resync, per shop (this process; a debounce, not a fact). */
const lastTrigger = new Map<string, number>();
/** The Přehled's own background work per shop (tests wait on it: whenOverviewIdle). */
const overviewWork = new Map<string, Promise<unknown>>();

/** Test hook. */
export function clearResyncDebounce(): void {
  lastTrigger.clear();
}

/** Test hook: resolves when the Přehled's last triggered work of `shop` has finished. */
export async function whenOverviewIdle(shop: string): Promise<void> {
  const work = overviewWork.get(shop);
  if (work) await work.catch(() => undefined);
}

function localTime(date: Date, timezone: string | null): string {
  return shopLocalDateTime(date, timezone ?? "UTC");
}

/** A sync (not only a background product lane) of the shop is queued or running here: "running", with its product progress. */
function runningView(shop: string): SyncView | null {
  if (!isSyncRunning(shop)) return null;
  const progress = syncProgress(shop);
  if (progress?.phase === "writing") return null; // only the background product lane: the sync itself is done (TargetingView says it)
  return { state: "running" };
}

/** The shop's sync line from its latest SyncRun. `notApplied` = the stored config is not the one Shopify runs. */
export function syncViewOf(
  status: SyncStatus | null,
  opts: { configExists: boolean; timezone: string | null; names: ReadonlyMap<string, string>; notApplied?: boolean; attention?: UiText[] },
): SyncView {
  if (!status) return opts.configExists ? { state: "pending" } : { state: "never" };
  const at = localTime(status.finishedAt ?? status.startedAt, opts.timezone);
  if (status.ok) {
    if (opts.notApplied) return { state: "pending" };
    const warnings = stepWarnings(status.steps);
    const view: SyncView = warnings.length > 0 ? { state: "ok", at, warnings } : { state: "ok", at };
    return opts.attention && opts.attention.length > 0 ? { ...view, attention: opts.attention } : view;
  }
  return { state: "error", at, problems: syncProblems(status.steps, opts.names) };
}

async function currentView(
  ctx: Pick<ShopCtx, "db" | "shop">,
  loaded: { config: WonDiscountsConfig; exists: boolean },
  timezone: string | null,
  attention?: UiText[],
): Promise<SyncView> {
  const running = runningView(ctx.shop);
  if (running) return running;
  const [status, notApplied] = await Promise.all([loadSyncStatus(ctx.db, ctx.shop), storedConfigNotApplied(ctx.db, ctx.shop)]);
  return syncViewOf(status, { configExists: loaded.exists, timezone, names: ruleNames(loaded.config), notApplied, attention });
}

/** Sync line for loaders that do not trigger a resync (Slevy a kódy, editor). */
export async function loadSyncView(
  ctx: Pick<ShopCtx, "db" | "shop">,
  loaded: { config: WonDiscountsConfig; exists: boolean; unreadable: boolean; readOnly: boolean },
  timezone: string | null,
): Promise<SyncView> {
  if (loaded.unreadable) return { state: "blocked", reason: "unreadable_config" };
  if (loaded.readOnly) return { state: "blocked", reason: "newer_schema" };
  return currentView(ctx, loaded, timezone);
}

/**
 * The product targeting is due for a refresh (item 2): the webhooks marked it
 * stale and no refresh is scheduled here any more (a restart lost it), or
 * the last product pass is older than TARGETING_MAX_AGE_MS / unknown.
 */
async function targetingDue(ctx: Pick<ShopCtx, "db" | "shop">, config: WonDiscountsConfig, now: Date): Promise<boolean> {
  if (!hasProductTargets(config)) return false;
  const facts = await loadShopSyncFacts(ctx.db, ctx.shop);
  if (facts.targetingStaleAt && !targetingRefreshScheduled(ctx.shop)) {
    if (now.getTime() - facts.targetingStaleAt.getTime() >= TARGETING_REFRESH_DEBOUNCE_MS) return true;
  }
  return !facts.productsSyncedAt || now.getTime() - facts.productsSyncedAt.getTime() >= TARGETING_MAX_AGE_MS;
}

/**
 * Přehled: retry a failed / pending sync (M3 trigger) and the other resync
 * reasons, then the product-targeting refresh when due — at most
 * `deadlineMs` of waiting, then the sync line. A thrown Response (re-auth of
 * the embedded admin) that arrives in time is rethrown to the route.
 */
export async function overviewSync(
  ctx: ShopCtx,
  loaded: { config: WonDiscountsConfig; exists: boolean; unreadable: boolean; readOnly: boolean },
  opts: { timezone: string | null; deadlineMs?: number; attention?: UiText[] },
): Promise<SyncView> {
  if (loaded.unreadable) return { state: "blocked", reason: "unreadable_config" };
  if (loaded.readOnly) return { state: "blocked", reason: "newer_schema" };
  const current = () => currentView(ctx, loaded, opts.timezone, opts.attention);
  // Another writer (a save and its sync, a move, a sweep, a resync) is at work: never a second resync next to it.
  if (isConfigLocked(ctx.shop)) return { state: "running" };
  // A sync, or a save's background product lane, is still running here: never supersede it from a page load
  // (a large lane would otherwise be restarted by every retry and never finish).
  if (isSyncRunning(ctx.shop)) return current();
  // Prefetch / focus reloads: one trigger per shop per debounce window.
  const now = nowOf(ctx);
  const last = lastTrigger.get(ctx.shop);
  if (last !== undefined && now.getTime() >= last && now.getTime() - last < RESYNC_TRIGGER_DEBOUNCE_MS) return current();
  lastTrigger.set(ctx.shop, now.getTime());
  if (lastTrigger.size > 10_000) lastTrigger.delete(lastTrigger.keys().next().value as string);

  // The lock is taken HERE, before any await: whatever queues for it later in this load runs after this work.
  const work = withConfigLock(ctx.shop, async () => {
    const common = { client: ctx.client, db: ctx.db, shop: ctx.shop, createSync: ctx.createSync, now: ctx.now, logger: ctx.logger, grantedScopes: ctx.scopes };
    const resync = await resyncIfPending({ ...common, timezone: opts.timezone, checkMarkets: true, productWrites: "background" });
    if (!resync.resynced && (await targetingDue(ctx, loaded.config, now))) {
      await refreshTargeting({ ...common, productWrites: "background" });
    }
    return resync;
  });
  overviewWork.set(ctx.shop, work);
  void work.finally(() => {
    if (overviewWork.get(ctx.shop) === work) overviewWork.delete(ctx.shop);
  }).catch(() => undefined);
  const outcome = await withinDeadline(work, opts.deadlineMs ?? OVERVIEW_SYNC_DEADLINE_MS);
  if (!outcome.done) return { state: "running" };
  if ("error" in outcome) {
    if (outcome.error instanceof Response) throw outcome.error;
    const detail = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
    return {
      state: "error",
      at: localTime(nowOf(ctx), opts.timezone),
      problems: [{ key: "sync.problem.other", params: { detail } }],
    };
  }
  const result = outcome.value;
  if (result.resynced && !result.result.ok && "reason" in result.result && result.result.runId === null) {
    if (result.result.reason === "unreadable_config" || result.result.reason === "newer_schema") {
      return { state: "blocked", reason: result.result.reason };
    }
  }
  return current();
}

/** A resync's result as the admin result banner. */
export function resyncResult(result: ResyncResult, names: ReadonlyMap<string, string>): UiResult {
  if (!result.ok && "reason" in result && result.runId === null) {
    if (result.reason === "unreadable_config") return { ok: false, reason: "unreadable_config" };
    if (result.reason === "newer_schema") return { ok: false, reason: "newer_schema" };
    if (result.reason === "no_config") return { ok: true, message: "synced", sync: { ok: true, problems: [], warnings: [] } };
  }
  const warnings = "warnings" in result ? result.warnings : [];
  const outcome = syncOutcome(result, warnings, names);
  if (!result.ok) return { ok: false, reason: "sync_failed", problems: outcome.problems };
  const background = "background" in result && result.background ? { syncing: { products: result.background.products } } : {};
  return { ok: true, message: "synced", sync: outcome, ...background };
}

/** Run `work` under the shop's config lock, at most ACTION_SYNC_DEADLINE_MS of waiting (item 7). */
async function lockedWithDeadline(
  ctx: ShopCtx,
  work: () => Promise<ResyncResult>,
  deadlineMs: number,
): Promise<{ done: true; result: ResyncResult } | { done: false }> {
  const running = withConfigLock(ctx.shop, work);
  const outcome = await withinDeadline(running, deadlineMs);
  if (!outcome.done) {
    running.catch(() => undefined);
    return { done: false };
  }
  if ("error" in outcome) throw outcome.error;
  return { done: true, result: outcome.value };
}

/** "Synchronizovat znovu": resync the stored config now (under the config lock: never between a save and its sync). */
export async function resyncNow(ctx: ShopCtx, opts: { deadlineMs?: number } = {}): Promise<UiResult> {
  const loaded = await loadConfig(ctx.db, ctx.shop);
  const outcome = await lockedWithDeadline(
    ctx,
    () =>
      resyncShop({
        client: ctx.client,
        db: ctx.db,
        shop: ctx.shop,
        createSync: ctx.createSync,
        now: ctx.now,
        logger: ctx.logger,
        grantedScopes: ctx.scopes,
        productWrites: "background",
      }),
    opts.deadlineMs ?? ACTION_SYNC_DEADLINE_MS,
  );
  if (!outcome.done) return { ok: true, message: "synced", syncing: {} };
  return resyncResult(outcome.result, ruleNames(loaded.config));
}

/** "Obnovit cílení": re-read collection members and rewrite the product refs now (item 2). */
export async function refreshTargetingNow(ctx: ShopCtx, opts: { deadlineMs?: number } = {}): Promise<UiResult> {
  const loaded = await loadConfig(ctx.db, ctx.shop);
  const outcome = await lockedWithDeadline(
    ctx,
    () =>
      refreshTargeting({
        client: ctx.client,
        db: ctx.db,
        shop: ctx.shop,
        createSync: ctx.createSync,
        now: ctx.now,
        logger: ctx.logger,
        grantedScopes: ctx.scopes,
      }),
    opts.deadlineMs ?? ACTION_SYNC_DEADLINE_MS,
  );
  if (!outcome.done) return { ok: true, message: "synced", syncing: {} };
  return resyncResult(outcome.result, ruleNames(loaded.config));
}

// --- Targeting line --------------------------------------------------------------------------

/** Is the product targeting fresh, or being refreshed? (item 2) */
export async function loadTargetingView(
  ctx: Pick<ShopCtx, "db" | "shop">,
  config: WonDiscountsConfig,
  timezone: string | null,
): Promise<TargetingView> {
  if (!hasProductTargets(config)) return { state: "none" };
  const [facts, status] = await Promise.all([loadShopSyncFacts(ctx.db, ctx.shop), loadSyncStatus(ctx.db, ctx.shop)]);
  const progress = syncProgress(ctx.shop);
  const writing = progress?.phase === "writing" && isSyncRunning(ctx.shop);
  const inProgress = writing || (status?.pending.includes("products_in_progress") ?? false);
  if (facts.targetingStaleAt || inProgress) {
    return {
      state: "refreshing",
      since: facts.targetingStaleAt ? localTime(facts.targetingStaleAt, timezone) : null,
      ...(writing && progress?.total ? { products: progress.total } : {}),
    };
  }
  return { state: "fresh", at: facts.productsSyncedAt ? localTime(facts.productsSyncedAt, timezone) : null };
}

// --- The automatic Won node, live (Přehled) --------------------------------------------------------

/** Validated against Admin 2026-04 (Shopify dev MCP); requested cost 2. */
export const AUTO_NODE_STATUS_DOCUMENT = `query WonDiscountsAutoNodeStatus($id: ID!) {
  node(id: $id) {
    __typename
    ... on DiscountAutomaticNode {
      id
      automaticDiscount {
        __typename
        ... on DiscountAutomaticApp {
          status
        }
      }
    }
  }
}`;

export type AutoNodeState = "active" | "inactive" | "missing" | "unknown";

/**
 * Is the automatic "Won Discounts" node there and ACTIVE in Shopify? (audit
 * P2-3: deleted or switched off by the merchant, every automatic rule stops.)
 * "unknown" when it cannot be read or the shop never synced.
 */
export async function readAutoNodeState(ctx: Pick<ShopCtx, "db" | "shop" | "client">): Promise<AutoNodeState> {
  const row = await ctx.db.wonNode.findFirst({ where: { shop: ctx.shop, key: "auto" }, select: { discountNodeId: true } });
  if (!row) {
    const synced = await ctx.db.syncRun.count({ where: { shop: ctx.shop, ok: true } });
    return synced > 0 ? "missing" : "unknown";
  }
  try {
    const result = await ctx.client.graphql<{
      node: { __typename?: string; automaticDiscount?: { __typename?: string; status?: string } | null } | null;
    }>(AUTO_NODE_STATUS_DOCUMENT, { id: row.discountNodeId });
    if (!result.data) return "unknown";
    const node = result.data.node;
    if (!node || node.__typename !== "DiscountAutomaticNode" || node.automaticDiscount?.__typename !== "DiscountAutomaticApp") return "missing";
    return node.automaticDiscount.status === "ACTIVE" ? "active" : "inactive";
  } catch (error) {
    if (error instanceof Response) throw error;
    return "unknown";
  }
}

/** The sentence for an automatic node that does not run (Přehled sync line, with "Synchronizovat znovu"). */
export function autoNodeAttention(state: AutoNodeState): UiText[] {
  if (state === "missing") return [{ key: "sync.problem.autoMissing" }];
  if (state === "inactive") return [{ key: "sync.problem.autoInactive" }];
  return [];
}

// --- Per-rule "Běží" ----------------------------------------------------------------------

function readVersion(data: string): WonDiscountsConfig | null {
  try {
    return readStoredConfig(JSON.parse(data));
  } catch {
    return null;
  }
}

const ruleKey = (rule: DiscountRule | undefined) => (rule ? canonicalJson(rule) : null);

/**
 * Everything the function payload is built from besides the rules: engine,
 * markets, campaigns and the other modules. Only the onboarding steps (goals,
 * step) change nothing that runs.
 */
function settingsKey(config: WonDiscountsConfig): string {
  const { onboarding, modules, ...rest } = config;
  void onboarding;
  const { codes, ...otherModules } = modules;
  void codes;
  return canonicalJson({ ...rest, modules: otherModules });
}

interface RunRow {
  steps: string;
  configVersionId: string | null;
  pending: string | null;
}

/** The config Shopify runs: the one the newest APPLYING run synced, by its version link (null = unknown). */
async function appliedConfig(db: PrismaClient, shop: string, runs: readonly RunRow[]): Promise<{ versionId: string; config: WonDiscountsConfig } | null> {
  const applied = runs.find((run) => shopConfigApplied(parseSteps(run.steps)));
  if (!applied?.configVersionId) return null;
  const version = await db.configVersion.findFirst({
    where: { id: applied.configVersionId, shop },
    select: { id: true, data: true },
  });
  const config = version ? readVersion(version.data) : null;
  return version && config ? { versionId: version.id, config } : null;
}

function parsePending(text: string | null): string[] {
  if (!text) return [];
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const isProductStep = (step: SyncStep) => step.step === "products" || step.step.startsWith("products.");

/** The latest product pass: failed, still writing / stale, or fine. */
function productsState(runs: readonly RunRow[], stale: boolean): "ok" | "failed" | "refreshing" {
  for (const run of runs) {
    const steps = parseSteps(run.steps);
    if (!steps.some(isProductStep)) continue;
    if (steps.some((step) => isProductStep(step) && !step.ok)) return "failed";
    if (parsePending(run.pending).includes("products_in_progress")) return "refreshing";
    break;
  }
  return stale ? "refreshing" : "ok";
}

/** Did the latest run that went through the nodes fail on the automatic node? */
function autoNodeFailed(runs: readonly RunRow[]): boolean {
  for (const run of runs) {
    const steps = parseSteps(run.steps);
    if (!steps.some((step) => step.step === "shop.read")) continue; // products-only runs never touch nodes
    return steps.some((step) => !step.ok && stepNodeKey(step.step) === "auto");
  }
  return false;
}

/**
 * Per rule of `config` (the stored one): synced / pending / failed /
 * refreshing. A rule that is not in Shopify is "failed" when the latest run
 * failed, else "pending" (saved, the next sync writes it). `autoNode` = the
 * automatic node as Přehled read it live (absent: judged from the sync facts).
 */
export async function loadRuleSync(
  ctx: Pick<ShopCtx, "db" | "shop">,
  config: WonDiscountsConfig,
  opts: { autoNode?: AutoNodeState } = {},
): Promise<RuleSyncMap> {
  const [runs, nodes, latest, facts] = await Promise.all([
    ctx.db.syncRun.findMany({
      where: { shop: ctx.shop },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      take: SYNC_RUNS_KEPT,
      select: { steps: true, configVersionId: true, pending: true },
    }),
    ctx.db.wonNode.findMany({ where: { shop: ctx.shop }, select: { key: true, codesHash: true } }),
    loadSyncStatus(ctx.db, ctx.shop),
    loadShopSyncFacts(ctx.db, ctx.shop),
  ]);
  const applied = await appliedConfig(ctx.db, ctx.shop, runs);
  const hashes = new Map(nodes.map((node) => [node.key, node.codesHash]));
  const notSynced: RuleSyncState = latest && !latest.ok ? "failed" : "pending";
  const settingsLive = applied !== null && settingsKey(applied.config) === settingsKey(config);
  const liveRules = new Map((applied?.config.modules.codes.rules ?? []).map((rule) => [rule.id, ruleKey(rule)]));
  const autoOk =
    hashes.has("auto") && !autoNodeFailed(runs) && (opts.autoNode === undefined || opts.autoNode === "active" || opts.autoNode === "unknown");
  const products = productsState(runs, facts.targetingStaleAt !== null);
  const out: Record<string, RuleSyncState> = {};
  for (const rule of config.modules.codes.rules) {
    if (!(settingsLive && liveRules.get(rule.id) === ruleKey(rule))) {
      out[rule.id] = notSynced;
      continue;
    }
    if (rule.method === "code" && hashes.get(`code:${rule.id}`) !== codesHash(rule.codes ?? [])) {
      out[rule.id] = notSynced;
      continue;
    }
    if (rule.method === "automatic" && !autoOk) {
      out[rule.id] = "failed";
      continue;
    }
    const targetsProducts = rule.target.kind === "products" || rule.target.kind === "collections";
    out[rule.id] = targetsProducts && products !== "ok" ? products : "synced";
  }
  return out;
}
