// The gift picker (Odměny, plan 2026-10-06 B6): Shopify's resource picker at the VARIANT level — a gift is one
// variant, so the merchant picks exactly that (never a product whose every variant comes back), the current gifts
// are preselected, and the picker itself holds the limit (`multiple`: 1 gift on Free and for the fallback, up to 3
// on Pro). What comes back IS the new selection. Client-only seam to App Bridge (`shopify.resourcePicker`, Resource
// Picker API: `type: "variant"`, `multiple: number`, `selectionIds: [{ id }]` — @shopify/app-bridge-types); outside
// the Shopify admin it reports `unavailable` like model/app-bridge.ts.

import type { GiftVariantView } from "../model/types";

export type GiftPickResult = { ok: true; items: GiftVariantView[] } | { ok: false; reason: "unavailable" | "cancelled" };

interface VariantPickerOptions {
  type: "variant";
  action: "select";
  multiple: boolean | number;
  selectionIds: { id: string }[];
}

type VariantPicker = (options: VariantPickerOptions) => Promise<unknown[] | undefined>;

function variantPicker(): VariantPicker | null {
  if (typeof window === "undefined") return null;
  // App Bridge answers only inside the Shopify admin iframe (the dev harness has the global, but no picker).
  if (window.top === window) return null;
  const picker = (window as unknown as { shopify?: { resourcePicker?: VariantPicker } }).shopify?.resourcePicker;
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

/** Open the variant picker with `selected` preselected; the result replaces the selection. */
export async function pickGiftVariants(selected: readonly string[], max: number): Promise<GiftPickResult> {
  const picker = variantPicker();
  if (!picker) return { ok: false, reason: "unavailable" };
  let picked: unknown[] | undefined;
  try {
    picked = await picker({ type: "variant", action: "select", multiple: max > 1 ? max : false, selectionIds: selected.map((id) => ({ id })) });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!picked) return { ok: false, reason: "cancelled" };
  return { ok: true, items: giftsFromPicked(picked, max) };
}
