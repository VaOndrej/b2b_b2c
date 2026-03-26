import test from "node:test";
import assert from "node:assert/strict";
import { createDiscountPreviewAction } from "../../app/services/discount-preview-action.server.ts";
import type { ActionFunctionArgs } from "react-router";
import type { PricingPipelineInput } from "../../core/pricing/pricing.pipeline.ts";

function buildRequest(body: unknown) {
  return new Request("https://example.test/app/api/discount-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("discount preview action hydrates persisted pricing context and forwards normalized input", async () => {
  let captured: PricingPipelineInput | null = null;
  const productId = "gid://shopify/Product/DISCOUNT_PREVIEW";
  const action = createDiscountPreviewAction({
    authenticateAdmin: async () => undefined,
    getConfig: async () =>
      ({
        b2bTag: "b2b",
        globalMinPricePercent: 70,
        b2bGlobalMinPricePercent: 60,
        allowZeroFinalPrice: false,
        allowStacking: true,
        maxCombinedPercentOff: null,
        productFloors: [
          {
            productId,
            segment: "B2B",
            minPercentOfBasePrice: 70,
            allowZeroFinalPrice: null,
            b2bOverridePrice: 81,
          },
        ],
        productTierPrices: [
          {
            productId,
            segment: "B2B",
            minQuantity: 5,
            unitPrice: 74,
          },
        ],
        discountRules: [],
        discountCombinationBlacklistRules: [],
        discountSegmentCaps: [],
      }) as unknown as never,
    applyDiscount: (input) => {
      captured = input;
      return { ok: true };
    },
  });

  const response = await action({
    request: buildRequest({
      productId,
      basePrice: 100,
      quantity: 5,
      buyerHasB2BTag: true,
      buyerHasPurchasingCompany: false,
      enteredDiscountCodes: ["vip20"],
      collectionIds: ["gid://shopify/Collection/1"],
    }),
    params: {},
    context: undefined,
  } as unknown as ActionFunctionArgs);

  assert.equal(response.status, 200);
  assert.ok(captured);
  const input = captured as PricingPipelineInput;
  assert.equal(input.segment, "B2B");
  assert.equal(input.b2bOverridePrice, 81);
  assert.deepEqual(input.tierPrices, [{ minQuantity: 5, unitPrice: 74 }]);
  assert.deepEqual(input.enteredDiscountCodes, ["VIP20"]);
  assert.deepEqual(input.collectionIds, ["gid://shopify/Collection/1"]);
});

test("discount preview action lets explicit preview pricing override persisted pricing context", async () => {
  let captured: PricingPipelineInput | null = null;
  const productId = "gid://shopify/Product/DISCOUNT_PREVIEW_OVERRIDE";
  const action = createDiscountPreviewAction({
    authenticateAdmin: async () => undefined,
    getConfig: async () =>
      ({
        b2bTag: "b2b",
        globalMinPricePercent: 70,
        b2bGlobalMinPricePercent: 60,
        allowZeroFinalPrice: false,
        allowStacking: true,
        maxCombinedPercentOff: null,
        productFloors: [
          {
            productId,
            segment: "B2B",
            minPercentOfBasePrice: 70,
            allowZeroFinalPrice: null,
            b2bOverridePrice: 81,
          },
        ],
        productTierPrices: [
          {
            productId,
            segment: "B2B",
            minQuantity: 5,
            unitPrice: 74,
          },
        ],
        discountRules: [],
        discountCombinationBlacklistRules: [],
        discountSegmentCaps: [],
      }) as unknown as never,
    applyDiscount: (input) => {
      captured = input;
      return { ok: true };
    },
  });

  await action({
    request: buildRequest({
      productId,
      basePrice: 100,
      quantity: 5,
      buyerHasB2BTag: true,
      buyerHasPurchasingCompany: false,
      b2bOverridePrice: 77,
      tierPrices: [{ minQuantity: 5, unitPrice: 72 }],
    }),
    params: {},
    context: undefined,
  } as unknown as ActionFunctionArgs);

  assert.ok(captured);
  const input = captured as PricingPipelineInput;
  assert.equal(input.b2bOverridePrice, 77);
  assert.deepEqual(input.tierPrices, [{ minQuantity: 5, unitPrice: 72 }]);
});
