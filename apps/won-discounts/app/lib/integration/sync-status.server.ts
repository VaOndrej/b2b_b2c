// Real sync facts for the admin (integration step):
//   - the Přehled trigger: resyncIfPending, bounded by a deadline (REL-1: the
//     page renders even when Shopify is slow; the resync goes on in the
//     background and the page says so);
//   - "Synchronizovat znovu": resyncShop, now;
//   - the shop's sync line (SyncView) from the latest SyncRun;
//   - per rule "Běží" (RuleSyncMap): is THIS version of the rule in Shopify?
//       automatic rule  the last run that APPLIED the shop function config
//                       (written or unchanged, verified) synced a config in
//                       which the rule was exactly as it is now;
//       code rule       the same, AND its Won node is tracked as active with
//                       the rule's current codes (WonNode.codesHash; an
//                       "inactive:" hash = deactivated node, null = codes
//                       still changing).
//     Which config a run synced: the stored config when it was saved before
//     the run started (ShopConfig.updatedAt ≤ run start), else the newest
//     ConfigVersion saved before the run. The admin's saves and their syncs
//     run under one lock (lock.server.ts), so a run never starts before the
//     save it syncs; only a Přehled resync racing a save can pair a run with a
//     version saved while it was queued — the next load corrects it.

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
import { withConfigLock } from "./lock.server";
import { ruleNames, shopConfigApplied, stepWarnings, syncOutcome, syncProblems } from "./sync-copy";

/** How long the Přehled waits for a pending resync before rendering anyway. */
export const OVERVIEW_SYNC_DEADLINE_MS = 3_000;

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
  const work = resyncIfPending({
    client: ctx.client,
    db: ctx.db,
    shop: ctx.shop,
    createSync: ctx.createSync,
    now: ctx.now,
    logger: ctx.logger,
  });
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
  const status = await loadSyncStatus(ctx.db, ctx.shop);
  return syncViewOf(status, { configExists: loaded.exists, timezone: opts.timezone, names: ruleNames(loaded.config) });
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

/** The rules (by id, canonical JSON) of the config the newest APPLYING run synced; null = none known. */
async function coveredRules(db: PrismaClient, shop: string): Promise<Map<string, string> | "current" | null> {
  const runs = await db.syncRun.findMany({
    where: { shop },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: SYNC_RUNS_KEPT,
    select: { startedAt: true, steps: true },
  });
  const applied = runs.find((run) => shopConfigApplied(parseSteps(run.steps)));
  if (!applied) return null;
  const stored = await db.shopConfig.findUnique({ where: { shop }, select: { updatedAt: true } });
  if (stored && stored.updatedAt.getTime() <= applied.startedAt.getTime()) return "current";
  const version = await db.configVersion.findFirst({
    where: { shop, createdAt: { lte: applied.startedAt } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { data: true },
  });
  const config = version ? readVersion(version.data) : null;
  if (!config) return null;
  return new Map(config.modules.codes.rules.map((rule) => [rule.id, canonicalJson(rule)]));
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
  const [covered, nodes, latest] = await Promise.all([
    coveredRules(ctx.db, ctx.shop),
    ctx.db.wonNode.findMany({ where: { shop: ctx.shop, role: "code" }, select: { key: true, codesHash: true } }),
    loadSyncStatus(ctx.db, ctx.shop),
  ]);
  const hashes = new Map(nodes.map((node) => [node.key, node.codesHash]));
  const notSynced: RuleSyncState = latest && !latest.ok ? "failed" : "pending";
  const out: Record<string, RuleSyncState> = {};
  for (const rule of config.modules.codes.rules) {
    const inConfig = covered === "current" || (covered !== null && covered.get(rule.id) === ruleKey(rule));
    let live = inConfig;
    if (live && rule.method === "code") {
      live = hashes.get(`code:${rule.id}`) === codesHash(rule.codes ?? []);
    }
    out[rule.id] = live ? "synced" : notSynced;
  }
  return out;
}

