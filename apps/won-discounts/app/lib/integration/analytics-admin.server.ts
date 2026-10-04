// Přehledy (MVP 7, contract M4) — the reports screen's server side: the shop's order facts of the last 30 days
// (app/lib/analytics/analytics.server.ts) worded for the screen. Free sees the basic numbers; the per-discount
// table is Pro (BILL-1: a Free shop gets a labelled EXAMPLE in the locked frame, never its own rows). Without
// access to orders (Shopify's protected customer data approval) the screen says so and shows nothing made up.
// The session shop only (SEC-2).

import type { ReadonlyDeep, WonDiscountsConfig } from "@won/core/discounts/config";
import { formatMoney } from "@won/core/discounts/describe";

import type { AnalyticsDay, AnalyticsOverviewView, AnalyticsRuleRowView, AnalyticsScreenData, AnalyticsTile } from "../../components/model/analytics";
import { t, type Locale } from "../../i18n";
import { ANALYTICS_DAYS, loadAnalytics, type AnalyticsSummary } from "../analytics/analytics.server";
import { loadConfig } from "../config.server";
import { nowOf, type ShopCtx } from "./context.server";
import { ordersAccess } from "./orders-access.server";
import { ctxPlan } from "./sync-status.server";

function tilesOf(a: AnalyticsSummary, locale: Locale): AnalyticsTile[] {
  const money = (minor: number) => (a.currency ? formatMoney(minor, a.currency, locale) : "0");
  return [
    { id: "orders", value: String(a.orders) },
    { id: "discounted", value: String(a.discountedOrders) },
    { id: "cost", value: money(a.discountCost) },
    { id: "average", value: money(a.averageOrder) },
  ];
}

function ruleName(key: string, config: ReadonlyDeep<WonDiscountsConfig>, locale: Locale): string {
  if (key === "tiers") return t(locale, "analytics.row.tiers");
  if (key === "gift") return t(locale, "analytics.row.gift");
  if (key === "other") return t(locale, "analytics.row.other");
  const rule = config.modules.codes.rules.find((r) => r.id === key);
  return rule ? rule.name || t(locale, "analytics.row.unnamed") : t(locale, "analytics.row.deleted");
}

/** The screen's data from a summary (pure: the dev harness renders the same). */
export function analyticsScreenOf(
  a: AnalyticsSummary,
  opts: { plan: "free" | "pro"; available: boolean; locale: Locale; config: ReadonlyDeep<WonDiscountsConfig> },
): AnalyticsScreenData {
  const { locale } = opts;
  const money = (minor: number) => (a.currency ? formatMoney(minor, a.currency, locale) : "0");
  const top = Math.max(1, ...a.series.map((d) => d.cost));
  const series: AnalyticsDay[] = a.series.map((d) => {
    const label = `${Number(d.day.slice(8, 10))}. ${Number(d.day.slice(5, 7))}.`;
    return { label, height: Math.round((100 * d.cost) / top), title: t(locale, "analytics.day.title", { day: label, cost: money(d.cost), orders: d.orders }) };
  });
  const topRule = Math.max(1, ...a.rules.map((r) => r.cost));
  const own: AnalyticsRuleRowView[] = a.rules.map((r) => ({
    key: r.key,
    name: ruleName(r.key, opts.config, locale),
    orders: r.orders,
    cost: money(r.cost),
    revenue: money(r.revenue),
    share: Math.round((100 * r.cost) / topRule),
  }));
  // BILL-1: a Free shop never gets its own per-discount rows — a labelled example fills the locked frame.
  const sample = opts.plan !== "pro" || own.length === 0;
  const example: AnalyticsRuleRowView[] = [
    { key: "example-1", name: t(locale, "analytics.sample.first"), orders: 42, cost: formatMoney(1260000, "CZK", locale), revenue: formatMoney(11340000, "CZK", locale), share: 100 },
    { key: "example-2", name: t(locale, "analytics.row.tiers"), orders: 17, cost: formatMoney(510000, "CZK", locale), revenue: formatMoney(6120000, "CZK", locale), share: 40 },
  ];
  return {
    plan: opts.plan,
    available: opts.available,
    days: a.days,
    empty: a.orders === 0,
    tiles: tilesOf(a, locale),
    series,
    otherCurrencyOrders: a.otherCurrencyOrders,
    rules: sample ? example : own,
    gifts: opts.plan === "pro" ? a.gifts : 0,
    outletItems: opts.plan === "pro" ? a.outletItems : 0,
    sample,
  };
}

export async function loadAnalyticsScreen(ctx: ShopCtx): Promise<AnalyticsScreenData> {
  const [summary, plan, available, loaded] = await Promise.all([
    loadAnalytics(ctx.db, ctx.shop, { now: nowOf(ctx), days: ANALYTICS_DAYS }),
    ctxPlan(ctx),
    ordersAccess(ctx).catch(() => false),
    loadConfig(ctx.db, ctx.shop),
  ]);
  return analyticsScreenOf(summary, { plan, available, locale: ctx.locale, config: loaded.config });
}

/** The Přehled card: the basic numbers (any plan). */
export async function loadAnalyticsOverview(ctx: ShopCtx): Promise<AnalyticsOverviewView> {
  const [summary, available] = await Promise.all([loadAnalytics(ctx.db, ctx.shop, { now: nowOf(ctx), days: ANALYTICS_DAYS }), ordersAccess(ctx).catch(() => false)]);
  return { available, empty: summary.orders === 0, days: summary.days, tiles: tilesOf(summary, ctx.locale).filter((tile) => tile.id !== "orders") };
}
