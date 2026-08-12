// "Effect Proof" primitives — the pure logic behind the admin's inline
// Without→With illustrations (doctrine §10). A proof must show the SAME truth
// the runtime enforces, so the merchant trusts what they see. Framework-free.

export interface CapProof {
  /** True when the cap is off (0 or negative) — every toast in the burst shows. */
  unlimited: boolean;
  /** How many of the burst a shopper actually sees. */
  shown: number;
  /** How many are held back (never negative). */
  quiet: number;
}

/**
 * Given a per-session cap and an illustrative burst size, work out how many
 * toasts show vs. are quieted. Mirrors the storefront gate (`maxPer > 0`), so
 * a cap of 0 (or negative) means "no limit".
 */
export function capProof(maxPerSession: number, burst: number): CapProof {
  if (!(maxPerSession > 0)) {
    return { unlimited: true, shown: burst, quiet: 0 };
  }
  const shown = Math.min(maxPerSession, burst);
  return { unlimited: false, shown, quiet: burst - shown };
}
