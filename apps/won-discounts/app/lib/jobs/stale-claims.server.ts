// Periodic in-process sweep of stale native-move claims (native move audit
// follow-up): app/lib/native/move.server.ts's sweepStaleClaims already settles
// a `moving` / `undoing` NativeDiscountBackup row older than CLAIM_STALE_MS
// (a double discount: native + Won rule both live) by reading what Shopify
// runs — but until this job it only ran when a merchant opened Přehled
// (app/lib/integration/native.server.ts loadNativeView), which is unbounded
// with nobody looking. This job runs the SAME resolveStaleClaims, under the
// SAME per-shop config lock (app/lib/integration/lock.server.ts), on a timer,
// across every shop with a stale claim — not just the one a request touched.
//
// Single-instance assumption (Fly runs one machine for this app today): the
// timer lives in this process; two instances would each sweep independently,
// harmless since a claim is taken over with compare-and-set first (a live
// process's own claim always wins, see sweepStaleClaims). MVP 5's scheduler
// takes over running this on a cadence; this job is the interim owner.

import type { PrismaClient } from "../../generated/prisma/client";
import type { Locale } from "../../i18n";
import type { AdminClient } from "../admin-client.server";
import { isConfigLocked, withConfigLock } from "../integration/lock.server";
import { createSaveAndSync } from "../integration/native.server";
import { CLAIM_STALE_MS, resolveStaleClaims } from "../native/move.server";
import { BACKUP_STATUS } from "../native/types";
import type { SaveAndSync } from "../native/types";
import { errorText } from "../sync/transport";
import type { SyncLogger } from "../sync/types";

/** Distinct stale shops read per sweep pass (a bound, like STALE_SWEEP_BATCH inside each shop). */
export const STALE_SWEEP_SHOPS = 25;

/** First run after server start; then every STALE_SWEEP_INTERVAL_MS. */
export const STALE_SWEEP_FIRST_DELAY_MS = 30_000;
export const STALE_SWEEP_INTERVAL_MS = 5 * 60_000;

const quiet: SyncLogger = { info() {}, warn() {}, error() {} };

export interface StaleClaimSweepDeps {
  db: PrismaClient;
  /** The shop's Admin API client from its stored offline session, or null when it has none (never installed under this key, or uninstalled). */
  clientFor: (shop: string) => Promise<AdminClient | null>;
  /**
   * Builds the native layer's SaveAndSync for a shop (a rollback saves and
   * resyncs the config). Default: native.server's createSaveAndSync — the
   * canonical production wiring, the same one Přehled's own trigger uses.
   * Overridable in tests.
   */
  buildSaveAndSync?: (opts: { client: AdminClient; db: PrismaClient; shop: string }) => SaveAndSync;
  logger?: SyncLogger;
  locale?: Locale;
  now?: () => Date;
  /** Distinct stale shops read this pass. Default STALE_SWEEP_SHOPS. */
  maxShops?: number;
}

export interface StaleClaimSweepResult {
  /** Shops whose lock was free and whose sweep ran (whether or not it found anything to settle). */
  shopsSwept: number;
  /** Shops skipped because another writer held the config lock (retried next pass). */
  shopsSkippedLocked: number;
  /** Shops skipped because they have no offline Admin API session (retried next pass; harmless if uninstalled). */
  shopsSkippedNoSession: number;
  /** Rows resolveStaleClaims settled, summed across every shop swept. */
  rowsResolved: number;
}

const EMPTY: StaleClaimSweepResult = { shopsSwept: 0, shopsSkippedLocked: 0, shopsSkippedNoSession: 0, rowsResolved: 0 };

/**
 * One pass: find every shop with a `moving` / `undoing` claim older than
 * CLAIM_STALE_MS (bounded, distinct shops), and for each — skipping a shop
 * whose config lock is currently held by another writer, non-blocking, never
 * queuing behind it — settle its stale claims under that same lock. Never
 * throws: a failure sweeping one shop, or reading the stale list itself, is
 * logged (no PII: shop domain and error text only, OBS-1) and the pass moves
 * on.
 */
