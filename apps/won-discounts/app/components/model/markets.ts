// Which currencies the admin asks for (MKT-1: a value per market currency, never
// converted). Source order: the shop's enabled Won markets; with none configured
// yet, the shop currency; with that unknown too, whatever currencies the rules
// already carry — so an editor never silently drops a stored amount.

import type { DiscountRule, MarketSetting } from "@won/core/discounts/config";

import type { CurrencyView } from "./types";

export function currencyViews(
  markets: readonly MarketSetting[],
  opts: { shopCurrency?: string | null; rules?: readonly DiscountRule[] } = {},
): CurrencyView[] {
  const byCode = new Map<string, string[]>();
  for (const market of markets) {
    if (!market.enabled) continue;
    const list = byCode.get(market.currency) ?? [];
    list.push(market.handle);
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
  return [...byCode].map(([code, handles]) => ({ code, markets: handles }));
}

export function currencyCodes(views: readonly CurrencyView[]): string[] {
  return views.map((v) => v.code);
}

/** Enabled Won market handles (Pro market targeting). */
export function marketHandles(markets: readonly MarketSetting[]): string[] {
  return markets.filter((m) => m.enabled).map((m) => m.handle);
}
