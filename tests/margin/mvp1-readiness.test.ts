import test from "node:test";
import assert from "node:assert/strict";
import { runPricingPipeline } from "../../core/pricing/pricing.pipeline.ts";
import { resolveSegment } from "../../core/segment/segment.engine.ts";

test("MVP_1 readiness: segment + floor + stacking governance works", () => {
  const floorRuleset = {
    global: {
      minPercentOfBasePrice: 65,
      allowZeroFinalPrice: false,
    },
    perProduct: [
      {
        productId: "gid://shopify/Product/PER_PRODUCT_1",
        segment: "B2C" as const,
        minPercentOfBasePrice: 80,
        allowZeroFinalPriceOverride: false,
      },
    ],
  };

  const b2bSegment = resolveSegment({ customerTags: ["b2b"], b2bTag: "b2b" });
  const b2bAllowed = runPricingPipeline({
    productId: "gid://shopify/Product/GLOBAL_1",
    segment: b2bSegment.segment,
    basePrice: 100,
    discounts: [{ code: "TEN", percentOff: 10 }],
    discountRules: {
      allowStacking: false,
      maxCombinedPercentOff: undefined,
    },
    floorRuleset,
  });

  assert.equal(b2bSegment.segment, "B2B");
  assert.equal(b2bAllowed.marginAllowed, true);
  assert.equal(b2bAllowed.finalPrice, 90);
  assert.equal(b2bAllowed.floorPrice, 65);

  const b2cSegment = resolveSegment({ customerTags: [], b2bTag: "b2b" });
  const b2cBlockedPerProduct = runPricingPipeline({
    productId: "gid://shopify/Product/PER_PRODUCT_1",
    segment: b2cSegment.segment,
    basePrice: 100,
    discounts: [{ code: "TWENTY_FIVE", percentOff: 25 }],
    discountRules: {
      allowStacking: false,
      maxCombinedPercentOff: undefined,
    },
    floorRuleset,
  });

  assert.equal(b2cSegment.segment, "B2C");
  assert.equal(b2cBlockedPerProduct.marginAllowed, false);
  assert.equal(b2cBlockedPerProduct.floorPrice, 80);
  assert.equal(b2cBlockedPerProduct.violationAmount, 5);

  const stackingDisabled = runPricingPipeline({
    productId: "gid://shopify/Product/GLOBAL_2",
    segment: "B2C",
    basePrice: 100,
    discounts: [
      { code: "TWENTY", percentOff: 20 },
      { code: "FIFTEEN", percentOff: 15 },
    ],
    discountRules: {
      allowStacking: false,
      maxCombinedPercentOff: undefined,
    },
    floorRuleset,
  });

  assert.equal(stackingDisabled.totalPercentOff, 20);
  assert.equal(stackingDisabled.marginAllowed, true);
  console.log("[MVP_1 READINESS PASS] Segment/floor/stacking governance je v poradku.");
});
