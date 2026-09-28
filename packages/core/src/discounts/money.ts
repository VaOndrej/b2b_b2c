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

// --- Minor units ---------------------------------------------------------------------
// Shopify (Functions input/output, Storefront/Admin API) speaks decimal strings in the
// presentment currency; the engine speaks integer minor units. These two helpers are
// the only bridge, so the function adapter, the admin simulator and the storefront
// convert the same way.

/** ISO 4217 currencies whose minor unit is not 1/100 (everything else: 2 digits). */
const MINOR_DIGITS: Readonly<Record<string, number>> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0,
  UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

/** Number of minor-unit digits of a currency (CZK/EUR 2, JPY 0, KWD 3). */
export function currencyExponent(currency: CurrencyCode): number {
  return MINOR_DIGITS[String(currency).toUpperCase()] ?? 2;
}

const DECIMAL_RE = /^(\d+)(?:\.(\d+))?$/;

/**
 * "1234.5" (or 1234.5) in `currency` → 123450 minor units. Parsed from the digits,
 * not via float multiplication (0.29 * 100 = 28.999…), and extra digits beyond
 * the currency's precision are rounded half up. Negative or malformed → null.
 */
export function toMinorUnits(amount: string | number, currency: CurrencyCode): number | null {
  const text = typeof amount === "number" ? (Number.isFinite(amount) ? String(amount) : "") : String(amount).trim();
  const m = DECIMAL_RE.exec(text);
  if (!m) return null;
  const digits = currencyExponent(currency);
  const fraction = m[2] ?? "";
  const kept = fraction.slice(0, digits).padEnd(digits, "0");
  const roundUp = fraction.length > digits && fraction.charCodeAt(digits) >= 53; // "5"
  const value = Number(m[1] + kept) + (roundUp ? 1 : 0);
  return Number.isSafeInteger(value) ? value : null;
}

/** 123450 minor units of `currency` → "1234.50" (the decimal string Shopify expects). */
export function fromMinorUnits(minor: number, currency: CurrencyCode): string {
  const digits = currencyExponent(currency);
  const n = Math.max(0, Math.round(minor));
  if (digits === 0) return String(n);
  const text = String(n).padStart(digits + 1, "0");
  return `${text.slice(0, -digits)}.${text.slice(-digits)}`;
}
