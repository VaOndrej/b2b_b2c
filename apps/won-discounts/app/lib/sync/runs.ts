// Facts read back from the persisted SyncRun rows (the sync's own record):
//   - did a run leave the shop function config APPLIED (written — or already
//     equal — and verified)? Only such a run proves what checkout runs; a
//     products-only refresh, a background product lane or a held / failed
//     write does not;
//   - which ConfigVersion the newest applying run synced, and whether the
//     STORED config still equals it for everything that runs (audit P2-2: a
//     process that died between the save and its SyncRun leaves a newer
//     stored config that no run ever applied — resyncIfPending resyncs it and
//     the Přehled offers "Synchronizovat znovu").

import { readStoredConfig, type WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import { SYNC_RUNS_KEPT } from "./nodes";
import type { SyncStep } from "./types";
import { canonicalJson } from "./util";

/**
 * Did this run leave the shop function config APPLIED (written — or already
 * equal — and verified)? A held, failed or rolled-back write does not count.
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

/** The newest run (of the kept ones) that applied the shop config, with the version it synced. */
export async function appliedRun(db: PrismaClient, shop: string): Promise<{ runId: string; configVersionId: string | null; startedAt: Date } | null> {
  const runs = await db.syncRun.findMany({
    where: { shop },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: SYNC_RUNS_KEPT,
    select: { id: true, steps: true, configVersionId: true, startedAt: true },
  });
  const run = runs.find((r) => shopConfigApplied(parseSteps(r.steps)));
  return run ? { runId: run.id, configVersionId: run.configVersionId ?? null, startedAt: run.startedAt } : null;
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
 * the version the newest applying run synced. False when nothing is saved, or
 * when history was pruned so that it cannot be told.
 */
export async function storedConfigNotApplied(db: PrismaClient, shop: string): Promise<boolean> {
  const newest = await newestVersion(db, shop);
  if (!newest) return false;
  const applied = await appliedRun(db, shop);
  if (!applied) return true;
  if (applied.configVersionId === newest.id) return false;
  if (!applied.configVersionId) return true;
  const synced = await db.configVersion.findFirst({ where: { id: applied.configVersionId, shop }, select: { data: true } });
  if (!synced) return true;
  const a = readVersion(synced.data);
  const b = readVersion(newest.data);
  if (!a || !b) return true;
  return runtimeKey(a) !== runtimeKey(b);
}
