// Real sync facts for the admin (integration step):
//   - the Přehled trigger: resyncIfPending on the GET, made safe for every load
//     (prefetch, focus reloads): it runs under the shop's config lock and is
//     NON-BLOCKING (a save, move or resync holding the lock → no second resync,
//     the page says a sync is running), debounced per shop (at most one trigger
//     per RESYNC_TRIGGER_DEBOUNCE_MS) and bounded by a deadline (REL-1: the
//     page renders even when Shopify is slow; the resync goes on in the
//     background and the page says so);
//   - "Synchronizovat znovu": resyncShop, now (under the same lock);
//   - the shop's sync line (SyncView) from the latest SyncRun;
//   - per rule "Běží" (RuleSyncMap): is THIS version of the rule in Shopify?
//     By the VERSION LINK, never by clocks: every SyncRun records the
//     ConfigVersion it synced (SyncRun.configVersionId). The newest run that
//     APPLIED the shop function config (written or unchanged, verified) names
//     the config Shopify runs. Then
//       automatic rule  that config holds the rule exactly as it is now, and
//                       every setting the payload is built from (engine,
//                       markets, campaigns, the other modules — all but the
//                       onboarding steps) is as it is now;
//       code rule       the same, AND its Won node is tracked as active with
//                       the rule's current codes (WonNode.codesHash; an
//                       "inactive:" hash = deactivated node, null = codes
//                       still changing).
//     A run without a link (before the column existed) or whose version was
//     pruned from history proves nothing: its rules read "čeká na propsání"
//     until the next sync.

import { readStoredConfig, type DiscountRule, type WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import { loadConfig } from "../config.server";
import { codesHash, SYNC_RUNS_KEPT } from "../sync/nodes";
import { loadSyncStatus, resyncIfPending, resyncShop, type ResyncResult, type SyncStatus } from "../sync/save-and-sync.server";
import { shopLocalDateTime } from "../sync/sync.server";
import type { SyncStep } from "../sync/types";
import { canonicalJson } from "../sync/util";
import type { RuleSyncMap, RuleSyncState, SyncView, UiResult } from "../../components/model/types";
import { nowOf, type ShopCtx } from "./context.server";
import { withinDeadline } from "./deadline";
import { isConfigLocked, withConfigLock } from "./lock.server";
import { ruleNames, shopConfigApplied, stepWarnings, syncOutcome, syncProblems } from "./sync-copy";

/** How long the Přehled waits for a pending resync before rendering anyway. */
export const OVERVIEW_SYNC_DEADLINE_MS = 3_000;
/** Přehled loads trigger resyncIfPending at most this often per shop (prefetch / focus reloads). */
export const RESYNC_TRIGGER_DEBOUNCE_MS = 30_000;

/** When the Přehled last triggered a resync, per shop (this process; a debounce, not a fact). */
const lastTrigger = new Map<string, number>();

/** Test hook. */
export function clearResyncDebounce(): void {
  lastTrigger.clear();
}

function localTime(date: Date, timezone: string | null): string {
  return shopLocalDateTime(date, timezone ?? "UTC");
}

/** The shop's sync line from its latest SyncRun. */
export function syncViewOf(
  status: SyncStatus | null,
  opts: { configExists: boolean; timezone: string | null; names: ReadonlyMap<string, string> },
): SyncView {
  if (!status) return opts.configExists ? { state: "pending" } : { state: "never" };
  const at = localTime(status.finishedAt ?? status.startedAt, opts.timezone);
  if (status.ok) {
    const warnings = stepWarnings(status.steps);
    return warnings.length > 0 ? { state: "ok", at, warnings } : { state: "ok", at };
  }
  return { state: "error", at, problems: syncProblems(status.steps, opts.names) };
}

/** Sync line for loaders that do not trigger a resync (Slevy a kódy, editor). */
export async function loadSyncView(
  ctx: Pick<ShopCtx, "db" | "shop">,
  loaded: { config: WonDiscountsConfig; exists: boolean; unreadable: boolean; readOnly: boolean },
  timezone: string | null,
): Promise<SyncView> {
  if (loaded.unreadable) return { state: "blocked", reason: "unreadable_config" };
  if (loaded.readOnly) return { state: "blocked", reason: "newer_schema" };
  const status = await loadSyncStatus(ctx.db, ctx.shop);
  return syncViewOf(status, { configExists: loaded.exists, timezone, names: ruleNames(loaded.config) });
}

/**
 * Přehled: retry a failed / pending sync (M3 trigger), at most
 * `deadlineMs` of waiting, then the sync line. A thrown Response (re-auth of
 * the embedded admin) that arrives in time is rethrown to the route.
 */
export async function overviewSync(
  ctx: ShopCtx,
  loaded: { config: WonDiscountsConfig; exists: boolean; unreadable: boolean; readOnly: boolean },
  opts: { timezone: string | null; deadlineMs?: number },
): Promise<SyncView> {
  if (loaded.unreadable) return { state: "blocked", reason: "unreadable_config" };
  if (loaded.readOnly) return { state: "blocked", reason: "newer_schema" };
  const names = ruleNames(loaded.config);
  const current = async () =>
    syncViewOf(await loadSyncStatus(ctx.db, ctx.shop), { configExists: loaded.exists, timezone: opts.timezone, names });
  // Another writer (a save and its sync, a move, a resync) is at work: never a second resync next to it.
  if (isConfigLocked(ctx.shop)) return { state: "running" };
  // Prefetch / focus reloads: one trigger per shop per debounce window.
  const now = nowOf(ctx).getTime();
  const last = lastTrigger.get(ctx.shop);
  if (last !== undefined && now >= last && now - last < RESYNC_TRIGGER_DEBOUNCE_MS) return current();
  lastTrigger.set(ctx.shop, now);
  if (lastTrigger.size > 10_000) lastTrigger.delete(lastTrigger.keys().next().value as string);

  const work = withConfigLock(ctx.shop, () =>
    resyncIfPending({
      client: ctx.client,
      db: ctx.db,
      shop: ctx.shop,
      createSync: ctx.createSync,
      now: ctx.now,
      logger: ctx.logger,
    }),
  );
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
  return { ok: true, message: "synced", sync: outcome };
}

/** "Synchronizovat znovu": resync the stored config now (under the config lock: never between a save and its sync). */
export async function resyncNow(ctx: ShopCtx): Promise<UiResult> {
  return withConfigLock(ctx.shop, async () => {
    const loaded = await loadConfig(ctx.db, ctx.shop);
    const result = await resyncShop({
      client: ctx.client,
      db: ctx.db,
      shop: ctx.shop,
      createSync: ctx.createSync,
      now: ctx.now,
      logger: ctx.logger,
    });
    return resyncResult(result, ruleNames(loaded.config));
  });
}

// --- Per-rule "Běží" ----------------------------------------------------------------------

function parseSteps(text: string): SyncStep[] {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? (value as SyncStep[]) : [];
  } catch {
    return [];
  }
}

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

