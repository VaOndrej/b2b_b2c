// Výprodej (MVP 5, Pro; plan docs/plans/2026-10-02-won-discounts-mvp5.md, contracts O1–O9) — the pure side.
//
// A sale runs on an EXISTING variant (no product copy): the app backs up the variant's `price` /
// `compareAtPrice` and the fixed prices of the price lists the merchant picked, lowers them by one whole
// percent (O2), flags the variant in its product's metafield (`outlet: [variant GIDs]`, O6: the function
// then keeps every other discount off it, A1), counts the pieces sold from orders (O7: cancellations and
// restocked refunds come back) and restores the prices when the quota is used up, at the end date or by hand
// (O5). The runs live in the app's database; this module holds the rules the admin, the webhooks and the
// scheduler share:
//   outletSalePrice / outletPricesFor   the sale price of one price (its own currency, no exchange rate);
//   restoreDecision                     what to write back at the end (never over a change made elsewhere);
//   outletLeft / outletOversold / …     the quota ledger;
//   outletReturnQty / outletAfterReturn  cancellations, refunds and a return after the end;
//   validateOutletDraft                 a new sale from the admin form (Pro only, bounds, caps);
//   outletList / outletStorefrontValue  what the product metafields carry (function, storefront block).

import type { OutletDisplay, ReopenOnReturnMode } from "./config/enums.ts";
import type { ShopPlan } from "./plan-gate.ts";

export const OUTLET_LIMITS = {
  percentMin: 1,
  percentMax: 90,
  quotaMax: 100_000,
  /**
   * Products with a running sale per shop: each carries an `outlet` list the function reads per cart line
   * (instruction budget, plan "Rozpočet — výprodej"; the admin refuses more, the sync never writes more).
   */
  products: 100,
  /** Running sales on one product's variants (its `outlet` list: ~45 B a GID in the product metafield). */
  variantsPerProduct: 50,
  /** Price lists one sale changes. */
  priceLists: 10,
} as const;

export type OutletStatus = "starting" | "active" | "ending" | "ended";
export type OutletEndReason = "quota" | "date" | "manual";

/** A price and its compare-at price, minor units of one currency (compareAt null = none). */
export interface OutletPriceSnapshot {
  price: number;
  compareAt: number | null;
}

/** O2: `original × (100 − percent) / 100`, half up; null when it would not lower the price or would reach 0. */
export function outletSalePrice(original: number, percent: number): number | null {
  if (!Number.isSafeInteger(original) || original <= 0) return null;
  if (!Number.isInteger(percent) || percent < OUTLET_LIMITS.percentMin || percent > OUTLET_LIMITS.percentMax) return null;
  const sale = Math.floor((original * (100 - percent) + 50) / 100);
  return sale >= 1 && sale < original ? sale : null;
}

/** O2: the sale's price and compareAt; `silent` keeps the own compareAt (no strike on the theme). */
export function outletPricesFor(original: OutletPriceSnapshot, percent: number, display: OutletDisplay): OutletPriceSnapshot | null {
  const price = outletSalePrice(original.price, percent);
  if (price === null) return null;
  return { price, compareAt: display === "silent" ? original.compareAt : original.price };
}

export type RestoreDecision = { action: "restore"; value: number | null } | { action: "none" } | { action: "kept" };

/**
 * O5: one field at the end of a sale. Only a field that still holds the sale's value goes back to the backup;
 * one already back needs nothing (a retried end); anything else was changed outside the app and is kept.
 */
export function restoreDecision(field: { current: number | null; sale: number | null; backup: number | null }): RestoreDecision {
  if (field.current === field.backup) return { action: "none" };
  if (field.current === field.sale) return { action: "restore", value: field.backup };
  return { action: "kept" };
}

export interface OutletLedger {
  quota: number;
  sold: number;
  returned: number;
}

const net = (l: OutletLedger) => l.sold - l.returned;
/** Pieces the sale still offers (never below 0; "zbývá X ks" shows only this). */
export const outletLeft = (l: OutletLedger): number => Math.max(0, l.quota - net(l));
/** Pieces sold past the quota (a webhook arrives after the checkout: the admin says exactly how many). */
export const outletOversold = (l: OutletLedger): number => Math.max(0, net(l) - l.quota);
export const outletExhausted = (l: OutletLedger): boolean => net(l) >= l.quota;

/**
 * O7: pieces one order line gives back. A cancellation returns everything that line sold and was not returned
 * yet; a restocked refund its quantity, at most that.
 */
export function outletReturnQty(kind: "cancel" | "refund", line: { sold: number; returned: number }, qty: number): number {
  const open = Math.max(0, line.sold - line.returned);
  if (kind === "cancel") return open;
  return Math.max(0, Math.min(Math.floor(qty) || 0, open));
}

/** O7: a return after the sale ended. Free never reopens (A6: nothing new starts on Free). */
export function outletAfterReturn(mode: ReopenOnReturnMode, plan: ShopPlan): "reopen" | "ask" | "record" {
  if (plan !== "pro" || mode === "never") return "record";
  return mode === "auto" ? "reopen" : "ask";
}

