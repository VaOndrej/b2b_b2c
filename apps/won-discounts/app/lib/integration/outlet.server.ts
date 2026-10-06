// Výprodej (MVP 5, Pro) — the server side of a sale (plan docs/plans/2026-10-02-won-discounts-mvp5.md, O1–O9).
//
//   startOutletRun(deps, form)    O4: Pro + validation (core validateOutletDraft) → row `starting` → read the
//                                 variant and the picked price lists' fixed prices → BACKUP in the row (write-ahead)
//                                 → `outlet` flag (O6) → variant price → fixed prices → `active`. A failure undoes
//                                 what was written (prices first, then the flag) and leaves the row `ended` with
//                                 the error; nothing stays on sale without its flag.
//   endOutletRun(deps, id, why)   O5: `ending` → each price field still holding the sale's value goes back to the
//                                 backup (one changed elsewhere is kept, `price_kept`) → `endedAt` (prices back)
//                                 → the flag goes → `ended`. A failed step leaves `ending` + error + next attempt
//                                 (the scheduler retries, O8): the flag stays until the prices are back.
//   reopenOutletRun(deps, id)     O7: a return after the end (Pro): the same row runs again from a NEW backup.
//   recordOutletWebhook(...)      O7: orders/create, orders/cancelled, refunds/create → ledger steps, idempotent
//                                 per order line (OutletEvent.key, WBH-2); returns the runs to end / reopen.
//   writeOutletFlag / writeOutletStorefront   the variant metafield `outlet` = true (the function's `wonOutlet`,
//                                 O6) and the product metafield `outlet` (storefront block, O9).
// Every Shopify call goes through the sync Transport (retry/backoff, API-3). Prices are minor units inside, decimal
// strings at Shopify. The session shop only (SEC-2).

import { randomUUID } from "node:crypto";

import { fromMinorUnits, toMinorUnits } from "@won/core/discounts/money";
import {
  outletAfterReturn,
  outletExhausted,
  outletLeft,
  outletOversold,
  outletPricesFor,
  outletReturnQty,
  outletStorefrontValue,
  restoreDecision,
  validateOutletDraft,
  type OutletDraftError,
  type OutletEndReason,
  type OutletPriceSnapshot,
} from "@won/core/discounts/outlet";
import type { ShopPlan } from "@won/core/discounts/plan-gate";

import type { PrismaClient } from "../../generated/prisma/client";
import type { AdminClient } from "../admin-client.server";
import { loadConfig } from "../config.server";
import { OUTLET_STOREFRONT_KEY, OUTLET_VARIANT_KEY, WON_NAMESPACE } from "../sync/graphql";
import { errorText, Transport, userErrorText, type UserErrorLike } from "../sync/transport";
import type { RetryOptions, SyncLogger } from "../sync/types";

export interface OutletDeps {
  shop: string;
  db: PrismaClient;
  client: AdminClient;
  /** The shop's plan (BILL-1; default planOf). */
  plan?: (shop: string) => Promise<ShopPlan>;
  now?: () => Date;
  logger?: SyncLogger;
  retry?: Partial<RetryOptions>;
  sleep?: (ms: number) => Promise<void>;
}

export type OutletResult =
  | { ok: true; runId: string; skippedLists: string[]; pending?: "flags" | "storefront" }
  | { ok: false; reason: "invalid"; errors: OutletDraftError[] }
  | { ok: false; reason: "failed"; message: string; runId?: string };

/** Minor units of one currency. */
interface PriceRecord {
  currency: string;
  variant: OutletPriceSnapshot;
  lists: { id: string; currency: string; price: number; compareAt: number | null }[];
}

/** Retry back-off of a failed start / end (O5): 1, 5, 15, then every 60 minutes. */
export const OUTLET_RETRY_MINUTES = [1, 5, 15, 60] as const;
export const OUTLET_NOT_ENDED = ["starting", "active", "ending"] as const;
/** How long an end in progress holds its run against another process's scheduler (audit A5). */
export const OUTLET_END_LEASE_MS = 2 * 60_000;

const quiet: SyncLogger = { info() {}, warn() {}, error() {} };
const nowOf = (deps: Pick<OutletDeps, "now">) => (deps.now ? deps.now() : new Date());
const transportOf = (deps: OutletDeps) => new Transport(deps.client, deps.retry, deps.sleep, deps.logger ?? quiet);
const numericId = (gid: string) => gid.split("/").pop() ?? "";

