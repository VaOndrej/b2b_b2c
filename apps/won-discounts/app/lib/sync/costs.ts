// The cost mirror (margin protection, MVP 2, spec §3 bod 7, A2). The discount
// function has no purchase cost in its input, so the sync copies each
// variant's `inventoryItem.unitCost` into an app-owned variant metafield the
// function reads:
//   $app:won_discounts/variant = {"cost": <unitCost.amount>, "cur": "<unitCost.currencyCode>"}
// only on variants with a cost > 0 (no cost → no metafield: the engine then
// applies the "no purchase cost" percent ceiling). Prisma VariantCost keeps one
// row per variant with what Shopify had and what the sync wrote; the admin
// counts, the impact overview and Vyzkoušet košík read it (never Shopify).
//
// Three ways in, all diffing against the metafield value Shopify HAS (read in
// the same query), so only changed variants are written:
//   runCostPass           the full pass: productVariants paged (COST_PAGE_SIZE),
//                         metafieldsSet ≤ 25 per call, metafieldsDelete where the
//                         cost disappeared (≤ 250 per call). Resumable: after
//                         every page the cursor is saved (ShopSyncState
//                         costsCursor), so a pass cancelled by a newer one or
//                         cut short by a restart continues where it stopped.
//                         Every row the pass saw gets its token (scanId); rows
//                         it did not see are re-read by id at the end (a
//                         variant created meanwhile is kept, a deleted one is
//                         dropped). A pass that finished without errors records
//                         costsScannedAt (= its start); the Přehled and the
//                         daily reconcile run a new one when that is > 24 h old;
//   mirrorInventoryItems  inventory_items/update (webhook): the item's variant
//                         looked up by the item (never trusting the payload's
//                         cost: a late delivery re-reads the current state);
//   mirrorProducts        products/create|update (webhook): the product's variants.
// clearCostMirror (margin protection switched off): every metafield the sync
// wrote is deleted and the rows go — so a cost that changed while protection
// was off is never trusted from a COMPLETED clear after it is switched on
// again: until the next pass writes a variant's cost, checkout treats it as
// unknown and applies the percent ceiling — stricter than no protection, NOT
// necessarily stricter than the cost floor (a cost of 70 % of the price with a
// 50 % ceiling is sold below cost in that window; the admin says so, audit
// P2-1). A clear that did not finish (switched off and on again quickly, or a
// reinstall) leaves older metafields that are read until the pass rewrites them.
// Row semantics: `metafieldValue` is only ever CONFIRMED (read from Shopify,
// or set by a write Shopify accepted) — Vyzkoušet košík and the impact
// overview read only that; `mayCarry` is the write-ahead marker (set before a
// write goes out, cleared when Shopify is read without the metafield or a
// delete is confirmed) the switch-off clear works from. A write Shopify
// REFUSES (userErrors; metafieldsSet is all-or-nothing) is split per variant,
// recorded on the variant (`writeError`, shown in the mirror status) and not
// re-sent for COST_WRITE_RETRY_MS — the pass still completes. `writeFailedAt`
// is the refusal's time, or the last retry attempt's (cost-lane.server.ts
// records it before a retry goes out, so a retry that fails early waits too).
// Every Shopify call goes through Transport (API-3: THROTTLED / 429 / 5xx
// retried with exponential backoff; metafieldsSet/Delete are idempotent).
// `isCancelled` is checked before every Shopify call: a newer job of the shop
// supersedes this one (cost-lane.server.ts).

import { randomUUID } from "node:crypto";

import { costMinorUnits, marginFloorUnit, resolveMargin, type FunctionMarginPayload } from "@won/core/discounts/margin";
import { toMinorUnits } from "@won/core/discounts/money";

import { Prisma, type PrismaClient } from "../../generated/prisma/client";
import { VARIANT_COST_KEY, WON_NAMESPACE } from "./graphql";
import { errorText, userErrorText, type Transport, type UserErrorLike } from "./transport";
import { chunks, METAFIELDS_DELETE_BATCH, METAFIELDS_SET_BATCH, NODES_BATCH, sameJson } from "./util";

/** A cursor older than this is not resumed (the pass starts over). */
export const COST_RESUME_MAX_AGE_MS = 24 * 60 * 60_000;
/** A full pass is due when the last complete one started longer ago than this (spec: "denně"). */
export const COSTS_MAX_AGE_MS = 24 * 60 * 60_000;
/** Pages of one product's variants read per webhook (150 each). */
const MAX_PRODUCT_VARIANT_PAGES = 20;
/** Characters of the error text kept on the pending state. */
const ERROR_MAX = 500;

export interface UnitCost {
  amount: string;
  currencyCode: string;
}

/**
 * The metafield value for a cost (what the function reads), or null when the
 * variant has no usable cost (none, ≤ 0, not a number, no ISO currency).
 */
