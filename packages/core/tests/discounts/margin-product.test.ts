// A product's own margin setting (feedback 9 Oct 2026, 3rd round, bod 7): the most specific one — it comes before
// the product's collections and the global values, field by field; an empty field keeps what the product would have
// without it. Amounts are minor units (haléře); costs are MAJOR units.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CONFIG_LIMITS, sanitizeConfig } from "../../src/discounts/config.ts";
import { buildShopFunctionConfig } from "../../src/discounts/function-payload.ts";
import { applyProductMargin, buildMarginPayload, marginImpact, readMarginPayload, resolveMargin, resolveProductMargin } from "../../src/discounts/margin.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { buildStorefrontConfig, marginKey, pdpFloor } from "../../src/discounts/storefront-config.ts";
import { cartOf, code, configOf, costLine, FIXTURE_NOW, FIXTURE_TZ, lineOf, marginPayloadOf, orderPct, pct } from "./engine-fixtures.ts";

const P = (n: number | string) => `gid://shopify/Product/${n}`;
const C = (n: number | string) => `gid://shopify/Collection/${n}`;

test("sanitizer: perProduct keeps one setting a product, rounds to the stricter tenth, folds what is over the limit into the global values", () => {
  const { config } = sanitizeConfig({
    modules: {
      margin: {
        enabled: true,
        global: { maxDiscountPercent: 50 },
        perProduct: [{ productId: P(1), minMarginPercent: 33.33 }, { productId: P(1), minMarginPercent: 5 }, { productId: "" }, { productId: P(2), maxDiscountPercent: 66.67 }],
      },
    },
  });
  assert.deepEqual(config.modules.margin.perProduct, [
    { productId: P(1), minMarginPercent: 33.4 },
    { productId: P(2), maxDiscountPercent: 66.6 },
  ]);
  const many = Array.from({ length: CONFIG_LIMITS.marginProductOverrides + 2 }, (_, i) => ({ productId: P(100 + i), minMarginPercent: i >= CONFIG_LIMITS.marginProductOverrides ? 40 : 10 }));
  const over = sanitizeConfig({ modules: { margin: { enabled: true, global: { maxDiscountPercent: 50 }, perProduct: many } } });
  assert.equal(over.config.modules.margin.perProduct.length, CONFIG_LIMITS.marginProductOverrides);
  assert.equal(over.config.modules.margin.global.minMarginPercent, 40);
  assert.deepEqual(over.issues.map((i) => i.code), ["margin_overrides_folded"]);
  // A config stored before the product settings has no key.
  assert.deepEqual(sanitizeConfig({ modules: { margin: { enabled: true, global: { maxDiscountPercent: 50 } } } }).config.modules.margin.perProduct, []);
});

test("payload: `prod` by numeric product id, absent without a product setting; the tolerant reader drops junk entries", () => {
  const margin = configOf([], { modules: { margin: { enabled: true, global: { minMarginPercent: 10, maxDiscountPercent: 50 }, perProduct: [{ productId: P(7), minMarginPercent: 30 }, { productId: P(8) }] } } }).modules.margin;
  const payload = buildMarginPayload(margin, "CZK");
  assert.deepEqual(payload, { enabled: true, min: 10, max: 50, cur: "CZK", prod: { "7": [30, null] } });
  assert.equal("prod" in buildMarginPayload({ ...margin, perProduct: [] }, "CZK"), false);
  assert.deepEqual(readMarginPayload({ enabled: true, max: 50, prod: { "7": [30, null], "8": [1], "9": ["x", 2], "10": [200, 200] } }), {
    enabled: true,
    max: 50,
    prod: { "7": [30, null], "10": [95, 100] },
  });
});

