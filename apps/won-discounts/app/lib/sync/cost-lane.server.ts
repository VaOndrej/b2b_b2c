// The cost mirror's jobs per shop, in THIS process (margin protection, MVP 2):
//   full   the full pass (costs.ts runCostPass) — margin protection switched
//          on, "Obnovit nákupní ceny", the Přehled / daily reconcile when the
//          last complete pass is older than 24 h;
//   clear  protection switched off: every variant metafield the sync wrote goes;
//   items  webhook-sized mirrors (inventory_items/update, products/create|update).
// Jobs of one shop run one after another (a webhook mirror never interleaves
// with a full pass: an older read could otherwise overwrite a newer cost). A
// newer full pass or clear supersedes the queued or running one ("novější běh
// ruší starší"): it stops at its next Shopify call; a full pass keeps its
// cursor and the newer one continues from it. Every job re-reads the STORED
// config when it runs (gated for the plan, BILL-1): full / items only while
// protection is on, clear only while it is off — so a job queued before the
// merchant switched protection off or on never does the wrong thing.
// The cost jobs never touch the shop config, so they need neither the config
// lock nor the settings sync queue: the config is written at once when
// protection is switched on — until a variant's cost is written, checkout
// applies the percent ceiling to it: stricter than no protection, NOT
// necessarily stricter than its cost floor (audit P2-1; the admin says so while
// the first pass runs). A refused write keeps an older cost only while it is
// the stricter floor (costs.ts olderCostsThatStay, from `floors` built here).
// The variant `pdp` maximum (MVP 3, K4) rides with the cost: full / items jobs
// get a pdp context built here from the SAME margin checkout runs (gated for
// the plan, folded — runningMargin), the product refs the sync wrote and the
// shop currency (read once per job; a failed read fails the job like any read).
// Single instance assumption as the rest of the sync (MVP 7 note): two
// instances would each run their own jobs — harmless, every write is an
// idempotent diff against what Shopify has.

import type { MarginModule } from "@won/core/discounts/config";
import { buildMarginPayload } from "@won/core/discounts/margin";
import { gateConfigForPlan, type ShopPlan } from "@won/core/discounts/plan-gate";

import type { PrismaClient } from "../../generated/prisma/client";
import type { AdminClient } from "../admin-client.server";
import { loadConfig } from "../config.server";
import { planOf } from "../plan.server";
import {
  clearCostMirror,
  COST_NO_SESSION,
  COST_WRITE_RETRY_MS,
  COSTS_MAX_AGE_MS,
  loadCostState,
  mirrorInventoryItems,
  mirrorProducts,
  recordCostsFailed,
  runCostPass,
  type ClearResult,
  type CostFloors,
  type CostPassResult,
  type PdpContext,
  type CostPending,
  type MirrorResult,
  pdpMarginKey,
} from "./costs";
import { foldedForCheckout } from "./margin-fold";
import { errorText, Transport } from "./transport";
import type { RetryOptions, SyncLogger } from "./types";
import { chunks, isoCurrency } from "./util";

export type CostJob =
  | {
      kind: "full";
      /** Start over (the cursor dropped); also re-sends refused writes unless `retryRefused` is false. */
      restart?: boolean;
      /** False: keep the refusal back-off even on a restart (the sync's pdp recompute, MVP 3). */
      retryRefused?: boolean;
    }
  | { kind: "clear" }
  | {
      kind: "items";
      inventoryItemIds?: readonly string[];
      productIds?: readonly string[];
      /** A retry of refused writes: re-send them although their attempt was just recorded (no back-off). */
      retryRefused?: boolean;
    };

export interface CostLaneDeps {
  client: AdminClient;
  db: PrismaClient;
  /** The shop's plan (BILL-1). Default: the app's resolver. */
  plan?: (shop: string) => Promise<ShopPlan>;
  now?: () => Date;
  logger?: SyncLogger;
  sleep?: (ms: number) => Promise<void>;
  retry?: Partial<RetryOptions>;
}

