import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig } from "@won/core/discounts/config";

import { orderFactFromWebhook } from "../../../app/lib/analytics/order-facts.ts";

// MVP 7 contract M4 (P2): one orders/create payload → one OrderDiscountFact. Amounts in the SHOP currency, minor
// units; each discount of the order is put on a Won rule by its title (the function's candidate message is the
// rule's name; a code discount by its code), a quantity tier by its text, a gift by "Dárek zdarma" / "Free gift";
// anything else is "other". No name, e-mail, address or customer id is ever read (PRIV-1).
// The payload shape follows Shopify's Order webhook (REST Order resource: discount_applications, line_items[].
// discount_allocations[].discount_application_index, shipping_lines[].discount_allocations).

const config = sanitizeConfig({
  modules: {
    codes: {
      rules: [
        { id: "auto", name: "Podzim 10 %", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "products", productIds: [], variantIds: [] } },
        { id: "vip", name: "VIP", method: "code", codes: ["VIP20"], value: { kind: "percentage", percent: 20 }, target: { kind: "order" } },
        { id: "ship", name: "Doprava zdarma nad 1000", method: "automatic", value: { kind: "freeShipping" }, target: { kind: "shipping" } },
      ],
    },
  },
}).config;

const order = (extra: Record<string, unknown> = {}) => ({
  id: 5001,
  admin_graphql_api_id: "gid://shopify/Order/5001",
  created_at: "2026-10-04T08:30:00+02:00",
  currency: "CZK",
  presentment_currency: "EUR",
  subtotal_price: "1530.00",
  total_discounts: "470.00",
  email: "jana@example.com",
  customer: { id: 77, first_name: "Jana" },
  shipping_address: { address1: "Dlouhá 1" },
  discount_applications: [
    { type: "automatic", title: "Podzim 10 %", value: "10.0", value_type: "percentage", target_type: "line_item" },
    { type: "discount_code", code: "vip20", title: "VIP", value: "20.0", value_type: "percentage", target_type: "line_item" },
    { type: "automatic", title: "Od 3 ks −15 %", value_type: "percentage", target_type: "line_item" },
    { type: "automatic", title: "Dárek zdarma", value_type: "percentage", target_type: "line_item" },
    { type: "automatic", title: "Doprava zdarma nad 1000", value_type: "percentage", target_type: "shipping_line" },
    { type: "automatic", title: "Sleva z jiné appky", value_type: "fixed_amount", target_type: "line_item" },
  ],
  line_items: [
    { id: 1, variant_id: 101, quantity: 2, price: "500.00", properties: [], discount_allocations: [{ amount: "100.00", discount_application_index: 0 }, { amount: "170.00", discount_application_index: 1 }] },
    { id: 2, variant_id: 102, quantity: 3, price: "200.00", properties: [], discount_allocations: [{ amount: "90.00", discount_application_index: 2 }, { amount: "10.00", discount_application_index: 5 }] },
    { id: 3, variant_id: 103, quantity: 1, price: "100.00", properties: [{ name: "_won_gift", value: "gift-1" }], discount_allocations: [{ amount: "100.00", discount_application_index: 3 }] },
  ],
  shipping_lines: [{ price: "99.00", discount_allocations: [{ amount: "99.00", discount_application_index: 4 }] }],
  ...extra,
});

test("an order becomes a fact: totals in the shop currency, each discount on its rule, tier, gift, shipping or other", () => {
  const fact = orderFactFromWebhook(order(), config, { outletVariantIds: new Set([102]) });
  assert.ok(fact);
  assert.deepEqual(
    { ...fact, createdAt: fact.createdAt.toISOString() },
    {
      orderId: "5001",
      createdAt: "2026-10-04T06:30:00.000Z",
      currency: "CZK",
      subtotalMinor: 153000,
      discountMinor: 56900,
      parts: [
        { key: "auto", kind: "rule", amountMinor: 10000 },
        { key: "vip", kind: "rule", amountMinor: 17000 },
        { key: "tiers", kind: "tier", amountMinor: 9000 },
        { key: "gift", kind: "gift", amountMinor: 10000 },
        { key: "ship", kind: "shipping", amountMinor: 9900 },
        { key: "other", kind: "other", amountMinor: 1000 },
      ],
      gifts: 1,
      outletItems: 3,
    },
  );
});

