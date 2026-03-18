import test from "node:test";
import assert from "node:assert/strict";
import { createCartValidateAdminAction } from "../../functions/cart-validation/src/admin-cart-validate-endpoint.ts";

function buildRequest(body: unknown, options?: { contentType?: string; method?: string }) {
  return new Request("https://example.test/app/api/cart-validate", {
    method: options?.method ?? "POST",
    headers:
      options?.contentType === undefined
        ? { "content-type": "application/json" }
        : { "content-type": options.contentType },
    body: JSON.stringify(body),
  });
}

test("cart-validate admin endpoint rejects non-json requests with explicit contract", async () => {
  const action = createCartValidateAdminAction({
    authenticateAdmin: async () => ({ session: { shop: "shop-a.myshopify.com" } }),
    getConfig: async () =>
      ({
        b2bTag: "b2b",
        globalMinPricePercent: 70,
        b2bGlobalMinPricePercent: 70,
        allowZeroFinalPrice: false,
        allowStacking: true,
        maxCombinedPercentOff: null,
        productFloors: [],
      }) as any,
    validate: (() => {
      throw new Error("validate must not be called for invalid requests");
    }) as any,
    recordViolation: (async () => undefined) as any,
  });

  const response = await action({
    request: buildRequest(
      { productId: "gid://shopify/Product/1", basePrice: 100 },
      { contentType: "text/plain" },
    ),
  });

  assert.equal(response.status, 415);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.contract, "INTERNAL_ADMIN_ENDPOINT");
});

test("cart-validate admin endpoint records violation for invalid line", async () => {
  const recorded: Array<Record<string, unknown>> = [];
  const action = createCartValidateAdminAction({
    authenticateAdmin: async () => ({ session: { shop: "shop-b.myshopify.com" } }),
    getConfig: async () =>
      ({
        b2bTag: "wholesale",
        globalMinPricePercent: 70,
        b2bGlobalMinPricePercent: 60,
        allowZeroFinalPrice: false,
        allowStacking: false,
        maxCombinedPercentOff: 10,
        productFloors: [],
      }) as any,
    validate: (() => ({
      valid: false,
      errors: [{ code: "PRICE_BELOW_FLOOR" }],
      result: {
        finalPrice: 10,
        floorPrice: 70,
        violationAmount: 60,
      },
    })) as any,
    recordViolation: (async (payload: Record<string, unknown>) => {
      recorded.push(payload);
    }) as any,
  });

  const response = await action({
    request: buildRequest({
      productId: "gid://shopify/Product/2",
      basePrice: 100,
      customerId: "gid://shopify/Customer/9",
      buyerHasB2BTag: true,
      buyerHasPurchasingCompany: false,
      discounts: [{ code: "DEMO", percentOff: 50 }],
    }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.contract, "INTERNAL_ADMIN_ENDPOINT");
  assert.equal(payload.result.valid, false);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.shop, "shop-b.myshopify.com");
  assert.equal(recorded[0]?.productId, "gid://shopify/Product/2");
  assert.equal(recorded[0]?.segment, "B2B");
  assert.equal(recorded[0]?.source, "api_cart_validation");
});