export type CostJobOutcome =
  | { done: "skipped"; reason: "margin_off" | "margin_on" | "no_config" | "superseded" }
  | { done: "full"; result: CostPassResult }
  | { done: "clear"; result: ClearResult }
  | { done: "items"; result: MirrorResult }
  | { done: "error"; error: string };

interface Lane {
  kind: "full" | "clear";
  cancelled: boolean;
  /** A full pass, once it runs: the margin it computes the pdp floor with (costs.ts pdpMarginKey). */
  marginKey?: string;
}

const queues = new Map<string, Promise<unknown>>();
const lanes = new Map<string, Lane>();
const progress = new Map<string, CostPending>();

const quiet: SyncLogger = { info() {}, warn() {}, error() {} };

type SettledListener = (shop: string, deps: CostLaneDeps) => void;
const settledListeners = new Set<SettledListener>();

/**
 * Called after every full pass (done or failed) and webhook-sized mirror that
 * ran — the mirror may have changed (integration/margin-impact.server.ts
 * recomputes the impact overview in the background). Returns the unsubscribe.
 */
export function onCostJobSettled(listener: SettledListener): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

function settled(shop: string, deps: CostLaneDeps): void {
  for (const listener of settledListeners) {
    try {
      listener(shop, deps);
    } catch {
      // a listener never fails a job
    }
  }
}

function chain<T>(shop: string, work: () => Promise<T>): Promise<T> {
  const previous = queues.get(shop) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(shop, settled);
  void settled.then(() => {
    if (queues.get(shop) === settled) queues.delete(shop);
  });
  return run;
}

/**
 * Margin protection in the stored config as checkout runs it: gated for the
 * shop's plan, and a collection too large to read folded into the whole
 * store's values like the sync ships it (sync/margin-fold.ts, audit fix round
 * 2). Null = nothing syncable.
 */
async function runningMargin(deps: CostLaneDeps, shop: string): Promise<MarginModule | null> {
  const loaded = await loadConfig(deps.db, shop);
  if (loaded.unreadable || loaded.readOnly) return null;
  if (!loaded.exists) return { ...loaded.config.modules.margin, enabled: false };
  const plan = await (deps.plan ?? planOf)(shop);
  return (await foldedForCheckout(deps.db, shop, gateConfigForPlan(loaded.config, plan).config)).modules.margin;
}

/** Product ids read per query (SQLite's bound-parameter limit). */
const REFS_CHUNK = 500;

/** The floors a refused write is judged by (costs.ts olderCostsThatStay): the settings checkout runs + the refs the sync wrote. */
function costFloors(deps: CostLaneDeps, shop: string, margin: MarginModule): CostFloors {
  return {
    payload: buildMarginPayload({ ...margin, enabled: true }),
    marginRefs: async (productIds) => {
      const out = new Map<string, unknown[]>();
      for (const ids of chunks(productIds, REFS_CHUNK)) {
        const rows = await deps.db.productTargetIndex.findMany({ where: { shop, productId: { in: ids } }, select: { productId: true, value: true } });
        for (const row of rows) {
          try {
            const refs = (JSON.parse(row.value ?? "{}") as { marginRefs?: unknown }).marginRefs;
            // As stored, junk included: olderCostsThatStay counts the entries like the engine.
            out.set(row.productId, Array.isArray(refs) ? refs : []);
          } catch {
            out.set(row.productId, []);
          }
        }
      }
      return out;
    },
  };
}

/**
 * The pdp context of a job (costs.ts): the margin checkout runs, the product
 * refs from `floors`, the shop currency read once (memoized; a failed read
 * rejects every caller — the job fails and is retried like any failed read).
 */
function pdpContext(transport: Transport, margin: MarginModule, floors: CostFloors): PdpContext {
  let currency: Promise<string | null> | null = null;
  return {
    margin,
    marginRefs: floors.marginRefs,
    shopCurrency: () =>
      (currency ??= transport.call<{ shop: { currencyCode?: string | null } | null }>("costShop").then((data) => {
        // The same normalization as the storefront config's (sync.server.ts): one string, one key (K4 v2).
        return isoCurrency(data.shop?.currencyCode);
      })),
  };
}

