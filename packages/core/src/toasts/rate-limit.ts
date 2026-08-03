// Rate limiting + dedupe helpers — guardrails so a noisy cart never spams the
// shopper. Pure functions over timestamp/window state; the storefront holds the
// arrays and passes `now`.

/** True if emitting now stays within `perMin` toasts over the last 60s. */
export function withinRateLimit(
  recentTimestamps: readonly number[],
  now: number,
  perMin: number,
): boolean {
  if (!Number.isFinite(perMin) || perMin <= 0) return true;
  const windowStart = now - 60_000;
  const inWindow = recentTimestamps.filter((t) => t >= windowStart).length;
  return inWindow < perMin;
}

/** Drop timestamps older than the last 60s (call before/after recording). */
export function pruneTimestamps(
  timestamps: readonly number[],
  now: number,
): number[] {
  const windowStart = now - 60_000;
  return timestamps.filter((t) => t >= windowStart);
}

/**
 * True if a key was already emitted within `dedupeWindowMs` (so we should skip
 * it). `lastSeen` maps dedupe key → last emit timestamp.
 */
export function isDuplicate(
  lastSeen: Record<string, number>,
  key: string,
  now: number,
  dedupeWindowMs: number,
): boolean {
  if (!Number.isFinite(dedupeWindowMs) || dedupeWindowMs <= 0) return false;
  const previous = lastSeen[key];
  return typeof previous === "number" && now - previous < dedupeWindowMs;
}
