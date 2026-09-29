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
// was off can never be trusted after it is switched on again (the config then
// treats every cost as unknown until the next pass writes it: the stricter
// percent ceiling, never a stale cost).
// Every Shopify call goes through Transport (API-3: THROTTLED / 429 / 5xx
// retried with exponential backoff; metafieldsSet/Delete are idempotent).
// `isCancelled` is checked before every Shopify call: a newer job of the shop
// supersedes this one (cost-lane.server.ts).

import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../../generated/prisma/client";
import { VARIANT_COST_KEY, WON_NAMESPACE } from "./graphql";
import { errorText, setMetafields, userErrorText, type Transport, type UserErrorLike } from "./transport";
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
}

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
  errors: string[];
}

const rowData = (s: VariantSnapshot, metafieldValue: string | null) => ({
  productId: s.productId,
  inventoryItemId: s.inventoryItemId,
  title: s.title,
  variantTitle: s.variantTitle,
  price: s.price,
  cost: s.unitCost?.amount ?? null,
  currency: s.unitCost?.currencyCode ?? null,
  metafieldValue,
});

/**
 * Record the snapshots and bring each variant's metafield to its desired value
 * (only where it differs). The row is written first with the value the
 * variant MAY carry once the call went out (write-ahead: a clear never misses
 * a metafield the sync wrote), then settled by the answer.
 */
export async function applySnapshots(ctx: CostCtx, snapshots: readonly VariantSnapshot[], opts: { scanId?: string } = {}): Promise<ApplyResult> {
  const { db, shop } = ctx;
  const sets: { s: VariantSnapshot; value: string }[] = [];
  const deletes: VariantSnapshot[] = [];
  const settled: { s: VariantSnapshot; value: string | null }[] = [];
  for (const s of snapshots) {
    const desired = desiredCostValue(s.unitCost);
    if (desired !== null && !sameJson(s.current, desired)) sets.push({ s, value: desired });
    else if (desired === null && s.current !== null) deletes.push(s);
    else settled.push({ s, value: desired === null ? null : s.current });
  }
  const upsert = (s: VariantSnapshot, metafieldValue: string | null) =>
    db.variantCost.upsert({
      where: { shop_variantId: { shop, variantId: s.variantId } },
      create: { shop, variantId: s.variantId, ...rowData(s, metafieldValue), scanId: opts.scanId ?? null },
      update: { ...rowData(s, metafieldValue), ...(opts.scanId ? { scanId: opts.scanId } : {}) },
    });
  const setValue = (variantIds: string[], metafieldValue: string | null) =>
    db.variantCost.updateMany({ where: { shop, variantId: { in: variantIds } }, data: { metafieldValue } });

  await db.$transaction([
    ...settled.map(({ s, value }) => upsert(s, value)),
    ...sets.map(({ s, value }) => upsert(s, s.current ?? value)),
    ...deletes.map((s) => upsert(s, s.current)),
  ]);

  const out: ApplyResult = { written: 0, cleared: 0, errors: [] };
  for (const batch of chunks(sets, METAFIELDS_SET_BATCH)) {
    checkCancelled(ctx);
    const error = await setMetafields(
      ctx.transport,
      batch.map(({ s, value }) => ({ ownerId: s.variantId, namespace: WON_NAMESPACE, key: VARIANT_COST_KEY, type: "json", value })),
    );
    if (error) {
      out.errors.push(`costs.set: ${error}`);
      continue;
    }
    await db.$transaction(batch.map(({ s, value }) => setValue([s.variantId], value)));
    out.written += batch.length;
  }
  for (const batch of chunks(deletes, METAFIELDS_DELETE_BATCH)) {
    checkCancelled(ctx);
    const error = await deleteVariantMetafields(ctx, batch.map((s) => s.variantId));
    if (error) {
      out.errors.push(`costs.delete: ${error}`);
      continue;
    }
    await setValue(batch.map((s) => s.variantId), null);
    out.cleared += batch.length;
  }
  return out;
}

async function deleteVariantMetafields(ctx: CostCtx, variantIds: string[]): Promise<string | null> {
  try {
    const data: { metafieldsDelete: { userErrors: UserErrorLike[] } } = await ctx.transport.call("metafieldsDelete", {
      metafields: variantIds.map((ownerId) => ({ ownerId, namespace: WON_NAMESPACE, key: VARIANT_COST_KEY })),
    });
    return userErrorText(data.metafieldsDelete.userErrors);
  } catch (error) {
    if (error instanceof Response || error instanceof CostJobCancelled) throw error;
    return errorText(error);
  }
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
    if (found.length) {
      const applied = await applySnapshots(ctx, found, { scanId: token });
      out.written += applied.written;
      out.cleared += applied.cleared;
      out.errors.push(...applied.errors);
    }
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
  const state = await loadCostState(db, shop);
  const previous = state.pending;
  const resumable =
    !opts.restart &&
    state.cursor !== null &&
    previous !== null &&
    previous.failedAt === undefined &&
    now.getTime() - Date.parse(previous.since) < COST_RESUME_MAX_AGE_MS;
  const out: CostPassResult = { outcome: "done", read: 0, written: 0, cleared: 0, removed: 0, errors: [], resumed: resumable };
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
      const applied = await applySnapshots(opts, snapshots, { scanId: pending.token });
      out.written += applied.written;
      out.cleared += applied.cleared;
      out.errors.push(...applied.errors);
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
  const out: MirrorResult = { written: 0, cleared: 0, removed: 0, errors: [] };
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
    if (snapshots.length) {
      const applied = await applySnapshots(ctx, snapshots);
      out.written += applied.written;
      out.cleared += applied.cleared;
      out.errors.push(...applied.errors);
    }
  }
  return out;
}

/**
 * products/create|update: every variant of each product; rows of variants the
 * product no longer has (and of a deleted product) are dropped.
 */
export async function mirrorProducts(ctx: CostCtx, productIds: readonly string[]): Promise<MirrorResult> {
  const out: MirrorResult = { written: 0, cleared: 0, removed: 0, errors: [] };
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
    const applied = await applySnapshots(ctx, snapshots);
    out.written += applied.written;
    out.cleared += applied.cleared;
    out.errors.push(...applied.errors);
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
 * Delete every variant metafield the sync wrote (≤ 250 per call), then the
 * shop's rows and its pass bookkeeping. Rows whose delete failed stay (with
 * their value) for the next clear.
 */
export async function clearCostMirror(ctx: CostCtx): Promise<ClearResult> {
  const { db, shop } = ctx;
  const out: ClearResult = { outcome: "done", cleared: 0, errors: [] };
  const carrying = await db.variantCost.findMany({ where: { shop, metafieldValue: { not: null } }, select: { variantId: true } });
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
