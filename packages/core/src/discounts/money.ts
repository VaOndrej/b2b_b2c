// Money helpers for Won Discounts (doctrine MKT-1, principle 6: per market/currency,
// never converted by exchange rate). Every threshold and fixed amount in the config
// is a MoneyByCurrency: minor units (haléře/centy), integer, >= 0. A market whose
// currency is missing from the map has no value for that field — engines must treat
// that as "not offered in this market", not as zero.

export type CurrencyCode = string; // ISO 4217, upper-case, e.g. "CZK"
export type MoneyByCurrency = Readonly<Record<CurrencyCode, number>>;

const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

/**
 * Sanitize an arbitrary value into a MoneyByCurrency (DATA-2: never throws).
 * - Keys are upper-cased and must look like an ISO 4217 code (3 letters); anything
 *   else is dropped.
 * - Values must be a finite `number` >= 0 (strings, NaN, Infinity, negatives are
 *   dropped, not coerced).
 * - Fractional values are floored to the minor unit.
 * - `opts.max`, when given, clamps each accepted value.
 */
export function sanitizeMoneyByCurrency(
  v: unknown,
  opts?: { max?: number },
): MoneyByCurrency {
  const out: Record<CurrencyCode, number> = {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) return out;

  for (const [rawKey, rawValue] of Object.entries(v as Record<string, unknown>)) {
    const key = rawKey.toUpperCase();
    if (!CURRENCY_CODE_RE.test(key)) continue;
    if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue < 0) {
      continue;
    }
    let amount = Math.floor(rawValue);
    if (opts?.max !== undefined) amount = Math.min(amount, opts.max);
    out[key] = amount;
  }
  return out;
}

/**
 * Read a currency's value out of a MoneyByCurrency map. Returns `null`, never 0,
 * when the market has no value at all (principle 6) — callers must not confuse
 * "not offered here" with "offered, worth zero".
 */
export function moneyFor(
  m: MoneyByCurrency | undefined,
  currency: CurrencyCode,
): number | null {
  if (!m) return null;
  const v = m[currency];
  return typeof v === "number" ? v : null;
}