export function desiredCostValue(unitCost: UnitCost | null | undefined): string | null {
  if (!unitCost) return null;
  const cost = Number(unitCost.amount);
  const cur = typeof unitCost.currencyCode === "string" ? unitCost.currencyCode.trim().toUpperCase() : "";
  if (!Number.isFinite(cost) || cost <= 0 || !/^[A-Z]{3}$/.test(cur)) return null;
  return JSON.stringify({ cost, cur });
}

/** A metafield value → {cost, cur} as the engine takes it, or null (junk, no cost — like the function). */
export function parseCostValue(value: string | null | undefined): { cost: number; cur: string } | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { cost?: unknown; cur?: unknown };
    if (typeof parsed.cost !== "number" || !Number.isFinite(parsed.cost) || parsed.cost <= 0) return null;
    if (typeof parsed.cur !== "string" || !/^[A-Z]{3}$/.test(parsed.cur)) return null;
    return { cost: parsed.cost, cur: parsed.cur };
  } catch {
    return null;
  }
}

// --- Pending state (ShopSyncState.costsPending) ---------------------------------------------

/** The pass under way (or the last failed one): what the admin shows as "N z M". */
export interface CostPending {
  /** The pass's token (VariantCost.scanId of the rows it saw). */
  token: string;
  /** When the pass started (ISO). */
  since: string;
  /** Variants read so far. */
  done: number;
  /** Variants in the shop (productVariantsCount, exact) — null when unknown. */
  total: number | null;
  /** Set when the pass ended with errors. */
  failedAt?: string;
  error?: string;
}

export function parseCostPending(text: string | null | undefined): CostPending | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as Partial<CostPending>;
    if (typeof v.token !== "string" || typeof v.since !== "string" || typeof v.done !== "number") return null;
    return {
      token: v.token,
      since: v.since,
      done: v.done,
      total: typeof v.total === "number" ? v.total : null,
      ...(typeof v.failedAt === "string" ? { failedAt: v.failedAt } : {}),
      ...(typeof v.error === "string" ? { error: v.error } : {}),
    };
  } catch {
    return null;
  }
}

export interface CostState {
  scannedAt: Date | null;
  cursor: string | null;
  pending: CostPending | null;
}

export async function loadCostState(db: PrismaClient, shop: string): Promise<CostState> {
  const row = await db.shopSyncState.findUnique({
    where: { shop },
    select: { costsScannedAt: true, costsCursor: true, costsPending: true },
  });
  return { scannedAt: row?.costsScannedAt ?? null, cursor: row?.costsCursor ?? null, pending: parseCostPending(row?.costsPending) };
}

/**
 * `CostPending.error` of a job that could not start because the shop has no
 * usable offline Admin API session (OQ4: the refresh token expired or was
 * revoked, or no session is stored). The admin says "open the app"; a load
 * with a session retries at once (cost-lane.server.ts costsDue).
 */
export const COST_NO_SESSION = "no_offline_session";

/**
 * Record a job that could not start (no session): the pending state of an
 * unfinished pass (if any) is marked failed with `error` — its token, its
 * progress and its resume CURSOR stay (audit fix round 2: a no-session failure
 * is resumed like a pass cut short) — else a failed pending state is created.
 * The admin shows it, costsDue retries it. The caller makes sure no pass of
 * the shop is running here (cost-lane.server.ts recordNoSession).
 */
export async function recordCostsFailed(db: PrismaClient, shop: string, now: Date, error: string): Promise<void> {
  const state = await loadCostState(db, shop);
  const base: CostPending = state.pending ?? { token: randomUUID(), since: now.toISOString(), done: 0, total: null };
  await saveCostState(db, shop, { costsPending: { ...base, failedAt: now.toISOString(), error: error.slice(0, ERROR_MAX) } });
}

async function saveCostState(db: PrismaClient, shop: string, data: { costsScannedAt?: Date | null; costsCursor?: string | null; costsPending?: CostPending | null }): Promise<void> {
  const row = {
    ...(data.costsScannedAt !== undefined ? { costsScannedAt: data.costsScannedAt } : {}),
    ...(data.costsCursor !== undefined ? { costsCursor: data.costsCursor } : {}),
    ...(data.costsPending !== undefined ? { costsPending: data.costsPending === null ? null : JSON.stringify(data.costsPending) } : {}),
  };
  await db.shopSyncState.upsert({ where: { shop }, create: { shop, ...row }, update: row });
}

// --- Snapshots and writes ----------------------------------------------------------------------

/** One variant as Shopify has it now, with the metafield value it carries. */
export interface VariantSnapshot {
  variantId: string;
  productId: string;
  inventoryItemId: string;
  title: string | null;
  variantTitle: string | null;
  price: string;
  unitCost: UnitCost | null;
  /** The `$app:won_discounts/variant` value Shopify has (null = none). */
  current: string | null;
}

