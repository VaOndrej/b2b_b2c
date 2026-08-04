// MVP9 — first VISIBLE, cold-start-safe page-view types: countdown timer and
// low-stock urgency. Framework-free pure logic; the storefront mirrors it and
// governs every emit through @won/core/toasts/governance (MVP8).

export interface CountdownOpts {
  /** Fixed deadline in epoch ms. Takes precedence over evergreen. */
  endsAt?: number;
  /** Evergreen duration in ms, counted from `startedAt` (per-session). */
  evergreenMs?: number;
  /** When the evergreen countdown started (epoch ms). */
  startedAt?: number;
}

/** Milliseconds left, clamped at 0. Fixed deadline wins over evergreen. */
export function countdownRemainingMs(now: number, opts: CountdownOpts): number {
  if (typeof opts.endsAt === "number") {
    return Math.max(0, opts.endsAt - now);
  }
  if (typeof opts.evergreenMs === "number" && typeof opts.startedAt === "number") {
    return Math.max(0, opts.startedAt + opts.evergreenMs - now);
  }
  return 0;
}

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** Split remaining ms into whole days/hours/minutes/seconds (never negative). */
export function formatCountdown(ms: number): CountdownParts {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export function isExpired(remainingMs: number): boolean {
  return remainingMs <= 0;
}

/**
 * Low-stock urgency predicate: show "Only N left" only when there is genuine
 * scarcity — a positive inventory strictly below the merchant's threshold. Out
 * of stock (0) and a disabled threshold (≤0) never trigger it. Uses REAL
 * inventory; nothing is fabricated.
 */
export function isLowStock(inventoryQuantity: number, threshold: number): boolean {
  return (
    Number.isFinite(inventoryQuantity) &&
    Number.isFinite(threshold) &&
    threshold > 0 &&
    inventoryQuantity > 0 &&
    inventoryQuantity < threshold
  );
}
