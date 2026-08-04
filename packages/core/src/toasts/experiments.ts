// MVP13 — A/B experiments. A deterministic split by cart-token hash so a given
// shopper always sees the same variant (stable experience, honest measurement),
// and a winner picker gated by a minimum sample so we never crown noise.

/** FNV-1a 32-bit hash — deterministic, no Math.random, stable across runs. */
export function hashToken(token: string): number {
  let h = 0x811c9dc5;
  const s = String(token ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept in uint32.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h >>> 0;
}

/** Deterministically assign a token to one of `variantCount` buckets. */
export function assignVariant(token: string, variantCount: number): number {
  if (!(variantCount > 1)) return 0;
  return hashToken(token) % variantCount;
}

export interface VariantStat {
  variant: number;
  impressions: number;
  clicks: number;
}

/**
 * Pick the variant with the highest CTR that meets `minSample` impressions.
 * Returns null when no variant has enough data yet — never guess on noise.
 */
export function pickWinner(
  stats: ReadonlyArray<VariantStat>,
  minSample = 100,
): number | null {
  let best: number | null = null;
  let bestCtr = -1;
  for (const s of stats) {
    if (!s || s.impressions < minSample) continue;
    const ctr = s.impressions > 0 ? s.clicks / s.impressions : 0;
    if (ctr > bestCtr) {
      bestCtr = ctr;
      best = s.variant;
    }
  }
  return best;
}
