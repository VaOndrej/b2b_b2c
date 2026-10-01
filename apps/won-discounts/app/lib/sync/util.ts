// Small shared helpers of the sync layer (one place for JSON comparison,
// batching and the Shopify batch limits).

import { createHash } from "node:crypto";

/** Shopify: 25 metafields per metafieldsSet (https://shopify.dev/docs/apps/build/metafields/metafield-limits). */
export const METAFIELDS_SET_BATCH = 25;
/** Shopify: 250 metafields per metafieldsDelete (same page; the platform-wide input-array cap). */
export const METAFIELDS_DELETE_BATCH = 250;
/** Ids per `nodes(ids:)` read. */
export const NODES_BATCH = 100;
/** Shopify: discountRedeemCodeBulkAdd takes at most 250 codes; the same cap bounds the bulk delete's ids. */
export const REDEEM_CODES_PER_CALL = 250;

export function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Deterministic JSON (sorted keys, undefined dropped) for comparing stored values with desired ones. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * True when `stored` (a JSON string as read from Shopify) means the same as
 * `desired` (a JSON string or a value). Unparseable / missing → false.
 */
export function sameJson(stored: string | null | undefined, desired: unknown): boolean {
  if (stored === null || stored === undefined) return false;
  try {
    const want = typeof desired === "string" ? JSON.parse(desired) : desired;
    return canonicalJson(JSON.parse(stored)) === canonicalJson(want);
  } catch {
    return false;
  }
}

/**
 * Shopify's `shop.currencyCode` as the sync passes it on (trimmed, upper-case
 * ISO 4217), or null when it is not one. The storefront config's margin key and
 * the variant pdp key must be built from the SAME string (MVP 3, K4 v2).
 */
export function isoCurrency(raw: unknown): string | null {
  const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** Short content hash (sha256, 32 hex). */
export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}
