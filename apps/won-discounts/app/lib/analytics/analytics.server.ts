// Analytics (MVP 7, contract M4; spec §8): the order facts (order-facts.ts) stored and summed up.
//   recordOrderFact(db, shop, payload, config)  orders/create → one OrderDiscountFact (idempotent per order: a
//                                               redelivery writes nothing, WBH-2); null = not an order;
//   markOrderCancelled(db, shop, payload)       orders/cancelled → the fact leaves every number;
//   loadAnalytics(db, shop, opts)               the last `days` days: Free numbers (orders, orders with a discount,
//                                               what the discounts cost, the average order), a day-by-day series
//                                               and — Pro — cost vs. revenue per rule, gifts given, sale items sold.
// No number claims the app "earned" anything (§12, EXP-1): cost is what the discounts took off, revenue is the
// subtotal of the orders a rule took part in. Amounts are minor units of the shop currency; facts in another
// currency (the shop changed its currency) are counted apart and left out of the sums.
// The session shop only (SEC-2); no personal data is stored (PRIV-1).

import type { ReadonlyDeep, WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import { loadConfig } from "../config.server";
import { orderFactFromWebhook, type OrderFactKind, type OrderFactPart } from "./order-facts";

/** Postgres INTEGER (the production database) holds this much; a larger amount is stored as this. */
const MAX_INT = 2_000_000_000;
const clamp = (n: number) => Math.max(0, Math.min(MAX_INT, Math.round(n)));

export const ANALYTICS_DAYS = 30;
/** Facts are kept this long (scheduler history.prune). */
export const ANALYTICS_RETENTION_DAYS = 400;

export async function recordOrderFact(
  db: PrismaClient,
  shop: string,
  payload: unknown,
  config: ReadonlyDeep<Pick<WonDiscountsConfig, "modules">>,
  opts: { outletVariantIds?: ReadonlySet<number> } = {},
): Promise<{ recorded: boolean } | null> {
  const fact = orderFactFromWebhook(payload, config, opts);
  if (!fact) return null;
  const existing = await db.orderDiscountFact.findUnique({ where: { shop_orderId: { shop, orderId: fact.orderId } }, select: { id: true } });
  if (existing) return { recorded: false };
  try {
    await db.orderDiscountFact.create({
      data: {
        shop,
        orderId: fact.orderId,
        createdAt: fact.createdAt,
        currency: fact.currency,
        subtotalMinor: clamp(fact.subtotalMinor),
        discountMinor: clamp(fact.discountMinor),
        parts: JSON.stringify(fact.parts.map((p) => ({ ...p, amountMinor: clamp(p.amountMinor) }))),
        gifts: fact.gifts,
        outletItems: fact.outletItems,
      },
    });
    return { recorded: true };
  } catch (error) {
    // Two deliveries at once: the unique (shop, orderId) lets one through.
    if ((error as { code?: string } | null)?.code === "P2002") return { recorded: false };
    throw error;
  }
}

export async function markOrderCancelled(db: PrismaClient, shop: string, payload: unknown, now: Date = new Date()): Promise<boolean> {
  const id = (payload as { id?: unknown } | null)?.id;
  if (typeof id !== "number" && typeof id !== "string") return false;
  const { count } = await db.orderDiscountFact.updateMany({ where: { shop, orderId: String(id), cancelledAt: null }, data: { cancelledAt: now } });
  return count > 0;
}

/**
 * The order webhook's analytics side (the route feeds the sale ledger too): `orders/create` records the fact with
 * the shop's stored config (rule names) and the variants on sale right now; `orders/cancelled` takes it out of the
 * numbers; any other topic is ignored.
 */
export async function recordOrderWebhook(db: PrismaClient, shop: string, topic: string, payload: unknown): Promise<"recorded" | "cancelled" | "ignored"> {
  const name = topic.toLowerCase().replace(/_/g, "/");
  if (name === "orders/cancelled") return (await markOrderCancelled(db, shop, payload)) ? "cancelled" : "ignored";
  if (name !== "orders/create") return "ignored";
  const [{ config }, runs] = await Promise.all([loadConfig(db, shop), db.outletRun.findMany({ where: { shop, status: { in: ["active", "ending"] } }, select: { variantId: true } })]);
  const outletVariantIds = new Set(runs.map((r) => Number(r.variantId.slice(r.variantId.lastIndexOf("/") + 1))).filter(Number.isFinite));
  return (await recordOrderFact(db, shop, payload, config, { outletVariantIds }))?.recorded ? "recorded" : "ignored";
}

/** Facts older than the retention (history.prune). */
export async function pruneOrderFacts(db: PrismaClient, now: Date): Promise<number> {
  const { count } = await db.orderDiscountFact.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - ANALYTICS_RETENTION_DAYS * 86_400_000) } } });
  return count;
}