/** Queue a cost job for `shop` (see the header). Never rejects: failures come back as `error`. */
export function startCostJob(shop: string, deps: CostLaneDeps, job: CostJob): Promise<CostJobOutcome> {
  let lane: Lane | null = null;
  if (job.kind !== "items") {
    const older = lanes.get(shop);
    if (older) older.cancelled = true;
    lane = { kind: job.kind, cancelled: false };
    lanes.set(shop, lane);
  }
  const logger = deps.logger ?? quiet;
  return chain(shop, async (): Promise<CostJobOutcome> => {
    try {
      if (lane?.cancelled) return { done: "skipped", reason: "superseded" };
      const margin = await runningMargin(deps, shop);
      if (margin === null) return { done: "skipped", reason: "no_config" };
      const enabled = margin.enabled === true;
      if (job.kind === "clear" && enabled) return { done: "skipped", reason: "margin_on" };
      if (job.kind !== "clear" && !enabled) return { done: "skipped", reason: "margin_off" };
      if (lane && job.kind === "full") lane.marginKey = pdpMarginKey(margin);
      const transport = new Transport(deps.client, deps.retry, deps.sleep, logger);
      const isCancelled = () => lane?.cancelled === true;
      const floors = costFloors(deps, shop, margin);
      const ctx = {
        transport,
        db: deps.db,
        shop,
        isCancelled,
        now: deps.now,
        floors,
        // The pdp floor only while protection is on (full / items); a clear deletes it with the cost.
        ...(enabled ? { pdp: pdpContext(transport, margin, floors) } : {}),
        ...(job.kind === "items" && job.retryRefused ? { retryRefused: true } : {}),
      };
      if (job.kind === "full") {
        const result = await runCostPass({
          ...ctx,
          now: deps.now ?? (() => new Date()),
          restart: job.restart,
          ...(job.retryRefused !== undefined ? { retryRefused: job.retryRefused } : {}),
          onProgress: (pending) => progress.set(shop, pending),
        });
        if (result.outcome === "failed") logger.warn(`costs ${shop}: full pass failed: ${result.errors.join("; ")}`);
        else if (result.outcome === "done") {
          logger.info(
            `costs ${shop}: full pass done (${result.read} read, ${result.written} written, ${result.cleared} cleared, ${result.pdp} pdp, ${result.refused} refused)`,
          );
        }
        if (result.outcome !== "cancelled") settled(shop, deps);
        return { done: "full", result };
      }
      if (job.kind === "clear") {
        const result = await clearCostMirror(ctx);
        if (result.outcome === "failed") logger.warn(`costs ${shop}: clear failed: ${result.errors.join("; ")}`);
        return { done: "clear", result };
      }
      const items = await mirrorInventoryItems(ctx, job.inventoryItemIds ?? []);
      const products = await mirrorProducts(ctx, job.productIds ?? []);
      const result: MirrorResult = {
        written: items.written + products.written,
        cleared: items.cleared + products.cleared,
        pdp: items.pdp + products.pdp,
        refused: items.refused + products.refused,
        backedOff: items.backedOff + products.backedOff,
        removed: items.removed + products.removed,
        errors: [...items.errors, ...products.errors],
      };
      if (result.errors.length > 0) logger.warn(`costs ${shop}: mirror failed: ${result.errors.join("; ")}`);
      if (result.refused > 0) logger.warn(`costs ${shop}: Shopify refused ${result.refused} variant cost write(s)`);
      settled(shop, deps);
      return { done: "items", result };
    } catch (error) {
      if (error instanceof Response) {
        logger.warn(`costs ${shop}: the Admin API session needs re-auth; the job stopped`);
        return { done: "error", error: "re-auth required" };
      }
      logger.error(`costs ${shop}: ${errorText(error)}`);
      return { done: "error", error: errorText(error) };
    } finally {
      if (lane && lanes.get(shop) === lane) {
        lanes.delete(shop);
        progress.delete(shop);
      }
    }
  });
}

