// Daily reconcile of the cost mirror (margin protection, MVP 2; pattern of
// jobs/stale-claims.server.ts): webhooks keep the mirror fresh, but a delivery
// can be lost (a restart drops the debounced queue, Shopify gives up after its
// retries) — so every shop whose last complete full pass is older than 24 h
// (costsDue: also a pass cut short, or a failed one after its retry interval)
// gets a new one, and a shop that switched protection off while some variant
// still carries a metafield the sync wrote gets a clear. The Přehled does the
// same check on load; this job covers shops nobody opens.
//
// Checked every COST_RECONCILE_INTERVAL_MS (hourly: "older than 24 h" is then
// at most an hour late), at most COST_RECONCILE_SHOPS jobs started per run
// (each runs in its shop's cost lane, in the background). Single instance
// assumption as the rest of the sync; MVP 5's scheduler takes it over.
// Started once per process on server boot (app/entry.server.tsx, next to the
// stale-claim sweep); the margin screen, the Přehled card and the app's cost
// refresher also ensure it (idempotent) — so it runs whether or not anybody
// opens the admin.

import { gateConfigForPlan, type ShopPlan } from "@won/core/discounts/plan-gate";

import type { PrismaClient } from "../../generated/prisma/client";
import type { AdminClient } from "../admin-client.server";
import { loadConfig } from "../config.server";
import { planOf } from "../plan.server";
import { costJobKind, costRetryRunning, costsDue, startDueJob, type CostDue } from "../sync/cost-lane.server";
import { errorText } from "../sync/transport";
import type { SyncLogger } from "../sync/types";

export const COST_RECONCILE_FIRST_DELAY_MS = 2 * 60_000;
export const COST_RECONCILE_INTERVAL_MS = 60 * 60_000;
/** Jobs started per run (bounded load; the rest waits for the next run). */
export const COST_RECONCILE_SHOPS = 5;

const quiet: SyncLogger = { info() {}, warn() {}, error() {} };

export interface CostReconcileDeps {
  db: PrismaClient;
  /** The shop's offline Admin API client, or null (uninstalled). */
  clientFor: (shop: string) => Promise<AdminClient | null>;
  plan?: (shop: string) => Promise<ShopPlan>;
  now?: () => Date;
  logger?: SyncLogger;
  maxShops?: number;
}

export interface CostReconcileResult {
  checked: number;
  started: { shop: string; kind: CostDue }[];
  skippedNoSession: number;
}

/** One run (see the header). Never throws. */
export async function runCostReconcileOnce(deps: CostReconcileDeps): Promise<CostReconcileResult> {
  const logger = deps.logger ?? quiet;
  const now = (deps.now ?? (() => new Date()))();
  const plan = deps.plan ?? planOf;
  const result: CostReconcileResult = { checked: 0, started: [], skippedNoSession: 0 };
  let shops: { shop: string }[];
  try {
    shops = await deps.db.shopConfig.findMany({ select: { shop: true }, orderBy: { shop: "asc" } });
  } catch (error) {
    logger.error(`cost reconcile: could not read the shops: ${errorText(error)}`);
    return result;
  }
  for (const { shop } of shops) {
    if (result.started.length >= (deps.maxShops ?? COST_RECONCILE_SHOPS)) break;
    if (costJobKind(shop) !== null) continue;
    try {
      result.checked += 1;
      const loaded = await loadConfig(deps.db, shop);
      if (loaded.unreadable || loaded.readOnly) continue;
      const enabled = loaded.exists && gateConfigForPlan(loaded.config, await plan(shop)).config.modules.margin.enabled === true;
      const due = await costsDue(deps.db, shop, enabled, now);
      if (!due || costRetryRunning(shop)) continue;
      const client = await deps.clientFor(shop);
      if (!client) {
        result.skippedNoSession += 1;
        continue;
      }
      await startDueJob(shop, { client, db: deps.db, plan, now: deps.now, logger }, due, now);
      result.started.push({ shop, kind: due });
    } catch (error) {
      logger.error(`cost reconcile ${shop}: ${errorText(error)}`);
    }
  }
  return result;
}

let job: { firstRun: ReturnType<typeof setTimeout>; interval: ReturnType<typeof setInterval> | null } | null = null;

const consoleLogger: SyncLogger = {
  info: (message) => console.info(`[won-cost-reconcile] ${message}`),
  warn: (message) => console.warn(`[won-cost-reconcile] ${message}`),
  error: (message) => console.error(`[won-cost-reconcile] ${message}`),
};

/**
 * Start the periodic reconcile once per process (idempotent; unref'd timers;
 * disabled under NODE_ENV=test unless `force`).
 */
export function ensureCostReconcileJob(
  db: PrismaClient,
  opts: {
    /** The shop's offline Admin API client (the app passes unauthenticated.admin). */
    clientFor: CostReconcileDeps["clientFor"];
    force?: boolean;
    deps?: CostReconcileDeps;
    firstDelayMs?: number;
    intervalMs?: number;
  },
): void {
  if (job) return;
  if (process.env.NODE_ENV === "test" && !opts.force) return;
  const deps: CostReconcileDeps = opts.deps ?? { db, logger: consoleLogger, clientFor: opts.clientFor };
  const run = () => {
    runCostReconcileOnce(deps)
      .then((result) => {
        if (result.started.length > 0) consoleLogger.info(`started ${result.started.map((s) => `${s.kind}:${s.shop}`).join(", ")}`);
      })
      .catch((error: unknown) => consoleLogger.error(`run failed: ${errorText(error)}`));
  };
  const firstRun = setTimeout(() => {
    run();
    const interval = setInterval(run, opts.intervalMs ?? COST_RECONCILE_INTERVAL_MS);
    interval.unref?.();
    if (job) job.interval = interval;
  }, opts.firstDelayMs ?? COST_RECONCILE_FIRST_DELAY_MS);
  firstRun.unref?.();
  job = { firstRun, interval: null };
}

/** Test hook. */
export function stopCostReconcileJob(): void {
  if (!job) return;
  clearTimeout(job.firstRun);
  if (job.interval) clearInterval(job.interval);
  job = null;
}

export function costReconcileJobStarted(): boolean {
  return job !== null;
}
