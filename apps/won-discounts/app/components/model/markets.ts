// Which currencies the admin asks for (MKT-1: a value per market currency, never
// converted). Source order: the shop's enabled Won markets; with none configured
// yet, the shop currency; with that unknown too, whatever currencies the rules
// already carry — so an editor never silently drops a stored amount.
//
// Markets are shown by their Shopify NAME (§4c: a handle is a machine value);
// the loader reads the names (read_markets) and the handle is only the fallback
// when that read fails.

import type { DiscountRule, MarketSetting } from "@won/core/discounts/config";
import { amountColumns } from "@won/core/discounts/market-amounts";
import { amountKeyCurrency, splitAmountKey } from "@won/core/discounts/money";

import type { CurrencyView, MarketView } from "./types";

export type MarketNames = Readonly<Record<string, string>>;

export function marketView(handle: string, names: MarketNames = {}): MarketView {
  const name = names[handle];
  return { handle, name: typeof name === "string" && name.trim() ? name : handle };
}

export function currencyViews(
  markets: readonly MarketSetting[],
  opts: { shopCurrency?: string | null; rules?: readonly DiscountRule[]; marketNames?: MarketNames } = {},
): CurrencyView[] {
  // 7 Oct 2026: one amount per MARKET. A currency one enabled market sells in keeps its plain key ("CZK"); a
  // shared one gets a key per market ("EUR@sk") — core market-amounts.ts amountColumns.
  const byCode = new Map<string, MarketView[]>();
  for (const column of amountColumns(markets)) byCode.set(column.key, [marketView(column.handle, opts.marketNames)]);
  if (byCode.size === 0 && opts.shopCurrency && /^[A-Z]{3}$/.test(opts.shopCurrency)) {
    byCode.set(opts.shopCurrency, []);
  }
  if (byCode.size === 0) {
    for (const rule of opts.rules ?? []) {
      const amount = rule.value.kind === "fixed" ? rule.value.amount : {};
      for (const code of [...Object.keys(amount), ...Object.keys(rule.minimum?.subtotal ?? {})]) {
        if (!byCode.has(code)) byCode.set(code, []);
      }
    }
  }
  return [...byCode].map(([code, list]) => ({ code, markets: list }));
}

/** Currencies of the enabled markets, each once; none configured → the shop currency (the same source order as currencyViews). */
export function enabledCurrencies(markets: readonly Pick<MarketSetting, "handle" | "currency" | "enabled">[], shopCurrency?: string | null): string[] {
  // The amount keys the enabled markets ask for: one per market (see currencyViews).
  const codes = amountColumns(markets).map((c) => c.key);
  return codes.length > 0 ? codes : shopCurrency && /^[A-Z]{3}$/.test(shopCurrency) ? [shopCurrency] : [];
}

/** The currencies (of `currencies`) that some of the amounts lacks (MKT-1: no amount = not offered in that market). */
export function currenciesWithoutAmount(amounts: readonly Readonly<Record<string, number>>[], currencies: readonly string[]): string[] {
  return currencies.filter((code) => amounts.some((amount) => typeof amount[code] !== "number"));
}

/** "Slovensko" for EUR — the markets that sell in a currency, by name; the code when no market is known for it. */
export function currencyMarketNames(code: string, views: readonly CurrencyView[]): string {
  const names = views.find((v) => v.code === code)?.markets.map((m) => m.name).filter(Boolean) ?? [];
  return names.length > 0 ? names.join(", ") : code;
}

// --- An amount suggested for another market (audit 6 Oct 2026, návrh 2) ----------------------------------------
// Only from the exchange rate the merchant set BY HAND for the market in Shopify (CurrencySetting.manualRate): the
// Admin API does not give Shopify's automatic rate. Nothing is ever filled in or saved without a click (MKT-1: no
// silent conversion); a market without a manual rate says so and asks for the amount.

export interface AmountSuggestView {
  /** The shop currency: the amount the merchant types first. */
  base: string;
  /** Manual rates from the shop currency, by target currency (1 base = rate target). Only markets that have one. */
  rates: Record<string, number>;
  /** The same by market handle: a market's own rate wins over its currency's (two markets of a currency may differ). */
  marketRates?: Record<string, number>;
}

/** A round number a merchant would type: 59,76 € → 60 €, 1 494 Kč → 1 490 Kč. */
function roundNice(major: number): number {
  const step = major < 10 ? 0.5 : major < 50 ? 1 : major < 200 ? 5 : major < 1000 ? 10 : major < 5000 ? 50 : 100;
  return Math.max(step, Math.round(major / step) * step);
}

/** The suggested amount in `target` (major units) for `baseMajor` of the shop currency; null without a usable rate. */
export function suggestedAmount(baseMajor: number, rate: number | undefined, exponent: number): number | null {
  if (!Number.isFinite(baseMajor) || baseMajor <= 0 || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) return null;
  const nice = roundNice(baseMajor * rate);
  return exponent === 0 ? Math.max(1, Math.round(nice)) : nice;
}

/** Names of the amount keys' markets ("EUR@sk" → "Slovensko") for the core's texts: from the columns the page shows… */
export function amountLabels(views: readonly CurrencyView[]): Record<string, string> {
  return Object.fromEntries(views.filter((v) => v.markets.length > 0).map((v) => [v.code, v.markets.map((m) => m.name).join(", ")]));
}

/** …or from the markets' names by handle, for a list of amount keys. */
export function amountLabelsOf(keys: readonly string[], names: MarketNames = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const market = splitAmountKey(key)?.market;
    if (market && names[market]) out[key] = names[market]!;
  }
  return out;
}

export function currencyCodes(views: readonly CurrencyView[]): string[] {
  return views.map((v) => v.code);
}

/** Enabled Won markets (Pro market targeting), by name. */
export function marketViews(markets: readonly MarketSetting[], names: MarketNames = {}): MarketView[] {
  return markets.filter((m) => m.enabled).map((m) => marketView(m.handle, names));
}

/** "CZK · Česko" — a market's amount key as its currency with the market's name. */
export function currencyLabel(view: CurrencyView): string {
  const code = amountKeyCurrency(view.code);
  return view.markets.length > 0 ? `${code} · ${view.markets.map((m) => m.name).join(", ")}` : code;
}
