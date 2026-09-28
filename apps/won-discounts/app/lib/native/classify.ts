// Can this Basic / Free shipping discount move into Won without changing what
// the shopper gets? Pure. A discount moves only when Won can express it
// exactly. A move must never quietly widen a discount, so specific customers,
// countries or a shipping price cap keep it in Shopify.

import { CONFIG_LIMITS } from "@won/core/discounts/config";

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
  if (native.value.kind === "percentage" && !Number.isFinite(native.value.percent)) return { code: "unsupported_value" };
  if (native.buyers !== "all") return { code: "specific_buyers" };
  if (!native.appliesOnOneTimePurchase) return { code: "subscription_only" };
  if (
    native.value.kind === "fixed" &&
    (native.target.kind === "products" || native.target.kind === "collections") &&
    !native.value.appliesOnEachItem
  ) {
    return { code: "fixed_once_per_order" };
  }
  if (native.shippingCountries) return { code: "shipping_countries" };
  if (native.maximumShippingPrice) return { code: "shipping_price_cap" };
  const items = itemCount(native);
  if (items > CONFIG_LIMITS.listItems) return { code: "too_many_items", count: items, limit: CONFIG_LIMITS.listItems };
  if (native.codesCount > MAX_BACKUP_CODES) {
    return { code: "too_many_codes_to_back_up", count: native.codesCount, limit: MAX_BACKUP_CODES };
  }
  if (native.usageLimit !== null && native.usageCount >= native.usageLimit) {
    return { code: "usage_exhausted", used: native.usageCount, limit: native.usageLimit };
  }
  return null;
}
