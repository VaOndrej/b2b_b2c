import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCouponSegmentRule,
  validateCouponsBySegment,
} from "../../core/discount/coupon-segment.rules.ts";

test("coupon segment validation normalizes rules and rejects mismatched segment codes", () => {
  const normalized = normalizeCouponSegmentRule({
    code: " vip20 ",
    allowedSegment: "B2B",
  });
  assert.deepEqual(normalized, {
    code: "VIP20",
    allowedSegment: "B2B",
  });

  const result = validateCouponsBySegment({
    segment: "B2C",
    rules: [
      { code: "vip20", allowedSegment: "B2B" },
      { code: "retail10", allowedSegment: "B2C" },
      { code: "all5", allowedSegment: "ALL" },
    ],
    enteredCoupons: [
      { code: "VIP20", rejectable: true },
      { code: "retail10", rejectable: true },
      { code: " all5 ", rejectable: true },
      { code: "unknown", rejectable: true },
    ],
  });

  assert.deepEqual(result.rejectedCodes, ["VIP20"]);
  assert.deepEqual(result.acceptedCodes, ["RETAIL10", "ALL5", "UNKNOWN"]);
  assert.deepEqual(result.nonRejectableMismatches, []);
});

test("coupon segment validation tracks non-rejectable mismatches separately", () => {
  const result = validateCouponsBySegment({
    segment: "B2B",
    rules: [{ code: "RETAIL_ONLY", allowedSegment: "B2C" }],
    enteredCoupons: [{ code: "retail_only", rejectable: false }],
  });

  assert.deepEqual(result.rejectedCodes, []);
  assert.deepEqual(result.nonRejectableMismatches, ["RETAIL_ONLY"]);
});
