// Can this Basic / Free shipping discount move into Won without changing what
// the shopper gets? Pure. A discount moves only when Won can express it
// exactly. A move must never quietly widen a discount, so specific customers,
// countries or a shipping price cap keep it in Shopify.

import { CONFIG_LIMITS } from "@won/core/discounts/config";

import { decimalToMinor } from "./amounts.ts";
import type { NativeDiscount, NotMovableReason } from "./types.ts";

/**
 * Most redeem codes a move backs up (and an undo re-adds). Above this the
 * backup row and the undo would be unreasonably large; such a discount stays.
 * Codes above CONFIG_LIMITS.codesPerRule but below this move with a stated loss.
 */
export const MAX_BACKUP_CODES = 10_000;

function itemCount(native: NativeDiscount): number {
  const t = native.target;
  if (!t) return 0;
  if (t.kind === "products") return Math.max(t.productIds.length, t.variantIds.length);
  if (t.kind === "collections") return t.ids.length;
  return 0;
}

/** Null when the discount can move; otherwise why not (./copy.ts has the sentence). */
export function classifyNative(native: NativeDiscount): NotMovableReason | null {
  if (!native.value || !native.target) return { code: "unsupported_value" };
  // A field Shopify returned in an unknown shape is never guessed (F13).
  if (native.unreadable && native.unreadable.length > 0) return { code: "unsupported_value" };
  if (native.value.kind === "percentage" && !Number.isFinite(native.value.percent)) return { code: "unsupported_value" };
  const shopCurrency = native.shop.currencyCode;
  if (native.value.kind === "fixed" && decimalToMinor(native.value.amount, native.value.currencyCode || shopCurrency) === null) {
    return { code: "unsupported_value" };
  }
  if (native.minimum?.kind === "subtotal" && decimalToMinor(native.minimum.amount, native.minimum.currencyCode || shopCurrency) === null) {
    return { code: "unsupported_value" };
  }
  if (native.method === "code" && native.codes.length === 0) return { code: "no_codes" };
  // A Won code has at most CONFIG_LIMITS.codeLength (64) characters, trimmed and
  // upper-cased (audit round 6); Shopify allows 255. A discount with a longer
  // code stays in Shopify: moving it without that code would stop the code working.
  if (native.method === "code" && native.codes.some((code) => code.trim().toUpperCase().length > CONFIG_LIMITS.codeLength)) {
    return { code: "code_too_long", max: CONFIG_LIMITS.codeLength };
  }
  if (native.buyers !== "all") return { code: "specific_buyers" };
  if (!native.appliesOnOneTimePurchase) return { code: "subscription_only" };
  if (
    native.value.kind === "fixed" &&
    (native.target.kind === "products" || native.target.kind === "collections") &&
    !native.value.appliesOnEachItem
  ) {
    return { code: "fixed_once_per_order" };
  }
  // The reverse (F13): an amount off EACH item of the whole order. A Won order
  // rule takes a fixed amount once per order, which would narrow it silently.
  if (native.value.kind === "fixed" && native.target.kind === "order" && native.value.appliesOnEachItem) {
    return { code: "fixed_each_item_on_order" };
  }
  if (native.shippingCountries) return { code: "shipping_countries" };
  if (native.maximumShippingPrice) return { code: "shipping_price_cap" };
  const items = itemCount(native);
  if (items > CONFIG_LIMITS.listItems) return { code: "too_many_items", count: items, limit: CONFIG_LIMITS.listItems };
  // A lower-bound count (precision AT_LEAST) may hide any number of codes: never back it up partially.
  if (native.method === "code" && (!native.codesCountExact || native.codesCount > MAX_BACKUP_CODES)) {
    return { code: "too_many_codes_to_back_up", count: native.codesCount, limit: MAX_BACKUP_CODES, atLeast: !native.codesCountExact };
  }
  if (native.usageLimit !== null && native.usageCount >= native.usageLimit) {
    return { code: "usage_exhausted", used: native.usageCount, limit: native.usageLimit };
  }
  return null;
}

/**
 * The full read before a delete must hold EVERYTHING the undo needs: every
 * list paged to its end and every code Shopify counts. Detection reads only a
 * first page, so this is checked by the move (and the dialog preview), not by
 * classifyNative. Null when the snapshot is complete.
 */
export function incompleteSnapshot(native: NativeDiscount): NotMovableReason | null {
  if (!native.complete) return { code: "incomplete_read" };
  if (native.method === "code" && (!native.codesCountExact || native.codes.length < native.codesCount)) {
    return { code: "incomplete_read" };
  }
  return null;
}
