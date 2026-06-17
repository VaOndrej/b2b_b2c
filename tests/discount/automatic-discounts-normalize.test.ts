import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDiscountNode } from "../../app/services/automatic-discounts.server.ts";

function basicNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/DiscountAutomaticNode/1",
    discount: {
      __typename: "DiscountAutomaticBasic",
      title: "Spring Sale",
      status: "ACTIVE",
      customerGets: {
        value: { __typename: "DiscountPercentage", percentage: 0.4 },
        items: { __typename: "AllDiscountItems", allItems: true },
      },
      ...overrides,
    },
  };
}

test("normalizes a global percentage automatic discount", () => {
  const result = normalizeDiscountNode(basicNode());
  assert.deepEqual(result, [
    {
      id: "gid://shopify/DiscountAutomaticNode/1",
      title: "Spring Sale",
      percentOff: 40,
      scope: "GLOBAL",
    },
  ]);
});

test("expands product-scoped discount into one entry per product", () => {
  const node = basicNode({
    customerGets: {
      value: { __typename: "DiscountPercentage", percentage: 0.25 },
      items: {
        __typename: "DiscountProducts",
        products: {
          nodes: [
            { id: "gid://shopify/Product/1" },
            { id: "gid://shopify/Product/2" },
          ],
        },
      },
    },
  });
  const result = normalizeDiscountNode(node);
  assert.equal(result.length, 2);
  assert.ok(result.every((d) => d.scope === "PRODUCT" && d.percentOff === 25));
  assert.deepEqual(
    result.map((d) => d.targetId),
    ["gid://shopify/Product/1", "gid://shopify/Product/2"],
  );
});

test("expands collection-scoped discount into one entry per collection", () => {
  const node = basicNode({
    customerGets: {
      value: { __typename: "DiscountPercentage", percentage: 0.5 },
      items: {
        __typename: "DiscountCollections",
        collections: { nodes: [{ id: "gid://shopify/Collection/9" }] },
      },
    },
  });
  const result = normalizeDiscountNode(node);
  assert.deepEqual(result, [
    {
      id: "gid://shopify/DiscountAutomaticNode/1",
      title: "Spring Sale",
      percentOff: 50,
      scope: "COLLECTION",
      targetId: "gid://shopify/Collection/9",
    },
  ]);
});

test("skips inactive, non-percentage, and non-automatic discounts", () => {
  assert.deepEqual(normalizeDiscountNode(basicNode({ status: "EXPIRED" })), []);
  assert.deepEqual(
    normalizeDiscountNode(
      basicNode({
        customerGets: {
          value: { __typename: "DiscountAmount", amount: { amount: "5.0" } },
          items: { __typename: "AllDiscountItems", allItems: true },
        },
      }),
    ),
    [],
  );
  assert.deepEqual(
    normalizeDiscountNode({ id: "x", discount: { __typename: "DiscountCodeBasic" } }),
    [],
  );
});

test("skips zero-percent discounts", () => {
  const node = basicNode({
    customerGets: {
      value: { __typename: "DiscountPercentage", percentage: 0 },
      items: { __typename: "AllDiscountItems", allItems: true },
    },
  });
  assert.deepEqual(normalizeDiscountNode(node), []);
});
