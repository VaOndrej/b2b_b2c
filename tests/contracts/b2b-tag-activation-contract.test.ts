import test from "node:test";
import assert from "node:assert/strict";
import { buildCartValidationFunctionConfig } from "../../core/config/function-config.ts";
import { hasExpectedB2BTags } from "../../app/services/cart-validation-activation.server.ts";

test("custom b2bTag propagates into cart validation config b2bTags", () => {
  const config = buildCartValidationFunctionConfig({
    b2bTag: " wholesale ",
    globalMinPricePercent: 70,
    b2bGlobalMinPricePercent: 65,
    allowZeroFinalPrice: false,
    allowStacking: false,
    maxCombinedPercentOff: null,
    productFloors: [],
    productTierPrices: [],
    productQuantityRules: [],
    collectionQuantityRules: [],
    productCustomerQuantityRules: [],
    productVisibilityRules: [],
    couponSegmentRules: [],
  });

  assert.deepEqual(config.b2bTags, ["wholesale"]);
  assert.equal(
    hasExpectedB2BTags(config, "wholesale"),
    true,
    "Activation guard must accept normalized custom b2bTag in b2bTags.",
  );
});

test("activation guard rejects stale default b2bTags for custom b2bTag", () => {
  const staleConfig = {
    b2bTag: "wholesale",
    b2bTags: ["b2b"],
  } as any;

  assert.equal(
    hasExpectedB2BTags(staleConfig, "wholesale"),
    false,
    "Activation guard must fail when function config still carries stale default b2b tag.",
  );
});
