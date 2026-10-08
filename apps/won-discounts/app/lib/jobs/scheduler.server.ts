// The app's scheduler (MVP 5, contract O8; plan docs/plans/2026-10-02-won-discounts-mvp5.md). One ticker per
// process (Fly runs one machine, like the other jobs: single-instance assumption) runs every task whose interval
// has passed since its last run; the last run is stored per task (Prisma JobState), so a task that came due while
// the process was down runs at the first tick after a restart (a sale whose end date passed during an outage
// ends then). Tasks:
//   outlet.due     every minute   sales at their end date → end; a used-up quota a webhook could not end (no
//                                 session at that moment) → end; a failed end (`ending`) → retry after its back-off;
//                                 a start interrupted by a crash (`starting` for 10+ minutes) → closed (before its
//                                 backup: nothing was written) or ended (prices back from the backup); a storefront
//                                 value that failed → written again.
//   campaigns.due  every minute   MVP 6 K4: shops whose selected campaign changed (ShopSyncState.campaignBoundaryAt,
//                                 written by the sync: the end of the current or next campaign) are resynced with
//                                 their offline session, so the next campaign's variables go out (3 phases) or the
//                                 ended one is tidied away. Never the critical path: the function itself starts and
//                                 ends a campaign (C4). A failed resync or a missing session retries in 5 minutes.
//   history.prune  daily          sale events 400 days after their sale ended (the sale row stays, PRIV-2), the
//                                 config history past its retention (pruneExpiredConfigHistory, wired here at last)
//                                 and (MVP 7) order facts 400 days after their order.
//   billing.reconcile  daily      MVP 7 M1: shops on Pro are checked against Shopify's active subscriptions; a
//                                 changed plan resyncs the shop (a lost app_subscriptions/update webhook).
//   combinations.daily  daily     Kontrola kombinací: every shop's stored check is planned again from the database
//                                 (a campaign's first day, a sale that ended, a plan that changed move it). A shop
//                                 without the cost mirror gets its few products read from Shopify here, once.
// The cost mirror reconcile (hourly, at most 5 shops a run) and the stale-claim sweep keep their own timers from
// MVP 1–2 (jobs/cost-reconcile.server.ts, jobs/stale-claims.server.ts) — they already run with nobody looking.
// Disabled under NODE_ENV=test unless forced; tests call runDueTasks / the *Once functions with an injected clock.

import type { ShopPlan } from "@won/core/discounts/plan-gate";
import { outletDue, outletExhausted } from "@won/core/discounts/outlet";

import type { PrismaClient } from "../../generated/prisma/client";
import type { AdminClient } from "../admin-client.server";
import { pruneOrderFacts } from "../analytics/analytics.server";
import { reconcilePlan } from "../billing.server";
import { pruneExpiredConfigHistory } from "../config.server";
import { planOf } from "../plan.server";
import { refreshCombinationCheck } from "../integration/combination-check.server";
import { endOutletRun, writeOutletStorefront, type OutletDeps } from "../integration/outlet.server";
import { resyncShop } from "../sync/save-and-sync.server";
import type { Sync } from "../sync/sync.server";
import { errorText } from "../sync/transport";
import type { SyncLogger } from "../sync/types";

export interface ScheduledTask {
  name: string;
  everyMs: number;
  run: (now: Date) => Promise<unknown>;
}

export const SCHEDULER_TICK_MS = 60_000;
export const SCHEDULER_FIRST_DELAY_MS = 15_000;
/** A task counts as due this much before its interval passed (timer jitter; see runDueTasks). */
export const DUE_SLACK_MS = 5_000;
export const OUTLET_HISTORY_RETENTION_DAYS = 400;
/** A start still `starting` after this long was interrupted (a crash or a restart mid-start). */
export const OUTLET_START_STALE_MS = 10 * 60_000;
/** Shops resynced per campaigns.due run (the rest waits for the next minute). */
export const CAMPAIGNS_DUE_BATCH = 20;
/** A failed campaign resync (or no session) is tried again after this long. */
export const CAMPAIGNS_RETRY_MS = 5 * 60_000;
/** Sales handled per outlet.due run (the rest waits for the next minute). */
export const OUTLET_DUE_BATCH = 50;

