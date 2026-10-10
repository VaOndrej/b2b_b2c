// The gift picker (Odměny). Since 10 Oct 2026 (feedback, bod 1) it is Shopify's PRODUCT picker with the variants
// shown — the same list of products as everywhere else in the app (a new sale, a discount's products). Before, it
// was the variant-level picker (`type: "variant"`), which lists every variant of the shop flat, by its
// "Product - Variant" name: a different list, and the merchant took it for the wrong one. A gift is still one
// variant: the merchant ticks the variants inside the picked products, and what comes back IS the new selection,
// at most `max` of them (more ticked → the first `max`, and the caller says so: never chosen silently).
// The price to pay: the stored gifts are variant ids without their product, so the picker cannot open with them
// ticked. Client-only seam to App Bridge (`shopify.resourcePicker`); outside the Shopify admin it reports
// `unavailable` like model/app-bridge.ts.

import type { GiftVariantView } from "../model/types";

export type GiftPickResult = { ok: true; items: GiftVariantView[]; /** More variants were ticked than the limit: only the first `max` were taken. */ trimmed?: boolean } | { ok: false; reason: "unavailable" | "cancelled" };

interface ProductPickerOptions {
  type: "product";
  action: "select";
  multiple: boolean | number;
}

type ProductPicker = (options: ProductPickerOptions) => Promise<unknown[] | undefined>;

function productPicker(): ProductPicker | null {
  if (typeof window === "undefined") return null;
  // App Bridge answers only inside the Shopify admin iframe (the dev harness has the global, but no picker).
  if (window.top === window) return null;
  const picker = (window as unknown as { shopify?: { resourcePicker?: ProductPicker } }).shopify?.resourcePicker;
  return typeof picker === "function" ? picker : null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A picked variant as the screen names it: "Product — Variant", the product alone for its only (default) variant. */
export function giftTitle(raw: { title?: unknown; displayName?: unknown; product?: unknown }): string {
  const product = str((raw.product as { title?: unknown } | null | undefined)?.title).trim();
  const variant = str(raw.title).trim();
  if (product) return variant && variant !== "Default Title" ? `${product} — ${variant}` : product;
  // No product in the payload: Shopify's own "Product - Variant".
  return str(raw.displayName).trim().replace(/ - Default Title$/, "") || variant;
}

/** The picker's payload → gifts: variant GIDs only, each once, at most `max` (the picker holds the limit; this is the guard). */
export function giftsFromPicked(picked: readonly unknown[], max: number): GiftVariantView[] {
  const out: GiftVariantView[] = [];
  for (const raw of picked) {
    const item = (raw ?? {}) as { id?: unknown; title?: unknown; displayName?: unknown; product?: unknown };
    const id = str(item.id);
    if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id) || out.some((g) => g.id === id)) continue;
    out.push({ id, title: giftTitle(item) });
  }
  return out.slice(0, Math.max(1, max));
}

/** The product picker's payload → gifts: every ticked variant of every picked product, each once, in the picker's order. */
export function giftsFromProducts(picked: readonly unknown[]): GiftVariantView[] {
  const out: GiftVariantView[] = [];
  for (const raw of picked) {
    const product = (raw ?? {}) as { title?: unknown; variants?: unknown };
    for (const v of Array.isArray(product.variants) ? product.variants : []) {
      const variant = (v ?? {}) as { id?: unknown; title?: unknown; displayName?: unknown };
      const id = str(variant.id);
      if (!/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(id) || out.some((g) => g.id === id)) continue;
      out.push({ id, title: giftTitle({ title: variant.title, displayName: variant.displayName, product: { title: product.title } }) });
    }
  }
  return out;
}

/** Open the product picker; the ticked variants replace the selection (at most `max`; `trimmed` when more were ticked). */
export async function pickGiftVariants(_selected: readonly string[], max: number): Promise<GiftPickResult> {
  const picker = productPicker();
  if (!picker) return { ok: false, reason: "unavailable" };
  let picked: unknown[] | undefined;
  try {
    picked = await picker({ type: "product", action: "select", multiple: max > 1 ? max : false });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!picked) return { ok: false, reason: "cancelled" };
  const all = giftsFromProducts(picked);
  const limit = Math.max(1, max);
  return { ok: true, items: all.slice(0, limit), ...(all.length > limit ? { trimmed: true } : {}) };
}
