import test from "node:test";
import assert from "node:assert/strict";
import { resolveDiscounts } from "../../core/discount/discount.orchestrator.ts";

test("advanced orchestration prefers product rule over collection and global defaults", () => {
  const result = resolveDiscounts(
    [],
    {
      allowStacking: false,
      rules: [
        {
          id: "global-5",
          scope: "GLOBAL",
          percentOff: 5,
          priority: 100,
        },
        {
          id: "collection-10",
          scope: "COLLECTION",
          targetId: "gid://shopify/Collection/TOOLS",
          percentOff: 10,
          priority: 100,
        },
        {
          id: "product-15",
          scope: "PRODUCT",
          targetId: "gid://shopify/Product/DRILL",
          percentOff: 15,
          priority: 100,
        },
      ],
    },
    {
      productId: "gid://shopify/Product/DRILL",
      segment: "B2C",
      collectionIds: ["gid://shopify/Collection/TOOLS"],
    },
  );

  assert.equal(result.totalPercentOff, 15);
  assert.deepEqual(result.appliedDiscounts.map((discount) => discount.id), [
    "product-15",
  ]);
});

test("advanced orchestration keeps config order for equally ranked product rules", () => {
  const productId = "gid://shopify/Product/TIE_BREAK";
  const result = resolveDiscounts(
    [],
    {
      allowStacking: true,
      rules: [
        {
          id: "product-beta",
          scope: "PRODUCT",
          targetId: productId,
          percentOff: 10,
          priority: 100,
        },
        {
          id: "product-alpha",
          scope: "PRODUCT",
          targetId: productId,
          percentOff: 10,
          priority: 100,
        },
      ],
      blacklists: [],
      segmentCaps: [],
    },
    {
      productId,
      segment: "B2C",
    },
  );

  assert.deepEqual(result.appliedDiscounts.map((discount) => discount.id), [
    "product-beta",
    "product-alpha",
  ]);
});

test("advanced orchestration rejects lower priority rule when blacklist conflicts", () => {
  const result = resolveDiscounts(
    [],
    {
      allowStacking: true,
      rules: [
        {
          id: "vip-rule",
          scope: "COUPON",
          code: "VIP20",
          percentOff: 20,
          priority: 200,
        },
        {
          id: "extra-rule",
          scope: "COUPON",
          code: "EXTRA10",
          percentOff: 10,
          priority: 100,
        },
      ],
      blacklists: [
        {
          leftType: "COUPON_CODE",
          leftValue: "VIP20",
          rightType: "COUPON_CODE",
          rightValue: "EXTRA10",
        },
      ],
    },
    {
      productId: "gid://shopify/Product/1",
      segment: "B2C",
      enteredDiscountCodes: ["VIP20", "EXTRA10"],
    },
  );

  assert.equal(result.totalPercentOff, 20);
  assert.deepEqual(result.appliedCodes, ["VIP20"]);
  assert.equal(
    result.rejectedDiscounts.some(
      (discount) =>
        discount.id === "extra-rule" && discount.reason === "BLACKLISTED",
    ),
    true,
  );
});

test("advanced orchestration trims lower priority discount first when segment cap is exceeded", () => {
  const result = resolveDiscounts(
    [],
    {
      allowStacking: true,
      rules: [
        {
          id: "product-30",
          scope: "PRODUCT",
          targetId: "gid://shopify/Product/1",
          percentOff: 30,
          priority: 200,
        },
        {
          id: "collection-20",
          scope: "COLLECTION",
          targetId: "gid://shopify/Collection/BULK",
          percentOff: 20,
          priority: 100,
        },
      ],
      segmentCaps: [
        {
          segment: "B2B",
          maxCombinedPercentOff: 40,
        },
      ],
    },
    {
      productId: "gid://shopify/Product/1",
      segment: "B2B",
      collectionIds: ["gid://shopify/Collection/BULK"],
    },
  );

  assert.equal(result.totalPercentOff, 40);
  assert.deepEqual(
    result.appliedDiscounts.map((discount) => ({
      id: discount.id,
      appliedPercentOff: discount.appliedPercentOff,
    })),
    [
      { id: "product-30", appliedPercentOff: 30 },
      { id: "collection-20", appliedPercentOff: 10 },
    ],
  );
  assert.equal(result.capAdjustments.length, 1);
  assert.equal(result.capAdjustments[0]?.id, "collection-20");
});