interface VariantNode {
  id?: string;
  title?: string | null;
  price?: string | null;
  product?: { id?: string; title?: string | null } | null;
  inventoryItem?: { id?: string; unitCost?: UnitCost | null } | null;
  cost?: { value?: string | null } | null;
}

const variantTitleOf = (title: string | null | undefined) => (title && title !== "Default Title" ? title : null);

function snapshotOf(node: VariantNode | null | undefined, extra: { product?: { id?: string; title?: string | null } | null; inventoryItem?: VariantNode["inventoryItem"] } = {}): VariantSnapshot | null {
  if (!node?.id) return null;
  const product = extra.product ?? node.product;
  const item = extra.inventoryItem ?? node.inventoryItem;
  if (!product?.id || !item?.id) return null;
  return {
    variantId: node.id,
    productId: product.id,
    inventoryItemId: item.id,
    title: product.title ?? null,
    variantTitle: variantTitleOf(node.title),
    price: typeof node.price === "string" ? node.price : "0",
    unitCost: item.unitCost ?? null,
    current: node.cost?.value ?? null,
  };
}

export interface CostCtx {
  transport: Transport;
  db: PrismaClient;
  shop: string;
  /** Checked before every Shopify call: true stops the job (a newer one supersedes it). */
  isCancelled?: () => boolean;
  /** The clock for the refusal back-off (default: now). */
  now?: () => Date;
  /** Re-send writes Shopify refused recently too ("Obnovit nákupní ceny"): no back-off. */
  retryRefused?: boolean;
  /**
   * Margin protection as checkout runs it (the lane builds it from the gated
   * stored config and the product refs the sync wrote): decides whether an
   * older cost stays after a refused write (olderCostsThatStay). Absent = it
   * is deleted.
   */
  floors?: CostFloors;
}

/** What olderCostsThatStay needs to compute a variant's floors the way the engine does. */
export interface CostFloors {
  /** The margin payload (buildMarginPayload, `cur` not needed: the variant's cost currency stands in for the shop's). */
  payload: FunctionMarginPayload;
  /** Product GID → the `marginRefs` its product metafield carries. */
  marginRefs: (productIds: readonly string[]) => Promise<ReadonlyMap<string, readonly string[]>>;
}

/** A variant whose write Shopify refused is not re-sent for this long (unless the merchant asks). */
export const COST_WRITE_RETRY_MS = 60 * 60_000;
const WRITE_ERROR_MAX = 300;

export class CostJobCancelled extends Error {
  constructor() {
    super("superseded by a newer cost job");
    this.name = "CostJobCancelled";
  }
}

function checkCancelled(ctx: CostCtx): void {
  if (ctx.isCancelled?.()) throw new CostJobCancelled();
}

export interface ApplyResult {
  written: number;
  cleared: number;
  /** Variants whose write Shopify refused (recorded on their rows; the job goes on). */
  refused: number;
  /** Variants not re-sent because Shopify refused them within COST_WRITE_RETRY_MS. */
  backedOff: number;
  /** Calls that failed as a whole (transport / GraphQL after the retries): the job is not complete. */
  errors: string[];
}

/** The snapshot's own columns; the cost only when it is usable (> 0, ISO currency). */
function rowData(s: VariantSnapshot) {
  const usable = desiredCostValue(s.unitCost) !== null;
  return {
    productId: s.productId,
    inventoryItemId: s.inventoryItemId,
    title: s.title,
    variantTitle: s.variantTitle,
    price: s.price,
    cost: usable ? s.unitCost!.amount : null,
    currency: usable ? s.unitCost!.currencyCode.trim().toUpperCase() : null,
  };
}

type SendOutcome = { kind: "ok" } | { kind: "refused"; error: string } | { kind: "failed"; error: string };

async function send(ctx: CostCtx, op: "metafieldsSet" | "metafieldsDelete", metafields: Record<string, unknown>[]): Promise<SendOutcome> {
  try {
    if (op === "metafieldsSet") {
      const data: { metafieldsSet: { userErrors: UserErrorLike[] } } = await ctx.transport.call("metafieldsSet", { metafields });
      const refused = userErrorText(data.metafieldsSet.userErrors);
      return refused ? { kind: "refused", error: refused } : { kind: "ok" };
    }
    const data: { metafieldsDelete: { userErrors: UserErrorLike[] } } = await ctx.transport.call("metafieldsDelete", { metafields });
    const refused = userErrorText(data.metafieldsDelete.userErrors);
    return refused ? { kind: "refused", error: refused } : { kind: "ok" };
  } catch (error) {
    if (error instanceof Response || error instanceof CostJobCancelled) throw error;
    return { kind: "failed", error: errorText(error) };
  }
}