/** O8: a running sale whose end date has come. */
export function outletDue(run: { status: OutletStatus | string; endsAt: Date | null }, now: Date): boolean {
  return run.status !== "ended" && run.endsAt !== null && run.endsAt.getTime() <= now.getTime();
}

export interface OutletDraft {
  variantId: string;
  productId: string;
  quota: number;
  percent: number;
  endsAt: Date | null;
  priceListIds: string[];
}

export interface OutletDraftError {
  field: "plan" | "variantId" | "quota" | "percent" | "endsAt" | "priceListIds";
  key: string;
  params?: Record<string, string | number>;
}

export interface OutletDraftContext {
  plan: ShopPlan;
  now: Date;
  /** Variants with a sale not yet ended (any status but `ended`). */
  runningVariantIds: ReadonlySet<string>;
  /** Their products. */
  runningProductIds: ReadonlySet<string>;
  /** Running sales per product id (variantsPerProduct cap); absent = not checked. */
  runningPerProduct?: ReadonlyMap<string, number>;
}

const gidOf = (kind: string, value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  return new RegExp(`^gid://shopify/${kind}/\\d+$`).test(text) ? text : null;
};

/** O4: a new sale from the admin form, checked on the server (SEC-1). */
export function validateOutletDraft(raw: unknown, ctx: OutletDraftContext): { ok: true; draft: OutletDraft } | { ok: false; errors: OutletDraftError[] } {
  if (ctx.plan !== "pro") return { ok: false, errors: [{ field: "plan", key: "outlet.error.pro" }] };
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const errors: OutletDraftError[] = [];
  const variantId = gidOf("ProductVariant", rec.variantId);
  const productId = gidOf("Product", rec.productId);
  if (!variantId || !productId) errors.push({ field: "variantId", key: "outlet.error.variant" });
  const quota = Number(rec.quota);
  if (!Number.isInteger(quota) || quota < 1 || quota > OUTLET_LIMITS.quotaMax) {
    errors.push({ field: "quota", key: "outlet.error.quota", params: { max: OUTLET_LIMITS.quotaMax } });
  }
  const percent = Number(rec.percent);
  if (!Number.isInteger(percent) || percent < OUTLET_LIMITS.percentMin || percent > OUTLET_LIMITS.percentMax) {
    errors.push({ field: "percent", key: "outlet.error.percent", params: { min: OUTLET_LIMITS.percentMin, max: OUTLET_LIMITS.percentMax } });
  }
  let endsAt: Date | null = null;
  if (rec.endsAt !== null && rec.endsAt !== undefined && rec.endsAt !== "") {
    const at = new Date(String(rec.endsAt));
    if (Number.isNaN(at.getTime()) || at.getTime() <= ctx.now.getTime()) errors.push({ field: "endsAt", key: "outlet.error.endsAt" });
    else endsAt = at;
  }
  const lists = Array.isArray(rec.priceListIds) ? rec.priceListIds.map((x) => gidOf("PriceList", x)) : [];
  if (lists.some((x) => x === null) || new Set(lists).size > OUTLET_LIMITS.priceLists || (rec.priceListIds !== undefined && !Array.isArray(rec.priceListIds))) {
    errors.push({ field: "priceListIds", key: "outlet.error.priceLists", params: { max: OUTLET_LIMITS.priceLists } });
  }
  if (errors.length > 0) return { ok: false, errors };
  if (ctx.runningVariantIds.has(variantId!)) return { ok: false, errors: [{ field: "variantId", key: "outlet.error.running" }] };
  if (!ctx.runningProductIds.has(productId!) && ctx.runningProductIds.size >= OUTLET_LIMITS.products) {
    return { ok: false, errors: [{ field: "variantId", key: "outlet.error.products", params: { max: OUTLET_LIMITS.products } }] };
  }
  if ((ctx.runningPerProduct?.get(productId!) ?? 0) >= OUTLET_LIMITS.variantsPerProduct) {
    return { ok: false, errors: [{ field: "variantId", key: "outlet.error.variants", params: { max: OUTLET_LIMITS.variantsPerProduct } }] };
  }
  return {
    ok: true,
    draft: { variantId: variantId!, productId: productId!, quota, percent, endsAt, priceListIds: [...new Set(lists as string[])] },
  };
}

/** O6: a product's `outlet` list — its variants with a sale not yet ended, unique, sorted. */
export function outletList(variantIds: readonly string[]): string[] {
  return [...new Set(variantIds)].sort();
}

/** O9: the product metafield `$app:won_discounts.outlet` the storefront block reads; null = delete it. */
export interface OutletStorefrontValue {
  d: OutletDisplay;
  /** Variant numeric id → pieces left (never below 0). */
  v: Record<string, number>;
}

export function outletStorefrontValue(display: OutletDisplay, runs: readonly { variantId: string; left: number }[]): OutletStorefrontValue | null {
  if (runs.length === 0) return null;
  const v: Record<string, number> = {};
  for (const run of runs) v[String(run.variantId).split("/").pop()!] = Math.max(0, Math.floor(run.left) || 0);
  return { d: display, v };
}
