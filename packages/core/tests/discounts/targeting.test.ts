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

const flat = (index: ReturnType<typeof productRuleIndex>) => Object.fromEntries(index);

test("rule refs round-trip: plain and campaign-scoped", () => {
  assert.equal(ruleRef("A"), "A");
  assert.equal(ruleRef("A", { campaignId: "bf" }), "A@bf");
  assert.deepEqual(parseRuleRef("A@bf"), { ruleId: "A", campaignId: "bf" });
  assert.deepEqual(parseRuleRef("A"), { ruleId: "A" });
});

test("collection and product targets map to product-wide ruleIds; order/shipping rules never appear", () => {
  const config = configOf([
    pct("coll", 10, { target: { kind: "collections", ids: [C(100)] } }),
    pct("prod", 10, { target: { kind: "products", productIds: [P(3)], variantIds: [] } }),
    orderPct("order", 10),
  ]);
  assert.deepEqual(flat(productRuleIndex(config, PRODUCTS)), {
    [P(1)]: { ruleIds: ["coll"], variantRuleIds: {} },
    [P(2)]: { ruleIds: ["coll"], variantRuleIds: {} },
    [P(3)]: { ruleIds: ["prod"], variantRuleIds: {} },
  });
});

test("a variant target goes to variantRuleIds keyed by variant GID — never product-wide, never to a sibling", () => {
  const config = configOf([pct("one", 10, { target: { kind: "products", productIds: [], variantIds: [V(12)] } })]);
  assert.deepEqual(productRuleIndex(config, PRODUCTS).get(P(1)), { ruleIds: [], variantRuleIds: { [V(12)]: ["one"] } });
});

test("all current variants listed still stay per variant: a variant added later does not inherit the discount", () => {
  const config = configOf([pct("all", 10, { target: { kind: "products", productIds: [], variantIds: [V(31), V(32)] } })]);
  assert.deepEqual(productRuleIndex(config, PRODUCTS).get(P(3)), {
    ruleIds: [],
    variantRuleIds: { [V(31)]: ["all"], [V(32)]: ["all"] },
  });
});

test("a rule that already covers the whole product is not repeated per variant", () => {
  const config = configOf([pct("x", 10, { target: { kind: "products", productIds: [P(1)], variantIds: [V(11)] } })]);
  assert.deepEqual(productRuleIndex(config, PRODUCTS).get(P(1)), { ruleIds: ["x"], variantRuleIds: {} });
});

test("every product gets an entry (possibly empty) and every list is sorted and unique", () => {
  const config = configOf([
    pct("b", 10, { target: { kind: "collections", ids: [C(100), C(200)] } }),
    pct("a", 10, { target: { kind: "products", productIds: [P(2)], variantIds: [V(21)] } }),
  ]);
  const index = productRuleIndex(config, PRODUCTS);
  assert.deepEqual(index.get(P(2)), { ruleIds: ["a", "b"], variantRuleIds: {} });
  assert.equal(index.size, 3);
  assert.deepEqual(index.get(P(3)), { ruleIds: [], variantRuleIds: {} });
});

test("disabled rules are indexed too, so enabling one needs no product metafield rewrite", () => {
  const config = configOf([pct("off", 10, { enabled: false, target: { kind: "collections", ids: [C(200)] } })]);
  assert.deepEqual(productRuleIndex(config, PRODUCTS).get(P(2))?.ruleIds, ["off"]);
});

test("a campaign that re-targets a rule adds campaign-scoped refs (also per variant); killed campaigns add nothing", () => {
  const campaign = (killed: boolean) => ({
    id: "bf",
    name: "BF",
    killed,
    window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:59" },
    overrides: [
      { ruleId: "r", patch: { target: { kind: "collections", ids: [C(200)] } } },
      { ruleId: "v", patch: { target: { kind: "products", productIds: [], variantIds: [V(32)] } } },
    ],
  });
  const rules = [
    pct("r", 10, { target: { kind: "products", productIds: [P(1)], variantIds: [] } }),
    pct("v", 10, { target: { kind: "products", productIds: [P(1)], variantIds: [] } }),
  ];
  const live = productRuleIndex(configOf(rules, { campaigns: [campaign(false)] }), PRODUCTS);
  assert.deepEqual(live.get(P(1)), { ruleIds: ["r", "v"], variantRuleIds: {} });
  assert.deepEqual(live.get(P(2)), { ruleIds: ["r@bf"], variantRuleIds: {} });
  assert.deepEqual(live.get(P(3)), { ruleIds: [], variantRuleIds: { [V(32)]: ["v@bf"] } });
  const killed = productRuleIndex(configOf(rules, { campaigns: [campaign(true)] }), PRODUCTS);
  assert.deepEqual(killed.get(P(2)), { ruleIds: [], variantRuleIds: {} });
});
