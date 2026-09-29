// What the sync ships for margin protection: `marginRefs` in the product
// metafield (targeting.ts, never dropped over the budget), the compact margin in
// the shop config (function-payload.ts, within the 9 000 B budget with 100
// collections), and the admin's impact overview (margin.ts marginImpact).

import assert from "node:assert/strict";
import { test } from "node:test";

import { CONFIG_LIMITS, sanitizeConfig } from "../../src/discounts/config.ts";
import { buildShopFunctionConfig, buildShopFunctionConfigWorstCase } from "../../src/discounts/function-payload.ts";
import { marginImpact, type MarginVariant } from "../../src/discounts/margin.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { PRODUCT_METAFIELD_BUDGET_BYTES, productMetafieldValue, productRuleIndex } from "../../src/discounts/targeting.ts";
import { cartOf, code, configOf, FIXTURE_NOW, FIXTURE_TZ, line, orderFixed, orderPct, pct, fixed } from "./engine-fixtures.ts";

const P = (n: number) => `gid://shopify/Product/${n}`;
const V = (n: number) => `gid://shopify/ProductVariant/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;
const bytesOf = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

const MARGIN_ON = {
  enabled: true,
  global: { minMarginPercent: 10, maxDiscountPercent: 50 },
  perCollection: [
    { collectionId: C(100), minMarginPercent: 30 },
    { collectionId: C(300), maxDiscountPercent: 10 },
    { collectionId: C(400) }, // nothing set: not a margin collection
  ],
};

// --- targeting: marginRefs ------------------------------------------------------------------------

test("marginRefs: numeric ids of the product's collections that have a margin setting (only while protection is on)", () => {
  const products = [
    { productId: P(1), variantIds: [V(11)], collectionIds: [C(300), C(100), C(200), C(400)] },
    { productId: P(2), variantIds: [V(21)], collectionIds: [C(200)] },
  ];
  const on = productRuleIndex(configOf([pct("coll", 10, { target: { kind: "collections", ids: [C(200)] } })], { modules: { margin: MARGIN_ON } }), products);
  assert.deepEqual(on.get(P(1)), { ruleIds: ["coll"], variantRuleIds: {}, marginRefs: ["100", "300"] });
  assert.deepEqual(productMetafieldValue(on.get(P(1))!), { ruleIds: ["coll"], variantRuleIds: {}, marginRefs: ["100", "300"] });
  assert.deepEqual(on.get(P(2)), { ruleIds: ["coll"], variantRuleIds: {} }, "no margin collection → no key at all");
  const off = productRuleIndex(configOf([], { modules: { margin: { ...MARGIN_ON, enabled: false } } }), products);
  assert.deepEqual(off.get(P(1)), { ruleIds: [], variantRuleIds: {} });
});

test("the engine reads marginRefs per line exactly as the metafield carries them", () => {
  const config = configOf([pct("A", 50)], { modules: { margin: MARGIN_ON } });
  const entry = productRuleIndex(config, [{ productId: P(1), variantIds: [V(11)], collectionIds: [C(300)] }]).get(P(1))!;
  const payload = buildShopFunctionConfig(config, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ, shopCurrency: "CZK" }).payload;
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"], { marginRefs: productMetafieldValue(entry).marginRefs })]), payload);
  assert.equal(plan.lines[0].product?.amount, 100_00); // collection 300: at most 10 % without a cost
});

test("over the product budget: rule refs are dropped first — marginRefs never (fail closed: less discount)", () => {
  const variants = Array.from({ length: 400 }, (_, i) => V(44_000_000_000_000 + i));
  const collections = Array.from({ length: CONFIG_LIMITS.marginOverrides }, (_, i) => C(900_000_000_000 + i));
  const config = configOf(
    [
      pct("a", 10, { target: { kind: "products", productIds: [], variantIds: variants.slice(0, 250) } }),
      pct("b", 10, { target: { kind: "products", productIds: [], variantIds: variants.slice(150, 400) } }),
    ],
    { modules: { margin: { enabled: true, global: { maxDiscountPercent: 50 }, perCollection: collections.map((collectionId) => ({ collectionId, minMarginPercent: 25 })) } } },
  );
  const entry = productRuleIndex(config, [{ productId: P(9), variantIds: variants, collectionIds: collections }]).get(P(9))!;
  const value = productMetafieldValue(entry);
  assert.ok(bytesOf(value) <= PRODUCT_METAFIELD_BUDGET_BYTES, String(bytesOf(value)));
  assert.equal(value.marginRefs?.length, 100, "every margin collection survives");
  assert.ok((entry.oversized?.droppedRefs.length ?? 0) > 0);
});

test("over the product budget with only product-wide refs left: those are dropped too (longest first), marginRefs stay", () => {
  const collections = Array.from({ length: CONFIG_LIMITS.marginOverrides }, (_, i) => C(900_000_000_000 + i));
  const ids = Array.from({ length: 150 }, (_, i) => `rule-${String(i).padStart(3, "0")}-${"x".repeat(i % 2 === 0 ? 50 : 40)}`);
  const config = configOf(
    ids.map((id) => pct(id, 10, { target: { kind: "collections", ids: [C(1)] } })),
    { modules: { margin: { enabled: true, global: { maxDiscountPercent: 50 }, perCollection: collections.map((collectionId) => ({ collectionId, minMarginPercent: 25 })) } } },
  );
  const entry = productRuleIndex(config, [{ productId: P(9), variantIds: [V(1)], collectionIds: [C(1), ...collections] }]).get(P(9))!;
  const value = productMetafieldValue(entry);
  assert.ok(entry.oversized!.bytes > PRODUCT_METAFIELD_BUDGET_BYTES);
  assert.ok(bytesOf(value) <= PRODUCT_METAFIELD_BUDGET_BYTES, String(bytesOf(value)));
  assert.equal(value.marginRefs?.length, 100);
  const dropped = entry.oversized!.droppedRefs;
  assert.ok(dropped.length > 0);
  // The longer (50-char tail) refs go first.
  assert.ok(dropped.every((ref) => ref.endsWith("x".repeat(50))), dropped.join(","));
  assert.ok(value.ruleIds.every((ref) => !dropped.includes(ref)));
});

// --- shop config: the compact margin ----------------------------------------------------------------

test("shop config: margin ships compact (tuples keyed by numeric collection id) with the shop currency", () => {
  const config = configOf([orderPct("O", 10)], { modules: { margin: MARGIN_ON } });
  const { payload } = buildShopFunctionConfig(config, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ, shopCurrency: "CZK" });
  assert.deepEqual(payload.modules.margin, { enabled: true, min: 10, max: 50, cur: "CZK", col: { "100": [30, null], "300": [null, 10] } });
  // Without the shop currency the costs are unknown (percent ceiling) — never a wrong conversion.
  const noCurrency = buildShopFunctionConfig(config, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ }).payload;
  assert.equal("cur" in noCurrency.modules.margin, false);
  // Off: one tiny object, whatever the settings.
  const off = buildShopFunctionConfig(configOf([], { modules: { margin: { ...MARGIN_ON, enabled: false } } }), {
    now: FIXTURE_NOW,
    shopTimezone: FIXTURE_TZ,
    shopCurrency: "CZK",
  }).payload;
  assert.deepEqual(off.modules.margin, { enabled: false });
});

test("shop config budget: 500 codes AND the worst-case margin (100 collections, 13-digit ids, two-decimal min and max) fit 9 000 B", () => {
  // The limits guarantee it: at most CONFIG_LIMITS.marginOverrides collections, and margin percents
  // keep one decimal (the sanitizer rounds 33.33 → 33.4 and 66.67 → 66.6), so no entry is longer than
  // "1234567890123":[94.9,99.9] whatever the merchant typed.
  assert.equal(CONFIG_LIMITS.marginOverrides, 100);
  const codes = Array.from({ length: 500 }, (_, i) => `INFLUENCER-${String(i).padStart(4, "0")}-PODZIM2026`);
  const perCollection = Array.from({ length: CONFIG_LIMITS.marginOverrides }, (_, i) => ({
    collectionId: C(9_000_000_000_000 + i),
    minMarginPercent: 33.33,
    maxDiscountPercent: 66.67,
  }));
  const config = configOf([orderPct("r", 10, code(codes))], {
    modules: { margin: { enabled: true, global: { minMarginPercent: 12.34, maxDiscountPercent: 45.67 }, perCollection } },
  });
  const encoded = buildShopFunctionConfig(config, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ, shopCurrency: "CZK" });
  const col = (encoded.payload.modules.margin as { col: Record<string, unknown> }).col;
  assert.equal(Object.keys(col).length, 100);
  assert.deepEqual(col["9000000000000"], [33.4, 66.6]);
  assert.equal(encoded.fits, true, `${encoded.bytes} B`);
  // Even with 3-decimal junk the stored values stay one decimal.
  const junk = configOf([], { modules: { margin: { enabled: true, global: { maxDiscountPercent: 33.333333333 }, perCollection: [{ collectionId: C(1), minMarginPercent: 94.99999 }] } } });
  assert.deepEqual(junk.modules.margin.global, { maxDiscountPercent: 33.3 });
  assert.equal(junk.modules.margin.perCollection[0].minMarginPercent, 95);
  // The save-time worst case measures the shop currency too (any 3-letter code costs the same bytes).
  const worst = buildShopFunctionConfigWorstCase(config);
  assert.equal(worst.bytes, encoded.bytes);
  assert.equal(worst.fits, true);
});

// --- marginImpact -------------------------------------------------------------------------------------

const VARIANTS: MarginVariant[] = [
  // cost 800 of 1 000 → floor 800 / 0.9 = 888,89 → at most 111,11 Kč off.
  { productId: P(1), variantId: V(11), title: "Mikina M", price: 1000_00, cost: 800_00, ruleRefs: ["A"], marginRefs: [] },
  // no cost → at most 50 % off.
  { productId: P(2), variantId: V(21), title: "Tričko", price: 400_00, cost: null, ruleRefs: ["A", "F"], marginRefs: [] },
  // collection 300: at most 10 % off without a cost.
  { productId: P(3), variantId: V(31), title: "Čepice", price: 200_00, cost: null, ruleRefs: ["F"], marginRefs: ["300"] },
  // plenty of headroom.
  { productId: P(4), variantId: V(41), title: "Taška", price: 1000_00, cost: 100_00, ruleRefs: ["A"], marginRefs: [] },
];

test("marginImpact: per active rule, the variants (1 item, shop currency) where margin protection lowers the discount", () => {
  const config = configOf(
    [
      pct("A", 20),
      fixed("F", { CZK: 150_00 }),
      pct("OFF", 90, { enabled: false }),
      orderPct("O", 60),
      orderFixed("OF", { CZK: 100_00 }),
    ],
    { modules: { margin: MARGIN_ON } },
  );
  const impact = marginImpact(config, VARIANTS, "CZK");
  assert.equal(impact.withoutCost, 2);
  assert.deepEqual(impact.rules.map((r) => r.ruleId), ["A", "F", "O"], "active product and percent order rules, config order");
  const [a, f, o] = impact.rules;
  assert.equal(a.discountClass, "product");
  assert.equal(a.variants, 1);
  assert.deepEqual(a.capped, [{ productId: P(1), variantId: V(11), title: "Mikina M", wanted: 200_00, allowed: 111_11, basis: "cost" }]);
  // F: 150 Kč off the 200 Kč cap (collection 300: 10 %) and the 400 Kč T-shirt (50 % → 200: fine).
  assert.equal(f.variants, 1);
  assert.deepEqual(f.capped, [{ productId: P(3), variantId: V(31), title: "Čepice", wanted: 150_00, allowed: 20_00, basis: "max_percent" }]);
  // O (60 % off the order) would go below the floor on 3 variants (not the bag); sorted by the amount lost.
  assert.equal(o.discountClass, "order");
  assert.equal(o.variants, 3);
  assert.deepEqual(o.capped.map((c) => [c.variantId, c.wanted, c.allowed]), [
    [V(11), 600_00, 111_11],
    [V(31), 120_00, 20_00],
    [V(21), 240_00, 200_00],
  ]);
});

test("marginImpact: computed from the settings even while protection is off (the admin previews it); top 50 by loss", () => {
  const many: MarginVariant[] = Array.from({ length: 80 }, (_, i) => ({
    productId: P(i),
    variantId: V(1000 + i),
    title: `V${i}`,
    price: 1000_00 + i * 100,
    cost: null,
    ruleRefs: ["A"],
    marginRefs: [],
  }));
  const config = configOf([pct("A", 60)], { modules: { margin: { ...MARGIN_ON, enabled: false } } });
  const impact = marginImpact(config, many, "CZK");
  assert.equal(impact.rules[0].variants, 80);
  assert.equal(impact.rules[0].capped.length, 50);
  assert.equal(impact.rules[0].capped[0].variantId, V(1079), "the largest loss first");
  assert.equal(impact.withoutCost, 80);
  assert.ok(sanitizeConfig(config).issues.length === 0);
});
