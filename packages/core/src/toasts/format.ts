// MVP14 — money + locale formatting. Prices are minor units (cents/haléře) and
// rendered in the shop's currency and locale via Intl. RTL detection lets the
// storefront flip toast direction for Arabic/Hebrew/Farsi stores.

export interface MoneyOpts {
  currency: string;
  locale: string;
}

/** Format minor units (e.g. 1999 → "$19.99"). Empty string on invalid input. */
export function formatMoney(minorUnits: number, opts: MoneyOpts): string {
  if (!Number.isFinite(minorUnits)) return "";
  const currency = opts.currency || "USD";
  const locale = opts.locale || "en";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(
      minorUnits / 100,
    );
  } catch {
    // Unknown currency/locale → a plain, still-truthful fallback.
    return (minorUnits / 100).toFixed(2);
  }
}

const RTL_LANGS = new Set(["ar", "he", "fa", "ur", "ps", "syr", "dv"]);

/** True for right-to-left languages (matches on the primary subtag). */
export function isRTLLocale(locale: string): boolean {
  const primary = String(locale ?? "")
    .toLowerCase()
    .split(/[-_]/)[0];
  return RTL_LANGS.has(primary);
}
