import test from "node:test";
import assert from "node:assert/strict";
import { computeEffectiveBasePrice } from "../../core/pricing/pricing.engine.ts";

test("pricing engine applies highest eligible quantity tier before B2B override", () => {
  const result = computeEffectiveBasePrice({
    productId: "gid://shopify/Product/TIER_1",
    segment: "B2B",
    basePrice: 100,
    b2bOverridePrice: 90,
    quantity: 12,
    tierPrices: [
      { minQuantity: 5, unitPrice: 85 },
      { minQuantity: 10, unitPrice: 75 },
    ],
  });

  assert.equal(result.effectiveBasePrice, 75);
  assert.deepEqual(result.appliedTierPrice, { minQuantity: 10, unitPrice: 75 });
  assert.equal(result.quantity, 12);
});

test("pricing engine falls back to override/base when no valid tier matches quantity", () => {
  const b2b = computeEffectiveBasePrice({
    productId: "gid://shopify/Product/TIER_2",
    segment: "B2B",
    basePrice: 100,
    b2bOverridePrice: 90,
    quantity: 2,
    tierPrices: [
      { minQuantity: 5, unitPrice: 80 },
      { minQuantity: 0, unitPrice: 10 },
      { minQuantity: 10, unitPrice: -5 },
    ],
  });
  assert.equal(b2b.effectiveBasePrice, 90);
  assert.equal(b2b.appliedTierPrice, undefined);
  assert.equal(b2b.quantity, 2);

  const b2c = computeEffectiveBasePrice({
    productId: "gid://shopify/Product/TIER_3",
    segment: "B2C",
    basePrice: 100,
    b2bOverridePrice: 80,
    quantity: 0,
    tierPrices: [{ minQuantity: 10, unitPrice: 70 }],
  });
  assert.equal(b2c.effectiveBasePrice, 100);
  assert.equal(b2c.quantity, 1);
});