async function planFor(deps: OutletDeps): Promise<ShopPlan> {
  if (deps.plan) return deps.plan(deps.shop);
  const { planOf } = await import("../plan.server");
  return planOf(deps.shop);
}

/** The module's settings (display on the web, return after the end) from the stored config. */
async function outletSettings(deps: OutletDeps) {
  const loaded = await loadConfig(deps.db, deps.shop);
  return loaded.config.modules.outlet;
}

async function event(
  deps: OutletDeps,
  runId: string,
  kind: string,
  extra: { qty?: number; orderId?: string; lineId?: string; key?: string; detail?: unknown } = {},
): Promise<boolean> {
  try {
    await deps.db.outletEvent.create({
      data: {
        shop: deps.shop,
        runId,
        kind,
        qty: extra.qty ?? 0,
        orderId: extra.orderId ?? null,
        lineId: extra.lineId ?? null,
        key: extra.key ?? `${kind}:${runId}:${randomUUID()}`,
        detail: extra.detail === undefined ? null : JSON.stringify(extra.detail),
        at: nowOf(deps),
      },
    });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

const money = (amount: unknown, currency: string): number | null => (amount === null || amount === undefined ? null : toMinorUnits(String(amount), currency));

interface VariantRead {
  productId: string;
  currency: string;
  price: number;
  compareAt: number | null;
}

async function readVariant(transport: Transport, variantId: string): Promise<VariantRead | null> {
  type Data = { shop?: { currencyCode?: string }; productVariant?: { price?: string; compareAtPrice?: string | null; product?: { id?: string } } | null };
  const data: Data = await transport.call("outletVariant", { id: variantId });
  const currency = data.shop?.currencyCode ?? "";
  const v = data.productVariant;
  if (!v?.product?.id || !currency) return null;
  const price = money(v.price, currency);
  if (price === null) return null;
  return { productId: v.product.id, currency, price, compareAt: money(v.compareAtPrice, currency) };
}

/** The variant's fixed price on one list, or null (no fixed price for it there). */
async function readFixedPrice(transport: Transport, listId: string, productId: string, variantId: string) {
  type Node = { variant?: { id?: string }; price?: { amount?: string; currencyCode?: string }; compareAtPrice?: { amount?: string } | null };
  type Data = { priceList?: { id: string; currency: string; prices?: { nodes?: Node[] } } | null };
  const data: Data = await transport.call("outletPriceListPrices", { id: listId, query: `product_id:${numericId(productId)}` });
  const list = data.priceList;
  if (!list) return null;
  const node = list.prices?.nodes?.find((n) => n.variant?.id === variantId);
  const price = node ? money(node.price?.amount, list.currency) : null;
  if (!node || price === null) return null;
  return { id: list.id, currency: list.currency, price, compareAt: money(node.compareAtPrice?.amount, list.currency) };
}

async function writeVariant(transport: Transport, productId: string, variantId: string, currency: string, fields: { price?: number; compareAt?: number | null }): Promise<string | null> {
  const input: Record<string, unknown> = { id: variantId };
  if (fields.price !== undefined) input.price = fromMinorUnits(fields.price, currency);
  if (fields.compareAt !== undefined) input.compareAtPrice = fields.compareAt === null ? null : fromMinorUnits(fields.compareAt, currency);
  if (Object.keys(input).length === 1) return null;
  try {
    const data: { productVariantsBulkUpdate: { userErrors: UserErrorLike[] } } = await transport.call("outletVariantUpdate", { productId, variants: [input] });
    return userErrorText(data.productVariantsBulkUpdate.userErrors);
  } catch (error) {
    return errorText(error);
  }
}

async function writeFixedPrice(transport: Transport, listId: string, variantId: string, currency: string, price: number, compareAt: number | null): Promise<string | null> {
  const amount = (n: number) => ({ amount: fromMinorUnits(n, currency), currencyCode: currency });
  try {
    const data: { priceListFixedPricesUpdate: { userErrors: UserErrorLike[] } } = await transport.call("outletFixedPrices", {
      priceListId: listId,
      pricesToAdd: [{ variantId, price: amount(price), compareAtPrice: compareAt === null ? null : amount(compareAt) }],
      variantIdsToDelete: [],
    });
    return userErrorText(data.priceListFixedPricesUpdate.userErrors);
  } catch (error) {
    return errorText(error);
  }
}

const parseRecord = (text: string | null): PriceRecord | null => {
  if (!text) return null;
  try {
    return JSON.parse(text) as PriceRecord;
  } catch {
    return null;
  }
};

/**
 * Steps of ONE sale run one after the other in this process (audit A1): the admin's "Ukončit", a webhook's used-up
 * quota and the scheduler may end the same sale at the same moment; the second then finds it ended. Single
 * instance, like the sync (one Fly machine).
 */
const runQueues = new Map<string, Promise<unknown>>();
function serial<T>(runId: string, work: () => Promise<T>): Promise<T> {
  const previous = runQueues.get(runId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  runQueues.set(runId, next);
  void next.finally(() => {
    if (runQueues.get(runId) === next) runQueues.delete(runId);
  }).catch(() => undefined);
  return next;
}

/** Variants with a sale not ended (validation: one per variant, OUTLET_LIMITS.running per shop). */
async function runningOf(deps: OutletDeps) {
  const rows = await deps.db.outletRun.findMany({ where: { shop: deps.shop, status: { in: [...OUTLET_NOT_ENDED] } }, select: { variantId: true } });
  return { runningVariantIds: new Set(rows.map((r) => r.variantId)) };
}

/** O4: a new sale from the admin (or a script). */
export async function startOutletRun(deps: OutletDeps, raw: unknown): Promise<OutletResult> {
  const plan = await planFor(deps);
  const checked = validateOutletDraft(raw, { plan, now: nowOf(deps), ...(await runningOf(deps)) });
  if (!checked.ok) return { ok: false, reason: "invalid", errors: checked.errors };
  const draft = checked.draft;
  const shop = deps.shop;
  // One run not ended per variant: checked again inside the transaction (two clicks, two tabs).
  const row = await deps.db.$transaction(async (tx) => {
    const busy = await tx.outletRun.findFirst({ where: { shop, variantId: draft.variantId, status: { in: [...OUTLET_NOT_ENDED] } } });
    if (busy) return null;
    return tx.outletRun.create({
      data: {
        shop,
        productId: draft.productId,
        variantId: draft.variantId,
        quota: draft.quota,
        percent: draft.percent,
        endsAt: draft.endsAt,
        priceListIds: JSON.stringify(draft.priceListIds),
        showBadge: draft.showBadge,
        status: "starting",
      },
    });
  });
  if (!row) return { ok: false, reason: "invalid", errors: [{ field: "variantId", key: "outlet.error.running" }] };
  return serial(row.id, () => applySale(deps, row.id));
}

/** O7: run an ended sale again (Pro; the merchant's "Znovu otevřít" or reopenOnReturnAfterEnd = auto). */
export async function reopenOutletRun(deps: OutletDeps, runId: string): Promise<OutletResult> {
  if ((await planFor(deps)) !== "pro") return { ok: false, reason: "invalid", errors: [{ field: "plan", key: "outlet.error.pro" }] };
  return serial(runId, () => reopenNow(deps, runId));
}

async function reopenNow(deps: OutletDeps, runId: string): Promise<OutletResult> {
  const run = await deps.db.outletRun.findFirst({ where: { id: runId, shop: deps.shop } });
  if (!run || run.status !== "ended") return { ok: false, reason: "failed", message: "not an ended sale", runId };
  if (outletLeft(run) === 0) return { ok: false, reason: "invalid", errors: [{ field: "variantId", key: "outlet.error.nothingLeft" }] };
  const busy = await deps.db.outletRun.findFirst({ where: { shop: deps.shop, variantId: run.variantId, status: { in: [...OUTLET_NOT_ENDED] } } });
  if (busy) return { ok: false, reason: "invalid", errors: [{ field: "variantId", key: "outlet.error.running" }] };
  await deps.db.outletRun.update({
    where: { id: run.id },
    data: { status: "starting", endReason: null, endedAt: null, startedAt: null, error: null, attempts: 0, nextAttemptAt: null, returnPending: 0, backup: null, sale: null },
  });
  await event(deps, run.id, "reopened", { qty: run.returnPending });
  return applySale(deps, run.id);
}

/** The merchant keeps an ended sale ended after a return (reopenOnReturnAfterEnd = ask). */
export async function keepOutletEnded(deps: OutletDeps, runId: string): Promise<boolean> {
  const { count } = await deps.db.outletRun.updateMany({ where: { id: runId, shop: deps.shop, status: "ended" }, data: { returnPending: 0 } });
  if (count > 0) await event(deps, runId, "return_kept");
  return count > 0;
}

/** Read → backup → flag → prices → active (the start and the reopen). */
async function applySale(deps: OutletDeps, runId: string): Promise<OutletResult> {
  const transport = transportOf(deps);
  const run = (await deps.db.outletRun.findUnique({ where: { id: runId } }))!;
  const fail = async (message: string, written: boolean): Promise<OutletResult> => {
    if (written) {
      const undone = await restorePrices(deps, transport, runId);
      if (!undone.ok) {
        // Prices may still be on sale: keep the flag, leave it to the scheduler as an end.
        await deps.db.outletRun.update({ where: { id: runId }, data: { status: "ending", endReason: "manual", error: `start: ${message}; undo: ${undone.message}`, ...retryAt(deps, 0) } });
        await event(deps, runId, "start_failed", { detail: { message, undo: undone.message } });
        return { ok: false, reason: "failed", message, runId };
      }
    }
    await deps.db.outletRun.update({ where: { id: runId }, data: { status: "ending", endedAt: nowOf(deps), error: `start: ${message}` } });
    const flags = await writeOutletFlag(deps, run.variantId);
    await deps.db.outletRun.update({ where: { id: runId }, data: flags ? { error: `start: ${message}; flags: ${flags}`, ...retryAt(deps, 0) } : { status: "ended" } });
    await event(deps, runId, "start_failed", { detail: { message } });
    return { ok: false, reason: "failed", message, runId };
  };
  let variant: VariantRead | null;
  try {
    variant = await readVariant(transport, run.variantId);
  } catch (error) {
    return fail(errorText(error), false);
  }
  if (!variant || variant.productId !== run.productId) return fail("the variant does not exist in Shopify (or belongs to another product)", false);
  const settings = await outletSettings(deps);
  const listIds = JSON.parse(run.priceListIds) as string[];
  const lists: PriceRecord["lists"] = [];
  const skippedLists: string[] = [];
  for (const id of listIds) {
    let fixed;
    try {
      fixed = await readFixedPrice(transport, id, run.productId, run.variantId);
    } catch (error) {
      return fail(errorText(error), false);
    }
    if (fixed && outletPricesFor({ price: fixed.price, compareAt: fixed.compareAt }, run.percent, settings.display)) lists.push(fixed);
    else skippedLists.push(id);
  }
  const salePrices = outletPricesFor({ price: variant.price, compareAt: variant.compareAt }, run.percent, settings.display);
  if (!salePrices) return fail("the sale would not lower the price", false);
  const backup: PriceRecord = { currency: variant.currency, variant: { price: variant.price, compareAt: variant.compareAt }, lists };
  const sale: PriceRecord = {
    currency: variant.currency,
    variant: salePrices,
    lists: lists.map((l) => ({ ...l, ...outletPricesFor({ price: l.price, compareAt: l.compareAt }, run.percent, settings.display)! })),
  };
  // Write-ahead (§14c): the backup is stored before the first write.
  // `startedAt` too: an order placed from the first lowered price on counts (audit: the `starting` window).
  await deps.db.outletRun.update({ where: { id: runId }, data: { backup: JSON.stringify(backup), sale: JSON.stringify(sale), startedAt: nowOf(deps) } });
  const flagged = await writeOutletFlag(deps, run.variantId);
  if (flagged) return fail(`flag: ${flagged}`, false);
  const variantError = await writeVariant(transport, run.productId, run.variantId, variant.currency, {
    price: sale.variant.price,
    ...(sale.variant.compareAt !== backup.variant.compareAt ? { compareAt: sale.variant.compareAt } : {}),
  });
  if (variantError) return fail(`variant: ${variantError}`, true);
  for (const l of sale.lists) {
    const listError = await writeFixedPrice(transport, l.id, run.variantId, l.currency, l.price, l.compareAt);
    if (listError) return fail(`price list ${l.id}: ${listError}`, true);
  }
  await deps.db.outletRun.update({ where: { id: runId }, data: { status: "active", error: null } });
  await event(deps, runId, "started", { detail: { percent: run.percent, quota: run.quota, before: backup.variant.price, after: sale.variant.price, currency: variant.currency, lists: sale.lists.map((l) => l.id) } });
  for (const id of skippedLists) await event(deps, runId, "price_list_skipped", { detail: { priceListId: id } });
  const storefront = await writeOutletStorefront(deps, [run.productId]);
  if (storefront) {
    await deps.db.outletRun.update({ where: { id: runId }, data: { error: `storefront: ${storefront}`, ...retryAt(deps, 0) } });
    return { ok: true, runId, skippedLists, pending: "storefront" };
  }
  return { ok: true, runId, skippedLists };
}

function retryAt(deps: OutletDeps, attempts: number) {
  const minutes = OUTLET_RETRY_MINUTES[Math.min(attempts, OUTLET_RETRY_MINUTES.length - 1)]!;
  return { attempts: attempts + 1, nextAttemptAt: new Date(nowOf(deps).getTime() + minutes * 60_000) };
}

/** O5: every price field still holding the sale's value back to the backup; the rest is recorded as kept. */
async function restorePrices(deps: OutletDeps, transport: Transport, runId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const run = (await deps.db.outletRun.findUnique({ where: { id: runId } }))!;
  const backup = parseRecord(run.backup);
  const sale = parseRecord(run.sale);
  if (!backup || !sale) return { ok: true }; // nothing was written (no backup = no write, write-ahead)
  let current: VariantRead | null;
  try {
    current = await readVariant(transport, run.variantId);
  } catch (error) {
    return { ok: false, message: errorText(error) };
  }
  if (!current) {
    await event(deps, runId, "price_kept", { detail: { field: "variant", why: "variant deleted" } });
  } else {
    const price = restoreDecision({ current: current.price, sale: sale.variant.price, backup: backup.variant.price });
    const compareAt = restoreDecision({ current: current.compareAt, sale: sale.variant.compareAt, backup: backup.variant.compareAt });
    const error = await writeVariant(transport, run.productId, run.variantId, backup.currency, {
      ...(price.action === "restore" ? { price: price.value! } : {}),
      ...(compareAt.action === "restore" ? { compareAt: compareAt.value } : {}),
    });
    if (error) return { ok: false, message: `variant: ${error}` };
    for (const [field, d, now] of [["price", price, current.price], ["compareAt", compareAt, current.compareAt]] as const) {
      if (d.action === "restore") await event(deps, runId, "price_restored", { detail: { field, value: d.value, currency: backup.currency } });
      if (d.action === "kept") await event(deps, runId, "price_kept", { detail: { field, value: now, currency: backup.currency } });
    }
  }
  for (const list of backup.lists) {
    const onSale = sale.lists.find((l) => l.id === list.id);
    if (!onSale) continue;
    let now;
    try {
      now = await readFixedPrice(transport, list.id, run.productId, run.variantId);
    } catch (error) {
      return { ok: false, message: `price list ${list.id}: ${errorText(error)}` };
    }
    if (!now) {
      await event(deps, runId, "price_kept", { detail: { field: "fixed", priceListId: list.id, why: "fixed price removed" } });
      continue;
    }
    const price = restoreDecision({ current: now.price, sale: onSale.price, backup: list.price });
    const compareAt = restoreDecision({ current: now.compareAt, sale: onSale.compareAt, backup: list.compareAt });
    if (price.action !== "restore" && compareAt.action !== "restore") {
      if (price.action === "kept" || compareAt.action === "kept") await event(deps, runId, "price_kept", { detail: { field: "fixed", priceListId: list.id, value: now.price, currency: list.currency } });
      continue;
    }
    const error = await writeFixedPrice(
      transport,
      list.id,
      run.variantId,
      list.currency,
      price.action === "restore" ? price.value! : now.price,
      compareAt.action === "restore" ? compareAt.value : now.compareAt,
    );
    if (error) return { ok: false, message: `price list ${list.id}: ${error}` };
    await event(deps, runId, "price_restored", { detail: { field: "fixed", priceListId: list.id, value: price.action === "restore" ? price.value : now.price, currency: list.currency } });
  }
  return { ok: true };
}

/** O5: end a running sale (quota, date, manual) — or finish an end that failed before. Never throws for Shopify. */
export async function endOutletRun(deps: OutletDeps, runId: string, reason: OutletEndReason): Promise<OutletResult> {
  return serial(runId, () => endNow(deps, runId, reason));
}

async function endNow(deps: OutletDeps, runId: string, reason: OutletEndReason): Promise<OutletResult> {
  const run = await deps.db.outletRun.findFirst({ where: { id: runId, shop: deps.shop } });
  if (!run) return { ok: false, reason: "failed", message: "no such sale" };
  if (run.status === "ended") return { ok: true, runId, skippedLists: [] };
  if (run.status === "starting") return { ok: false, reason: "failed", message: "the sale is still starting", runId };
  // A lease (audit A5, live E2E): the scheduler of another process (a script next to the app, a second instance)
  // takes over an `ending` run only after its next attempt time, never while this end is under way.
  await deps.db.outletRun.update({ where: { id: runId }, data: { status: "ending", endReason: run.endReason ?? reason, nextAttemptAt: new Date(nowOf(deps).getTime() + OUTLET_END_LEASE_MS) } });
  const transport = transportOf(deps);
  if (run.endedAt === null) {
    const restored = await restorePrices(deps, transport, runId);
    if (!restored.ok) {
      await deps.db.outletRun.update({ where: { id: runId }, data: { error: `end: ${restored.message}`, ...retryAt(deps, run.attempts) } });
      await event(deps, runId, "end_failed", { detail: { message: restored.message } });
      return { ok: false, reason: "failed", message: restored.message, runId };
    }
    await deps.db.outletRun.update({ where: { id: runId }, data: { endedAt: nowOf(deps) } });
  }
  const flags = await writeOutletFlag(deps, run.variantId);
  if (flags) {
    await deps.db.outletRun.update({ where: { id: runId }, data: { error: `flags: ${flags}`, ...retryAt(deps, run.attempts) } });
    return { ok: true, runId, skippedLists: [], pending: "flags" };
  }
  await deps.db.outletRun.update({ where: { id: runId }, data: { status: "ended", error: null, attempts: 0, nextAttemptAt: null } });
  await event(deps, runId, "ended", { detail: { reason: run.endReason ?? reason, sold: run.sold, returned: run.returned, oversold: outletOversold(run) } });
  const storefront = await writeOutletStorefront(deps, [run.productId]);
  if (storefront) (deps.logger ?? quiet).warn(`outlet ${deps.shop}: storefront value of ${run.productId}: ${storefront}`);
  return { ok: true, runId, skippedLists: [] };
}

/**
 * O6: the variant's sale flag — the variant metafield `outlet` = true while a run of it is not ended and its
 * prices are not back (`endedAt` null); deleted otherwise. Only this module writes the key (the sync and the
 * cost mirror never touch it). Null = done, else the error.
 */
export async function writeOutletFlag(deps: OutletDeps, variantId: string): Promise<string | null> {
  const transport = transportOf(deps);
  const flagged = await deps.db.outletRun.count({ where: { shop: deps.shop, variantId, status: { in: [...OUTLET_NOT_ENDED] }, endedAt: null } });
  try {
    if (flagged > 0) {
      const data: { metafieldsSet: { userErrors: UserErrorLike[] } } = await transport.call("metafieldsSet", {
        metafields: [{ ownerId: variantId, namespace: WON_NAMESPACE, key: OUTLET_VARIANT_KEY, type: "json", value: "true" }],
      });
      return userErrorText(data.metafieldsSet.userErrors);
    }
    const data: { metafieldsDelete: { userErrors: UserErrorLike[] } } = await transport.call("metafieldsDelete", {
      metafields: [{ ownerId: variantId, namespace: WON_NAMESPACE, key: OUTLET_VARIANT_KEY }],
    });
    return userErrorText(data.metafieldsDelete.userErrors);
  } catch (error) {
    return errorText(error);
  }
}

/**
 * Show or hide the storefront badge of ONE running sale (its variant). Only the value the badge block reads is
 * written again; the price, the quota and the sale's flag stay as they are. false = not this shop's running sale.
 */
export async function setOutletBadge(deps: OutletDeps, runId: string, show: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  const run = await deps.db.outletRun.findFirst({ where: { id: runId, shop: deps.shop, status: { in: [...OUTLET_NOT_ENDED] } } });
  if (!run) return { ok: false, message: "not a running sale" };
  await deps.db.outletRun.update({ where: { id: run.id }, data: { showBadge: show } });
  const error = await writeOutletStorefront(deps, [run.productId]);
  return error ? { ok: false, message: error } : { ok: true };
}

/** O9: the storefront block's product metafield `outlet` — the active sales and what they have left; deleted when none. */
export async function writeOutletStorefront(deps: OutletDeps, productIds: readonly string[]): Promise<string | null> {
  const transport = transportOf(deps);
  const settings = await outletSettings(deps);
  for (const productId of new Set(productIds)) {
    const runs = await deps.db.outletRun.findMany({ where: { shop: deps.shop, productId, status: "active" } });
    const value = outletStorefrontValue(settings.display, runs.map((r) => ({ variantId: r.variantId, left: outletLeft(r), showBadge: r.showBadge })));
    try {
      if (value) {
        const data: { metafieldsSet: { userErrors: UserErrorLike[] } } = await transport.call("metafieldsSet", {
          metafields: [{ ownerId: productId, namespace: WON_NAMESPACE, key: OUTLET_STOREFRONT_KEY, type: "json", value: JSON.stringify(value) }],
        });
        const error = userErrorText(data.metafieldsSet.userErrors);
        if (error) return error;
      } else {
        const data: { metafieldsDelete: { userErrors: UserErrorLike[] } } = await transport.call("metafieldsDelete", {
          metafields: [{ ownerId: productId, namespace: WON_NAMESPACE, key: OUTLET_STOREFRONT_KEY }],
        });
        const error = userErrorText(data.metafieldsDelete.userErrors);
        if (error) return error;
      }
    } catch (error) {
      return errorText(error);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Orders (O7). Payloads are the REST webhook bodies (orders/create, orders/cancelled, refunds/create); only ids,
// quantities and restock types are read — no customer data is stored (PRIV-1).

export interface OutletWebhookOutcome {
  /** Sales whose quota the order used up: end them (Admin API, in the background). */
  end: string[];
  /** Ended sales a return reopens (reopenOnReturnAfterEnd = auto, Pro). */
  reopen: string[];
  /** Products whose storefront value ("zbývá X ks") changed. */
  storefront: string[];
  /** Steps recorded (0 = a repeated delivery or nothing of ours). */
  recorded: number;
}

type OrderLine = { id?: unknown; variant_id?: unknown; quantity?: unknown };

const lineIdOf = (value: unknown) => (value === null || value === undefined ? "" : String(value));

/** O7: one webhook. `deps.client` is not used (pure DB); the caller ends / reopens with an Admin client. */
export async function recordOutletWebhook(deps: Omit<OutletDeps, "client">, topic: string, payload: unknown): Promise<OutletWebhookOutcome> {
  const out: OutletWebhookOutcome = { end: [], reopen: [], storefront: [], recorded: 0 };
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const d = deps as OutletDeps;
  const t = topic.toLowerCase().replace("_", "/");
  if (t === "orders/create") {
    const orderId = lineIdOf(body.id);
    const createdAt = new Date(String(body.created_at ?? ""));
    for (const line of (Array.isArray(body.line_items) ? body.line_items : []) as OrderLine[]) {
      const variantId = `gid://shopify/ProductVariant/${lineIdOf(line.variant_id)}`;
      const qty = Math.max(0, Math.floor(Number(line.quantity)) || 0);
      if (!line.variant_id || qty === 0) continue;
      // The sale the order was placed in: running, or ended after the order was placed (a late webhook: oversold).
      const placed = Number.isNaN(createdAt.getTime()) ? nowOf(d) : createdAt;
      const candidates = await deps.db.outletRun.findMany({ where: { shop: deps.shop, variantId, startedAt: { not: null, lte: placed } }, orderBy: { startedAt: "desc" }, take: 5 });
      const run = candidates.find((c) => c.status === "starting" || c.status === "active" || c.status === "ending" || (c.status === "ended" && c.endedAt !== null && c.endedAt > placed));
      if (!run) continue;
      const lineId = lineIdOf(line.id);
      if (!(await event(d, run.id, "sale", { qty, orderId, lineId, key: `sale:${orderId}:${lineId}` }))) continue;
      out.recorded += 1;
      const updated = await deps.db.outletRun.update({ where: { id: run.id }, data: { sold: { increment: qty } } });
      out.storefront.push(run.productId);
      if (outletOversold(updated) > 0) await event(d, run.id, "oversold", { qty: outletOversold(updated), orderId, lineId, key: `oversold:${orderId}:${lineId}` });
      if (updated.status === "active" && outletExhausted(updated)) {
        await event(d, run.id, "quota_reached", { orderId, key: `quota_reached:${run.id}:${orderId}:${lineId}` });
        out.end.push(run.id);
      }
    }
    return out;
  }
  const returns: { orderId: string; lineId: string; qty: number; kind: "cancel" | "refund"; key: string }[] = [];
  if (t === "orders/cancelled") {
    const orderId = lineIdOf(body.id);
    for (const line of (Array.isArray(body.line_items) ? body.line_items : []) as OrderLine[]) {
      const lineId = lineIdOf(line.id);
      returns.push({ orderId, lineId, qty: Number(line.quantity) || 0, kind: "cancel", key: `cancel:${orderId}:${lineId}` });
    }
  } else if (t === "refunds/create") {
    const orderId = lineIdOf(body.order_id);
    const refundId = lineIdOf(body.id);
    type RefundLine = { id?: unknown; line_item_id?: unknown; quantity?: unknown; restock_type?: unknown };
    for (const line of (Array.isArray(body.refund_line_items) ? body.refund_line_items : []) as RefundLine[]) {
      if (String(line.restock_type ?? "no_restock") === "no_restock") continue;
      returns.push({ orderId, lineId: lineIdOf(line.line_item_id), qty: Number(line.quantity) || 0, kind: "refund", key: `refund:${refundId}:${lineIdOf(line.id)}` });
    }
  } else {
    return out;
  }
  const settings = await outletSettings(d);
  const plan = await planFor(d);
  for (const r of returns) {
    const sale = await deps.db.outletEvent.findFirst({ where: { shop: deps.shop, key: `sale:${r.orderId}:${r.lineId}` } });
    if (!sale) continue;
    const back = await deps.db.outletEvent.aggregate({ where: { shop: deps.shop, runId: sale.runId, orderId: r.orderId, lineId: r.lineId, kind: { in: ["cancel", "refund"] } }, _sum: { qty: true } });
    const qty = outletReturnQty(r.kind, { sold: sale.qty, returned: back._sum.qty ?? 0 }, r.qty);
    if (qty === 0) continue;
    if (!(await event(d, sale.runId, r.kind, { qty, orderId: r.orderId, lineId: r.lineId, key: r.key }))) continue;
    out.recorded += 1;
    const run = await deps.db.outletRun.update({ where: { id: sale.runId }, data: { returned: { increment: qty } } });
    out.storefront.push(run.productId);
    if (run.status !== "ended") continue;
    await event(d, run.id, "return_after_end", { qty, orderId: r.orderId, lineId: r.lineId, key: `return_after_end:${r.key}` });
    const decision = outletAfterReturn(settings.reopenOnReturnAfterEnd, plan);
    if (decision === "ask") await deps.db.outletRun.update({ where: { id: run.id }, data: { returnPending: { increment: qty } } });
    if (decision === "reopen" && !out.reopen.includes(run.id)) out.reopen.push(run.id);
  }
  out.storefront = [...new Set(out.storefront)];
  return out;
}

/** O7 + O5: what a webhook asks for afterwards, with an Admin client (ends, reopens, storefront values). */
export async function settleOutletWebhook(deps: OutletDeps, outcome: OutletWebhookOutcome): Promise<void> {
  const logger = deps.logger ?? quiet;
  for (const id of outcome.end) {
    const r = await endOutletRun(deps, id, "quota");
    if (!r.ok) logger.warn(`outlet ${deps.shop}: end of ${id} failed (the scheduler retries): ${r.reason === "failed" ? r.message : "invalid"}`);
  }
  for (const id of outcome.reopen) {
    const r = await reopenOutletRun(deps, id);
    if (!r.ok) logger.warn(`outlet ${deps.shop}: reopen of ${id} failed: ${r.reason === "failed" ? r.message : r.errors.map((e) => e.key).join(", ")}`);
  }
  const error = await writeOutletStorefront(deps, outcome.storefront);
  if (error) logger.warn(`outlet ${deps.shop}: storefront values: ${error}`);
}
