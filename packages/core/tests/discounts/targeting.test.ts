// productRuleIndex: what the sync layer writes into product metafields so the
// function never needs collection slots in its input query.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseRuleRef,
  PRODUCT_METAFIELD_BUDGET_BYTES,
  productMetafieldValue,
  productRuleIndex,
  ruleRef,
} from "../../src/discounts/targeting.ts";
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

test("a variant target goes to variantRuleIds keyed by the variant's numeric id — never product-wide, never to a sibling", () => {
  const config = configOf([pct("one", 10, { target: { kind: "products", productIds: [], variantIds: [V(12)] } })]);
  assert.deepEqual(productRuleIndex(config, PRODUCTS).get(P(1)), { ruleIds: [], variantRuleIds: { "12": ["one"] } });
});

test("all current variants listed still stay per variant: a variant added later does not inherit the discount", () => {
  const config = configOf([pct("all", 10, { target: { kind: "products", productIds: [], variantIds: [V(31), V(32)] } })]);
  assert.deepEqual(productRuleIndex(config, PRODUCTS).get(P(3)), {
    ruleIds: [],
    variantRuleIds: { "31": ["all"], "32": ["all"] },
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
  assert.deepEqual(live.get(P(3)), { ruleIds: [], variantRuleIds: { "32": ["v@bf"] } });
  const killed = productRuleIndex(configOf(rules, { campaigns: [campaign(true)] }), PRODUCTS);
  assert.deepEqual(killed.get(P(2)), { ruleIds: [], variantRuleIds: {} });
});

// --- fix round 2: per-product metafield budget ------------------------------------------------

const manyVariants = (n: number, from = 44_000_000_000_000) => Array.from({ length: n }, (_, i) => V(from + i));
const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

test("sanity: one rule can list at most CONFIG_LIMITS.listItems (250) variants, so 400 need two rules", () => {
  const config = configOf([pct("r", 10, { target: { kind: "products", productIds: [], variantIds: manyVariants(400) } })]);
  const target = config.modules.codes.rules[0].target as { variantIds: string[] };
  assert.equal(target.variantIds.length, 250);
});

test("400 targeted variants (two rules) on a 400-variant product: over budget, the largest ref is dropped and reported", () => {
  const variants = manyVariants(400);
  const config = configOf([
    pct("a", 10, { target: { kind: "products", productIds: [], variantIds: variants.slice(0, 250) } }),
    pct("b", 10, { target: { kind: "products", productIds: [], variantIds: variants.slice(150, 400) } }),
    pct("coll", 10, { target: { kind: "collections", ids: [C(100)] } }),
  ]);
  const entry = productRuleIndex(config, [{ productId: P(9), variantIds: variants, collectionIds: [C(100)] }]).get(P(9))!;
  const value = productMetafieldValue(entry);
  assert.ok(entry.oversized!.bytes > PRODUCT_METAFIELD_BUDGET_BYTES, String(entry.oversized?.bytes));
  assert.ok(bytesOf(value) <= PRODUCT_METAFIELD_BUDGET_BYTES, String(bytesOf(value)));
  assert.deepEqual(entry.oversized?.droppedRefs, ["a"], "equal counts (250/250): dropped by ref asc");
  assert.deepEqual(entry.oversized?.collapsedRefs, []);
  assert.deepEqual(value.ruleIds, ["coll"], "collection-wide rules survive");
  assert.equal(Object.keys(value.variantRuleIds).length, 250, "rule b keeps all its variants");
  assert.ok(Object.values(value.variantRuleIds).every((refs) => refs.length === 1 && refs[0] === "b"));
  assert.ok(Object.keys(value.variantRuleIds).every((k) => /^\d+$/.test(k)), "keys are numeric ids, not GIDs");
});

test("over budget with refs that cover every variant: collapsed to the equivalent product-wide refs", () => {
  const variants = manyVariants(250);
  const ids = ["r1", "r2", "r3", "r4", "r5"];
  const config = configOf(ids.map((id) => pct(id, 10, { target: { kind: "products", productIds: [], variantIds: variants } })));
  const entry = productRuleIndex(config, [{ productId: P(9), variantIds: variants, collectionIds: [] }]).get(P(9))!;
  assert.deepEqual(productMetafieldValue(entry), { ruleIds: ids, variantRuleIds: {} });
  assert.deepEqual(entry.oversized?.collapsedRefs, ids);
  assert.deepEqual(entry.oversized?.droppedRefs, []);
  assert.ok(entry.oversized!.bytes > PRODUCT_METAFIELD_BUDGET_BYTES, String(entry.oversized?.bytes));
});

test("a product within the budget has no oversized report and its value is the entry itself", () => {
  const config = configOf([pct("one", 10, { target: { kind: "products", productIds: [], variantIds: [V(12)] } })]);
  const entry = productRuleIndex(config, PRODUCTS).get(P(1))!;
  assert.equal(entry.oversized, undefined);
  assert.deepEqual(productMetafieldValue(entry), { ruleIds: [], variantRuleIds: { "12": ["one"] } });
  assert.equal(PRODUCT_METAFIELD_BUDGET_BYTES, 9000);
});