const quiet: SyncLogger = { info() {}, warn() {}, error() {} };

/** Run every task that is due at `now` (never ran, or its interval passed); record each run. Never throws for a task. */
export async function runDueTasks(db: PrismaClient, tasks: readonly ScheduledTask[], now: Date): Promise<{ name: string; ran: boolean; error?: string }[]> {
  const states = new Map((await db.jobState.findMany({ where: { name: { in: tasks.map((t) => t.name) } } })).map((s) => [s.name, s]));
  const out: { name: string; ran: boolean; error?: string }[] = [];
  for (const task of tasks) {
    const last = states.get(task.name)?.lastRunAt;
    // A tick comes every SCHEDULER_TICK_MS give or take a few ms: without the slack a task due "every minute" would
    // be skipped by every tick that fires a hair early and run only every second minute (found live, MVP 6.1).
    if (last && now.getTime() - last.getTime() < task.everyMs - DUE_SLACK_MS) {
      out.push({ name: task.name, ran: false });
      continue;
    }
    let error: string | undefined;
    try {
      await task.run(now);
    } catch (e) {
      error = errorText(e);
    }
    await db.jobState.upsert({
      where: { name: task.name },
      create: { name: task.name, lastRunAt: now, lastError: error ?? null },
      update: { lastRunAt: now, lastError: error ?? null },
    });
    out.push({ name: task.name, ran: true, ...(error ? { error } : {}) });
  }
  return out;
}

export interface OutletDueDeps {
  db: PrismaClient;
  clientFor: (shop: string) => Promise<AdminClient | null>;
  plan?: (shop: string) => Promise<ShopPlan>;
  now?: () => Date;
  logger?: SyncLogger;
  /** Passed through to every OutletDeps (tests: retry, sleep, queue). */
  outletDeps?: Partial<OutletDeps>;
}

export interface OutletDueResult {
  ended: string[];
  failed: string[];
  closed: string[];
  storefront: string[];
  skippedNoSession: number;
}