/**
 * Does a full pass of `shop` already cover every variant's pdp floor for the
 * margin `marginKey` (MVP 3)? One queued and not started yet does (it reads the
 * stored config when it starts, and resumes a cursor only under the same
 * margin); one running does when it runs with that margin.
 */
export function fullPassCovers(shop: string, marginKey: string): boolean {
  const lane = lanes.get(shop);
  if (!lane || lane.cancelled || lane.kind !== "full") return false;
  return lane.marginKey === undefined || lane.marginKey === marginKey;
}

/** The full pass or clear of `shop` queued or running here (null = none). */
export function costJobKind(shop: string): "full" | "clear" | null {
  const lane = lanes.get(shop);
  return lane && !lane.cancelled ? lane.kind : null;
}

/** Progress of the running full pass ("N z M"), null when none is running here. */
export function costPassProgress(shop: string): CostPending | null {
  if (costJobKind(shop) !== "full") return null;
  const value = progress.get(shop);
  return value ? { ...value } : null;
}

/** Resolves when no cost job of `shop` is queued or running here (tests, scripts). */
export async function costIdle(shop: string): Promise<void> {
  for (let current = queues.get(shop); current; current = queues.get(shop)) {
    await current;
    if (queues.get(shop) === current) break;
  }
}

// --- When is a job due? (the Přehled, the margin screen, the daily reconcile) -------------------

/** A failed full pass is retried by the Přehled / reconcile at most this often. */
export const COST_RETRY_MIN_INTERVAL_MS = 15 * 60_000;

/** Refused variants retried per job; more than this → one full pass instead. */
export const COST_RETRY_ITEMS = 250;

export type CostDue = "full" | "clear" | "retry";

/**
 * What the shop's cost mirror needs now, or null: a full pass while
 * protection is on and the last complete pass is older than COSTS_MAX_AGE_MS
 * (or none finished, or one was cut short — its cursor is resumed); a failed
 * pass is retried after COST_RETRY_MIN_INTERVAL_MS (one that could not start
 * for want of an offline session at once: the caller has a client); a "retry" of the
 * variants whose cost Shopify refused once their back-off
 * (COST_WRITE_RETRY_MS, from `writeFailedAt`: the refusal or the last retry
 * attempt, see launchClaimed) has passed — the pass itself counted as fresh. A clear
 * while protection is off and some variant still carries a metafield the sync
 * wrote.
 */
export async function costsDue(db: PrismaClient, shop: string, enabled: boolean, now: Date): Promise<CostDue | null> {
  if (!enabled) {
    const carrying = await db.variantCost.count({ where: { shop, mayCarry: true } });
    return carrying > 0 ? "clear" : null;
  }
  const state = await loadCostState(db, shop);
  if (state.pending?.failedAt) {
    // No offline session: whoever asks now has a client (an admin load) — retry at once.
    if (state.pending.error === COST_NO_SESSION) return "full";
    return now.getTime() - Date.parse(state.pending.failedAt) >= COST_RETRY_MIN_INTERVAL_MS ? "full" : null;
  }
  if (state.cursor !== null) return "full";
  if (!state.scannedAt || now.getTime() - state.scannedAt.getTime() >= COSTS_MAX_AGE_MS) return "full";
  const refused = await db.variantCost.count({
    where: { shop, writeError: { not: null }, writeFailedAt: { lte: new Date(now.getTime() - COST_WRITE_RETRY_MS) } },
  });
  return refused > 0 ? "retry" : null;
}

/** The job for a due state ("retry" = the refused variants by their inventory items, or one full pass when many). */
export async function jobFor(db: PrismaClient, shop: string, due: CostDue, now: Date): Promise<CostJob> {
  if (due !== "retry") return { kind: due };
  const refused = await db.variantCost.findMany({
    where: { shop, writeError: { not: null }, writeFailedAt: { lte: new Date(now.getTime() - COST_WRITE_RETRY_MS) } },
    select: { inventoryItemId: true },
    orderBy: { variantId: "asc" },
    take: COST_RETRY_ITEMS + 1,
  });
  if (refused.length > COST_RETRY_ITEMS) return { kind: "full" };
  return { kind: "items", inventoryItemIds: refused.map((row) => row.inventoryItemId), retryRefused: true };
}

