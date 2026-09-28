// Shopify decimal strings → integer minor units, per currency precision, parsed
// from the digits (no float math). Shared by classify (refuse what cannot be
// read) and the mapping (MoneyByCurrency).

/** Digits after the decimal point of a currency (CZK/EUR 2, JPY 0, KWD 3), from ICU. */
export function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * "10.005" CZK → 1001: extra digits beyond the currency's precision are rounded
 * half up. Null when it is not a non-negative decimal.
 */
export function decimalToMinor(amount: string, currency: string): number | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(String(amount).trim());
  if (!m) return null;
  const digits = currencyDigits(currency);
  const fraction = m[2] ?? "";
  const kept = fraction.slice(0, digits).padEnd(digits, "0");
  const roundUp = fraction.length > digits && Number(fraction[digits]) >= 5;
  const value = Number(m[1] + kept) + (roundUp ? 1 : 0);
  return Number.isSafeInteger(value) ? value : null;
}
