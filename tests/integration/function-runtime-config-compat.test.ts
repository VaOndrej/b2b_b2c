import test from "node:test";
import assert from "node:assert/strict";
import { cartValidationsGenerateRun } from "../../extensions/margin-guard-cart-validation/src/cart_validations_generate_run.js";
import { cartLinesDiscountsGenerateRun } from "../../extensions/margin-guard-discount-function/src/cart_lines_discounts_generate_run.js";
import {
  buildCartValidationFunctionConfig,
  buildDiscountFunctionConfig,
} from "../../core/config/function-config.ts";

test("runtime integration: function inputs accept config payload from builders", () => {
  const sharedConfig = {
    b2bTag: "b2b",
    globalMinPricePercent: 65,
    allowZeroFinalPrice: false,
    productFloors: [
      {
        productId: "gid://shopify/Product/42",
        minPercentOfBasePrice: 70,
        segment: null,
        allowZeroFinalPrice: null,
      },
    ],
  };

  const cartConfig = buildCartValidationFunctionConfig(sharedConfig);
  const cartValidationResult = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-contract-1",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/42",
            },
          },
          cost: {
            amountPerQuantity: { amount: "60.00" },
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "60.00" },
          },
        },
      ],
    },
    validation: {
      metafield: {
        jsonValue: cartConfig,
      },
    },
  });

  assert.equal(Array.isArray(cartValidationResult.operations), true);
  assert.equal(cartValidationResult.operations.length > 0, true);

  const discountConfig = buildDiscountFunctionConfig(sharedConfig);
  const discountResult = cartLinesDiscountsGenerateRun({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-contract-2",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "100.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/42",
            },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: {
        jsonValue: discountConfig,
      },
    },
  });

  assert.equal(Array.isArray(discountResult.operations), true);
  assert.equal(discountResult.operations.length > 0, true);
});
