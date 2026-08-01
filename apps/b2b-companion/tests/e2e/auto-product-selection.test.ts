import test from "node:test";
import assert from "node:assert/strict";
import { selectAutoScenarioProductIds } from "./support/scenario-selection.ts";
import { preflightStorefrontHandle } from "./support/runtime.ts";

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
        productId: "gid://shopify/Product/MOQ_ONLY",
        minimumOrderQuantity: 3,
        stepQuantity: null,
        maxOrderQuantity: null,
      },
      {
        productId: "gid://shopify/Product/STEP",
        minimumOrderQuantity: 1,
        stepQuantity: 2,
        maxOrderQuantity: null,
      },
      {
        productId: "gid://shopify/Product/MAX",
        minimumOrderQuantity: 1,
        stepQuantity: null,
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
    step: "gid://shopify/Product/STEP",
    max: "gid://shopify/Product/MAX",
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
    step: null,
    max: null,
    variant: null,
  });
});

test("storefront preflight accepts a published handle with variants", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    assert.match(url, /\/products\/valid-handle\.js$/);
    return new Response(
      JSON.stringify({
        handle: "valid-handle",
        variants: [{ id: 101 }, { id: 102 }],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }) as typeof fetch;

  try {
    const result = await preflightStorefrontHandle({
      storefrontBaseUrl: "https://example.myshopify.com",
      storefrontPassword: null,
      handle: "valid-handle",
      requireVariants: true,
    });

    assert.deepEqual(result, {
      ok: true,
      normalizedHandle: "valid-handle",
      variantCount: 2,
      reason: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("storefront preflight rejects variant scenario handles when product.js exposes no variants", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        handle: "single-product",
        variants: [],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )) as typeof fetch;

  try {
    const result = await preflightStorefrontHandle({
      storefrontBaseUrl: "https://example.myshopify.com",
      storefrontPassword: null,
      handle: "single-product",
      requireVariants: true,
    });

    assert.equal(result.ok, false);
    assert.equal(result.normalizedHandle, "single-product");
    assert.equal(result.variantCount, 0);
    assert.match(
      String(result.reason),
      /does not expose variants/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("storefront preflight rejects storefront handles whose product.js endpoint is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("Not found", {
      status: 404,
    })) as typeof fetch;

  try {
    const result = await preflightStorefrontHandle({
      storefrontBaseUrl: "https://example.myshopify.com",
      storefrontPassword: null,
      handle: "missing-handle",
    });

    assert.equal(result.ok, false);
    assert.equal(result.normalizedHandle, "missing-handle");
    assert.equal(result.variantCount, 0);
    assert.match(String(result.reason), /HTTP 404/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
