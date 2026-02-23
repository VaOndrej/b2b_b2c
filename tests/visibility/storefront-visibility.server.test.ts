import test from "node:test";
import assert from "node:assert/strict";
import { resolveStorefrontVisibilityByHandles } from "../../app/services/storefront-visibility.server.ts";

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
