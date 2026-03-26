import test from "node:test";
import assert from "node:assert/strict";
import { selectAutoScenarioProductIds } from "./support/scenario-selection.ts";

test("auto storefront scenario selection uses the latest restrictive rules by scenario", () => {
  const selected = selectAutoScenarioProductIds({
    visibilityRules: [
      {
        productId: "gid://shopify/Product/VISIBILITY",
        visibilityMode: "B2B_ONLY",
      },
    ],
    quantityRules: [
      {
        productId: "gid://shopify/Product/NOOP",
        minimumOrderQuantity: 1,
        stepQuantity: null,
        maxOrderQuantity: null,
      },
      {
        productId: "gid://shopify/Product/QUANTITY",
        minimumOrderQuantity: 3,
        stepQuantity: 2,
        maxOrderQuantity: 5,
      },
    ],
    variantVisibilityRules: [
      {
        productId: "gid://shopify/Product/VARIANT",
        visibilityMode: "B2B_ONLY",
      },
    ],
  });

  assert.deepEqual(selected, {
    visibility: "gid://shopify/Product/VISIBILITY",
    quantity: "gid://shopify/Product/QUANTITY",
    variant: "gid://shopify/Product/VARIANT",
  });
});

test("auto storefront scenario selection ignores ALL visibility and noop quantity rows", () => {
  const selected = selectAutoScenarioProductIds({
    visibilityRules: [
      {
        productId: "gid://shopify/Product/ALL_ONLY",
        visibilityMode: "ALL",
      },
    ],
    quantityRules: [
      {
        productId: "gid://shopify/Product/DEFAULTS_ONLY",
        minimumOrderQuantity: 1,
        stepQuantity: 1,
        maxOrderQuantity: null,
      },
    ],
    variantVisibilityRules: [
      {
        productId: "gid://shopify/Product/VARIANT_ALL",
        visibilityMode: "ALL",
      },
    ],
  });

  assert.deepEqual(selected, {
    visibility: null,
    quantity: null,
    variant: null,
  });
});