const setInput = (variantId: string, value: string) => ({ ownerId: variantId, namespace: WON_NAMESPACE, key: VARIANT_COST_KEY, type: "json", value });
const deleteInput = (variantId: string) => ({ ownerId: variantId, namespace: WON_NAMESPACE, key: VARIANT_COST_KEY });

/**
 * Send one batch; a batch Shopify REFUSES (userErrors: metafieldsSet is
 * all-or-nothing) is split and sent per variant, so one bad variant never
 * blocks the other 24. `onDone(ids)` / `onRefused(id, error)` settle the rows.
 */
async function sendBatch(
  ctx: CostCtx,
  op: "metafieldsSet" | "metafieldsDelete",
  items: readonly { variantId: string; input: Record<string, unknown> }[],
  out: ApplyResult,
  onDone: (variantIds: string[]) => Promise<void>,
  onRefused: (variantId: string, error: string) => Promise<void>,
): Promise<number> {
  checkCancelled(ctx);
  const whole = await send(ctx, op, items.map((i) => i.input));
  if (whole.kind === "ok") {
    await onDone(items.map((i) => i.variantId));
    return items.length;
  }
  if (whole.kind === "failed") {
    out.errors.push(`costs.${op === "metafieldsSet" ? "set" : "delete"}: ${whole.error}`);
    return 0;
  }
  if (items.length === 1) {
    await onRefused(items[0]!.variantId, whole.error);
    return 0;
  }
  let done = 0;
  for (const item of items) done += await sendBatch(ctx, op, [item], out, onDone, onRefused);
  return done;
}

/** Existing rows are read in chunks of this many ids (SQLite's bound-parameter limit). */
const ROW_READ_CHUNK = 500;

type RowState = {
  productId: string;
  inventoryItemId: string;
  title: string | null;
  variantTitle: string | null;
  price: string;
  cost: string | null;
  currency: string | null;
  metafieldValue: string | null;
  mayCarry: boolean;
  writeError: string | null;
  writeFailedAt: Date | null;
  scanId: string | null;
};

const ROW_FIELDS = ["productId", "inventoryItemId", "title", "variantTitle", "price", "cost", "currency", "metafieldValue", "mayCarry"] as const;

/**
 * After Shopify refused a new cost (audit P2-1b): the variants whose OLDER
 * cost stays. It stays only when, at the variant's current price, its cost
 * floor is at least as strict as the percent floor that applies without it —
 * core marginFloorUnit with the settings the engine resolves for the product
 * (resolveMargin over its marginRefs) and the variant's price in the shop
 * currency (Shopify keeps unit costs in the shop currency, so the new cost's
 * currency stands in for it; an older cost in another currency is ignored by
 * checkout anyway and goes). A higher cost can only be written by replacing
 * the older one, so while the write is refused the older, lower cost is the
 * best floor there is when it beats the ceiling. The floor is compared at the
 * shop price; a market price differs, the comparison is the same ratio.
 */
export async function olderCostsThatStay(ctx: Pick<CostCtx, "floors">, snapshots: readonly VariantSnapshot[]): Promise<Set<string>> {
  const out = new Set<string>();
  const floors = ctx.floors;
  if (!floors || !floors.payload.enabled || snapshots.length === 0) return out;
  const refs = await floors.marginRefs([...new Set(snapshots.map((s) => s.productId))]);
  for (const s of snapshots) {
    const older = parseCostValue(s.current);
    const currency = s.unitCost?.currencyCode.trim().toUpperCase() ?? "";
    if (!older || older.cur !== currency) continue;
    const settings = resolveMargin(floors.payload, refs.get(s.productId) ?? []);
    const price = toMinorUnits(s.price, currency);
    if (!settings || price === null) continue;
    const costMinor = costMinorUnits(older.cost, older.cur, 1, currency, currency);
    const withCost = marginFloorUnit({ unitPrice: price, costMinor, minMarginPercent: settings.minMarginPercent, maxDiscountPercent: settings.maxDiscountPercent });
    const ceiling = marginFloorUnit({ unitPrice: price, costMinor: null, minMarginPercent: settings.minMarginPercent, maxDiscountPercent: settings.maxDiscountPercent });
    if (withCost.basis === "cost" && withCost.floorUnit >= ceiling.floorUnit) out.add(s.variantId);
  }
  return out;
}

/**
 * Record the snapshots and bring each variant's metafield to its desired value
 * (only where it differs). `metafieldValue` is only ever a CONFIRMED value
 * (read from Shopify, or set by a write Shopify accepted); before a write goes
 * out the row is marked `mayCarry` (write-ahead: a switch-off clear never
 * misses a metafield the sync may have written), and the answer settles it.
 * A write Shopify refuses is recorded on the variant (`writeError`) and not
 * re-sent for COST_WRITE_RETRY_MS; the job goes on — and when the variant
 * still carries an OLDER, different value, that value stays only while it is
 * the stricter floor (olderCostsThatStay); otherwise it is deleted and the
 * "no purchase cost" ceiling applies — decided in the call that saw the
 * refusal and again in every later one while it backs off.
 * A row is only written when something in it changes: a no-op pass or
 * products/update never moves `updatedAt` (the impact cache keys on it); the
 * pass token (`scanId`) is set with a plain UPDATE that leaves it alone.
 */
