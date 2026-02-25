import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveStorefrontQuantityConstraintsByProductId,
  resolveStorefrontQuantityConstraintsByHandle,
  resolveStorefrontVisibilityByHandles,
} from "../../app/services/storefront-visibility.server.ts";

test("storefront visibility hides B2B_ONLY products for B2C visitors", async () => {
  const admin = {
    async graphql() {
      return {
        async json() {
          return {
            data: {
              products: {
                nodes: [
                  {
                    id: "gid://shopify/Product/8679309213867",
                    handle: "featured-product",
                  },
                ],
              },
            },
          };
        },
      };
    },
  };

  const result = await resolveStorefrontVisibilityByHandles({
    admin,
    handles: ["featured-product"],
    segment: "B2C",
    rules: [
      {
        productId: "gid://shopify/Product/8679309213867",
        visibilityMode: "B2B_ONLY",
      },
    ],
  });

  assert.deepEqual(result.hiddenHandles, ["featured-product"]);
  assert.deepEqual(result.hiddenProductIds, ["gid://shopify/Product/8679309213867"]);
  assert.equal(
    result.productIdByHandle["featured-product"],
    "gid://shopify/Product/8679309213867",
  );
  assert.equal(result.visibilityByHandle["featured-product"], false);
});

test("storefront visibility lookup quotes handles and falls back per handle", async () => {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const responses = [
    {
      data: {
        products: {
          nodes: [],
        },
      },
    },
    {
      data: {
        products: {
          nodes: [
            {
              id: "gid://shopify/Product/8679309213867",
              handle: "my-featured-product",
            },
          ],
        },
      },
    },
  ];

  const admin = {
    async graphql(_query: string, options?: { variables?: Record<string, unknown> }) {
      calls.push(options?.variables);
      const payload = responses.shift() ?? { data: { products: { nodes: [] } } };
      return {
        async json() {
          return payload;
        },
      };
    },
  };

  const result = await resolveStorefrontVisibilityByHandles({
    admin,
    handles: ["my-featured-product"],
    segment: "B2C",
    rules: [
      {
        productId: "gid://shopify/Product/8679309213867",
        visibilityMode: "B2B_ONLY",
      },
    ],
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.query, "handle:'my-featured-product'");
  assert.equal(calls[0]?.first, 1);
  assert.equal(calls[1]?.query, "handle:'my-featured-product'");
  assert.equal(result.visibilityByHandle["my-featured-product"], false);
  assert.deepEqual(result.hiddenHandles, ["my-featured-product"]);
});

test("storefront quantity constraints resolve step and MOQ per handle", () => {
  const constraintsByHandle = resolveStorefrontQuantityConstraintsByHandle({
    handles: ["my-featured-product"],
    productIdByHandle: {
      "my-featured-product": "gid://shopify/Product/8679309213867",
    },
    segment: "B2C",
    rules: [
      {
        productId: "gid://shopify/Product/8679309213867",
        minimumOrderQuantity: 1,
        stepQuantity: 2,
      },
      {
        productId: "gid://shopify/Product/8679309213867",
        segment: "B2B",
        minimumOrderQuantity: 5,
        stepQuantity: 4,
      },
    ],
  });

  assert.deepEqual(constraintsByHandle, {
    "my-featured-product": {
      minimumOrderQuantity: 1,
      stepQuantity: 2,
    },
  });
});

test("storefront quantity constraints resolve by product id without handle lookup", () => {
  const constraintsByProductId = resolveStorefrontQuantityConstraintsByProductId({
    productIds: ["8679308853419", "gid://shopify/Product/8679309213867"],
    segment: "B2C",
    rules: [
      {
        productId: "gid://shopify/Product/8679308853419",
        minimumOrderQuantity: 1,
        stepQuantity: 2,
      },
      {
        productId: "gid://shopify/Product/8679309213867",
        minimumOrderQuantity: 3,
        stepQuantity: 1,
      },
    ],
  });

  assert.deepEqual(constraintsByProductId, {
    "gid://shopify/Product/8679308853419": {
      minimumOrderQuantity: 1,
      stepQuantity: 2,
    },
    "gid://shopify/Product/8679309213867": {
      minimumOrderQuantity: 3,
      stepQuantity: 1,
    },
  });
});

test("storefront quantity constraints apply customer max override over segment max", () => {
  const productId = "gid://shopify/Product/MAX_OVERRIDE";
  const baseRules = [
    {
      productId,
      minimumOrderQuantity: 1,
      stepQuantity: 2,
      maxOrderQuantity: 10,
    },
  ];
  const customerRules = [
    {
      productId,
      customerId: "gid://shopify/Customer/42",
      maxOrderQuantity: 40,
    },
  ];

  const overridden = resolveStorefrontQuantityConstraintsByProductId({
    productIds: [productId],
    segment: "B2C",
    customerId: "gid://shopify/Customer/42",
    rules: baseRules,
    customerMaxRules: customerRules,
  });
  assert.deepEqual(overridden, {
    [productId]: {
      minimumOrderQuantity: 1,
      stepQuantity: 2,
      maxOrderQuantity: 40,
    },
  });

  const withoutOverride = resolveStorefrontQuantityConstraintsByProductId({
    productIds: [productId],
    segment: "B2C",
    customerId: "gid://shopify/Customer/999",
    rules: baseRules,
    customerMaxRules: customerRules,
  });
  assert.deepEqual(withoutOverride, {
    [productId]: {
      minimumOrderQuantity: 1,
      stepQuantity: 2,
      maxOrderQuantity: 10,
    },
  });
});
