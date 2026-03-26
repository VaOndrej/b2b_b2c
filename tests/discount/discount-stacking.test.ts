import test from "node:test";
import assert from "node:assert/strict";
import { resolveDiscounts } from "../../core/discount/discount.orchestrator.ts";

test("discount orchestrator sums all codes when stacking is enabled", () => {
  const result = resolveDiscounts(
    [
      { code: "SUMMER10", percentOff: 10 },
      { code: "VIP15", percentOff: 15 },
    ],
    { allowStacking: true },
  );

  assert.equal(result.totalPercentOff, 25, "stacking must sum both discounts");
  assert.deepEqual(result.appliedCodes, ["SUMMER10", "VIP15"]);
});

test("discount orchestrator caps stacked discounts by maxCombinedPercentOff", () => {
  const result = resolveDiscounts(
    [
      { code: "A", percentOff: 20 },
      { code: "B", percentOff: 25 },
    ],
    { allowStacking: true, maxCombinedPercentOff: 30 },
  );

  assert.equal(
    result.totalPercentOff,
    30,
    "stacked total 45% must be capped to maxCombinedPercentOff 30%",
  );
  assert.deepEqual(result.appliedCodes, ["A", "B"]);
});

test("discount orchestrator clamps stacked total to 100% even without cap", () => {
  const result = resolveDiscounts(
    [
      { code: "X", percentOff: 60 },
      { code: "Y", percentOff: 70 },
    ],
    { allowStacking: true },
  );

  assert.equal(
    result.totalPercentOff,
    100,
    "stacked total 130% must be clamped to 100%",
  );
});

test("discount orchestrator picks best single code when stacking is disabled", () => {
  const result = resolveDiscounts(
    [
      { code: "SMALL5", percentOff: 5 },
      { code: "BIG20", percentOff: 20 },
    ],
    { allowStacking: false },
  );

  assert.equal(
    result.totalPercentOff,
    20,
    "without stacking, only the highest discount applies",
  );
  assert.deepEqual(result.appliedCodes, ["BIG20"]);
});