test("order: product → collection → global, field by field; a product may be looser than its collection", () => {
  const payload = readMarginPayload({ enabled: true, min: 10, max: 50, col: { "1": [20, 40] }, prod: { "7": [5, null], "8": [null, 90], "9": [60, 10] } });
  const viaCollection = resolveMargin(payload, ["1"]);
  assert.deepEqual(viaCollection, { minMarginPercent: 20, maxDiscountPercent: 40, source: "collection" });
  // Looser minimum than the collection's; the empty maximum stays the collection's.
  assert.deepEqual(resolveProductMargin(payload, ["1"], 1, P(7)), { minMarginPercent: 5, maxDiscountPercent: 40, source: "product" });
  // No collection: the empty minimum is the global one.
  assert.deepEqual(resolveProductMargin(payload, [], 0, "8"), { minMarginPercent: 10, maxDiscountPercent: 90, source: "product" });
  assert.deepEqual(resolveProductMargin(payload, ["1"], 1, P(9)), { minMarginPercent: 60, maxDiscountPercent: 10, source: "product" });
  // Another product, no id, protection off: untouched.
  assert.deepEqual(resolveProductMargin(payload, ["1"], 1, P(99)), viaCollection);
  assert.deepEqual(resolveProductMargin(payload, ["1"]), viaCollection);
  assert.equal(applyProductMargin({ enabled: false }, null, P(7)), null);
  // More refs than the engine reads one by one: the strictest collection — and still the product's own first.
  assert.deepEqual(resolveProductMargin(payload, ["1", "2", "3", "4", "5"], 5, P(9)), { minMarginPercent: 60, maxDiscountPercent: 10, source: "product" });
});

test("planCart: the product's own minimum margin decides the cut, stricter or looser than its collection", () => {
  const rules = [pct("A", 30)];
  // 1 000 Kč, cost 700 Kč. Collection 1: margin 20 % → floor 875 Kč → 125 Kč off at most.
  const margin = { global: { maxDiscountPercent: 50 }, perCollection: [{ collectionId: C(1), minMarginPercent: 20 }] };
  const lines = [costLine("L1", 1000_00, 700, 1, ["A"], { marginRefs: ["1"] })];
  const byCollection = planCart(cartOf(lines), marginPayloadOf(rules, margin));
  assert.equal(lineOf(byCollection, "L1").product?.amount, 125_00);
  assert.equal(lineOf(byCollection, "L1").marginCapped?.source, "collection");
  // Its own 0 %: never below the cost → the whole 30 % (300 Kč = down to the cost exactly).
  const looser = planCart(cartOf(lines), marginPayloadOf(rules, { ...margin, perProduct: [{ productId: P("L1"), minMarginPercent: 0 }] }));
  assert.equal(lineOf(looser, "L1").product?.amount, 300_00);
  assert.equal(lineOf(looser, "L1").marginCapped, undefined);
  // Its own 30 %: floor 1 000 Kč → nothing off.
  const stricter = planCart(cartOf(lines), marginPayloadOf(rules, { ...margin, perProduct: [{ productId: P("L1"), minMarginPercent: 30 }] }));
  assert.equal(lineOf(stricter, "L1").product, null);
  // Another product's setting changes nothing here.
  const other = planCart(cartOf(lines), marginPayloadOf(rules, { ...margin, perProduct: [{ productId: P("L2"), minMarginPercent: 0 }] }));
  assert.deepEqual(other.lines, byCollection.lines);
});

test("planCart without a cost: the product's own maximum discount is the ceiling", () => {
  const rules = [pct("A", 40)];
  const lines = [costLine("L1", 1000_00, 0, 1, ["A"])];
  const plan = planCart(cartOf(lines), marginPayloadOf(rules, { global: { maxDiscountPercent: 50 }, perProduct: [{ productId: P("L1"), maxDiscountPercent: 15 }] }));
  assert.equal(lineOf(plan, "L1").product?.amount, 150_00);
  assert.deepEqual(lineOf(plan, "L1").marginCapped && { basis: lineOf(plan, "L1").marginCapped!.basis, source: lineOf(plan, "L1").marginCapped!.source }, { basis: "max_percent", source: "product" });
});

test("Free: product settings fold into the global values, the strictest wins, and the gate says so", () => {
  const config = configOf([], { modules: { margin: { enabled: true, global: { minMarginPercent: 10, maxDiscountPercent: 50 }, perProduct: [{ productId: P(1), minMarginPercent: 30 }, { productId: P(2), maxDiscountPercent: 80 }] } } });
  const gated = gateConfigForPlan(config, "free");
  assert.deepEqual(gated.config.modules.margin, { enabled: true, global: { minMarginPercent: 30, maxDiscountPercent: 50 }, perCollection: [], perProduct: [] });
  const stripped = gated.stripped.find((s) => s.capability === "margin_per_product");
  assert.deepEqual(stripped && { reason: stripped.reason, count: stripped.count, removedIds: stripped.removedIds, values: stripped.values }, {
    reason: "folded",
    count: 2,
    removedIds: [P(1), P(2)],
    values: { minMarginPercent: { from: 10, to: 30 } },
  });
  assert.equal(gateConfigForPlan(config, "pro").config.modules.margin.perProduct.length, 2);
});

