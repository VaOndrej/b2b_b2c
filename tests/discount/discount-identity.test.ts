import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDiscountRuleLookupKey,
  canonicalizeDiscountBlacklistPair,
} from "../../core/discount/discount.identity.ts";

test("discount rule lookup key is stable across nullish inputs", () => {
  const undefinedKey = buildDiscountRuleLookupKey({
    scope: "GLOBAL",
    targetId: undefined,
    code: undefined,
    segment: undefined,
  });
  const nullKey = buildDiscountRuleLookupKey({
    scope: "GLOBAL",
    targetId: null,
    code: null,
    segment: null,
  });

  assert.equal(undefinedKey, nullKey);
  assert.equal(undefinedKey, "GLOBAL|ALL|GLOBAL");
});

test("discount blacklist canonicalization normalizes coupon codes and ignores pair direction", () => {
  const leftFirst = canonicalizeDiscountBlacklistPair({
    leftType: "COUPON_CODE",
    leftValue: " vip20 ",
    rightType: "RULE_ID",
    rightValue: "rule-2",
    segment: "B2B",
  });
  const rightFirst = canonicalizeDiscountBlacklistPair({
    leftType: "RULE_ID",
    leftValue: "rule-2",
    rightType: "COUPON_CODE",
    rightValue: "VIP20",
    segment: "B2B",
  });

  assert.deepEqual(leftFirst, rightFirst);
  assert.equal(
    leftFirst.pairKey,
    "B2B|COUPON_CODE:VIP20|RULE_ID:rule-2",
  );
});
