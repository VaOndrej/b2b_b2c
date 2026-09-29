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
// protection is switched on (an unknown cost = the stricter percent ceiling).
// Single instance assumption as the rest of the sync (MVP 7 note): two
// instances would each run their own jobs — harmless, every write is an
// idempotent diff against what Shopify has.

import { gateConfigForPlan, type ShopPlan } from "@won/core/discounts/plan-gate";

import type { PrismaClient } from "../../generated/prisma/client";
import type { AdminClient } from "../admin-client.server";
import { loadConfig } from "../config.server";
import { planOf } from "../plan.server";
import {
  clearCostMirror,
  COSTS_MAX_AGE_MS,
  loadCostState,
  mirrorInventoryItems,
  mirrorProducts,
  runCostPass,
  type ClearResult,
  type CostPassResult,
  type CostPending,
  type MirrorResult,
} from "./costs";
import { errorText, Transport } from "./transport";
import type { RetryOptions, SyncLogger } from "./types";

export type CostJob =
  | { kind: "full"; restart?: boolean }
  | { kind: "clear" }
  | { kind: "items"; inventoryItemIds?: readonly string[]; productIds?: readonly string[] };

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
}

const queues = new Map<string, Promise<unknown>>();
const lanes = new Map<string, Lane>();
const progress = new Map<string, CostPending>();

const quiet: SyncLogger = { info() {}, warn() {}, error() {} };

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

/** Is margin protection on in the stored config, as the shop's plan runs it? Null = nothing syncable. */
async function marginEnabled(deps: CostLaneDeps, shop: string): Promise<boolean | null> {
  const loaded = await loadConfig(deps.db, shop);
  if (loaded.unreadable || loaded.readOnly) return null;
  if (!loaded.exists) return false;
  const plan = await (deps.plan ?? planOf)(shop);
  return gateConfigForPlan(loaded.config, plan).config.modules.margin.enabled === true;
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
      const enabled = await marginEnabled(deps, shop);
      if (enabled === null) return { done: "skipped", reason: "no_config" };
      if (job.kind === "clear" && enabled) return { done: "skipped", reason: "margin_on" };
      if (job.kind !== "clear" && !enabled) return { done: "skipped", reason: "margin_off" };
      const transport = new Transport(deps.client, deps.retry, deps.sleep, logger);
      const isCancelled = () => lane?.cancelled === true;
      const ctx = { transport, db: deps.db, shop, isCancelled, now: deps.now };
      if (job.kind === "full") {
        const result = await runCostPass({
          ...ctx,
          now: deps.now ?? (() => new Date()),
          restart: job.restart,
          onProgress: (pending) => progress.set(shop, pending),
        });
        if (result.outcome === "failed") logger.warn(`costs ${shop}: full pass failed: ${result.errors.join("; ")}`);
        else if (result.outcome === "done") {
          logger.info(`costs ${shop}: full pass done (${result.read} read, ${result.written} written, ${result.cleared} cleared, ${result.refused} refused)`);
        }
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
        refused: items.refused + products.refused,
        backedOff: items.backedOff + products.backedOff,
        removed: items.removed + products.removed,
        errors: [...items.errors, ...products.errors],
      };
      if (result.errors.length > 0) logger.warn(`costs ${shop}: mirror failed: ${result.errors.join("; ")}`);
      if (result.refused > 0) logger.warn(`costs ${shop}: Shopify refused ${result.refused} variant cost write(s)`);
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

/**
 * What the shop's cost mirror needs now, or null: a full pass while
 * protection is on and the last complete pass is older than COSTS_MAX_AGE_MS
 * (or none finished, or one was cut short — its cursor is resumed); a failed
 * pass is retried after COST_RETRY_MIN_INTERVAL_MS. A clear while protection
 * is off and some variant still carries a metafield the sync wrote.
 */
export async function costsDue(db: PrismaClient, shop: string, enabled: boolean, now: Date): Promise<"full" | "clear" | null> {
  if (!enabled) {
    const carrying = await db.variantCost.count({ where: { shop, mayCarry: true } });
    return carrying > 0 ? "clear" : null;
  }
  const state = await loadCostState(db, shop);
  if (state.pending?.failedAt) {
    return now.getTime() - Date.parse(state.pending.failedAt) >= COST_RETRY_MIN_INTERVAL_MS ? "full" : null;
  }
  if (state.cursor !== null) return "full";
  if (!state.scannedAt || now.getTime() - state.scannedAt.getTime() >= COSTS_MAX_AGE_MS) return "full";
  return null;
}

/**
 * Start the job the mirror needs (background, never awaited here) unless one
 * of this shop is already queued or running. `enabled` = margin protection in
 * the gated config the caller has. Returns what it did.
 */
export async function ensureCostsFresh(
  shop: string,
  deps: CostLaneDeps,
  enabled: boolean,
): Promise<"running" | "started_full" | "started_clear" | "up_to_date"> {
  if (costJobKind(shop) !== null) return "running";
  const due = await costsDue(deps.db, shop, enabled, (deps.now ?? (() => new Date()))());
  if (due === null) return "up_to_date";
  if (costJobKind(shop) !== null) return "running";
  void startCostJob(shop, deps, { kind: due });
  return due === "full" ? "started_full" : "started_clear";
}
