import test from "node:test";
import assert from "node:assert/strict";
import { detectDiscountFloorConflicts } from "@won/core/discount/conflict.detector";
import type { DiscountRules } from "@won/core/discount/discount.rules";
import type { FloorRuleset } from "@won/core/margin/floor.rules";

const NO_CONFIGURED_RULES: DiscountRules = { allowStacking: true, rules: [] };

function floorRuleset(overrides?: Partial<FloorRuleset>): FloorRuleset {
  return {
    global: {
      minPercentOfBasePrice: 70,
      allowZeroFinalPrice: false,
    },
    perProduct: [],
    ...overrides,
  };
}

test("flags an automatic discount that pushes a product below the global floor", () => {
  const conflicts = detectDiscountFloorConflicts({
    products: [
      { productId: "gid://shopify/Product/1", title: "Snowboard", effectiveBasePrice: 100 },
    ],
    automaticDiscounts: [
      { id: "auto-1", title: "Spring 40%", percentOff: 40, scope: "GLOBAL" },
    ],
    configuredDiscountRules: NO_CONFIGURED_RULES,
    floorRuleset: floorRuleset(),
  });

  // 40% off 100 = 60 final, floor is 70 → conflict for both segments.
  assert.equal(conflicts.length, 2);
  const b2c = conflicts.find((c) => c.segment === "B2C");
  assert.ok(b2c);
  assert.equal(b2c?.floorPrice, 70);
  assert.equal(b2c?.projectedFinalPrice, 60);
  assert.equal(b2c?.violationAmount, 10);
  assert.equal(b2c?.reason, "BELOW_FLOOR");
  assert.equal(b2c?.offendingDiscount.id, "auto-1");
});

test("does not flag an automatic discount that stays above the floor", () => {
  const conflicts = detectDiscountFloorConflicts({
    products: [
      { productId: "gid://shopify/Product/1", effectiveBasePrice: 100 },
    ],
    automaticDiscounts: [
      { id: "auto-1", percentOff: 20, scope: "GLOBAL" },
    ],
    configuredDiscountRules: NO_CONFIGURED_RULES,
    floorRuleset: floorRuleset(),
  });

  // 20% off → 80 final, above 70 floor.
  assert.deepEqual(conflicts, []);
});

test("combines automatic discount with configured margin-guard product rule", () => {
  const configured: DiscountRules = {
    allowStacking: true,
    rules: [
      {
        id: "mg-product-rule",
        scope: "PRODUCT",
        targetId: "gid://shopify/Product/1",
        percentOff: 25,
      },
    ],
  };

  const conflicts = detectDiscountFloorConflicts({
    products: [
      { productId: "gid://shopify/Product/1", effectiveBasePrice: 100 },
    ],
    automaticDiscounts: [
      { id: "auto-1", percentOff: 20, scope: "GLOBAL" },
    ],
    configuredDiscountRules: configured,
    floorRuleset: floorRuleset(),
  });

  // 20% auto + 25% configured = 45% off → 55 final, below 70 floor.
  assert.equal(conflicts.length, 2);
  assert.equal(conflicts[0]?.totalPercentOff, 45);
  assert.equal(conflicts[0]?.projectedFinalPrice, 55);
});

test("respects per-product and B2B-specific floors", () => {
  const conflicts = detectDiscountFloorConflicts({
    products: [
      { productId: "gid://shopify/Product/1", effectiveBasePrice: 100 },
    ],
    automaticDiscounts: [
      { id: "auto-1", percentOff: 35, scope: "GLOBAL" },
    ],
    configuredDiscountRules: NO_CONFIGURED_RULES,
    floorRuleset: floorRuleset({
      global: { minPercentOfBasePrice: 50, b2bMinPercentOfBasePrice: 80, allowZeroFinalPrice: false },
    }),
  });

  // 35% off → 65 final. B2C floor 50 → ok. B2B floor 80 → conflict.
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.segment, "B2B");
  assert.equal(conflicts[0]?.floorPrice, 80);
});

test("matches product- and collection-scoped automatic discounts", () => {
  const conflicts = detectDiscountFloorConflicts({
    products: [
      {
        productId: "gid://shopify/Product/1",
        effectiveBasePrice: 100,
        collectionIds: ["gid://shopify/Collection/9"],
      },
      { productId: "gid://shopify/Product/2", effectiveBasePrice: 100 },
    ],
    automaticDiscounts: [
      { id: "coll", percentOff: 40, scope: "COLLECTION", targetId: "gid://shopify/Collection/9" },
    ],
    configuredDiscountRules: NO_CONFIGURED_RULES,
    floorRuleset: floorRuleset(),
  });

  // Only product 1 is in the targeted collection.
  assert.ok(conflicts.every((c) => c.productId === "gid://shopify/Product/1"));
  assert.equal(conflicts.length, 2);
});

