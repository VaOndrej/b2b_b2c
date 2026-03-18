import test from "node:test";
import assert from "node:assert/strict";
import { buildQuantityRuleUpdateData } from "../../app/services/margin-guard-config.server.ts";

test("upsertProductQuantityRule preserves step and max when updating MOQ", () => {
  const data = buildQuantityRuleUpdateData(
    { stepQuantity: 5, maxOrderQuantity: 12 },
    3,
  );

  assert.equal(data.minimumOrderQuantity, 3);
  assert.equal(data.stepQuantity, 5);
  assert.equal(data.maxOrderQuantity, 12);
});

test("upsertProductQuantityRule keeps null step/max when not set", () => {
  const data = buildQuantityRuleUpdateData(
    { stepQuantity: null, maxOrderQuantity: null },
    4,
  );

  assert.equal(data.minimumOrderQuantity, 4);
  assert.equal(data.stepQuantity, null);
  assert.equal(data.maxOrderQuantity, null);
});
