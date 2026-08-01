import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveQuantityConstraints,
  validateQuantity,
} from "../../src/quantity/quantity.engine.ts";

test("quantity constraints default to min=1, step=1 and no maximum", () => {
  assert.deepEqual(resolveQuantityConstraints({ quantity: 1, rules: [] }), {
    minimumOrderQuantity: 1,
    stepQuantity: 1,
    maxOrderQuantity: null,
  });
});

test("segment-specific MOQ wins over an all-segment rule at the same target", () => {
  const rules = [
    { productId: "gid://shopify/Product/MOQ", minimumOrderQuantity: 3 },
    {
      productId: "gid://shopify/Product/MOQ",
      segment: "B2B" as const,
      minimumOrderQuantity: 5,
    },
  ];

  assert.equal(
    resolveQuantityConstraints({
      quantity: 1,
      segment: "B2C",
      productId: "gid://shopify/Product/MOQ",
      rules,
    }).minimumOrderQuantity,
    3,
  );
  assert.equal(
    resolveQuantityConstraints({
      quantity: 1,
      segment: "B2B",
      productId: "gid://shopify/Product/MOQ",
      rules,
    }).minimumOrderQuantity,
    5,
  );
});

test("product rules win over collection and global rules", () => {
  const constraints = resolveQuantityConstraints({
    quantity: 2,
    productId: "gid://shopify/Product/SPECIFIC",
    collectionIds: ["gid://shopify/Collection/42"],
    segment: "B2C",
    rules: [
      { minimumOrderQuantity: 2 },
      {
        collectionId: "gid://shopify/Collection/42",
        minimumOrderQuantity: 6,
      },
      {
        productId: "gid://shopify/Product/SPECIFIC",
        minimumOrderQuantity: 4,
      },
    ],
  });

  assert.equal(constraints.minimumOrderQuantity, 4);
});

test("segment-specific step wins at the same target", () => {
  const rules = [
    { productId: "gid://shopify/Product/STEP", stepQuantity: 6 },
    {
      productId: "gid://shopify/Product/STEP",
      segment: "B2C" as const,
      stepQuantity: 4,
    },
  ];

  assert.equal(
    validateQuantity({
      quantity: 8,
      segment: "B2C",
      productId: "gid://shopify/Product/STEP",
      rules,
    }),
    true,
  );
  assert.equal(
    validateQuantity({
      quantity: 6,
      segment: "B2C",
      productId: "gid://shopify/Product/STEP",
      rules,
    }),
    false,
  );
});

test("invalid constraints are ignored and finite decimals are floored", () => {
  const invalid = resolveQuantityConstraints({
    quantity: 1,
    rules: [
      {
        minimumOrderQuantity: Number.NaN,
        stepQuantity: 0,
        maxOrderQuantity: -1,
      },
    ],
  });
  assert.deepEqual(invalid, {
    minimumOrderQuantity: 1,
    stepQuantity: 1,
    maxOrderQuantity: null,
  });

  const normalized = resolveQuantityConstraints({
    quantity: 1,
    rules: [
      {
        minimumOrderQuantity: 3.9,
        stepQuantity: 2.8,
        maxOrderQuantity: 9.7,
      },
    ],
  });
  assert.deepEqual(normalized, {
    minimumOrderQuantity: 3,
    stepQuantity: 2,
    maxOrderQuantity: 9,
  });
});

test("product max wins over a collection max at lower target priority", () => {
  const input = {
    quantity: 1,
    productId: "gid://shopify/Product/COMBO",
    collectionIds: ["gid://shopify/Collection/99"],
    segment: "B2C" as const,
    rules: [
      {
        collectionId: "gid://shopify/Collection/99",
        minimumOrderQuantity: 6,
        maxOrderQuantity: 20,
      },
      {
        productId: "gid://shopify/Product/COMBO",
        minimumOrderQuantity: 3,
        maxOrderQuantity: 10,
      },
    ],
  };

  assert.deepEqual(resolveQuantityConstraints(input), {
    minimumOrderQuantity: 3,
    stepQuantity: 1,
    maxOrderQuantity: 10,
  });
});

test("the strictest maximum wins when target and segment priority tie", () => {
  const constraints = resolveQuantityConstraints({
    quantity: 1,
    productId: "gid://shopify/Product/MAX",
    segment: "B2C",
    rules: [
      { productId: "gid://shopify/Product/MAX", maxOrderQuantity: 10 },
      { productId: "gid://shopify/Product/MAX", maxOrderQuantity: 7 },
      { productId: "gid://shopify/Product/MAX", maxOrderQuantity: 12 },
    ],
  });

  assert.equal(constraints.maxOrderQuantity, 7);
});

test("segment-specific maximum wins over an all-segment maximum", () => {
  const rules = [
    { productId: "gid://shopify/Product/MAX", maxOrderQuantity: 10 },
    {
      productId: "gid://shopify/Product/MAX",
      segment: "B2B" as const,
      maxOrderQuantity: 40,
    },
  ];

  assert.equal(
    resolveQuantityConstraints({
      quantity: 1,
      segment: "B2C",
      productId: "gid://shopify/Product/MAX",
      rules,
    }).maxOrderQuantity,
    10,
  );
  assert.equal(
    resolveQuantityConstraints({
      quantity: 1,
      segment: "B2B",
      productId: "gid://shopify/Product/MAX",
      rules,
    }).maxOrderQuantity,
    40,
  );
});

test("validation rejects quantities below minimum, outside step, or above maximum", () => {
  const rules = [
    {
      productId: "gid://shopify/Product/VALIDATE",
      minimumOrderQuantity: 3,
      stepQuantity: 2,
      maxOrderQuantity: 7,
    },
  ];
  const validate = (quantity: number) =>
    validateQuantity({
      quantity,
      productId: "gid://shopify/Product/VALIDATE",
      rules,
    });

  assert.equal(validate(2), false, "below minimum");
  assert.equal(validate(5), false, "outside step");
  assert.equal(validate(8), false, "above maximum");
  assert.equal(validate(6), true, "valid quantity");
});