export async function applySnapshots(ctx: CostCtx, snapshots: readonly VariantSnapshot[], opts: { scanId?: string } = {}): Promise<ApplyResult> {
  const { db, shop } = ctx;
  const now = (ctx.now ?? (() => new Date()))();
  const existing = new Map<string, RowState>();
  for (const ids of chunks(snapshots.map((s) => s.variantId), ROW_READ_CHUNK)) {
    const rows = await db.variantCost.findMany({
      where: { shop, variantId: { in: ids } },
      select: {
        variantId: true,
        productId: true,
        inventoryItemId: true,
        title: true,
        variantTitle: true,
        price: true,
        cost: true,
        currency: true,
        metafieldValue: true,
        mayCarry: true,
        writeError: true,
        writeFailedAt: true,
        scanId: true,
      },
    });
    for (const { variantId, ...row } of rows) existing.set(variantId, row);
  }
  const sets: { s: VariantSnapshot; value: string }[] = [];
  const deletes: VariantSnapshot[] = [];
  const settled: { s: VariantSnapshot; value: string | null }[] = [];
  for (const s of snapshots) {
    const desired = desiredCostValue(s.unitCost);
    if (desired !== null && !sameJson(s.current, desired)) sets.push({ s, value: desired });
    else if (desired === null && s.current !== null) deletes.push(s);
    else settled.push({ s, value: s.current });
  }
  // Back-off: a variant Shopify refused within COST_WRITE_RETRY_MS is not re-sent (unless the merchant asks).
  const cutoff = now.getTime() - COST_WRITE_RETRY_MS;
  const backedOff = new Set<string>();
  if (!ctx.retryRefused) {
    for (const id of [...sets.map((w) => w.s.variantId), ...deletes.map((s) => s.variantId)]) {
      const failedAt = existing.get(id)?.writeFailedAt;
      if (failedAt && failedAt.getTime() > cutoff) backedOff.add(id);
    }
  }
  const toSend = (id: string) => !backedOff.has(id);

  // Rows first, only where something changes (a no-op leaves updatedAt alone).
  const writes: ReturnType<typeof db.variantCost.upsert>[] = [];
  const record = (s: VariantSnapshot, data: { metafieldValue: string | null; mayCarry: boolean; clearError?: boolean }) => {
    const next = { ...rowData(s), metafieldValue: data.metafieldValue, mayCarry: data.mayCarry };
    const row = existing.get(s.variantId);
    const changed =
      !row || ROW_FIELDS.some((field) => row[field] !== next[field]) || (data.clearError === true && (row.writeError !== null || row.writeFailedAt !== null));
    if (!changed) return;
    writes.push(
      db.variantCost.upsert({
        where: { shop_variantId: { shop, variantId: s.variantId } },
        create: { shop, variantId: s.variantId, ...next, scanId: opts.scanId ?? null },
        update: { ...next, ...(data.clearError ? { writeError: null, writeFailedAt: null } : {}), ...(opts.scanId ? { scanId: opts.scanId } : {}) },
      }),
    );
  };
  // Nothing to write: Shopify holds what it should (a confirmed value, or none).
  for (const { s, value } of settled) record(s, { metafieldValue: value, mayCarry: value !== null, clearError: true });
  // About to write or delete: confirmed = what Shopify has now; may carry (write-ahead).
  for (const { s } of sets) record(s, { metafieldValue: s.current, mayCarry: toSend(s.variantId) || s.current !== null });
  for (const s of deletes) record(s, { metafieldValue: s.current, mayCarry: true });
  if (writes.length > 0) await db.$transaction(writes);
  if (opts.scanId) {
    // The pass saw these variants: its token, without touching updatedAt (not a change of the mirror's content).
    const unmarked = snapshots.filter((s) => existing.has(s.variantId) && existing.get(s.variantId)!.scanId !== opts.scanId).map((s) => s.variantId);
    for (const ids of chunks(unmarked, ROW_READ_CHUNK)) {
      await db.$executeRaw`UPDATE "VariantCost" SET "scanId" = ${opts.scanId} WHERE "shop" = ${shop} AND "variantId" IN (${Prisma.join(ids)})`;
    }
  }

  const out: ApplyResult = { written: 0, cleared: 0, refused: 0, backedOff: backedOff.size, errors: [] };
  const refuse = async (variantId: string, error: string, stillCarries: boolean) => {
    out.refused += 1;
    await db.variantCost.updateMany({
      where: { shop, variantId },
      data: { writeError: error.slice(0, WRITE_ERROR_MAX), writeFailedAt: now, ...(stillCarries ? {} : { mayCarry: false }) },
    });
  };
  const currentOf = new Map(snapshots.map((s) => [s.variantId, s.current]));
  const valueOf = new Map(sets.map((w) => [w.s.variantId, w.value]));
  /**
   * Refused sets on variants that still carry an older value: that value goes
   * unless it is the stricter floor (olderCostsThatStay) — until a retry writes
   * the right cost. Also the backed-off ones: a delete that failed earlier is
   * tried again on every pass or mirror, not only in the call where Shopify
   * refused the write.
   */
  const staleAfterRefusal: string[] = sets.filter((w) => !toSend(w.s.variantId) && w.s.current !== null).map((w) => w.s.variantId);
  for (const batch of chunks(sets.filter((w) => toSend(w.s.variantId)), METAFIELDS_SET_BATCH)) {
    out.written += await sendBatch(
      ctx,
      "metafieldsSet",
      batch.map((w) => ({ variantId: w.s.variantId, input: setInput(w.s.variantId, w.value) })),
      out,
      async (ids) => {
        await db.$transaction(
          ids.map((variantId) =>
            db.variantCost.updateMany({
              where: { shop, variantId },
              data: { metafieldValue: valueOf.get(variantId)!, mayCarry: true, writeError: null, writeFailedAt: null },
            }),
          ),
        );
      },
      // Refused = nothing applied (all-or-nothing): it carries only what it carried.
      async (variantId, error) => {
        const carries = currentOf.get(variantId) != null;
        await refuse(variantId, error, carries);
        if (carries) staleAfterRefusal.push(variantId);
      },
    );
  }
  const snapshotOfId = new Map(snapshots.map((s) => [s.variantId, s]));
  const staying = await olderCostsThatStay(ctx, staleAfterRefusal.map((id) => snapshotOfId.get(id)!));
  for (const batch of chunks(staleAfterRefusal.filter((id) => !staying.has(id)), METAFIELDS_DELETE_BATCH)) {
    await sendBatch(
      ctx,
      "metafieldsDelete",
      batch.map((variantId) => ({ variantId, input: deleteInput(variantId) })),
      out,
      async (ids) => {
        // Gone from Shopify; the refusal stays recorded (retried after the back-off).
        await db.variantCost.updateMany({ where: { shop, variantId: { in: ids } }, data: { metafieldValue: null, mayCarry: false } });
      },
      async (_variantId, error) => {
        out.errors.push(`costs.delete: an older cost could not be removed after a refused write: ${error}`);
      },
    );
  }
  for (const batch of chunks(deletes.filter((s) => toSend(s.variantId)), METAFIELDS_DELETE_BATCH)) {
    out.cleared += await sendBatch(
      ctx,
      "metafieldsDelete",
      batch.map((s) => ({ variantId: s.variantId, input: deleteInput(s.variantId) })),
      out,
      async (ids) => {
        await db.variantCost.updateMany({
          where: { shop, variantId: { in: ids } },
          data: { metafieldValue: null, mayCarry: false, writeError: null, writeFailedAt: null },
        });
      },
      (variantId, error) => refuse(variantId, error, true),
    );
  }
  return out;
}

