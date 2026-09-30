// Facts read back from the persisted SyncRun rows (the sync's own record):
//   - did a run leave the shop function config APPLIED (written — or already
//     equal — and verified)? Only such a run proves what checkout runs; a
//     products-only refresh, a background product lane or a held / failed
//     write does not — nor a campaign switch's phase 1 whose final write was
//     held (audit fix round 4): phase 1 carries the live MARGIN part unchanged
//     (sync.server.ts phaseOnePayload), so the margin — and the collections it
//     folds — is still the one the last applying run wrote; the plan is
//     recorded with the final write only (recordAppliedPlan), so the fold
//     views and appliedPlanOf read the same run. (A first sync's phase 1 — no
//     live margin to keep — folds every collection: checkout is then stricter
//     than the views say until the final write, never looser.);
//   - which ConfigVersion the newest applying run synced, and whether the
//     STORED config still equals it for everything that runs (audit P2-2: a
//     process that died between the save and its SyncRun leaves a newer
//     stored config that no run ever applied — resyncIfPending resyncs it and
//     the Přehled offers "Synchronizovat znovu");
//   - which plan that live config was built for (F2 re-review I-2, BILL-1): a
//     config written for another plan than the shop has now — one written
//     before the sync gated for plans at all, or before a downgrade — is not
//     "applied" either: Pro can still be live for a Free shop.

import { readStoredConfig, type WonDiscountsConfig } from "@won/core/discounts/config";
import type { ShopPlan } from "@won/core/discounts/plan-gate";

import type { PrismaClient } from "../../generated/prisma/client";
import { loadShopSyncFacts } from "./sync-state.server";
import type { SyncStep } from "./types";
import { canonicalJson } from "./util";

/**
 * Did this run leave the shop function config APPLIED (written — or already
 * equal — and verified)? A held, failed or rolled-back write does not count,
 * nor a campaign switch's phase 1 alone (`shop_config.phase1.*`, see the header).
 */
export function shopConfigApplied(steps: readonly SyncStep[]): boolean {
  const written = steps.some((step) => step.step === "shop_config.write" && step.ok);
  const verifyFailed = steps.some((step) => step.step === "shop_config.verify" && !step.ok);
  return written && !verifyFailed;
}

export function parseSteps(text: string | null): SyncStep[] {
  if (!text) return [];
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? (value as SyncStep[]) : [];
  } catch {
    return [];
  }
}

/** Everything the function payload is built from: the config without the onboarding steps (goals, step). */
export function runtimeKey(config: WonDiscountsConfig): string {
  const { onboarding, ...rest } = config;
  void onboarding;
  return canonicalJson(rest);
}

function readVersion(data: string): WonDiscountsConfig | null {
  try {
    return readStoredConfig(JSON.parse(data));
  } catch {
    return null;
  }
}

/** The newest run that applied the shop config (persist always keeps it), with the version it synced. */
export async function appliedRun(
  db: PrismaClient,
  shop: string,
): Promise<{ runId: string; configVersionId: string | null; startedAt: Date; steps: SyncStep[] } | null> {
  const runs = await db.syncRun.findMany({
    where: { shop },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    select: { id: true, steps: true, configVersionId: true, startedAt: true },
  });
  for (const run of runs) {
    const steps = parseSteps(run.steps);
    if (shopConfigApplied(steps)) return { runId: run.id, configVersionId: run.configVersionId ?? null, startedAt: run.startedAt, steps };
  }
  return null;
}

/**
 * The plan the shop config live in Shopify was built for: recorded on every
 * applying sync (ShopSyncState.appliedPlan); else the applying run's own
 * `plan` step; else — an applying run from before the sync gated for plans —
 * "pro", because that config shipped every Pro setting as stored. Null when
 * no shop config was ever applied.
 */
export async function appliedPlanOf(db: PrismaClient, shop: string): Promise<ShopPlan | null> {
  const facts = await loadShopSyncFacts(db, shop);
  if (facts.appliedPlan) return facts.appliedPlan;
  const run = await appliedRun(db, shop);
  if (!run) return null;
  const step = run.steps.find((s) => s.step === "plan");
  const match = step ? /^plan (free|pro)\b/.exec(step.detail) : null;
  return match ? (match[1] as ShopPlan) : "pro";
}

/** The live shop config was built for another plan than `plan` (null = nothing applied yet: not a mismatch). */
export async function appliedPlanMismatch(db: PrismaClient, shop: string, plan: ShopPlan): Promise<{ applied: ShopPlan } | null> {
  const applied = await appliedPlanOf(db, shop);
  return applied !== null && applied !== plan ? { applied } : null;
}

/** The newest ConfigVersion of the shop (the one its ShopConfig row was saved as), null when history is empty. */
export async function newestVersion(db: PrismaClient, shop: string): Promise<{ id: string; data: string } | null> {
  return db.configVersion.findFirst({
    where: { shop },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true, data: true },
  });
}

/**
 * True when the stored config holds something no applying run has put into
 * Shopify: the newest ConfigVersion differs (for everything that runs) from
 * the version the newest applying run synced — or, with `plan`, the live
 * config was built for another plan. False when nothing is saved, or when
 * history was pruned so that it cannot be told.
 */
export async function storedConfigNotApplied(db: PrismaClient, shop: string, opts: { plan?: ShopPlan } = {}): Promise<boolean> {
  const newest = await newestVersion(db, shop);
  if (!newest) return false;
  const applied = await appliedRun(db, shop);
  if (!applied) return true;
  if (opts.plan && (await appliedPlanMismatch(db, shop, opts.plan))) return true;
  if (applied.configVersionId === newest.id) return false;
  if (!applied.configVersionId) return true;
  const synced = await db.configVersion.findFirst({ where: { id: applied.configVersionId, shop }, select: { data: true } });
  if (!synced) return true;
  const a = readVersion(synced.data);
  const b = readVersion(newest.data);
  if (!a || !b) return true;
  return runtimeKey(a) !== runtimeKey(b);
}
