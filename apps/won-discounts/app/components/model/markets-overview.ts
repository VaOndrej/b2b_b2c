// "Trhy a měny" in Nastavení (audit 6 Oct 2026, N15, návrh 4): one row per Shopify market and what each part of
// the app offers there — the amount, or that it is missing, with the link to the field. Pure: the loader and the
// dev harness call it on the stored config; amounts are worded with the core formatter.

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";
import { formatMoney } from "@won/core/discounts/describe";
import { amountColumns, expandConfigAmounts } from "@won/core/discounts/market-amounts";
import { isMilestoneRule } from "@won/core/discounts/milestones";
import { gateConfigForPlan } from "@won/core/discounts/plan-gate";

import type { Locale } from "../../i18n";
import { missingCurrencies } from "./describe";
import { marketView, type MarketNames } from "./markets";

/** One cell: an amount, nothing set up, a missing amount (with where to add it) or set without an amount (percent). */
export type MarketCell =
  | { kind: "amount"; text: string }
  | { kind: "none" }
  | { kind: "ok" }
  | { kind: "percent" }
  | { kind: "missing"; href: string; count?: number };

export interface MarketRowView {
  handle: string;
  name: string;
  currency: string;
  /** Active in Shopify. A switched-off market keeps its amounts; nothing is asked for it. */
  enabled: boolean;
  shipping: MarketCell;
  gift: MarketCell;
  discounts: MarketCell;
  tiers: MarketCell;
  /** How many of the four cells miss something (0 for a switched-off market). */
  missing: number;
}

function discountsCell(rules: readonly DiscountRule[], currency: string): MarketCell {
  // Only rules that ask for an amount per currency (a fixed value, a minimum spend): a percent needs none.
  const asking = rules.filter((r) => r.enabled && (r.value.kind === "fixed" || Object.keys(r.minimum?.subtotal ?? {}).length > 0));
  if (asking.length === 0) return { kind: "none" };
  const without = asking.filter((r) => missingCurrencies(r, [currency]).length > 0);
  if (without.length === 0) return { kind: "ok" };
  // A discount that is a step of Milníky is fixed in that page's amounts table.
  if (without.every(isMilestoneRule)) return { kind: "missing", href: "/app/rewards#amounts", count: without.length };
  return { kind: "missing", href: without.length === 1 ? `/app/discounts/${encodeURIComponent(without[0]!.id)}#value` : "/app/discounts", count: without.length };
}

export function marketRows(stored: WonDiscountsConfig, opts: { plan: "free" | "pro"; names?: MarketNames; locale: Locale }): MarketRowView[] {
  // 7 Oct 2026: every market has its own amount. In the admin's columns (core market-amounts.ts) a market's
  // amount is under its own key — "EUR@sk" where two enabled markets share the currency, else the currency.
  const config = expandConfigAmounts(stored);
  const keys = new Map(amountColumns(config.markets).map((column) => [column.handle, column.key]));
  const gated = gateConfigForPlan(config, opts.plan).config;
  const { freeShipping, gifts } = gated.modules.rewards;
  const sets = gated.modules.tiers.sets.filter((s) => s.breaks.length > 0);
  const amountBreaks = sets.flatMap((s) => s.breaks.flatMap((b) => (b.amountOff ? [b.amountOff] : [])));
  const rows = config.markets.map((market): MarketRowView => {
    // A switched-off market has no column: what is stored for its currency is what it would get.
    const c = keys.get(market.handle) ?? market.currency;
    const money = (minor: number) => formatMoney(minor, c, opts.locale);
    const shipping: MarketCell = !freeShipping
      ? { kind: "none" }
      : typeof freeShipping.threshold[c] === "number"
        ? { kind: "amount", text: money(freeShipping.threshold[c]!) }
        : { kind: "missing", href: "/app/rewards#amounts" };
    const gift: MarketCell =
      gifts.length === 0
        ? { kind: "none" }
        : gifts.every((g) => typeof g.threshold[c] === "number")
          ? { kind: "amount", text: gifts.map((g) => money(g.threshold[c]!)).join(" / ") }
          : { kind: "missing", href: "/app/rewards#amounts" };
    const tiers: MarketCell =
      sets.length === 0
        ? { kind: "none" }
        : amountBreaks.length === 0
          ? { kind: "percent" }
          : amountBreaks.every((amount) => typeof amount[c] === "number")
            ? { kind: "ok" }
            : { kind: "missing", href: "/app/tiers#global" };
    const cells = { shipping, gift, discounts: discountsCell(config.modules.codes.rules, c), tiers };
    return {
      handle: market.handle,
      name: marketView(market.handle, opts.names).name,
      currency: market.currency,
      enabled: market.enabled,
      ...cells,
      missing: market.enabled ? Object.values(cells).filter((cell) => cell.kind === "missing").length : 0,
    };
  });
  // Enabled markets first; the switched-off ones under them.
  return [...rows.filter((r) => r.enabled), ...rows.filter((r) => !r.enabled)];
}