async function deleteVariantMetafields(ctx: CostCtx, variantIds: string[]): Promise<string | null> {
  const result = await send(ctx, "metafieldsDelete", variantIds.map(deleteInput));
  return result.kind === "ok" ? null : result.error;
}

// --- The full pass ---------------------------------------------------------------------------------

export interface CostPassOptions extends CostCtx {
  now: () => Date;
  /** Start over even when an unfinished pass could be resumed ("Obnovit nákupní ceny"). */
  restart?: boolean;
  /** After every page (the admin's "N z M"). */
  onProgress?: (pending: CostPending) => void;
}

export interface CostPassResult {
  outcome: "done" | "failed" | "cancelled";
  /** Variants read in this run (a resumed pass counts from where it continued). */
  read: number;
  written: number;
  cleared: number;
  /** Rows of variants that no longer exist, dropped. */
  removed: number;
  /** Variants whose write Shopify refused (recorded on their rows; the pass still completes). */
  refused: number;
  errors: string[];
  resumed: boolean;
}

interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

async function variantCount(ctx: CostCtx): Promise<number | null> {
  try {
    const data: { productVariantsCount: { count: number; precision: string } | null } = await ctx.transport.call("costVariantsCount");
    const count = data.productVariantsCount;
    return count && count.precision === "EXACT" ? count.count : null;
  } catch (error) {
    if (error instanceof Response || error instanceof CostJobCancelled) throw error;
    return null;
  }
}

