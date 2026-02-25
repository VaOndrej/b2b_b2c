import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveQuantityConstraints,
  validateQuantity,
} from "../../core/quantity/quantity.engine.ts";

test("quantity engine resolves segment-specific MOQ over all-segment rule", () => {
  const rules = [
    {
      productId: "gid://shopify/Product/MOQ",
      minimumOrderQuantity: 3,
    },
    {
      productId: "gid://shopify/Product/MOQ",
      segment: "B2B" as const,
      minimumOrderQuantity: 5,
    },
  ];

  const b2cConstraints = resolveQuantityConstraints({
    quantity: 1,
    segment: "B2C",
    productId: "gid://shopify/Product/MOQ",
    rules,
  });
  assert.equal(b2cConstraints.minimumOrderQuantity, 3);

  const b2bConstraints = resolveQuantityConstraints({
    quantity: 1,
    segment: "B2B",
    productId: "gid://shopify/Product/MOQ",
    rules,
  });
  assert.equal(b2bConstraints.minimumOrderQuantity, 5);
  assert.equal(
    validateQuantity({
      quantity: 4,
      segment: "B2B",
      productId: "gid://shopify/Product/MOQ",
      rules,
    }),
    false,
  );
});

test("quantity engine prioritizes product rule over collection and global rules", () => {
  const constraints = resolveQuantityConstraints({
    quantity: 2,
    productId: "gid://shopify/Product/SPECIFIC",
    collectionIds: ["gid://shopify/Collection/42"],
    segment: "B2C",
    rules: [
      {
        minimumOrderQuantity: 2,
      },
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

test("quantity engine applies step quantity with segment precedence", () => {
  const rules = [
    {
      productId: "gid://shopify/Product/STEP",
      stepQuantity: 6,
    },
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
  assert.equal(
    validateQuantity({
      quantity: 12,
      segment: "B2B",
      productId: "gid://shopify/Product/STEP",
      rules,
    }),
    true,
  );
});

test("quantity engine treats step <= 1 as no restriction", () => {
  assert.equal(
    validateQuantity({
      quantity: 5,
      segment: "B2C",
      productId: "gid://shopify/Product/STEP_DISABLED",
      rules: [
        {
          productId: "gid://shopify/Product/STEP_DISABLED",
          stepQuantity: 1,
        },
      ],
    }),
    true,
  );
});

test("quantity engine resolves max quantity with segment precedence", () => {
  const rules = [
    {
      productId: "gid://shopify/Product/MAX",
      maxOrderQuantity: 10,
    },
    {
      productId: "gid://shopify/Product/MAX",
      segment: "B2B" as const,
      maxOrderQuantity: 40,
    },
  ];

  const b2cConstraints = resolveQuantityConstraints({
    quantity: 1,
    segment: "B2C",
    productId: "gid://shopify/Product/MAX",
    rules,
  });
  assert.equal(b2cConstraints.maxOrderQuantity, 10);
  assert.equal(
    validateQuantity({
      quantity: 11,
      segment: "B2C",
      productId: "gid://shopify/Product/MAX",
      rules,
    }),
    false,
  );

  const b2bConstraints = resolveQuantityConstraints({
    quantity: 1,
    segment: "B2B",
    productId: "gid://shopify/Product/MAX",
    rules,
  });
  assert.equal(b2bConstraints.maxOrderQuantity, 40);
  assert.equal(
    validateQuantity({
      quantity: 39,
      segment: "B2B",
      productId: "gid://shopify/Product/MAX",
      rules,
    }),
    true,
  );
});