/** The config Shopify runs: the one the newest APPLYING run synced, by its version link (null = unknown). */
async function appliedConfig(db: PrismaClient, shop: string): Promise<{ versionId: string; config: WonDiscountsConfig } | null> {
  const runs = await db.syncRun.findMany({
    where: { shop },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: SYNC_RUNS_KEPT,
    select: { steps: true, configVersionId: true },
  });
  const applied = runs.find((run) => shopConfigApplied(parseSteps(run.steps)));
  if (!applied?.configVersionId) return null;
  const version = await db.configVersion.findFirst({
    where: { id: applied.configVersionId, shop },
    select: { id: true, data: true },
  });
  const config = version ? readVersion(version.data) : null;
  return version && config ? { versionId: version.id, config } : null;
}

/**
 * Per rule of `config` (the stored one): synced / pending / failed. A rule
 * that is not in Shopify is "failed" when the latest run failed, else
 * "pending" (saved, the next sync writes it).
 */
export async function loadRuleSync(
  ctx: Pick<ShopCtx, "db" | "shop">,
  config: WonDiscountsConfig,
): Promise<RuleSyncMap> {
  const [applied, nodes, latest] = await Promise.all([
    appliedConfig(ctx.db, ctx.shop),
    ctx.db.wonNode.findMany({ where: { shop: ctx.shop, role: "code" }, select: { key: true, codesHash: true } }),
    loadSyncStatus(ctx.db, ctx.shop),
  ]);
  const hashes = new Map(nodes.map((node) => [node.key, node.codesHash]));
  const notSynced: RuleSyncState = latest && !latest.ok ? "failed" : "pending";
  const settingsLive = applied !== null && settingsKey(applied.config) === settingsKey(config);
  const liveRules = new Map((applied?.config.modules.codes.rules ?? []).map((rule) => [rule.id, ruleKey(rule)]));
  const out: Record<string, RuleSyncState> = {};
  for (const rule of config.modules.codes.rules) {
    const inConfig = settingsLive && liveRules.get(rule.id) === ruleKey(rule);
    let live = inConfig;
    if (live && rule.method === "code") {
      live = hashes.get(`code:${rule.id}`) === codesHash(rule.codes ?? []);
    }
    out[rule.id] = live ? "synced" : notSynced;
  }
  return out;
}