export interface AnalyticsRuleRow {
  key: string;
  kind: OrderFactKind;
  /** Orders the discount took part in. */
  orders: number;
  /** What it took off those orders. */
  cost: number;
  /** The subtotal of those orders. */
  revenue: number;
}

export interface AnalyticsSummary {
  days: number;
  /** The currency of the sums; null = no order yet. */
  currency: string | null;
  /** Orders in another currency (left out of the sums). */
  otherCurrencyOrders: number;
  orders: number;
  discountedOrders: number;
  discountCost: number;
  revenue: number;
  /** revenue / orders, rounded; 0 without an order. */
  averageOrder: number;
  /** One entry per day of the range (UTC days), oldest first. */
  series: { day: string; orders: number; cost: number; revenue: number }[];
  /** Pro: per discount, the costliest first. */
  rules: AnalyticsRuleRow[];
  gifts: number;
  outletItems: number;
}

function parseParts(text: string): OrderFactPart[] {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((p): p is OrderFactPart => typeof p === "object" && p !== null && typeof (p as OrderFactPart).key === "string" && typeof (p as OrderFactPart).amountMinor === "number") : [];
  } catch {
    return [];
  }
}

/** The shop's numbers over the last `days` days up to `now` (cancelled orders left out). */
export async function loadAnalytics(db: PrismaClient, shop: string, opts: { now?: Date; days?: number } = {}): Promise<AnalyticsSummary> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? ANALYTICS_DAYS;
  const dayOf = (d: Date) => d.toISOString().slice(0, 10);
  const today = Date.parse(`${dayOf(now)}T00:00:00Z`);
  const since = new Date(today - (days - 1) * 86_400_000);
  const facts = await db.orderDiscountFact.findMany({
    where: { shop, cancelledAt: null, createdAt: { gte: since, lte: now } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true, currency: true, subtotalMinor: true, discountMinor: true, parts: true, gifts: true, outletItems: true },
  });
  const currency = facts.length > 0 ? facts[facts.length - 1]!.currency : null;
  const mine = facts.filter((f) => f.currency === currency);
  const series = new Map<string, { day: string; orders: number; cost: number; revenue: number }>();
  for (let i = 0; i < days; i += 1) {
    const day = dayOf(new Date(since.getTime() + i * 86_400_000));
    series.set(day, { day, orders: 0, cost: 0, revenue: 0 });
  }
  const rules = new Map<string, AnalyticsRuleRow>();
  let discountedOrders = 0;
  let discountCost = 0;
  let revenue = 0;
  let gifts = 0;
  let outletItems = 0;
  for (const fact of mine) {
    revenue += fact.subtotalMinor;
    discountCost += fact.discountMinor;
    if (fact.discountMinor > 0) discountedOrders += 1;
    gifts += fact.gifts;
    outletItems += fact.outletItems;
    const bucket = series.get(dayOf(fact.createdAt));
    if (bucket) {
      bucket.orders += 1;
      bucket.cost += fact.discountMinor;
      bucket.revenue += fact.subtotalMinor;
    }
    for (const part of parseParts(fact.parts)) {
      const row = rules.get(part.key) ?? { key: part.key, kind: part.kind, orders: 0, cost: 0, revenue: 0 };
      row.orders += 1;
      row.cost += part.amountMinor;
      row.revenue += fact.subtotalMinor;
      rules.set(part.key, row);
    }
  }
  return {
    days,
    currency,
    otherCurrencyOrders: facts.length - mine.length,
    orders: mine.length,
    discountedOrders,
    discountCost,
    revenue,
    averageOrder: mine.length > 0 ? Math.round(revenue / mine.length) : 0,
    series: [...series.values()],
    rules: [...rules.values()].sort((a, b) => b.cost - a.cost || (a.key < b.key ? -1 : 1)),
    gifts,
    outletItems,
  };
}
