import test from "node:test";
import assert from "node:assert/strict";
import { resolveDiscounts } from "../../core/discount/discount.orchestrator.ts";

test("discount orchestrator resolves product over collection over global rules", () => {
  const productId = "gid://shopify/Product/ADV_PRODUCT";
  const collectionId = "gid://shopify/Collection/ADV_COLLECTION";

  const result = resolveDiscounts(
    [],
    {
      allowStacking: true,
      rules: [
        {
          id: "global-rule",
          scope: "GLOBAL",
          percentOff: 5,
          priority: 100,
          stackMode: "STACKABLE",
        },
        {
          id: "collection-rule",
          scope: "COLLECTION",
          targetId: collectionId,
          percentOff: 15,
          priority: 100,
          stackMode: "STACKABLE",
        },
        {
          id: "product-rule",
          scope: "PRODUCT",
          targetId: productId,
          percentOff: 25,
          priority: 100,
          stackMode: "STACKABLE",
        },
      ],
      blacklists: [],
      segmentCaps: [],
    },
    {
      productId,
      segment: "B2B",
      collectionIds: [collectionId],
    },
  );

  assert.equal(result.totalPercentOff, 45);
  assert.deepEqual(
    result.appliedDiscounts.map((discount) => discount.id),
    ["product-rule", "collection-rule", "global-rule"],
  );
  assert.deepEqual(
    result.appliedDiscounts.map((discount) => discount.scope),
    ["PRODUCT", "COLLECTION", "GLOBAL"],
  );
});

test("discount orchestrator rejects blacklisted coupon combinations", () => {
  const result = resolveDiscounts(
    [
      { code: "VIP20", percentOff: 20, sourceId: "vip20" },
      { code: "EXTRA10", percentOff: 10, sourceId: "extra10" },
    ],
    {
      allowStacking: true,
      blacklists: [
      {
        leftType: "COUPON_CODE",
        leftValue: "VIP20",
        rightType: "COUPON_CODE",
        rightValue: "EXTRA10",
        segment: "ALL",
      },
      ],
      segmentCaps: [],
    },
    {
      segment: "B2C",
    },
  );

  assert.equal(result.totalPercentOff, 20);
  assert.deepEqual(result.appliedCodes, ["VIP20"]);
  assert.equal(result.rejectedDiscounts.length, 1);
  assert.equal(result.rejectedDiscounts[0]?.code, "EXTRA10");
  assert.equal(result.rejectedDiscounts[0]?.reason, "BLACKLISTED");
  assert.equal(result.rejectedDiscounts[0]?.blockedByCode, "VIP20");
});

test("discount orchestrator applies per-segment caps before floor validation", () => {
  const result = resolveDiscounts(
    [
      { code: "SUMMER30", percentOff: 30, sourceId: "summer30" },
    ],
    {
      allowStacking: true,
      segmentCaps: [
      {
        segment: "B2B",
        maxCombinedPercentOff: 18,
      },
      ],
    },
    {
      segment: "B2B",
    },
  );

  assert.equal(result.totalPercentOff, 18);
  assert.deepEqual(result.appliedCodes, ["SUMMER30"]);
  assert.equal(result.capAdjustments.length, 1);
  assert.equal(result.capAdjustments[0]?.fromPercentOff, 30);
  assert.equal(result.capAdjustments[0]?.toPercentOff, 18);
  assert.equal(result.capAdjustments[0]?.reason, "SEGMENT_CAP");
});

test("discount orchestrator keeps config order as tie-break for equally ranked coupon rules", () => {
  const result = resolveDiscounts(
    [],
    {
      allowStacking: true,
      rules: [
        {
          id: "beta-rule",
          scope: "COUPON",
          code: "BETA10",
          percentOff: 10,
          priority: 100,
          stackMode: "STACKABLE",
        },
        {
          id: "alpha-rule",
          scope: "COUPON",
          code: "ALPHA10",
          percentOff: 10,
          priority: 100,
          stackMode: "STACKABLE",
        },
      ],
      blacklists: [
        {
          leftType: "COUPON_CODE",
          leftValue: "BETA10",
          rightType: "COUPON_CODE",
          rightValue: "ALPHA10",
          segment: "ALL",
        },
      ],
      segmentCaps: [],
    },
    {
      segment: "B2C",
      enteredDiscountCodes: ["ALPHA10", "BETA10"],
    },
  );

  assert.equal(result.totalPercentOff, 10);
  assert.deepEqual(result.appliedCodes, ["BETA10"]);
  assert.equal(result.rejectedDiscounts[0]?.code, "ALPHA10");
  assert.equal(result.rejectedDiscounts[0]?.blockedByCode, "BETA10");
});
