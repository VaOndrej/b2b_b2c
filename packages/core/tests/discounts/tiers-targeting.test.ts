// MVP 3 contracts K1/K3: the product metafield carries `tierRef` = the id of
// the scoped tier set that applies to the product (the first set listing the
// product, else the first listing one of its collections, config order);
// absent = the global set applies. Like `marginRefs`, it is never dropped when
// the product value is over its byte budget (without it the product would get
// the global set: possibly more than its own set gives).

import assert from "node:assert/strict";
import { test } from "node:test";

import { PRODUCT_METAFIELD_BUDGET_BYTES, productMetafieldValue, productRuleIndex } from "../../src/discounts/targeting.ts";
import { configOf, pct } from "./engine-fixtures.ts";

const P = (n: number) => `gid://shopify/Product/${n}`;
const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;
const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

const SETS = [
  { id: "global", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10 }] },
  { id: "kolekce-a", scope: { collectionIds: [C(1), C(2)] }, countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] },
  { id: "produkty", scope: { productIds: [P(1), P(2)] }, countAcross: "line", breaks: [{ minQty: 5, percent: 20 }] },
  { id: "kolekce-b", scope: { collectionIds: [C(2), C(3)], productIds: [P(2)] }, countAcross: "cart", breaks: [{ minQty: 2, percent: 7 }] },
];

test("K1: a product listed by a set beats any collection match; then the first set (config order) listing one of its collections", () => {
  const config = configOf([], { modules: { tiers: { sets: SETS } } });
  const index = productRuleIndex(config, [
    { productId: P(1), variantIds: [V(11)], collectionIds: [C(3)] }, // listed by "produkty"
    { productId: P(2), variantIds: [V(21)], collectionIds: [C(1)] }, // listed by "produkty" first (config order), also by "kolekce-b"
    { productId: P(3), variantIds: [V(31)], collectionIds: [C(3), C(2)] }, // C2 is in "kolekce-a", which comes first
    { productId: P(4), variantIds: [V(41)], collectionIds: [C(3)] }, // only "kolekce-b"
    { productId: P(5), variantIds: [V(51)], collectionIds: [C(9)] }, // no scoped set: the global one applies
  ]);
  assert.equal(index.get(P(1))?.tierRef, "produkty");
  assert.equal(index.get(P(2))?.tierRef, "produkty");
  assert.equal(index.get(P(3))?.tierRef, "kolekce-a");
  assert.equal(index.get(P(4))?.tierRef, "kolekce-b");
  assert.equal(index.get(P(5))?.tierRef, undefined);
  assert.deepEqual(index.get(P(5)), { ruleIds: [], variantRuleIds: {} }, "no key at all when the global set applies");
  assert.deepEqual(productMetafieldValue(index.get(P(4))!), { ruleIds: [], variantRuleIds: {}, tierRef: "kolekce-b" });
});

test("tierRef sits next to rule refs and marginRefs in the written value", () => {
  const config = configOf([pct("coll", 10, { target: { kind: "collections", ids: [C(1)] } })], {
    modules: {
      tiers: { sets: SETS },
      margin: { enabled: true, global: { maxDiscountPercent: 50 }, perCollection: [{ collectionId: C(1), maxDiscountPercent: 10 }] },
    },
  });
  const entry = productRuleIndex(config, [{ productId: P(9), variantIds: [V(91)], collectionIds: [C(1)] }]).get(P(9))!;
  assert.deepEqual(productMetafieldValue(entry), { ruleIds: ["coll"], variantRuleIds: {}, marginRefs: ["1"], tierRef: "kolekce-a" });
});

test("over the product budget: rule refs are dropped, tierRef never (fail closed)", () => {
  const variants = Array.from({ length: 400 }, (_, i) => V(44_000_000_000_000 + i));
  const setId = "t".repeat(64);
  const config = configOf(
    [
      pct("a", 10, { target: { kind: "products", productIds: [], variantIds: variants.slice(0, 250) } }),
      pct("b", 10, { target: { kind: "products", productIds: [], variantIds: variants.slice(150, 400) } }),
    ],
    { modules: { tiers: { sets: [{ id: setId, scope: { productIds: [P(9)] }, countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }] } } },
  );
  const entry = productRuleIndex(config, [{ productId: P(9), variantIds: variants, collectionIds: [] }]).get(P(9))!;
  const value = productMetafieldValue(entry);
  assert.ok((entry.oversized?.droppedRefs.length ?? 0) > 0);
  assert.ok(bytesOf(value) <= PRODUCT_METAFIELD_BUDGET_BYTES, String(bytesOf(value)));
  assert.equal(value.tierRef, setId);
});

test("a set whose breaks are empty still claims its products (a Free inert set: no tier, never the global one)", () => {
  const config = configOf([], {
    modules: { tiers: { sets: [SETS[0], { id: "prazdna", scope: { productIds: [P(1)] }, countAcross: "line", breaks: [] }] } },
  });
  assert.equal(productRuleIndex(config, [{ productId: P(1), variantIds: [], collectionIds: [] }]).get(P(1))?.tierRef, "prazdna");
});
