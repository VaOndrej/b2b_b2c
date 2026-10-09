// The admin's margin overview resolves a product's margin settings the way
// checkout does (MVP 2 audit round 5): a product metafield listing more than 4
// marginRefs — junk entries counted, as the engine counts them — takes the
// store's strictest setting (core resolveProductMargin), in the rows' numbers
// (core marginImpact) and in their `source` label alike.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { DEFAULT_CONFIG } from "@won/core/discounts/config/defaults";

import { parseRefs } from "../../../app/lib/integration/margin-impact.server.ts";
import { impactRulesOf } from "../../../app/lib/integration/margin-impact-view.ts";

test("parseRefs counts the metafield's marginRefs entries, junk included", () => {
  assert.deepEqual(parseRefs(JSON.stringify({ ruleIds: ["a"], marginRefs: ["5", 6, null, "7", "8"] })).marginRefs, ["5", "7", "8"]);
  assert.equal(parseRefs(JSON.stringify({ marginRefs: ["5", 6, null, "7", "8"] })).marginRefCount, 5);
  assert.equal(parseRefs(JSON.stringify({ marginRefs: "5" })).marginRefCount, 0);
  assert.equal(parseRefs(null).marginRefCount, 0);
  assert.equal(parseRefs("{junk").marginRefCount, 0);
});

test("impactRulesOf: a variant whose product lists 5+ refs is measured and labelled by the store's strictest setting", () => {
  const config = structuredClone(DEFAULT_CONFIG) as WonDiscountsConfig;
  config.modules.codes.rules = [
    { id: "half", name: "Půlka", enabled: true, method: "automatic", value: { kind: "percentage", percent: 50 }, target: { kind: "products", productIds: [], variantIds: [] } },
  ] as WonDiscountsConfig["modules"]["codes"]["rules"];
  config.modules.margin = {
    enabled: true,
    global: { maxDiscountPercent: 40 },
    perCollection: [
      { collectionId: "gid://shopify/Collection/5", maxDiscountPercent: 10 },
      { collectionId: "gid://shopify/Collection/6", maxDiscountPercent: 90 },
    ],
    perProduct: [],
  };
  const variant = (id: string, marginRefs: string[], marginRefCount?: number) => ({
    productId: `gid://shopify/Product/${id}`,
    variantId: `gid://shopify/ProductVariant/${id}`,
    title: id,
    price: 1000_00,
    cost: null,
    ruleRefs: ["half"],
    marginRefs,
    ...(marginRefCount !== undefined ? { marginRefCount } : {}),
  });
  const { rules } = impactRulesOf(config, [variant("1", ["6"]), variant("2", ["6", "6", "6", "6", "6"]), variant("3", ["6", "6"], 5)], "CZK");
  const rows = rules[0]!.rows.map((r) => [r.variantId.split("/").pop(), r.allowed, r.source]);
  // One ref (collection 6): 90 % → the 50 % rule is not lowered. 5 entries (strings or junk): the strictest 10 %.
  assert.deepEqual(rows, [
    ["2", 100_00, "collection"],
    ["3", 100_00, "collection"],
  ]);
});