export async function runStaleClaimSweepOnce(deps: StaleClaimSweepDeps): Promise<StaleClaimSweepResult> {
  const logger = deps.logger ?? quiet;
  const now = deps.now ?? (() => new Date());
  const locale = deps.locale ?? "cs";
  const buildSaveAndSync =
    deps.buildSaveAndSync ?? ((opts) => createSaveAndSync({ client: opts.client, db: opts.db, locale, now: deps.now, logger: deps.logger }));

  let stale: { shop: string }[];
  try {
    stale = await deps.db.nativeDiscountBackup.findMany({
      where: {
        status: { in: [BACKUP_STATUS.moving, BACKUP_STATUS.undoing] },
        updatedAt: { lt: new Date(now().getTime() - CLAIM_STALE_MS) },
      },
      distinct: ["shop"],
      select: { shop: true },
      take: deps.maxShops ?? STALE_SWEEP_SHOPS,
    });
  } catch (error) {
    logger.error(`stale-claim sweep: could not read stale shops: ${errorText(error)}`);
    return EMPTY;
  }

  const result = { ...EMPTY };
  for (const { shop } of stale) {
    if (isConfigLocked(shop)) {
      // Another writer (a save, a move, a targeting resync) holds or waits for
      // this shop's lock right now: skip, never queue behind it. Retried next pass.
      result.shopsSkippedLocked += 1;
      continue;
    }
    let client: AdminClient | null;
    try {
      client = await deps.clientFor(shop);
    } catch (error) {
      logger.error(`stale-claim sweep ${shop}: could not build an Admin API client: ${errorText(error)}`);
      continue;
    }
    if (!client) {
      result.shopsSkippedNoSession += 1;
      continue;
    }
    try {
      const resolved = await withConfigLock(shop, () =>
        resolveStaleClaims({
          client,
          db: deps.db,
          shop,
          locale,
          now: deps.now,
          saveAndSync: buildSaveAndSync({ client, db: deps.db, shop }),
        }),
      );
      result.shopsSwept += 1;
      result.rowsResolved += resolved;
    } catch (error) {
      logger.error(`stale-claim sweep ${shop}: ${errorText(error)}`);
    }
  }
  return result;
}

// --- Process-wide timer ---------------------------------------------------------------------

interface JobHandle {
  firstRun: ReturnType<typeof setTimeout>;
  interval: ReturnType<typeof setInterval> | null;
}

let job: JobHandle | null = null;

/** The app's default deps: its own db, and unauthenticated.admin(shop) loaded lazily (importing this module never loads the Shopify app). */
function appDeps(db: PrismaClient, logger: SyncLogger): StaleClaimSweepDeps {
  return {
    db,
    logger,
    clientFor: async (shop) => {
      try {
        const { unauthenticated } = await import("../../shopify.server");
        const { adminClientFromApp } = await import("../admin-client.server");
        const { admin } = await unauthenticated.admin(shop);
        return adminClientFromApp(admin as unknown as Parameters<typeof adminClientFromApp>[0]);
      } catch {
        // No offline session (never installed under this API key) or the shop
        // uninstalled meanwhile: nothing to sweep for it right now.
        return null;
      }
    },
  };
}

const consoleLogger: SyncLogger = {
  info: (message) => console.info(`[won-stale-claims] ${message}`),
  warn: (message) => console.warn(`[won-stale-claims] ${message}`),
  error: (message) => console.error(`[won-stale-claims] ${message}`),
};

/**
 * Start the periodic sweep once per process: first run STALE_SWEEP_FIRST_DELAY_MS
 * after this call, then every STALE_SWEEP_INTERVAL_MS. Idempotent — a second
 * call is a no-op unless `opts.force` (tests). Timers are unref'd so they
 * never keep the process alive on their own. Disabled under NODE_ENV=test
 * unless `opts.force` — a test that wants the real timers opts in explicitly;
 * everything else should call runStaleClaimSweepOnce directly.
 */
export function startStaleClaimJob(opts: {
  force?: boolean;
  db?: PrismaClient;
  deps?: StaleClaimSweepDeps;
  firstDelayMs?: number;
  intervalMs?: number;
} = {}): void {
  if (job) return;
  if (process.env.NODE_ENV === "test" && !opts.force) return;

  const run = () => {
    let deps = opts.deps;
    if (!deps) {
      // Loaded lazily so a plain import of this module never pulls in the app db.
      const db = opts.db;
      if (!db) {
        consoleLogger.error("run: no db and no deps configured");
        return;
      }
      deps = appDeps(db, consoleLogger);
    }
    runStaleClaimSweepOnce(deps).catch((error: unknown) => consoleLogger.error(`sweep failed: ${errorText(error)}`));
  };

  const firstRun = setTimeout(() => {
    run();
    const interval = setInterval(run, opts.intervalMs ?? STALE_SWEEP_INTERVAL_MS);
    interval.unref?.();
    if (job) job.interval = interval;
  }, opts.firstDelayMs ?? STALE_SWEEP_FIRST_DELAY_MS);
  firstRun.unref?.();
  job = { firstRun, interval: null };
}

/** Test hook: stop the timers and clear the idempotency guard. */
export function stopStaleClaimJob(): void {
  if (!job) return;
  clearTimeout(job.firstRun);
  if (job.interval) clearInterval(job.interval);
  job = null;
}

/** Test hook: is the job started in this process? */
export function staleClaimJobStarted(): boolean {
  return job !== null;
}
