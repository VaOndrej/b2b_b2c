import test from "node:test";
import assert from "node:assert/strict";
import { runPricingPipeline } from "@won/core/pricing/pricing.pipeline";
import type { PricingPipelineInput } from "@won/core/pricing/pricing.pipeline";

/**
 * End-to-end composition of the full pricing pipeline (no existing test drives the
 * whole chain). Verifies the documented order actually composes:
 *   base → effective base (tier > B2B override > base) → discounts → final → margin.
 */

const PRODUCT = "gid://shopify/Product/1";

function pipeline(overrides: Partial<PricingPipelineInput>): PricingPipelineInput {
  return {
    productId: PRODUCT,
    segment: "B2C",
    basePrice: 100,
    discounts: [],
    discountRules: { allowStacking: true },
    floorRuleset: {
      global: { minPercentOfBasePrice: 70, allowZeroFinalPrice: false },
      perProduct: [],
    },
    ...overrides,
  };
}

test("full chain: tier beats B2B override, discount applies, margin passes", () => {
  const result = runPricingPipeline(
    pipeline({
      segment: "B2B",
      b2bOverridePrice: 90,
      quantity: 10,
      tierPrices: [{ minQuantity: 5, unitPrice: 80 }],
      discounts: [{ code: "X", percentOff: 10 }],
    }),
  );
  // effective base = tier 80 (> override 90 > base 100), 10% off → 72
  assert.equal(result.totalPercentOff, 10);
  assert.equal(result.finalPrice, 72);
  assert.equal(result.floorPrice, 56, "floor = 70% of effective base 80");
  assert.equal(result.marginAllowed, true);
  assert.equal(result.violationAmount, 0);
});

test("full chain: a discount that breaches the floor is reported, not silently applied", () => {
  const result = runPricingPipeline(
    pipeline({
      segment: "B2C",
      discounts: [{ code: "BIG", percentOff: 50 }],
    }),
  );
  // effective base 100, 50% off → 50; floor = 70 → below floor
  assert.equal(result.finalPrice, 50);
  assert.equal(result.floorPrice, 70);
  assert.equal(result.marginAllowed, false);
  assert.equal(result.violationAmount, 20);
  assert.equal(result.marginReason, "BELOW_FLOOR");
});

test("full chain: B2B override feeds the effective base only for B2B", () => {
  const b2b = runPricingPipeline(
    pipeline({ segment: "B2B", basePrice: 80, b2bOverridePrice: 100 }),
  );
  const b2c = runPricingPipeline(
    pipeline({ segment: "B2C", basePrice: 80, b2bOverridePrice: 100 }),
  );
  assert.equal(b2b.finalPrice, 100, "B2B uses the override as effective base");
  assert.equal(b2c.finalPrice, 80, "B2C ignores the override, uses base");
});
