// Won Toasts — Phase 8 trust-data bridge (popularity signal).
//
// Pure aggregation of product sales into an AI/theme-legible popularity signal:
//   • soldUnits  — total units sold in a rolling window (FACTUAL)
//   • isBestseller — a DERIVED claim: top (1 − percentile) of ELIGIBLE products,
//     where "eligible" means at least `minSales` units — so a single sale never
//     earns a badge (honesty floor).
//
// This layer NEVER touches Shopify or the DB — the app feeds it sale records and
// writes the results to `won.*` product metafields, which the theme won-schema
// engine reads (units → Product.additionalProperty, bestseller → visible badge).
// Deterministic: `now` is injected, never read from the clock.

export interface ProductSale {
  /** Shopify product GID, e.g. "gid://shopify/Product/123". */
  productId: string;
  /** Units in that sale line (must be >= 1). */
  quantity: number;
  /** When the sale happened, epoch ms. */
  at: number;
}

export interface PopularityOptions {
  /** Reference "now", epoch ms (injected for determinism). */
  now: number;
  /** Rolling window length in days (e.g. 30). */
  windowDays: number;
  /** Minimum units within the window to be eligible for the bestseller badge. */
  minSales: number;
  /** e.g. 0.8 → the top 20% of eligible products (by units) are bestsellers. */
  bestsellerPercentile: number;
}

export interface ProductPopularity {
  productId: string;
  /** Total units sold in the window. */
  soldUnits: number;
  /** 1 = most sold. Dense rank (equal sellers share a rank). */
  rank: number;
  isBestseller: boolean;
}

export const DEFAULT_POPULARITY_OPTIONS: Omit<PopularityOptions, "now"> = {
  windowDays: 30,
  minSales: 5,
  bestsellerPercentile: 0.8,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Aggregate raw sale records into a per-product popularity signal. Returns one
 * row per product that sold at least once in the window, ranked by units. A
 * product with no sales in the window is simply absent (the writer decides how
 * to clear a stale badge).
 */
export function computeProductPopularity(
  sales: ReadonlyArray<ProductSale>,
  options: PopularityOptions,
): ProductPopularity[] {
  const { now, windowDays, minSales, bestsellerPercentile } = options;
  const cutoff = now - windowDays * DAY_MS;

  // 1. Sum units per product within [cutoff, now]. Skip malformed rows.
  const units = new Map<string, number>();
  for (const s of sales) {
    if (!s || typeof s.productId !== "string" || s.productId === "") continue;
    const q = Number(s.quantity);
    const at = Number(s.at);
    if (!Number.isFinite(q) || q <= 0) continue;
    if (!Number.isFinite(at) || at < cutoff || at > now) continue;
    units.set(s.productId, (units.get(s.productId) ?? 0) + q);
  }

  // 2. Sort by units desc (productId as a stable tiebreak for determinism).
  const rows = [...units.entries()]
    .map(([productId, soldUnits]) => ({ productId, soldUnits }))
    .sort(
      (a, b) => b.soldUnits - a.soldUnits || a.productId.localeCompare(b.productId),
    );

  // 3. Dense rank (equal soldUnits share a rank).
  let rank = 0;
  let prevUnits = Number.POSITIVE_INFINITY;
  const ranked = rows.map((r) => {
    if (r.soldUnits < prevUnits) {
      rank += 1;
      prevUnits = r.soldUnits;
    }
    return { productId: r.productId, soldUnits: r.soldUnits, rank };
  });

  // 4. Bestseller threshold over ELIGIBLE products only (>= minSales). Take the
  //    top (1 − percentile) share; use the units value at that boundary so tied
  //    sellers are treated equally (>= thresholdUnits). Nobody below the floor
  //    ever qualifies.
  const eligible = ranked.filter((r) => r.soldUnits >= minSales);
  let thresholdUnits = Number.POSITIVE_INFINITY; // nothing qualifies by default
  if (eligible.length > 0) {
    const share = Math.max(0, Math.min(1, 1 - bestsellerPercentile));
    const slots = Math.ceil(share * eligible.length); // eligible already sorted desc
    if (slots > 0) thresholdUnits = eligible[slots - 1].soldUnits;
  }

  return ranked.map((r) => ({
    productId: r.productId,
    soldUnits: r.soldUnits,
    rank: r.rank,
    isBestseller: r.soldUnits >= minSales && r.soldUnits >= thresholdUnits,
  }));
}