test("honours discount segment restriction", () => {
  const conflicts = detectDiscountFloorConflicts({
    products: [
      { productId: "gid://shopify/Product/1", effectiveBasePrice: 100 },
    ],
    automaticDiscounts: [
      { id: "b2b-only", percentOff: 40, scope: "GLOBAL", segment: "B2B" },
    ],
    configuredDiscountRules: NO_CONFIGURED_RULES,
    floorRuleset: floorRuleset(),
  });

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.segment, "B2B");
});

test("flags a per-unit fixed-amount discount that breaches the floor", () => {
  const conflicts = detectDiscountFloorConflicts({
    products: [
      { productId: "gid://shopify/Product/1", effectiveBasePrice: 100 },
    ],
    automaticDiscounts: [
      {
        id: "amount-1",
        title: "$40 off each",
        scope: "GLOBAL",
        valueType: "FIXED_AMOUNT",
        amount: 40,
        amountScope: "PER_UNIT",
      },
    ],
    configuredDiscountRules: NO_CONFIGURED_RULES,
    floorRuleset: floorRuleset(),
  });

  // $40 off a $100 base = 60 final vs 70 floor → conflict, 40% equivalent.
  assert.equal(conflicts.length, 2);
  const b2c = conflicts.find((c) => c.segment === "B2C");
  assert.equal(b2c?.reason, "BELOW_FLOOR");
  assert.equal(b2c?.projectedFinalPrice, 60);
  assert.equal(b2c?.offendingDiscount.valueType, "FIXED_AMOUNT");
  assert.equal(b2c?.offendingDiscount.percentOff, 40);
  assert.equal(b2c?.offendingDiscount.amount, 40);
});

test("does not flag a per-unit fixed-amount discount that stays above the floor", () => {
  const conflicts = detectDiscountFloorConflicts({
    products: [
      { productId: "gid://shopify/Product/1", effectiveBasePrice: 100 },
    ],
    automaticDiscounts: [
      {
        id: "amount-1",
        scope: "GLOBAL",
        valueType: "FIXED_AMOUNT",
        amount: 20,
        amountScope: "PER_UNIT",
      },
    ],
    configuredDiscountRules: NO_CONFIGURED_RULES,
    floorRuleset: floorRuleset(),
  });

  // $20 off → 80 final, above 70 floor.
  assert.deepEqual(conflicts, []);
});

test("flags per-order fixed-amount discounts as unverifiable", () => {
  const conflicts = detectDiscountFloorConflicts({
    products: [
      { productId: "gid://shopify/Product/1", effectiveBasePrice: 100 },
    ],
    automaticDiscounts: [
      {
        id: "order-amount",
        title: "$10 off order",
        scope: "GLOBAL",
        valueType: "FIXED_AMOUNT",
        amount: 10,
        amountScope: "PER_ORDER",
      },
    ],
    configuredDiscountRules: NO_CONFIGURED_RULES,
    floorRuleset: floorRuleset(),
  });

  assert.equal(conflicts.length, 2);
  assert.ok(conflicts.every((c) => c.reason === "UNVERIFIABLE_AGAINST_FLOOR"));
  assert.equal(conflicts[0]?.offendingDiscount.valueType, "FIXED_AMOUNT");
  assert.equal(conflicts[0]?.totalPercentOff, 0);
});

test("flags unsupported (BXGY) discounts as unverifiable instead of ignoring them", () => {
  const conflicts = detectDiscountFloorConflicts({
    products: [
      { productId: "gid://shopify/Product/1", effectiveBasePrice: 100 },
    ],
    automaticDiscounts: [
      {
        id: "bxgy",
        title: "Buy 2 get 1",
        scope: "GLOBAL",
        valueType: "UNSUPPORTED",
        unsupportedKind: "Buy X Get Y",
      },
    ],
    configuredDiscountRules: NO_CONFIGURED_RULES,
    floorRuleset: floorRuleset(),
  });

  assert.equal(conflicts.length, 2);
  assert.ok(conflicts.every((c) => c.reason === "UNVERIFIABLE_AGAINST_FLOOR"));
  assert.equal(conflicts[0]?.offendingDiscount.valueType, "UNSUPPORTED");
  assert.equal(conflicts[0]?.offendingDiscount.unsupportedKind, "Buy X Get Y");
});

test("ignores products with non-positive price or zero-percent discounts", () => {
  const conflicts = detectDiscountFloorConflicts({
    products: [
      { productId: "gid://shopify/Product/0", effectiveBasePrice: 0 },
      { productId: "gid://shopify/Product/1", effectiveBasePrice: 100 },
    ],
    automaticDiscounts: [
      { id: "zero", percentOff: 0, scope: "GLOBAL" },
    ],
    configuredDiscountRules: NO_CONFIGURED_RULES,
    floorRuleset: floorRuleset(),
  });

  assert.deepEqual(conflicts, []);
});