/**
 * Shops claimed here: a due job being decided (Přehled, margin screen,
 * reconcile), or a refused-variant retry queued or running. Claimed
 * synchronously before the first await, so two simultaneous loads never
 * queue two jobs; released when nothing was due, when a full pass / clear is
 * in the lane (costJobKind covers it from there), or when the retry ends.
 */
const retrying = new Set<string>();

/** Claim `shop` unless a job of it is queued, running or being decided here. */
function claim(shop: string): boolean {
  if (costJobKind(shop) !== null || retrying.has(shop)) return false;
  retrying.add(shop);
  return true;
}

/**
 * Start the job the mirror needs (background, never awaited here) unless one
 * of this shop is already queued, running or being decided. `enabled` =
 * margin protection in the gated config the caller has. Returns what it did.
 */
export async function ensureCostsFresh(
  shop: string,
  deps: CostLaneDeps,
  enabled: boolean,
): Promise<"running" | "started_full" | "started_clear" | "started_retry" | "up_to_date"> {
  if (!claim(shop)) return "running";
  let due: CostDue | null;
  const now = (deps.now ?? (() => new Date()))();
  try {
    due = await costsDue(deps.db, shop, enabled, now);
  } catch (error) {
    retrying.delete(shop);
    throw error;
  }
  if (due === null) {
    retrying.delete(shop);
    return "up_to_date";
  }
  const kind = await launchClaimed(shop, deps, due, now);
  return kind === "items" ? "started_retry" : kind === "full" ? "started_full" : "started_clear";
}

/**
 * Start the job for `due` in the background (the reconcile), unless a job of
 * the shop is queued, running or being decided here (null then).
 */
export async function startDueJob(shop: string, deps: CostLaneDeps, due: CostDue, now: Date): Promise<CostJob["kind"] | null> {
  if (!claim(shop)) return null;
  return launchClaimed(shop, deps, due, now);
}

/**
 * With `shop` claimed: its job for `due`, started in the background. A retry
 * first records its attempt on the refused rows (`writeFailedAt` = now), so a
 * retry that fails before it reaches them (the read fails, an item has no
 * variant) is not queued again by the next load: it waits out the back-off
 * like a refusal. The retry job itself re-sends them regardless (retryRefused).
 */
async function launchClaimed(shop: string, deps: CostLaneDeps, due: CostDue, now: Date): Promise<CostJob["kind"]> {
  try {
    const job = await jobFor(deps.db, shop, due, now);
    if (job.kind === "items") {
      await deps.db.variantCost.updateMany({
        where: { shop, inventoryItemId: { in: [...(job.inventoryItemIds ?? [])] }, writeError: { not: null } },
        data: { writeFailedAt: now },
      });
      void startCostJob(shop, deps, job).finally(() => retrying.delete(shop));
    } else {
      void startCostJob(shop, deps, job);
      retrying.delete(shop);
    }
    return job.kind;
  } catch (error) {
    retrying.delete(shop);
    throw error;
  }
}

/**
 * OQ4: the shop has no usable offline session, so a background job could not
 * start — recorded for the admin ("open the app"; costs.ts recordCostsFailed,
 * which keeps an unfinished pass's cursor). Never over a job of the shop that
 * is queued or running here (it records its own outcome). Returns whether it
 * recorded.
 */
export async function recordNoSession(db: PrismaClient, shop: string, now: Date): Promise<boolean> {
  if (costJobKind(shop) !== null || retrying.has(shop)) return false;
  await recordCostsFailed(db, shop, now, COST_NO_SESSION);
  return true;
}

/** Is a refused-variant retry of `shop` queued or running here (or a due job being decided)? */
export function costRetryRunning(shop: string): boolean {
  return retrying.has(shop);
}
