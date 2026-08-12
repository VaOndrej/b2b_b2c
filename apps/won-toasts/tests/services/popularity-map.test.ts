import assert from "node:assert/strict";
import { test } from "node:test";

import { ordersToSales, popularityToMetafields } from "../../app/services/popularity-map.ts";

test("ordersToSales flattens line items to sales, dropping malformed lines", () => {
  const sales = ordersToSales([
    {
      createdAt: "2026-08-01T10:00:00Z",
      lineItems: {
        edges: [
          { node: { quantity: 2, product: { id: "gid://shopify/Product/1" } } },
          { node: { quantity: 1, product: { id: "gid://shopify/Product/2" } } },
          { node: { quantity: 0, product: { id: "gid://shopify/Product/3" } } }, // qty 0 → dropped
          { node: { quantity: 5, product: { id: null } } }, // no product → dropped
        ],
      },
    },
    { createdAt: "not-a-date", lineItems: { edges: [{ node: { quantity: 9, product: { id: "x" } } }] } }, // bad date → dropped
    null,
  ]);
  assert.equal(sales.length, 2);
  const at = Date.parse("2026-08-01T10:00:00Z");
  assert.deepEqual(sales[0], { productId: "gid://shopify/Product/1", quantity: 2, at });
  assert.deepEqual(sales[1], { productId: "gid://shopify/Product/2", quantity: 1, at });
});

test("popularityToMetafields emits units_sold_30d + bestseller per product, correct types", () => {
  const mf = popularityToMetafields([
    { productId: "gid://shopify/Product/1", soldUnits: 42, isBestseller: true },
    { productId: "gid://shopify/Product/2", soldUnits: 3, isBestseller: false },
  ]);
  assert.equal(mf.length, 4);
  const units = mf.find((m) => m.ownerId.endsWith("/1") && m.key === "units_sold_30d")!;
  assert.equal(units.namespace, "won");
  assert.equal(units.type, "number_integer");
  assert.equal(units.value, "42");
  const best = mf.find((m) => m.ownerId.endsWith("/1") && m.key === "bestseller")!;
  assert.equal(best.type, "boolean");
  assert.equal(best.value, "true");
  const best2 = mf.find((m) => m.ownerId.endsWith("/2") && m.key === "bestseller")!;
  assert.equal(best2.value, "false");
});
