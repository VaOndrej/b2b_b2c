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
      scope: "GLOBAL",
      valueType: "PERCENTAGE",
      percentOff: 40,
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
      scope: "COLLECTION",
      targetId: "gid://shopify/Collection/9",
      valueType: "PERCENTAGE",
      percentOff: 50,
    },
  ]);
});

test("normalizes a per-order fixed-amount automatic discount", () => {
  const result = normalizeDiscountNode(
    basicNode({
      customerGets: {
        value: { __typename: "DiscountAmount", amount: { amount: "5.0" } },
        items: { __typename: "AllDiscountItems", allItems: true },
      },
    }),
  );
  assert.deepEqual(result, [
    {
      id: "gid://shopify/DiscountAutomaticNode/1",
      title: "Spring Sale",
      scope: "GLOBAL",
      valueType: "FIXED_AMOUNT",
      amount: 5,
      amountScope: "PER_ORDER",
    },
  ]);
});

test("normalizes a per-unit fixed-amount automatic discount", () => {
  const result = normalizeDiscountNode(
    basicNode({
      customerGets: {
        value: {
          __typename: "DiscountAmount",
          appliesOnEachItem: true,
          amount: { amount: "3" },
        },
        items: {
          __typename: "DiscountProducts",
          products: { nodes: [{ id: "gid://shopify/Product/7" }] },
        },
      },
    }),
  );
  assert.deepEqual(result, [
    {
      id: "gid://shopify/DiscountAutomaticNode/1",
      title: "Spring Sale",
      scope: "PRODUCT",
      targetId: "gid://shopify/Product/7",
      valueType: "FIXED_AMOUNT",
      amount: 3,
      amountScope: "PER_UNIT",
    },
  ]);
});

test("flags BXGY automatic discounts as unsupported instead of dropping them", () => {
  const result = normalizeDiscountNode({
    id: "gid://shopify/DiscountAutomaticNode/9",
    discount: {
      __typename: "DiscountAutomaticBxgy",
      title: "Buy 2 get 1",
      status: "ACTIVE",
    },
  });
  assert.deepEqual(result, [
    {
      id: "gid://shopify/DiscountAutomaticNode/9",
      title: "Buy 2 get 1",
      scope: "GLOBAL",
      valueType: "UNSUPPORTED",
      unsupportedKind: "Buy X Get Y",
    },
  ]);
});

test("skips inactive and non-automatic discounts", () => {
  assert.deepEqual(normalizeDiscountNode(basicNode({ status: "EXPIRED" })), []);
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
