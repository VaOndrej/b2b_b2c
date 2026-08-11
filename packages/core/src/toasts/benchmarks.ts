// MVP13d — cross-store benchmarks (the portfolio moat single-store analytics can
// never have). Anonymous aggregate across Won shops: per-type percentiles of
// read-rate / CTR / dismiss, plus a "stores like yours" rank. STRICT privacy:
// only aggregates, never cross-store PII, and k-ANONYMITY — a type is reported
// only when at least N shops contributed it. Opt-out is respected (decision #3).

export interface TypeRates {
  readRate: number;
  ctr: number;
  dismissRate: number;
}

export interface StoreTypeRates {
  /** Opaque per-shop hash — never a shop domain or id. */
  shopHash: string;
  optOut: boolean;
  /** Merchant self-selected industry (for "stores like yours"). */
  industry?: string;
  byType: Record<string, TypeRates>;
}

export interface Percentiles {
  p25: number;
  p50: number;
  p75: number;
}

export interface TypeBenchmark {
  stores: number;
  readRate: Percentiles;
  ctr: Percentiles;
  dismissRate: Percentiles;
}

export interface BenchmarkOptions {
  /** k-anonymity floor — a type needs at least this many contributing shops. */
  minStores?: number;
  /** When set, cohort to "stores like yours" — only shops in this industry
   *  count, and k-anonymity is re-applied within that cohort. */
  industry?: string;
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function pctSet(values: number[]): Percentiles {
  const s = values.slice().sort((a, b) => a - b);
  return { p25: percentile(s, 0.25), p50: percentile(s, 0.5), p75: percentile(s, 0.75) };
}

/**
 * Aggregate per-shop rates into per-type benchmarks. Opted-out shops are dropped
 * first; a type is included only if ≥ minStores shops contributed it (k-anonymity),
 * so no small cohort can be de-anonymised. Deterministic regardless of input order.
 */
export function computeBenchmark(
  rows: ReadonlyArray<StoreTypeRates>,
  opts: BenchmarkOptions = {},
): Record<string, TypeBenchmark> {
  const minStores = opts.minStores ?? 10;
  const contributing = rows.filter(
    (r) => r && !r.optOut && (!opts.industry || r.industry === opts.industry),
  );

  const byType = new Map<string, { readRate: number[]; ctr: number[]; dismissRate: number[] }>();
  for (const store of contributing) {
    for (const type of Object.keys(store.byType ?? {})) {
      const r = store.byType[type];
      if (!r) continue;
      let bucket = byType.get(type);
      if (!bucket) byType.set(type, (bucket = { readRate: [], ctr: [], dismissRate: [] }));
      bucket.readRate.push(r.readRate);
      bucket.ctr.push(r.ctr);
      bucket.dismissRate.push(r.dismissRate);
    }
  }

  const out: Record<string, TypeBenchmark> = {};
  for (const type of Array.from(byType.keys()).sort()) {
    const b = byType.get(type)!;
    if (b.readRate.length < minStores) continue; // k-anonymity: suppress
    out[type] = {
      stores: b.readRate.length,
      readRate: pctSet(b.readRate),
      ctr: pctSet(b.ctr),
      dismissRate: pctSet(b.dismissRate),
    };
  }
  return out;
}

/** Where a shop's value sits in a cohort: fraction of the cohort at or below it. */
export function percentileRank(value: number, cohort: ReadonlyArray<number>): number {
  if (cohort.length === 0) return 0;
  let atOrBelow = 0;
  for (const v of cohort) if (v <= value) atOrBelow += 1;
  return atOrBelow / cohort.length;
}
