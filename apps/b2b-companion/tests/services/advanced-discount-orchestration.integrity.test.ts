import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDiscountCombinationBlacklistCanonicalPairKey,
  buildDiscountRuleCanonicalKey,
} from "../../app/services/margin-guard-config.server.ts";

test("advanced discount canonical keys normalize rule identity and blacklist symmetry", () => {
  const productRuleKey = buildDiscountRuleCanonicalKey({
    scope: "PRODUCT",
    segment: "B2B",
    targetId: " gid://shopify/Product/123 ",
  });
  const couponRuleKey = buildDiscountRuleCanonicalKey({
    scope: "COUPON",
    segment: "all",
    code: " vip20 ",
  });
  const globalRuleKey = buildDiscountRuleCanonicalKey({
    scope: "GLOBAL",
    segment: undefined,
  });

  assert.equal(
    productRuleKey,
    "PRODUCT|B2B|PRODUCT:gid://shopify/Product/123",
  );
  assert.equal(couponRuleKey, "COUPON|ALL|COUPON:VIP20");
  assert.equal(globalRuleKey, "GLOBAL|ALL|GLOBAL");

  const forwardBlacklistKey = buildDiscountCombinationBlacklistCanonicalPairKey({
    leftType: "COUPON_CODE",
    leftValue: " vip20 ",
    rightType: "RULE_ID",
    rightValue: "rule-123",
    segment: "B2B",
  });
  const reverseBlacklistKey = buildDiscountCombinationBlacklistCanonicalPairKey({
    leftType: "RULE_ID",
    leftValue: "rule-123",
    rightType: "COUPON_CODE",
    rightValue: "VIP20",
    segment: "B2B",
  });
  const segmentSplitBlacklistKey = buildDiscountCombinationBlacklistCanonicalPairKey({
    leftType: "RULE_ID",
    leftValue: "rule-123",
    rightType: "COUPON_CODE",
    rightValue: "VIP20",
    segment: "ALL",
  });

  assert.equal(forwardBlacklistKey, reverseBlacklistKey);
  assert.equal(
    forwardBlacklistKey,
    "B2B|COUPON_CODE:VIP20|RULE_ID:rule-123",
  );
  assert.equal(
    segmentSplitBlacklistKey,
    "ALL|COUPON_CODE:VIP20|RULE_ID:rule-123",
  );
});
