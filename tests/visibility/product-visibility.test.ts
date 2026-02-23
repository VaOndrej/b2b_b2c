import test from "node:test";
import assert from "node:assert/strict";
import { isProductVisible } from "../../core/visibility/visibility.engine.ts";

test("product visibility rules apply segment and customer restrictions", () => {
  const rules = [
    {
      productId: "gid://shopify/Product/B2B_ONLY",
      visibilityMode: "B2B_ONLY" as const,
    },
    {
      productId: "gid://shopify/Product/B2C_ONLY",
      visibilityMode: "B2C_ONLY" as const,
    },
    {
      productId: "gid://shopify/Product/CUSTOMER_ONLY",
      visibilityMode: "CUSTOMER_ONLY" as const,
      customerId: "gid://shopify/Customer/42",
    },
  ];

  assert.equal(
    isProductVisible({
      productId: "gid://shopify/Product/B2B_ONLY",
      segment: "B2C",
      rules,
    }),
    false,
  );
  assert.equal(
    isProductVisible({
      productId: "gid://shopify/Product/B2B_ONLY",
      segment: "B2B",
      rules,
    }),
    true,
  );
  assert.equal(
    isProductVisible({
      productId: "gid://shopify/Product/B2C_ONLY",
      segment: "B2B",
      rules,
    }),
    false,
  );
  assert.equal(
    isProductVisible({
      productId: "gid://shopify/Product/B2C_ONLY",
      segment: "B2C",
      rules,
    }),
    true,
  );
  assert.equal(
    isProductVisible({
      productId: "gid://shopify/Product/CUSTOMER_ONLY",
      segment: "B2C",
      customerId: "gid://shopify/Customer/99",
      rules,
    }),
    false,
  );
  assert.equal(
    isProductVisible({
      productId: "gid://shopify/Product/CUSTOMER_ONLY",
      segment: "B2C",
      customerId: "gid://shopify/Customer/42",
      rules,
    }),
    true,
  );
});

test("product visibility defaults to visible when no rule exists", () => {
  assert.equal(
    isProductVisible({
      productId: "gid://shopify/Product/NO_RULE",
      segment: "B2C",
      rules: [],
    }),
    true,
  );
});