test("storefront: the product's own maximum, the margin key and the PDP floor follow the product setting", () => {
  const base = { enabled: true, global: { minMarginPercent: 10, maxDiscountPercent: 50 }, perCollection: [{ collectionId: C(1), minMarginPercent: 20 }] };
  const without = configOf([], { modules: { margin: base } });
  const withProduct = configOf([], { modules: { margin: { ...base, perProduct: [{ productId: P(7), minMarginPercent: 40, maxDiscountPercent: 25 }, { productId: P(8), minMarginPercent: 5 }] } } });
  assert.notEqual(marginKey(without.modules.margin, "CZK"), marginKey(withProduct.modules.margin, "CZK"));
  const sf = buildStorefrontConfig(withProduct, { configVersion: "v", shopCurrency: "CZK" });
  assert.deepEqual(sf.margin.on && sf.margin.prod, { "7": 25 });
  const floor = (margin: typeof without.modules.margin, productId?: string) => pdpFloor({ unitCost: 600, costCurrency: "CZK", shopCurrency: "CZK", margin, collectionIds: [C(1)], productId })?.f;
  assert.equal(floor(without.modules.margin, P(7)), 750_00); // collection: 600 / 0.8
  assert.equal(floor(withProduct.modules.margin, P(7)), 1000_00); // product: 600 / 0.6
  assert.equal(floor(withProduct.modules.margin, P(99)), 750_00);
  assert.equal(floor(withProduct.modules.margin), 750_00);
});

test("impact overview: a variant of a product with its own setting is measured by it", () => {
  const config = configOf([pct("A", 30)], { modules: { margin: { enabled: true, global: { maxDiscountPercent: 50 }, perProduct: [{ productId: P(7), minMarginPercent: 30 }] } } });
  const variant = (productId: string, variantId: string) => ({ productId, variantId, title: variantId, price: 1000_00, cost: 700_00, ruleRefs: ["A"], marginRefs: [] });
  const impact = marginImpact(config, [variant(P(7), "v7"), variant(P(8), "v8")], "CZK");
  // Product 7: floor 1 000 Kč → 0 allowed. Product 8: never below the cost → 300 Kč allowed = the whole discount.
  assert.deepEqual(impact.rules[0].capped.map((c) => [c.variantId, c.wanted, c.allowed]), [["v7", 300_00, 0]]);
});

test("shop config budget: the most collections AND the most products with their own setting, 500 codes — within 9 000 B or refused, never silently cut", () => {
  const codes = Array.from({ length: 500 }, (_, i) => `INFLUENCER-${String(i).padStart(4, "0")}-PODZIM2026`);
  const perCollection = Array.from({ length: CONFIG_LIMITS.marginOverrides }, (_, i) => ({ collectionId: C(9_000_000_000_000 + i), minMarginPercent: 33.33, maxDiscountPercent: 66.67 }));
  const perProduct = Array.from({ length: CONFIG_LIMITS.marginProductOverrides }, (_, i) => ({ productId: P(9_000_000_000_000 + i), minMarginPercent: 33.33, maxDiscountPercent: 66.67 }));
  const config = configOf([orderPct("r", 10, code(codes))], { modules: { margin: { enabled: true, global: { minMarginPercent: 12.34, maxDiscountPercent: 45.67 }, perCollection, perProduct } } });
  const encoded = buildShopFunctionConfig(config, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ, shopCurrency: "CZK" });
  const prod = (encoded.payload.modules.margin as { prod: Record<string, unknown> }).prod;
  assert.equal(Object.keys(prod).length, CONFIG_LIMITS.marginProductOverrides);
  assert.equal(encoded.fits, true, `${encoded.bytes} B`);
});