test("PRIV-1: the fact carries nothing of the customer", () => {
  const text = JSON.stringify(orderFactFromWebhook(order(), config));
  for (const secret of ["jana", "Jana", "Dlouhá", "77", "email", "customer", "address"]) assert.equal(text.includes(secret), false, secret);
});

test("several discounts of one rule add up; a discount with no allocation is left out; an order without discounts is a fact with no parts", () => {
  const twice = orderFactFromWebhook(
    order({
      discount_applications: [{ type: "automatic", title: "Podzim 10 %" }, { type: "automatic", title: "Podzim 10 %" }, { type: "automatic", title: "VIP" }],
      line_items: [{ id: 1, variant_id: 101, quantity: 1, price: "500.00", discount_allocations: [{ amount: "10.00", discount_application_index: 0 }, { amount: "5.50", discount_application_index: 1 }] }],
      shipping_lines: [],
    }),
    config,
  )!;
  assert.deepEqual(twice.parts, [{ key: "auto", kind: "rule", amountMinor: 1550 }]);
  assert.equal(twice.discountMinor, 1550);
  const none = orderFactFromWebhook(order({ discount_applications: [], line_items: [{ id: 1, variant_id: 101, quantity: 1, price: "500.00", discount_allocations: [] }], shipping_lines: [] }), config)!;
  assert.deepEqual({ parts: none.parts, discountMinor: none.discountMinor, gifts: none.gifts, outletItems: none.outletItems }, { parts: [], discountMinor: 0, gifts: 0, outletItems: 0 });
});

test("English tier and gift texts, a capped tier, a code matched in any case and padding, a rule that was renamed (other)", () => {
  const fact = orderFactFromWebhook(
    order({
      discount_applications: [
        { type: "automatic", title: "From 3 items −15%" },
        { type: "automatic", title: "Množstevní sleva od 5 ks" },
        { type: "automatic", title: "Free gift" },
        { type: "discount_code", code: " Vip20 ", title: "Something" },
        { type: "automatic", title: "Podzim 12 %" },
      ],
      line_items: [{ id: 1, variant_id: 101, quantity: 1, price: "500.00", discount_allocations: [0, 1, 2, 3, 4].map((i) => ({ amount: "1.00", discount_application_index: i })) }],
      shipping_lines: [],
    }),
    config,
  )!;
  assert.deepEqual(fact.parts, [
    { key: "tiers", kind: "tier", amountMinor: 200 },
    { key: "gift", kind: "gift", amountMinor: 100 },
    { key: "vip", kind: "rule", amountMinor: 100 },
    { key: "other", kind: "other", amountMinor: 100 },
  ]);
});

test("junk never throws: not an order → null; junk amounts and indexes are skipped", () => {
  for (const junk of [null, 7, "x", {}, { id: 1 }, { id: 1, created_at: "nope", currency: "CZK" }]) assert.equal(orderFactFromWebhook(junk, config), null, JSON.stringify(junk));
  const fact = orderFactFromWebhook(
    order({
      subtotal_price: "abc",
      line_items: [{ id: 1, quantity: "x", discount_allocations: [{ amount: "zz", discount_application_index: 0 }, { amount: "5.00", discount_application_index: 99 }, "junk"] }, "junk"],
      shipping_lines: "junk",
    }),
    config,
  )!;
  assert.deepEqual({ subtotalMinor: fact.subtotalMinor, parts: fact.parts, discountMinor: fact.discountMinor }, { subtotalMinor: 0, parts: [], discountMinor: 0 });
});
