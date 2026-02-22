import test from "node:test";
import assert from "node:assert/strict";
import { cartValidationsGenerateRun } from "../../extensions/margin-guard-cart-validation/src/cart_validations_generate_run.js";

test("shopify function blocks checkout below global floor", () => {
  const blocked = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-1",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/1",
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
        jsonValue: {
          globalMinPricePercent: 70,
          b2bGlobalMinPricePercent: 70,
          allowZeroFinalPrice: false,
          perProductFloorPercentsB2C: {},
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
  });

  assert.equal(blocked.operations.length > 0, true);
  assert.equal(
    blocked.operations[0]?.validationAdd?.errors?.length > 0,
    true,
  );

  const allowed = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-2",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/1",
            },
          },
          cost: {
            amountPerQuantity: { amount: "80.00" },
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "80.00" },
          },
        },
      ],
    },
    validation: {
      metafield: {
        jsonValue: {
          globalMinPricePercent: 70,
          b2bGlobalMinPricePercent: 70,
          allowZeroFinalPrice: false,
          perProductFloorPercentsB2C: {},
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
  });

  assert.equal(allowed.operations.length, 0);

  const perProductBlocked = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-3",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/42",
            },
          },
          cost: {
            amountPerQuantity: { amount: "50.00" },
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "50.00" },
          },
        },
      ],
    },
    validation: {
      metafield: {
        jsonValue: {
          globalMinPricePercent: 30,
          b2bGlobalMinPricePercent: 30,
          allowZeroFinalPrice: false,
          perProductFloorPercentsB2C: {
            "gid://shopify/Product/42": 60,
          },
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
  });

  assert.equal(perProductBlocked.operations.length > 0, true);

  const perProductFreeAllowed = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-4",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/42",
            },
          },
          cost: {
            amountPerQuantity: { amount: "0.00" },
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "0.00" },
          },
        },
      ],
    },
    validation: {
      metafield: {
        jsonValue: {
          globalMinPricePercent: 70,
          b2bGlobalMinPricePercent: 70,
          allowZeroFinalPrice: false,
          perProductFloorPercentsB2C: {
            "gid://shopify/Product/42": 0,
          },
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {
            "gid://shopify/Product/42": true,
          },
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
  });

  assert.equal(perProductFreeAllowed.operations.length, 0);

  const b2bPerProductBlocked = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: true } },
      lines: [
        {
          id: "line-5",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/99",
            },
          },
          cost: {
            amountPerQuantity: { amount: "50.00" },
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "50.00" },
          },
        },
      ],
    },
    validation: {
      metafield: {
        jsonValue: {
          globalMinPricePercent: 30,
          b2bGlobalMinPricePercent: 30,
          allowZeroFinalPrice: false,
          perProductFloorPercentsB2C: {},
          perProductFloorPercentsB2B: {
            "gid://shopify/Product/99": 60,
          },
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
  });

  assert.equal(b2bPerProductBlocked.operations.length > 0, true);
  console.log("[FUNCTION CART PASS] Shopify Function checkout block pod floor funguje.");
});
