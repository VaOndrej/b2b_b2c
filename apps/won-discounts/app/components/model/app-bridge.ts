// Client-only seam to App Bridge (the `shopify` global the embedded admin
// injects). Outside Shopify admin — the dev harness, a unit render — it is
// absent, and every helper reports `unavailable` instead of throwing, so the
// screens can say so honestly.

export interface PickedVariant {
  id: string;
  title: string;
  price?: string;
}
export interface PickedProduct {
  id: string;
  title: string;
  variants: PickedVariant[];
}
export interface PickedCollection {
  id: string;
  title: string;
}

export type PickResult<T> = { ok: true; items: T[] } | { ok: false; reason: "unavailable" | "cancelled" };

interface ResourcePickerOptions {
  type: "product" | "collection";
  multiple?: boolean;
  selectionIds?: { id: string }[];
}

interface ShopifyGlobal {
  resourcePicker?: (options: ResourcePickerOptions) => Promise<unknown[] | undefined>;
  toast?: { show?: (message: string, options?: { isError?: boolean }) => void };
  /** App Bridge Scopes API (optional scopes declared in shopify.app.toml `optional_scopes`). */
  scopes?: { request?: (scopes: string[]) => Promise<{ result?: string } | undefined> };
}

function appBridge(): ShopifyGlobal | null {
  if (typeof window === "undefined") return null;
  // App Bridge only works inside the Shopify admin iframe. Outside it (the dev
  // harness loads app-bridge.js too, via the root document) the global exists
  // but a picker would never answer, so treat it as unavailable.
  if (window.top === window) return null;
  return ((window as unknown as { shopify?: ShopifyGlobal }).shopify ?? null) as ShopifyGlobal | null;
}

export function isAppBridgeAvailable(): boolean {
  return typeof appBridge()?.resourcePicker === "function";
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function pickProducts(selected: readonly string[]): Promise<PickResult<PickedProduct>> {
  const bridge = appBridge();
  if (!bridge?.resourcePicker) return { ok: false, reason: "unavailable" };
  let picked: unknown[] | undefined;
  try {
    picked = await bridge.resourcePicker({ type: "product", multiple: true, selectionIds: selected.map((id) => ({ id })) });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!picked) return { ok: false, reason: "cancelled" };
  const items = picked.map((raw) => {
    const p = raw as { id?: unknown; title?: unknown; variants?: unknown };
    const variants = Array.isArray(p.variants)
      ? p.variants.map((v) => {
          const variant = v as { id?: unknown; title?: unknown; price?: unknown };
          return { id: str(variant.id), title: str(variant.title), price: str(variant.price) || undefined };
        })
      : [];
    return { id: str(p.id), title: str(p.title), variants: variants.filter((v) => v.id) };
  });
  return { ok: true, items: items.filter((p) => p.id) };
}

export async function pickCollections(selected: readonly string[]): Promise<PickResult<PickedCollection>> {
  const bridge = appBridge();
  if (!bridge?.resourcePicker) return { ok: false, reason: "unavailable" };
  let picked: unknown[] | undefined;
  try {
    picked = await bridge.resourcePicker({ type: "collection", multiple: true, selectionIds: selected.map((id) => ({ id })) });
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  if (!picked) return { ok: false, reason: "cancelled" };
  const items = picked.map((raw) => {
    const c = raw as { id?: unknown; title?: unknown };
    return { id: str(c.id), title: str(c.title) };
  });
  return { ok: true, items: items.filter((c) => c.id) };
}

export function showToast(message: string, isError = false): void {
  appBridge()?.toast?.show?.(message, { isError });
}

export type ScopeRequestResult = "granted" | "declined" | "unavailable";

/**
 * Ask the merchant for optional scopes (App Bridge `shopify.scopes.request`,
 * a grant modal over the app; the scopes must be in `optional_scopes`).
 * Outside the Shopify admin: "unavailable".
 */
export async function requestScopes(scopes: string[]): Promise<ScopeRequestResult> {
  const bridge = appBridge();
  if (typeof bridge?.scopes?.request !== "function") return "unavailable";
  try {
    const response = await bridge.scopes.request(scopes);
    return response?.result === "granted-all" ? "granted" : "declined";
  } catch {
    return "unavailable";
  }
}
