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
    );
    return null;
  }
  return { handle, currency, enabled: sanitizeBool(v.enabled, true) };
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
    );
  }
  return out;
}
