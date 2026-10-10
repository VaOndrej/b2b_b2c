// Výprodej (MVP 5, Pro; plan docs/plans/2026-10-02-won-discounts-mvp5.md, contracts O1–O9) — the pure side.
//
// A sale runs on an EXISTING variant (no product copy): the app backs up the variant's `price` /
// `compareAtPrice` and the fixed prices of the price lists the merchant picked, lowers them by one whole
// percent (O2), flags the variant (its metafield `outlet` = true, O6: the function then keeps every other
// discount off it, A1), counts the pieces sold from orders (O7: cancellations and
// restocked refunds come back) and restores the prices when the quota is used up, at the end date or by hand
// (O5). The runs live in the app's database; this module holds the rules the admin, the webhooks and the
// scheduler share:
//   outletSalePrice / outletPricesFor   the sale price of one price (its own currency, no exchange rate);
//   restoreDecision                     what to write back at the end (never over a change made elsewhere);
//   outletLeft / outletOversold / …     the quota ledger;
//   outletReturnQty / outletAfterReturn  cancellations, refunds and a return after the end;
//   validateOutletDraft                 a new sale from the admin form (Pro only, bounds, caps);
//   outletStorefrontValue               what the storefront block's product metafield carries.

import { OUTLET_DISPLAY_MODES, type OutletDisplay, type ReopenOnReturnMode } from "./config/enums.ts";
import type { ShopPlan } from "./plan-gate.ts";
import { OUTLET_ALLOW } from "./cart.ts";

export const OUTLET_LIMITS = {
  percentMin: 1,
  percentMax: 90,
  quotaMax: 100_000,
  /** Sales not ended per shop (the admin's list and the scheduler's sweep stay bounded). */
  running: 500,
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
  /** false = the storefront badge block does not show this sale's variant (the sale itself is the same). */
  showBadge: boolean;
  /** How this sale shows on the storefront (per sale since 9 Oct 2026); null = not said: the shop's setting applies. */
  display: OutletDisplay | null;
  /** The merchant's own badge text for this sale ("{left}" = the pieces left); null = the default label. */
  message: string | null;
  /** true = the sale's variant takes other discounts too; false = the shop's rule. Which ones: `combineWith`. */
  combine: boolean;
  /** With `combine`: the discounts this sale takes (at least one). All three = like any product (no sale flag). */
  combineWith: OutletCombineClass[];
}

/** The discounts a sale can be allowed to take; the order of the checkboxes. Shipping and gifts always apply. */
export const OUTLET_COMBINE_CLASSES = ["tiers", "product", "order"] as const;
export type OutletCombineClass = (typeof OUTLET_COMBINE_CLASSES)[number];

/** What a stored sale takes: `combine` off → nothing; on with no list (a sale from before the list) → every class. */
export function outletCombineWith(combine: boolean | null | undefined, stored: string | null | undefined): OutletCombineClass[] {
  if (combine !== true) return [];
  if (stored === null || stored === undefined) return [...OUTLET_COMBINE_CLASSES];
  const picked = new Set(stored.split(","));
  return OUTLET_COMBINE_CLASSES.filter((c) => picked.has(c));
}

/**
 * The variant's sale flag for what the sale takes (the function's and the storefront's `outlet`): `true` = no
 * other discount, a number = the sum of the allowed classes (cart.ts OUTLET_ALLOW), null = no flag at all (the
 * sale takes everything, its variant is like any product).
 */
export function outletFlagFor(combineWith: readonly OutletCombineClass[]): true | number | null {
  const allow = combineWith.reduce((sum, c) => sum | OUTLET_ALLOW[c], 0);
  return allow === 0 ? true : allow === 7 ? null : allow;
}

/** The longest badge text a sale may carry (a badge, not a paragraph). */
export const OUTLET_MESSAGE_MAX = 80;

/** A badge text as stored: trimmed, inner whitespace collapsed; "" → null. Longer than the limit → "too_long". */
export function outletMessageOf(raw: unknown): string | null | "too_long" {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (text === "") return null;
  return text.length > OUTLET_MESSAGE_MAX ? "too_long" : text;
}

/** Does this display level show the badge / the pieces left. */
export const outletShowsBadge = (display: OutletDisplay): boolean => display === "strike_badge" || display === "strike_badge_left";

export interface OutletDraftError {
  field: "plan" | "variantId" | "quota" | "percent" | "endsAt" | "priceListIds" | "display" | "message" | "combineWith";
  key: string;
  params?: Record<string, string | number>;
}