/** Add one apply's counts to a running total. */
function add(out: { written: number; cleared: number; refused: number; errors: string[] }, applied: ApplyResult): void {
  out.written += applied.written;
  out.cleared += applied.cleared;
  out.refused += applied.refused;
  out.errors.push(...applied.errors);
}

/** Rows the pass did not see: re-read by id — existing ones are applied, gone ones dropped. */
async function recheckUnseen(ctx: CostCtx, token: string, out: CostPassResult): Promise<void> {
  const rows = await ctx.db.variantCost.findMany({
    where: { shop: ctx.shop, OR: [{ scanId: null }, { scanId: { not: token } }] },
    select: { variantId: true },
  });
  for (const batch of chunks(rows.map((r) => r.variantId), NODES_BATCH)) {
    checkCancelled(ctx);
    const data: { nodes: (VariantNode | null)[] } = await ctx.transport.call("costVariantNodes", { ids: batch });
    const found: VariantSnapshot[] = [];
    const gone: string[] = [];
    batch.forEach((variantId, i) => {
      const snapshot = snapshotOf(data.nodes[i]);
      if (snapshot) found.push(snapshot);
      else gone.push(variantId);
    });
    if (gone.length) {
      await ctx.db.variantCost.deleteMany({ where: { shop: ctx.shop, variantId: { in: gone } } });
      out.removed += gone.length;
    }
    if (found.length) add(out, await applySnapshots(ctx, found, { scanId: token }));
  }
}

/**
 * The full pass (see the header). Never throws for Shopify failures: they end
 * the pass as `failed` (recorded on the pending state for the admin). A thrown
 * Response (re-auth) is rethrown; a cancelled pass keeps its cursor.
 */
export async function runCostPass(opts: CostPassOptions): Promise<CostPassResult> {
  const { db, shop } = opts;
  const now = opts.now();
  // "Obnovit nákupní ceny" (restart) re-sends refused writes too.
  if (opts.restart) opts = { ...opts, retryRefused: true };
  const state = await loadCostState(db, shop);
  const previous = state.pending;
  const resumable =
    !opts.restart &&
    state.cursor !== null &&
    previous !== null &&
    // A pass that failed for want of a session never ran: its cursor is resumed like one cut short.
    (previous.failedAt === undefined || previous.error === COST_NO_SESSION) &&
    now.getTime() - Date.parse(previous.since) < COST_RESUME_MAX_AGE_MS;
  const out: CostPassResult = { outcome: "done", read: 0, written: 0, cleared: 0, removed: 0, refused: 0, errors: [], resumed: resumable };
  const pending: CostPending = resumable
    ? { token: previous!.token, since: previous!.since, done: previous!.done, total: previous!.total }
    : { token: randomUUID(), since: now.toISOString(), done: 0, total: null };
  let cursor: string | null = resumable ? state.cursor : null;
  try {
    checkCancelled(opts);
    if (!resumable) pending.total = await variantCount(opts);
    await saveCostState(db, shop, { costsCursor: cursor, costsPending: pending });
    opts.onProgress?.({ ...pending });
    for (;;) {
      checkCancelled(opts);
      const data: { productVariants: Page<VariantNode> } = await opts.transport.call("costVariants", { after: cursor });
      const page = data.productVariants;
      const snapshots = page.nodes.map((node) => snapshotOf(node)).filter((s): s is VariantSnapshot => s !== null);
      add(out, await applySnapshots(opts, snapshots, { scanId: pending.token }));
      out.read += page.nodes.length;
      pending.done += page.nodes.length;
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
      await saveCostState(db, shop, { costsCursor: cursor, costsPending: pending });
      opts.onProgress?.({ ...pending });
      if (!page.pageInfo.hasNextPage || cursor === null) break;
    }
    await recheckUnseen(opts, pending.token, out);
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof CostJobCancelled) return { ...out, outcome: "cancelled" };
    out.errors.push(`costs.read: ${errorText(error)}`);
  }
  if (out.errors.length === 0) {
    await saveCostState(db, shop, { costsScannedAt: new Date(pending.since), costsCursor: null, costsPending: null });
    return out;
  }
  const error = [...new Set(out.errors)].join("; ").slice(0, ERROR_MAX);
  await saveCostState(db, shop, { costsCursor: null, costsPending: { ...pending, failedAt: opts.now().toISOString(), error } });
  return { ...out, outcome: "failed" };
}

// --- Webhook-sized mirrors -----------------------------------------------------------------------

export interface MirrorResult extends ApplyResult {
  /** Rows dropped because their variant (or inventory item, or product) is gone. */
  removed: number;
}

/**
 * inventory_items/update: re-read each item's variant (cost, price, metafield)
 * and bring its metafield up to date. An item Shopify no longer has drops its
 * row; an item without a variant is ignored. Throws on a read failure (the
 * caller logs; the daily reconcile catches up).
 */
