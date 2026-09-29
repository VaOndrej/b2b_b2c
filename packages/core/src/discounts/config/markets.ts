import { CONFIG_LIMITS } from "./limits.ts";
import { isRecord, preview, pushIssue, sanitizeBool } from "./sanitize-helpers.ts";
import type { ConfigIssue, MarketSetting } from "./types.ts";

function sanitizeMarket(v: unknown, issues: ConfigIssue[], index: number): MarketSetting | null {
  if (!isRecord(v)) return null;
  const handle = typeof v.handle === "string" ? v.handle.slice(0, 100) : "";
  if (!handle) {
    pushIssue(issues, `markets[${index}].handle`, "missing_handle", "Market without a handle was dropped.");
    return null;
  }
  const currency = typeof v.currency === "string" ? v.currency.toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency)) {
    pushIssue(
      issues,
      `markets[${index}].currency`,
      "invalid_currency",
      `Invalid market currency ${preview(v.currency)}; market dropped.`,
      { market: handle, value: preview(v.currency) },
    );
    return null;
  }
  const market: MarketSetting = { handle, currency, enabled: sanitizeBool(v.enabled, true) };
  if (Array.isArray(v.countries)) market.countries = sanitizeCountries(v.countries, issues, `markets[${index}].countries`);
  return market;
}

const COUNTRY_RE = /^[A-Z]{2}$/;

/** ISO 3166-1 alpha-2, upper-cased, each once, capped like every reference list. */
function sanitizeCountries(v: unknown[], issues: ConfigIssue[], path: string): string[] {
  const out: string[] = [];
  const invalid: unknown[] = [];
  for (const raw of v) {
    const code = typeof raw === "string" ? raw.trim().toUpperCase() : "";
    if (!COUNTRY_RE.test(code)) {
      invalid.push(raw);
      continue;
    }
    if (!out.includes(code) && out.length < CONFIG_LIMITS.listItems) out.push(code);
  }
  if (invalid.length > 0) {
    pushIssue(
      issues,
      path,
      "invalid_country",
      `${invalid.length} value(s) are not two-letter country codes (${invalid.slice(0, 5).map((x) => preview(x, 20)).join(", ")}); they were dropped.`,
      { count: invalid.length, values: invalid.slice(0, 5).map((x) => preview(x, 20)).join(", ") },
    );
  }
  return out;
}

export function sanitizeMarkets(v: unknown, issues: ConfigIssue[]): MarketSetting[] {
  if (!Array.isArray(v)) return [];
  const out: MarketSetting[] = [];
  let overLimit = 0;
  v.forEach((item, i) => {
    if (out.length >= CONFIG_LIMITS.markets) {
      overLimit++;
      return;
    }
    const m = sanitizeMarket(item, issues, i);
    if (m) out.push(m);
  });
  if (overLimit > 0) {
    pushIssue(
      issues,
      "markets",
      "too_many_markets",
      `Only the first ${CONFIG_LIMITS.markets} markets are kept; ${overLimit} more were dropped.`,
      { max: CONFIG_LIMITS.markets, count: overLimit },
    );
  }
  return out;
}
