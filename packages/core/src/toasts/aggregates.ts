// MVP9/MVP11 — REAL aggregates. Counts genuine events (cart adds, orders) inside
// a time window. The number is always derived from stored event timestamps —
// never randomized, never fabricated. Cold-start honesty: with no events the
// count is 0 and the storefront shows nothing (see formatAggregateCount).

/** Count events whose epoch-ms timestamp is within [now - windowMs, now]. */
export function countWithinWindow(
  events: readonly number[] | null | undefined,
  now: number,
  windowMs: number,
): number {
  if (!Array.isArray(events) || !(windowMs > 0)) return 0;
  const start = now - windowMs;
  let n = 0;
  for (const t of events) {
    if (typeof t === "number" && t >= start && t <= now) n += 1;
  }
  return n;
}

/**
 * Render an aggregate message, but ONLY when the count is positive. A zero count
 * returns "" so the storefront never shows a dishonest "0 people" line. `{count}`
 * is substituted with the real number.
 */
export function formatAggregateCount(template: string, count: number): string {
  if (!(count > 0)) return "";
  return String(template ?? "").replace(/\{count\}/g, String(count));
}