/** O8: one outlet.due run (see the header). */
export async function runOutletDueOnce(deps: OutletDueDeps): Promise<OutletDueResult> {
  const now = (deps.now ?? (() => new Date()))();
  const logger = deps.logger ?? quiet;
  const result: OutletDueResult = { ended: [], failed: [], closed: [], storefront: [], skippedNoSession: 0 };
  const rows = await deps.db.outletRun.findMany({
    where: {
      OR: [
        { status: "active", endsAt: { lte: now } },
        { status: "active", error: { not: null }, nextAttemptAt: { lte: now } },
        // An end under way holds a lease (nextAttemptAt ahead, outlet.server.ts OUTLET_END_LEASE_MS); null = an old row.
        { status: "ending", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { status: "starting", createdAt: { lte: new Date(now.getTime() - OUTLET_START_STALE_MS) } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: OUTLET_DUE_BATCH,
  });
  // A used-up quota still `active` (its webhook found no session): scanned separately, the ledger decides.
  const active = await deps.db.outletRun.findMany({ where: { status: "active" }, select: { id: true, quota: true, sold: true, returned: true } });
  const exhausted = new Set(active.filter((r) => outletExhausted(r)).map((r) => r.id));
  const extra = exhausted.size ? await deps.db.outletRun.findMany({ where: { id: { in: [...exhausted] } } }) : [];
  const all = [...rows, ...extra.filter((r) => !rows.some((x) => x.id === r.id))].slice(0, OUTLET_DUE_BATCH);
  const clients = new Map<string, AdminClient | null>();
  for (const run of all) {
    if (!clients.has(run.shop)) clients.set(run.shop, await deps.clientFor(run.shop).catch(() => null));
    const client = clients.get(run.shop);
    if (!client) {
      result.skippedNoSession += 1;
      continue;
    }
    const od: OutletDeps = { shop: run.shop, db: deps.db, client, now: () => now, logger, ...(deps.plan ? { plan: deps.plan } : {}), ...deps.outletDeps };
    try {
      if (run.status === "starting") {
        if (!run.backup) {
          await deps.db.outletRun.update({ where: { id: run.id }, data: { status: "ended", endedAt: now, error: "start interrupted before its backup: nothing was written" } });
          result.closed.push(run.id);
          continue;
        }
        await deps.db.outletRun.update({ where: { id: run.id }, data: { status: "ending", endReason: "manual", error: "start interrupted" } });
        run.status = "ending";
      }
      if (run.status === "active" && run.error?.startsWith("storefront") && !outletDue(run, now) && !exhausted.has(run.id)) {
        const error = await writeOutletStorefront(od, [run.productId]);
        if (!error) await deps.db.outletRun.update({ where: { id: run.id }, data: { error: null, attempts: 0, nextAttemptAt: null } });
        result.storefront.push(run.id);
        continue;
      }
      const reason = run.status === "ending" ? ((run.endReason as "quota" | "date" | "manual" | null) ?? "manual") : outletDue(run, now) ? "date" : "quota";
      const ended = await endOutletRun(od, run.id, reason);
      (ended.ok ? result.ended : result.failed).push(run.id);
    } catch (error) {
      logger.error(`outlet.due ${run.shop} ${run.id}: ${errorText(error)}`);
      result.failed.push(run.id);
    }
  }
  return result;
}

/** O8: history.prune (see the header). */
export async function pruneHistoryOnce(db: PrismaClient, now: Date): Promise<{ outletEvents: number; configVersions: number; orderFacts: number }> {
  const cutoff = new Date(now.getTime() - OUTLET_HISTORY_RETENTION_DAYS * 86_400_000);
  const old = await db.outletRun.findMany({ where: { status: "ended", endedAt: { lt: cutoff } }, select: { id: true } });
  let outletEvents = 0;
  for (let i = 0; i < old.length; i += 500) {
    const { count } = await db.outletEvent.deleteMany({ where: { runId: { in: old.slice(i, i + 500).map((r) => r.id) } } });
    outletEvents += count;
  }
  const configVersions = await pruneExpiredConfigHistory(db, now);
  // MVP 7: order facts past their retention (analytics.server.ts ANALYTICS_RETENTION_DAYS).
  const orderFacts = await pruneOrderFacts(db, now);
  return { outletEvents, configVersions, orderFacts };
}

/** Shops reconciled per billing.reconcile run. */
export const BILLING_RECONCILE_BATCH = 50;

export interface BillingReconcileDeps {
  db: PrismaClient;
  clientFor: (shop: string) => Promise<AdminClient | null>;
  now?: () => Date;
  logger?: SyncLogger;
  /** Tests: the resync after a changed plan (default: resyncShop of the stored config). */
  resync?: (client: AdminClient, shop: string) => Promise<unknown>;
}

/**
 * MVP 7 (M1): billing.reconcile, daily — every shop whose row says Pro is checked against Shopify (a lost
 * app_subscriptions/update webhook must not leave Pro on, nor let a paying shop's row go stale). A plan that
 * changed resyncs the shop. No session → left as it is: the row goes stale and the shop Free by itself.
 */
export async function runBillingReconcileOnce(deps: BillingReconcileDeps): Promise<{ checked: number; changed: string[]; skippedNoSession: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const logger = deps.logger ?? quiet;
  const out = { checked: 0, changed: [] as string[], skippedNoSession: 0 };
  const rows = await deps.db.shopEntitlement.findMany({ where: { plan: "pro" }, orderBy: { checkedAt: "asc" }, take: BILLING_RECONCILE_BATCH, select: { shop: true } });
  for (const { shop } of rows) {
    const client = await deps.clientFor(shop).catch(() => null);
    if (!client) {
      out.skippedNoSession += 1;
      continue;
    }
    const result = await reconcilePlan(deps.db, client, shop, now);
    out.checked += 1;
    if (!result.changed) continue;
    out.changed.push(shop);
    try {
      await (deps.resync ?? ((c: AdminClient, s: string) => resyncShop({ client: c, db: deps.db, shop: s })))(client, shop);
    } catch (error) {
      logger.warn(`billing.reconcile ${shop}: resync after a plan change failed: ${error instanceof Response ? `HTTP ${error.status}` : errorText(error)}`);
    }
  }
  return out;
}

/** The app's tasks. */
export interface CampaignsDueDeps {
  db: PrismaClient;
  clientFor: (shop: string) => Promise<AdminClient | null>;
  now?: () => Date;
  logger?: SyncLogger;
  /** Tests: the sync the resync uses (default: production). */
  createSync?: (client: AdminClient, db: PrismaClient) => Sync;
  /** Tests: the resync itself (default: resyncShop of the stored config). */
  resync?: (client: AdminClient, shop: string) => Promise<{ ok: boolean }>;
}

/** K4: one campaigns.due run (see the header). */
export async function runCampaignsDueOnce(deps: CampaignsDueDeps): Promise<{ synced: string[]; failed: string[]; skippedNoSession: number }> {
  const now = (deps.now ?? (() => new Date()))();
  const logger = deps.logger ?? quiet;
  const out = { synced: [] as string[], failed: [] as string[], skippedNoSession: 0 };
  const due = await deps.db.shopSyncState.findMany({
    where: { campaignBoundaryAt: { lte: now } },
    orderBy: { campaignBoundaryAt: "asc" },
    take: CAMPAIGNS_DUE_BATCH,
    select: { shop: true },
  });
  const later = new Date(now.getTime() + CAMPAIGNS_RETRY_MS);
  const retryLater = (shop: string) => deps.db.shopSyncState.update({ where: { shop }, data: { campaignBoundaryAt: later } });
  for (const { shop } of due) {
    const client = await deps.clientFor(shop).catch(() => null);
    if (!client) {
      out.skippedNoSession += 1;
      await retryLater(shop);
      continue;
    }
    let ok = false;
    try {
      const resync = deps.resync ?? ((c: AdminClient, s: string) => resyncShop({ client: c, db: deps.db, shop: s, ...(deps.createSync ? { createSync: deps.createSync } : {}), ...(deps.now ? { now: deps.now } : {}) }));
      ok = (await resync(client, shop)).ok;
    } catch (error) {
      // A thrown Response (re-auth) or any error: the resync did not happen.
      logger.warn(`campaigns.due ${shop}: ${error instanceof Response ? `HTTP ${error.status}` : errorText(error)}`);
    }
    if (ok) out.synced.push(shop);
    else {
      out.failed.push(shop);
      // The sync records the next boundary when it succeeds; a failure (or a held switch) tries again later.
      await retryLater(shop);
    }
  }
  return out;
}

export interface CombinationsDailyDeps {
  db: PrismaClient;
  clientFor: (shop: string) => Promise<AdminClient | null>;
  plan?: (shop: string) => Promise<ShopPlan>;
  now?: () => Date;
  logger?: SyncLogger;
}

/**
 * combinations.daily (see the header): every shop a sync recorded a currency and a time zone for. Planned from
 * the database; Shopify is asked only for the products of a shop without the cost mirror, and only when the
 * shop's session is there (without it the stored products are used).
 */
export async function runCombinationsDailyOnce(deps: CombinationsDailyDeps): Promise<{ computed: string[]; failed: string[] }> {
  const now = (deps.now ?? (() => new Date()))();
  const logger = deps.logger ?? quiet;
  const out = { computed: [] as string[], failed: [] as string[] };
  const shops = await deps.db.shopSyncState.findMany({ where: { currency: { not: null }, timezone: { not: null } }, select: { shop: true, currency: true, timezone: true }, orderBy: { shop: "asc" } });
  for (const { shop, currency, timezone } of shops) {
    try {
      const client = await deps.clientFor(shop).catch(() => null);
      const plan = await (deps.plan ?? planOf)(shop);
      await refreshCombinationCheck(deps.db, shop, { plan, shopCurrency: currency, timezone, now, logger, ...(client ? { client } : {}) });
      out.computed.push(shop);
    } catch (error) {
      logger.warn(`combinations.daily ${shop}: ${error instanceof Response ? `HTTP ${error.status}` : errorText(error)}`);
      out.failed.push(shop);
    }
  }
  return out;
}

export function appTasks(deps: OutletDueDeps): ScheduledTask[] {
  return [
    { name: "outlet.due", everyMs: 60_000, run: (now) => runOutletDueOnce({ ...deps, now: () => now }) },
    { name: "campaigns.due", everyMs: 60_000, run: (now) => runCampaignsDueOnce({ db: deps.db, clientFor: deps.clientFor, now: () => now, ...(deps.logger ? { logger: deps.logger } : {}) }) },
    { name: "history.prune", everyMs: 24 * 3_600_000, run: (now) => pruneHistoryOnce(deps.db, now) },
    { name: "billing.reconcile", everyMs: 24 * 3_600_000, run: (now) => runBillingReconcileOnce({ db: deps.db, clientFor: deps.clientFor, now: () => now, ...(deps.logger ? { logger: deps.logger } : {}) }) },
    { name: "combinations.daily", everyMs: 24 * 3_600_000, run: (now) => runCombinationsDailyOnce({ db: deps.db, clientFor: deps.clientFor, now: () => now, ...(deps.plan ? { plan: deps.plan } : {}), ...(deps.logger ? { logger: deps.logger } : {}) }) },
  ];
}

const consoleLogger: SyncLogger = {
  info: (message) => console.info(`[won-scheduler] ${message}`),
  warn: (message) => console.warn(`[won-scheduler] ${message}`),
  error: (message) => console.error(`[won-scheduler] ${message}`),
};

let job: { firstRun: ReturnType<typeof setTimeout>; interval: ReturnType<typeof setInterval> | null } | null = null;

/** Start the ticker once per process (idempotent; unref'd timers; off under NODE_ENV=test unless forced). */
export function startScheduler(db: PrismaClient, opts: { clientFor: OutletDueDeps["clientFor"]; force?: boolean; tickMs?: number; firstDelayMs?: number }): void {
  if (job) return;
  if (process.env.NODE_ENV === "test" && !opts.force) return;
  const tasks = appTasks({ db, clientFor: opts.clientFor, logger: consoleLogger });
  let running = false;
  const tick = () => {
    if (running) return; // a slow tick never overlaps the next
    running = true;
    runDueTasks(db, tasks, new Date())
      .then((results) => {
        for (const r of results) if (r.error) consoleLogger.error(`${r.name}: ${r.error}`);
      })
      .catch((error: unknown) => consoleLogger.error(`tick failed: ${errorText(error)}`))
      .finally(() => {
        running = false;
      });
  };
  const firstRun = setTimeout(() => {
    tick();
    const interval = setInterval(tick, opts.tickMs ?? SCHEDULER_TICK_MS);
    interval.unref?.();
    if (job) job.interval = interval;
  }, opts.firstDelayMs ?? SCHEDULER_FIRST_DELAY_MS);
  firstRun.unref?.();
  job = { firstRun, interval: null };
}

export function stopScheduler(): void {
  if (!job) return;
  clearTimeout(job.firstRun);
  if (job.interval) clearInterval(job.interval);
  job = null;
}

export function schedulerStarted(): boolean {
  return job !== null;
}
