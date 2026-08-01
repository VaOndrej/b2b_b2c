import test from "node:test";
import assert from "node:assert/strict";
import { resolveDiscounts } from "../../core/discount/discount.orchestrator.ts";
import type { DiscountRules } from "../../core/discount/discount.rules.ts";

/**
 * Explicit coverage for the discount cap + stacking outcomes that had NO tests:
 * min(global, segment) caps, CAP_REDUCED_TO_ZERO, NEVER_WITH_COUPONS conflicts,
 * appliedCodes ordering — and a regression guard for the cap-underflow bug found by
 * the property test (roundPercent clamped the excess to 100, so a combined cap far
 * below the stacked total was silently breached).
 */

test("combined cap is enforced even when stacked discounts exceed 100%", () => {
  // Two 90% discounts stack to 180% raw. Cap is 80%. Before the fix, the excess was
  // measured against a total clamped to 100 (→ trim only 20), leaving the line at 100%
  // off (free). The cap must hold: total is exactly 80%.
  const result = resolveDiscounts(
    [
      { code: "A", percentOff: 90, priority: 5 },
      { code: "B", percentOff: 90, priority: 1 },
    ],
    { allowStacking: true, maxCombinedPercentOff: 80 },
  );
  assert.equal(result.totalPercentOff, 80);
  // Excess trimmed from the lowest-priority discount first (B), so A survives whole.
  const applied = new Map(result.appliedDiscounts.map((d) => [d.code, d.appliedPercentOff]));
  assert.equal(applied.get("A"), 80);
  assert.equal(applied.get("B") ?? 0, 0);
});

test("cap far below the stacked total still holds (excess not clamped to 100)", () => {
  // 83 + 73 + 41 = 197 raw, cap 16. The excess (181) exceeds 100; if it were clamped
  // the cap would leak. Total must be exactly 16.
  const result = resolveDiscounts(
    [
      { code: "A", percentOff: 83, priority: 3 },
      { code: "B", percentOff: 73, priority: 2 },
      { code: "C", percentOff: 41, priority: 1 },
    ],
    { allowStacking: true, maxCombinedPercentOff: 16 },
  );
  assert.equal(result.totalPercentOff, 16);
});

test("min(global, segment) cap applies with GLOBAL_AND_SEGMENT_CAP reason", () => {
  const rules: DiscountRules = {
    allowStacking: true,
    maxCombinedPercentOff: 40,
    segmentCaps: [{ segment: "B2B", maxCombinedPercentOff: 25 }],
  };
  const result = resolveDiscounts(
    [{ code: "BIG", percentOff: 60, sourceId: "big" }],
    rules,
    { segment: "B2B" },
  );
  assert.equal(result.totalPercentOff, 25, "the tighter (segment) cap wins");
  assert.equal(result.capAdjustments.length, 1);
  assert.equal(result.capAdjustments[0]?.reason, "GLOBAL_AND_SEGMENT_CAP");
  assert.equal(result.capAdjustments[0]?.fromPercentOff, 60);
  assert.equal(result.capAdjustments[0]?.toPercentOff, 25);
});

test("a discount trimmed to zero by the cap is rejected as CAP_REDUCED_TO_ZERO", () => {
  const result = resolveDiscounts(
    [
      { code: "KEEP", percentOff: 30, priority: 5 },
      { code: "DROP", percentOff: 30, priority: 1 },
    ],
    { allowStacking: true, maxCombinedPercentOff: 30 },
  );
  assert.equal(result.totalPercentOff, 30);
  assert.deepEqual(result.appliedCodes, ["KEEP"]);
  const dropped = result.rejectedDiscounts.find((r) => r.code === "DROP");
  assert.ok(dropped, "DROP should be rejected");
  assert.equal(dropped?.reason, "CAP_REDUCED_TO_ZERO");
});

test("NEVER_WITH_COUPONS rule conflicts with an entered coupon → STACKING_CONFLICT", () => {
  const result = resolveDiscounts(
    [],
    {
      allowStacking: true,
      rules: [
        { id: "coupon", scope: "COUPON", code: "SAVE", percentOff: 20, priority: 200 },
        {
          id: "loyalty",
          scope: "GLOBAL",
          percentOff: 15,
          priority: 100,
          stackMode: "NEVER_WITH_COUPONS",
        },
      ],
    },
    { enteredDiscountCodes: ["SAVE"] },
  );
  // The coupon (higher priority) is selected first; the NEVER_WITH_COUPONS rule loses.
  assert.deepEqual(result.appliedCodes, ["SAVE"]);
  const rejected = result.rejectedDiscounts.find((r) => r.id === "loyalty");
  assert.ok(rejected, "loyalty rule should be rejected");
  assert.equal(rejected?.reason, "STACKING_CONFLICT");
  assert.equal(rejected?.blockedById, "coupon");
});

test("appliedCodes preserves the input entry order (by sequence)", () => {
  const result = resolveDiscounts(
    [
      { code: "FIRST", percentOff: 10 },
      { code: "SECOND", percentOff: 10 },
      { code: "THIRD", percentOff: 10 },
    ],
    { allowStacking: true },
  );
  assert.deepEqual(result.appliedCodes, ["FIRST", "SECOND", "THIRD"]);
});