export async function mirrorInventoryItems(ctx: CostCtx, inventoryItemIds: readonly string[]): Promise<MirrorResult> {
  const out: MirrorResult = { written: 0, cleared: 0, refused: 0, backedOff: 0, removed: 0, errors: [] };
  for (const batch of chunks([...new Set(inventoryItemIds)], NODES_BATCH)) {
    checkCancelled(ctx);
    const data: {
      nodes: ({ __typename?: string; id?: string; unitCost?: UnitCost | null; variants?: { nodes: VariantNode[] } | null } | null)[];
    } = await ctx.transport.call("costInventoryItems", { ids: batch });
    const snapshots: VariantSnapshot[] = [];
    const gone: string[] = [];
    batch.forEach((itemId, i) => {
      const node = data.nodes[i];
      if (!node || node.__typename !== "InventoryItem") {
        gone.push(itemId);
        return;
      }
      const snapshot = snapshotOf(node.variants?.nodes[0], { inventoryItem: { id: node.id, unitCost: node.unitCost ?? null } });
      if (snapshot) snapshots.push(snapshot);
    });
    if (gone.length) out.removed += (await ctx.db.variantCost.deleteMany({ where: { shop: ctx.shop, inventoryItemId: { in: gone } } })).count;
    if (snapshots.length) add(out, await applySnapshots(ctx, snapshots));
  }
  return out;
}

/**
 * products/create|update: every variant of each product; rows of variants the
 * product no longer has (and of a deleted product) are dropped.
 */
export async function mirrorProducts(ctx: CostCtx, productIds: readonly string[]): Promise<MirrorResult> {
  const out: MirrorResult = { written: 0, cleared: 0, refused: 0, backedOff: 0, removed: 0, errors: [] };
  for (const productId of new Set(productIds)) {
    const snapshots: VariantSnapshot[] = [];
    let after: string | null = null;
    let exists = true;
    let complete = false;
    for (let page = 0; page < MAX_PRODUCT_VARIANT_PAGES; page += 1) {
      checkCancelled(ctx);
      const data: { product: { id: string; title?: string | null; variants: Page<VariantNode> } | null } = await ctx.transport.call(
        "costProductVariants",
        { id: productId, after },
      );
      if (!data.product) {
        exists = false;
        break;
      }
      const product = { id: data.product.id, title: data.product.title ?? null };
      for (const node of data.product.variants.nodes) {
        const snapshot = snapshotOf(node, { product });
        if (snapshot) snapshots.push(snapshot);
      }
      if (!data.product.variants.pageInfo.hasNextPage) {
        complete = true;
        break;
      }
      after = data.product.variants.pageInfo.endCursor;
    }
    if (!exists) {
      out.removed += (await ctx.db.variantCost.deleteMany({ where: { shop: ctx.shop, productId } })).count;
      continue;
    }
    if (complete) {
      const keep = snapshots.map((s) => s.variantId);
      out.removed += (await ctx.db.variantCost.deleteMany({ where: { shop: ctx.shop, productId, variantId: { notIn: keep } } })).count;
    }
    add(out, await applySnapshots(ctx, snapshots));
  }
  return out;
}

// --- Margin protection switched off --------------------------------------------------------------

export interface ClearResult {
  outcome: "done" | "failed" | "cancelled";
  cleared: number;
  errors: string[];
}

/**
 * Delete the metafield of every variant that may carry one (`mayCarry`: a
 * confirmed value, a write that may have landed, or an uninstall marker;
 * ≤ 250 per call), then the shop's rows and its pass bookkeeping. Rows whose
 * delete failed stay (still marked) for the next clear.
 */
export async function clearCostMirror(ctx: CostCtx): Promise<ClearResult> {
  const { db, shop } = ctx;
  const out: ClearResult = { outcome: "done", cleared: 0, errors: [] };
  const carrying = await db.variantCost.findMany({ where: { shop, mayCarry: true }, select: { variantId: true } });
  try {
    for (const batch of chunks(carrying.map((r) => r.variantId), METAFIELDS_DELETE_BATCH)) {
      checkCancelled(ctx);
      const error = await deleteVariantMetafields(ctx, batch);
      if (error) {
        out.errors.push(`costs.clear: ${error}`);
        continue;
      }
      await db.variantCost.deleteMany({ where: { shop, variantId: { in: batch } } });
      out.cleared += batch.length;
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof CostJobCancelled) return { ...out, outcome: "cancelled" };
    out.errors.push(`costs.clear: ${errorText(error)}`);
  }
  if (out.errors.length > 0) return { ...out, outcome: "failed" };
  await db.variantCost.deleteMany({ where: { shop } });
  await saveCostState(db, shop, { costsScannedAt: null, costsCursor: null, costsPending: null });
  return out;
}