export interface OutletDraftContext {
  plan: ShopPlan;
  now: Date;
  /** Variants with a sale not yet ended (any status but `ended`): one sale per variant, OUTLET_LIMITS.running per shop. */
  runningVariantIds: ReadonlySet<string>;
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
  // How it shows: absent = not said (the shop's setting applies, as before the levels were per sale); anything else must be a known level.
  const display = rec.display === undefined || rec.display === null || rec.display === "" ? null : rec.display;
  if (display !== null && !(OUTLET_DISPLAY_MODES as readonly unknown[]).includes(display)) errors.push({ field: "display", key: "outlet.error.display" });
  const message = outletMessageOf(rec.message);
  if (message === "too_long") errors.push({ field: "message", key: "outlet.error.message", params: { max: OUTLET_MESSAGE_MAX } });
  // What it combines with: with "takes other discounts" at least one of them must be ticked.
  const combineWith = OUTLET_COMBINE_CLASSES.filter((c) => Array.isArray(rec.combineWith) && rec.combineWith.includes(c));
  // (No list sent at all = every class: the switch as it was before the list.)
  const combine = rec.combine === true;
  const takes = combine ? (rec.combineWith === undefined ? [...OUTLET_COMBINE_CLASSES] : combineWith) : [];
  if (combine && takes.length === 0) errors.push({ field: "combineWith", key: "outlet.error.combineWith" });
  if (errors.length > 0) return { ok: false, errors };
  if (ctx.runningVariantIds.has(variantId!)) return { ok: false, errors: [{ field: "variantId", key: "outlet.error.running" }] };
  if (ctx.runningVariantIds.size >= OUTLET_LIMITS.running) {
    return { ok: false, errors: [{ field: "variantId", key: "outlet.error.limit", params: { max: OUTLET_LIMITS.running } }] };
  }
  return {
    ok: true,
    draft: { variantId: variantId!, productId: productId!, quota, percent, endsAt, priceListIds: [...new Set(lists as string[])], showBadge: rec.showBadge !== false, display: display as OutletDisplay | null, message: message as string | null, combine, combineWith: takes },
  };
}

/** O9: the product metafield `$app:won_discounts.outlet` the storefront block reads; null = delete it. */
export interface OutletStorefrontValue {
  d: OutletDisplay;
  /** Variant numeric id → pieces left (never below 0). */
  v: Record<string, number>;
  /** Variant numeric id → when its sale ends, epoch seconds: only sales with an end date (the looks with a countdown). */
  e?: Record<string, number>;
  /**
   * Variant numeric id → what the badge block shows for THAT sale (per sale since 9 Oct 2026): 0 = nothing,
   * 1 = the badge, 2 = the badge and the pieces left. A variant without an entry (a sale from before) follows `d`.
   */
  s?: Record<string, 0 | 1 | 2>;
  /** Variant numeric id → the merchant's own badge text for that sale ("{left}" = the pieces left); absent = the default label. */
  m?: Record<string, string>;
}

/**
 * A sale whose badge the merchant hid (`showBadge: false`) is left out: the block lists only the variants in `v`,
 * so that variant gets no badge and no "zbývá X ks" while its sale runs as any other. No shown variant = null.
 */
export function outletStorefrontValue(
  display: OutletDisplay,
  runs: readonly { variantId: string; left: number; showBadge?: boolean; endsAt?: Date | null; display?: string | null; message?: string | null }[],
): OutletStorefrontValue | null {
  const shown = runs.filter((run) => run.showBadge !== false);
  if (shown.length === 0) return null;
  const v: Record<string, number> = {};
  const e: Record<string, number> = {};
  const s: Record<string, 0 | 1 | 2> = {};
  const m: Record<string, string> = {};
  for (const run of shown) {
    const id = String(run.variantId).split("/").pop()!;
    v[id] = Math.max(0, Math.floor(run.left) || 0);
    if (run.endsAt && Number.isFinite(run.endsAt.getTime())) e[id] = Math.floor(run.endsAt.getTime() / 1000);
    // The sale's own level; a sale without one (started before they were per sale) follows `d`.
    if (typeof run.display === "string" && (OUTLET_DISPLAY_MODES as readonly string[]).includes(run.display)) {
      s[id] = run.display === "strike_badge_left" ? 2 : run.display === "strike_badge" ? 1 : 0;
    }
    const text = outletMessageOf(run.message);
    if (text && text !== "too_long") m[id] = text;
  }
  return {
    d: display,
    v,
    ...(Object.keys(e).length > 0 ? { e } : {}),
    ...(Object.keys(s).length > 0 ? { s } : {}),
    ...(Object.keys(m).length > 0 ? { m } : {}),
  };
}
