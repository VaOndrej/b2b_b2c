import test from "node:test";
import assert from "node:assert/strict";
import { cartValidationsGenerateRun as cartValidationsGenerateRunRaw } from "../../extensions/margin-guard-cart-validation/src/cart_validations_generate_run.js";

const DEFAULT_LOCALIZATION = {
  language: {
    isoCode: "EN",
  },
};

function runCartValidation(input: any) {
  return cartValidationsGenerateRunRaw({
    ...input,
    localization: input?.localization ?? DEFAULT_LOCALIZATION,
  } as any);
}

test("shopify function uses totalAmount for discounted checkout validation", () => {
  const blockedByDiscountedTotal = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/3101", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-total-amount-1",
          quantity: 2,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/8679308853419",
            },
          },
          cost: {
            amountPerQuantity: { amount: "699.95" },
            subtotalAmount: { amount: "1399.90" },
            totalAmount: { amount: "0.00" },
          },
        },
      ],
    },
    validation: {
      metafield: {
        jsonValue: {
          globalMinPricePercent: 65,
          b2bGlobalMinPricePercent: 65,
          allowZeroFinalPrice: false,
          perProductFloorPercentsB2C: {},
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
  });

  assert.equal(blockedByDiscountedTotal.operations.length > 0, true);
  assert.equal(
    blockedByDiscountedTotal.operations[0]?.validationAdd?.errors?.length > 0,
    true,
  );

  const allowedWhenTotalAboveFloor = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/3102", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-total-amount-2",
          quantity: 2,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/8679308853419",
            },
          },
          cost: {
            amountPerQuantity: { amount: "699.95" },
            subtotalAmount: { amount: "1399.90" },
            totalAmount: { amount: "1200.00" },
          },
        },
      ],
    },
    validation: {
      metafield: {
        jsonValue: {
          globalMinPricePercent: 65,
          b2bGlobalMinPricePercent: 65,
          allowZeroFinalPrice: false,
          perProductFloorPercentsB2C: {},
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
  });

  assert.equal(allowedWhenTotalAboveFloor.operations.length, 0);
  console.log("[FUNCTION TOTAL AMOUNT PASS] totalAmount fix funguje.");
});
