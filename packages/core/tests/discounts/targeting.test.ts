// productRuleIndex: what the sync layer writes into product metafields so the
// function never needs collection slots in its input query.

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRuleRef, productRuleIndex, ruleRef } from "../../src/discounts/targeting.ts";
import { configOf, orderPct, pct } from "./engine-fixtures.ts";

const P = (n: number) => `gid://shopify/Product/${n}`;
const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;

const PRODUCTS = [
  { productId: P(1), variantIds: [V(11), V(12)], collectionIds: [C(100)] },
  { productId: P(2), variantIds: [V(21)], collectionIds: [C(100), C(200)] },
  { productId: P(3), variantIds: [V(31), V(32)], collectionIds: [] },
];

test("rule refs round-trip: plain, variant-scoped, campaign-scoped", () => {
  assert.equal(ruleRef("A"), "A");
  assert.equal(ruleRef("A", { variantId: V(42) }), "A:42");
  assert.equal(ruleRef("A", { campaignId: "bf" }), "A@bf");
  assert.equal(ruleRef("A", { campaignId: "bf", variantId: V(42) }), "A@bf:42");
  assert.deepEqual(parseRuleRef("A@bf:42"), { ruleId: "A", campaignId: "bf", variant: "42" });
  assert.deepEqual(parseRuleRef("A"), { ruleId: "A" });
});

test("collection and product targets map to product ids; order/shipping rules never appear", () => {
  const config = configOf([
    pct("coll", 10, { target: { kind: "collections", ids: [C(100)] } }),
    pct("prod", 10, { target: { kind: "products", productIds: [P(3)], variantIds: [] } }),
    orderPct("order", 10),
  ]);
  const index = productRuleIndex(config, PRODUCTS);
  assert.deepEqual(Object.fromEntries(index), {
    [P(1)]: ["coll"],
    [P(2)]: ["coll"],
    [P(3)]: ["prod"],
  });
});

test("a variant target is scoped to the variant; all variants listed collapse to the product", () => {
  const config = configOf([
    pct("one", 10, { target: { kind: "products", productIds: [], variantIds: [V(12)] } }),
    pct("all", 10, { target: { kind: "products", productIds: [], variantIds: [V(31), V(32)] } }),
  ]);
  const index = productRuleIndex(config, PRODUCTS);
  assert.deepEqual(index.get(P(1)), ["one:12"]);
  assert.deepEqual(index.get(P(3)), ["all"]);
  assert.deepEqual(index.get(P(2)), []);
});

test("every product gets an entry (possibly empty) and entries are sorted and unique", () => {
  const config = configOf([
    pct("b", 10, { target: { kind: "collections", ids: [C(100), C(200)] } }),
    pct("a", 10, { target: { kind: "products", productIds: [P(2)], variantIds: [V(21)] } }),
  ]);
  const index = productRuleIndex(config, PRODUCTS);
  assert.deepEqual(index.get(P(2)), ["a", "b"]);
  assert.equal(index.size, 3);
});

test("disabled rules are indexed too, so enabling one needs no product metafield rewrite", () => {
  const config = configOf([pct("off", 10, { enabled: false, target: { kind: "collections", ids: [C(200)] } })]);
  assert.deepEqual(productRuleIndex(config, PRODUCTS).get(P(2)), ["off"]);
});

test("a campaign that re-targets a rule adds campaign-scoped refs; killed campaigns add nothing", () => {
  const campaign = (killed: boolean) => ({
    id: "bf",
    name: "BF",
    killed,
    window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:59" },
    overrides: [{ ruleId: "r", patch: { target: { kind: "collections", ids: [C(200)] } } }],
  });
  const rules = [pct("r", 10, { target: { kind: "products", productIds: [P(1)], variantIds: [] } })];
  const live = productRuleIndex(configOf(rules, { campaigns: [campaign(false)] }), PRODUCTS);
  assert.deepEqual(live.get(P(1)), ["r"]);
  assert.deepEqual(live.get(P(2)), ["r@bf"]);
  const killed = productRuleIndex(configOf(rules, { campaigns: [campaign(true)] }), PRODUCTS);
  assert.deepEqual(killed.get(P(2)), []);
});
