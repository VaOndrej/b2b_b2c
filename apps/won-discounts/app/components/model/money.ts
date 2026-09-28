// Money in the admin (MKT-1): per currency, integer minor units, never converted.
// Formatting is hand-rolled on purpose (no Intl): the server render and the
// browser must print the exact same string, and it mirrors the engine's
// formatter in @won/core/discounts (the admin switches to that one once the
// engine surface is stable; see describe.ts).

const NBSP = "\u00a0";

/** ISO 4217 currencies whose minor unit is not 1/100. */
const MINOR_DIGITS: Readonly<Record<string, number>> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0,
  UGX: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
};

export function currencyExponent(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

const CS_SYMBOLS: Readonly<Record<string, string>> = { CZK: "Kč", EUR: "€" };
const EN_PREFIX_SYMBOLS: Readonly<Record<string, string>> = { EUR: "€", USD: "$", GBP: "£" };

function groupThousands(digits: string, separator: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += separator;
    out += digits[i];
  }
  return out;
}

/** 123450 CZK → "1 234,50 Kč" (cs) / "CZK 1,234.50" (en); whole amounts drop the decimals. */
export function formatMoney(minor: number, currency: string, locale: "cs" | "en"): string {
  const code = currency.toUpperCase();
  const digits = currencyExponent(code);
  const n = Math.round(Math.abs(minor));
  const scale = 10 ** digits;
  const major = Math.floor(n / scale);
  const fraction = n % scale;
  const sign = minor < 0 ? "-" : "";
  const cs = locale === "cs";
  let number = groupThousands(String(major), cs ? NBSP : ",");
  if (fraction > 0) number += (cs ? "," : ".") + String(fraction).padStart(digits, "0");
  if (cs) return `${sign}${number}${NBSP}${CS_SYMBOLS[code] ?? code}`;
  const symbol = EN_PREFIX_SYMBOLS[code];
  return symbol ? `${sign}${symbol}${number}` : `${sign}${code} ${number}`;
}

/** 12.5 → "12,5 %" (cs) / "12.5%" (en). */
export function formatPercent(percent: number, locale: "cs" | "en"): string {
  const text = String(Math.round(percent * 100) / 100);
  return locale === "cs" ? `${text.replace(".", ",")}${NBSP}%` : `${text}%`;
}

const DECIMAL_RE = /^(\d{1,12})(?:[.,](\d+))?$/;

/**
 * What a merchant typed ("100", "100,50", "1 000.5") in `currency` → minor units.
 * Empty → null ("no value", not zero). Negative, malformed, or more decimals than
 * the currency has → NaN (the form reports it).
 */
export function parseMoneyInput(raw: string, currency: string): number | null {
  const text = raw.replace(/[\s\u00a0]/g, "");
  if (text === "") return null;
  const m = DECIMAL_RE.exec(text);
  if (!m) return Number.NaN;
  const digits = currencyExponent(currency);
  const fraction = m[2] ?? "";
  if (fraction.length > digits) return Number.NaN;
  return Number(m[1]) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
}

/** Minor units → the editable field value ("100" or "100.5"), inverse of parseMoneyInput. */
export function minorToInput(minor: number, currency: string): string {
  const digits = currencyExponent(currency);
  if (digits === 0) return String(minor);
  const scale = 10 ** digits;
  const major = Math.floor(minor / scale);
  const fraction = minor % scale;
  if (fraction === 0) return String(major);
  return `${major}.${String(fraction).padStart(digits, "0").replace(/0+$/, "")}`;
}

const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-27" (or an ISO date-time) → "27. 11. 2026" (cs) / "27 Nov 2026" (en). */
export function formatDate(isoDate: string, locale: "cs" | "en"): string {
  const [y, m, d] = isoDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return locale === "cs" ? `${d}. ${m}. ${y}` : `${d} ${EN_MONTHS[m - 1]} ${y}`;
}

/** "2026-09-28T16:20:00…" → "28. 9. 2026 16:20" / "28 Sep 2026 16:20" (the time as written). */
export function formatDateTime(iso: string, locale: "cs" | "en"): string {
  const time = /T(\d{2}:\d{2})/.exec(iso)?.[1];
  const date = formatDate(iso, locale);
  return time ? `${date} ${time}` : date;
}
