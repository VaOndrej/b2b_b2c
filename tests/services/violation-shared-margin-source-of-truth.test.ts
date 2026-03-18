import test from "node:test";
import assert from "node:assert/strict";
import { validateMargin } from "../../core/margin/margin.guard.ts";
import { evaluateViolationFromSharedMarginGuard } from "../../app/services/cart-validation-violation-sync.server.ts";

test("violation sync uses same margin calculation as shared margin guard", () => {
  const input = {
    productId: "gid://shopify/Product/100",
    segment: "B2C" as const,
    effectiveBasePrice: 100,
    finalPrice: 40,
    floorPercent: 70,
    allowZeroFinalPrice: false,
  };

  const syncResult = evaluateViolationFromSharedMarginGuard(input);
  const sharedResult = validateMargin({
    productId: input.productId,
    segment: input.segment,
    effectiveBasePrice: input.effectiveBasePrice,
    finalPrice: input.finalPrice,
    ruleset: {
      global: {
        minPercentOfBasePrice: input.floorPercent,
        allowZeroFinalPrice: input.allowZeroFinalPrice,
      },
      perProduct: [],
    },
  });

  assert.equal(syncResult.floorPrice, sharedResult.floorPrice);
  assert.equal(syncResult.violationAmount, sharedResult.violationAmount);
  assert.equal(syncResult.reason, "BELOW_FLOOR");
});

test("violation sync zero-price branch matches shared margin guard reasoning", () => {
  const input = {
    productId: "gid://shopify/Product/200",
    segment: "B2B" as const,
    effectiveBasePrice: 90,
    finalPrice: 0,
    floorPercent: 70,
    allowZeroFinalPrice: false,
  };

  const syncResult = evaluateViolationFromSharedMarginGuard(input);

  assert.equal(syncResult.floorPrice, 63);
  assert.equal(syncResult.violationAmount, 63);
  assert.equal(syncResult.reason, "ZERO_FINAL_PRICE_NOT_ALLOWED");
});
