// Which currencies the admin asks for (MKT-1: a value per market currency, never
// converted). Source order: the shop's enabled Won markets; with none configured
// yet, the shop currency; with that unknown too, whatever currencies the rules
// already carry — so an editor never silently drops a stored amount.
//
// Markets are shown by their Shopify NAME (§4c: a handle is a machine value);
// the loader reads the names (read_markets) and the handle is only the fallback
// when that read fails.

import type { DiscountRule, MarketSetting } from "@won/core/discounts/config";

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
  const byCode = new Map<string, MarketView[]>();
  for (const market of markets) {
    if (!market.enabled) continue;
    const list = byCode.get(market.currency) ?? [];
    list.push(marketView(market.handle, opts.marketNames));
    byCode.set(market.currency, list);
  }
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

export function currencyCodes(views: readonly CurrencyView[]): string[] {
  return views.map((v) => v.code);
}

/** Enabled Won markets (Pro market targeting), by name. */
export function marketViews(markets: readonly MarketSetting[], names: MarketNames = {}): MarketView[] {
  return markets.filter((m) => m.enabled).map((m) => marketView(m.handle, names));
}

/** "CZK · Česko, Slovensko" — a currency with the markets that sell in it. */
export function currencyLabel(view: CurrencyView): string {
  return view.markets.length > 0 ? `${view.code} · ${view.markets.map((m) => m.name).join(", ")}` : view.code;
}
