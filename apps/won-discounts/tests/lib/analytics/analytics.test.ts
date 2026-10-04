import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { sanitizeConfig } from "@won/core/discounts/config";

import { loadAnalytics, markOrderCancelled, pruneOrderFacts, recordOrderFact } from "../../../app/lib/analytics/analytics.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";

// MVP 7 contract M4: order facts stored once per order (WBH-2), cancelled orders out of every number, the sums of
// the last 30 days per shop (SEC-2), per-rule cost vs. revenue, retention 400 days.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("analytics");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `analytics-${seq}.myshopify.com`;
});

const NOW = new Date("2026-10-04T10:00:00Z");
const config = sanitizeConfig({
  modules: { codes: { rules: [{ id: "auto", name: "Podzim 10 %", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "order" } }] } },
}).config;

const order = (id: number, day: string, subtotal: string, off: [string, string][] = [], extra: Record<string, unknown> = {}) => ({
  id,
  created_at: `${day}T09:00:00Z`,
  currency: "CZK",
  subtotal_price: subtotal,
  discount_applications: off.map(([title]) => ({ type: "automatic", title })),
  line_items: [{ id: 1, variant_id: 101, quantity: 1, discount_allocations: off.map(([, amount], i) => ({ amount, discount_application_index: i })) }],
  ...extra,
});

test("orders are recorded once; the sums cover the last 30 days of this shop, cancelled orders left out", async () => {
  assert.deepEqual(await recordOrderFact(db.prisma, shop, order(1, "2026-10-03", "900.00", [["Podzim 10 %", "100.00"]]), config), { recorded: true });
  assert.deepEqual(await recordOrderFact(db.prisma, shop, order(1, "2026-10-03", "900.00", [["Podzim 10 %", "100.00"]]), config), { recorded: false }, "a redelivery");
  await recordOrderFact(db.prisma, shop, order(2, "2026-10-04", "500.00"), config);
  await recordOrderFact(db.prisma, shop, order(3, "2026-10-04", "450.00", [["Podzim 10 %", "50.00"], ["Od 3 ks −10 %", "20.00"]]), config);
  await recordOrderFact(db.prisma, shop, order(4, "2026-08-01", "9999.00", [["Podzim 10 %", "1.00"]]), config); // out of range
  await recordOrderFact(db.prisma, shop, order(5, "2026-10-02", "100.00", [["Podzim 10 %", "10.00"]]), config);
  assert.equal(await markOrderCancelled(db.prisma, shop, { id: 5 }, NOW), true);
  assert.equal(await markOrderCancelled(db.prisma, shop, { id: 5 }, NOW), false, "already cancelled");
  await recordOrderFact(db.prisma, `other-${shop}`, order(9, "2026-10-04", "7777.00", [["Podzim 10 %", "777.00"]]), config);
  assert.equal(await recordOrderFact(db.prisma, shop, { nope: true }, config), null);

  const a = await loadAnalytics(db.prisma, shop, { now: NOW });
  assert.deepEqual(
    { days: a.days, currency: a.currency, orders: a.orders, discountedOrders: a.discountedOrders, discountCost: a.discountCost, revenue: a.revenue, averageOrder: a.averageOrder, other: a.otherCurrencyOrders },
    { days: 30, currency: "CZK", orders: 3, discountedOrders: 2, discountCost: 17000, revenue: 185000, averageOrder: 61667, other: 0 },
  );
  assert.deepEqual(a.rules, [
    { key: "auto", kind: "rule", orders: 2, cost: 15000, revenue: 135000 },
    { key: "tiers", kind: "tier", orders: 1, cost: 2000, revenue: 45000 },
  ]);
  assert.equal(a.series.length, 30);
  assert.deepEqual(a.series.slice(-2), [
    { day: "2026-10-03", orders: 1, cost: 10000, revenue: 90000 },
    { day: "2026-10-04", orders: 2, cost: 7000, revenue: 95000 },
  ]);
  assert.equal(a.series[0]!.day, "2026-09-05");
});

test("no order: zeros and no currency; another currency's orders are counted apart", async () => {
  const empty = await loadAnalytics(db.prisma, shop, { now: NOW });
  assert.deepEqual({ currency: empty.currency, orders: empty.orders, averageOrder: empty.averageOrder, rules: empty.rules }, { currency: null, orders: 0, averageOrder: 0, rules: [] });
  await recordOrderFact(db.prisma, shop, order(1, "2026-10-01", "10.00", [], { currency: "USD" }), config);
  await recordOrderFact(db.prisma, shop, order(2, "2026-10-03", "500.00"), config);
  const a = await loadAnalytics(db.prisma, shop, { now: NOW });
  assert.deepEqual({ currency: a.currency, orders: a.orders, other: a.otherCurrencyOrders, revenue: a.revenue }, { currency: "CZK", orders: 1, other: 1, revenue: 50000 });
});

test("gifts and sale items add up; facts past 400 days are pruned", async () => {
  const gift = order(1, "2026-10-03", "900.00", [["Dárek zdarma", "100.00"]]);
  (gift.line_items[0] as Record<string, unknown>).properties = [{ name: "_won_gift", value: "g" }];
  await recordOrderFact(db.prisma, shop, gift, config, { outletVariantIds: new Set([101]) });
  const a = await loadAnalytics(db.prisma, shop, { now: NOW });
  assert.deepEqual({ gifts: a.gifts, outletItems: a.outletItems, rules: a.rules.map((r) => r.key) }, { gifts: 1, outletItems: 1, rules: ["gift"] });
  await recordOrderFact(db.prisma, shop, order(2, "2025-08-01", "1.00"), config);
  assert.equal(await pruneOrderFacts(db.prisma, NOW), 1);
  assert.equal(await db.prisma.orderDiscountFact.count({ where: { shop } }), 1);
});

test("BILL-1: a Free shop's screen never carries its own per-discount rows, gifts or sale items — a labelled example instead", async () => {
  const { analyticsScreenOf } = await import("../../../app/lib/integration/analytics-admin.server.ts");
  await recordOrderFact(db.prisma, shop, order(1, "2026-10-03", "900.00", [["Podzim 10 %", "100.00"]]), config);
  const summary = await loadAnalytics(db.prisma, shop, { now: NOW });
  const free = analyticsScreenOf(summary, { plan: "free", available: true, locale: "cs", config });
  assert.equal(free.sample, true);
  assert.equal(JSON.stringify(free.rules).includes("Podzim 10 %"), false);
  assert.deepEqual({ gifts: free.gifts, outlet: free.outletItems }, { gifts: 0, outlet: 0 });
  assert.equal(free.tiles.find((x) => x.id === "cost")!.value.replace(/\s/g, " "), "100 Kč", "the basic numbers are the shop's own on any plan");
  const pro = analyticsScreenOf(summary, { plan: "pro", available: true, locale: "cs", config });
  assert.equal(pro.sample, false);
  assert.deepEqual(pro.rules.map((r) => [r.name, r.orders, r.share]), [["Podzim 10 %", 1, 100]]);
});
