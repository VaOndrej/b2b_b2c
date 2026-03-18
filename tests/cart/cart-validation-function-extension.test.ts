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

test("shopify function blocks checkout below global floor", () => {
  const blocked = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/3001", hasAnyTag: false },
      },
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

  const allowed = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/3002", hasAnyTag: false },
      },
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

  const perProductBlocked = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/3003", hasAnyTag: false },
      },
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

  const perProductFreeAllowed = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/3004", hasAnyTag: false },
      },
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

  const b2bPerProductBlocked = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/3005", hasAnyTag: true },
      },
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

test("shopify function enforces max combined discount cap with localized message", () => {
  const blocked = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/3010", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-cap-1",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/1",
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
          globalMinPricePercent: 0,
          b2bGlobalMinPricePercent: 0,
          allowZeroFinalPrice: false,
          maxCombinedPercentOff: 40,
          perProductFloorPercentsB2C: {},
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
    localization: {
      language: {
        isoCode: "CS",
      },
    },
  } as any);

  const message = blocked.operations[0]?.validationAdd?.errors?.[0]?.message ?? "";
  assert.equal(blocked.operations.length > 0, true);
  assert.equal(message.includes("Kombinovana sleva"), true);

  const allowed = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/3011", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-cap-2",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/1",
            },
          },
          cost: {
            amountPerQuantity: { amount: "70.00" },
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "70.00" },
          },
        },
      ],
    },
    validation: {
      metafield: {
        jsonValue: {
          globalMinPricePercent: 0,
          b2bGlobalMinPricePercent: 0,
          allowZeroFinalPrice: false,
          maxCombinedPercentOff: 40,
          perProductFloorPercentsB2C: {},
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
    localization: {
      language: {
        isoCode: "EN",
      },
    },
  } as any);

  assert.equal(allowed.operations.length, 0);
});

test("shopify function uses b2bOverridePrice when quantity is below tier threshold", () => {
  const result = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/3101", hasAnyTag: true },
      },
      lines: [
        {
          id: "line-tier-fallback",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/200",
            },
          },
          cost: {
            amountPerQuantity: { amount: "70.00" },
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "70.00" },
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
          perProductB2BOverridePrices: {
            "gid://shopify/Product/200": 80,
          },
          perProductTierPricesB2B: {
            "gid://shopify/Product/200": [
              { minQuantity: 2, unitPrice: 50 },
            ],
          },
        },
      },
    },
  });

  assert.equal(
    result.operations.length,
    0,
    "Quantity pod tier threshold musi fallbacknout na B2B override, ne na base price.",
  );
});

test("shopify function blocks segment-mismatched coupon codes from cart inputs", () => {
  const result = runCartValidation({
    cart: {
      enteredDiscountCodes: [
        { code: "retail10", rejectable: true },
      ],
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/3201", hasAnyTag: true },
      },
      lines: [
        {
          id: "line-coupon-segment",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/201",
            },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "100.00" },
          },
        },
      ],
    },
    validation: {
      metafield: {
        jsonValue: {
          globalMinPricePercent: 0,
          b2bGlobalMinPricePercent: 0,
          allowZeroFinalPrice: true,
          allowStacking: true,
          couponSegmentRules: {
            RETAIL10: "B2C",
          },
          perProductFloorPercentsB2C: {},
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
  });

  const message = result.operations[0]?.validationAdd?.errors?.[0]?.message ?? "";
  assert.equal(result.operations.length > 0, true);
  assert.equal(
    message.includes("not available for your customer segment"),
    true,
  );
});

test("shopify function resolves B2B from defensive purchasingCompany fallback path", () => {
  const result = runCartValidation({
    cart: {
      purchasingCompany: {
        company: {
          id: "gid://shopify/Company/501",
        },
      },
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/3301", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-purchasing-company-fallback",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/202",
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
          globalMinPricePercent: 0,
          b2bGlobalMinPricePercent: 0,
          allowZeroFinalPrice: false,
          perProductFloorPercentsB2C: {
            "gid://shopify/Product/202": 10,
          },
          perProductFloorPercentsB2B: {
            "gid://shopify/Product/202": 90,
          },
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
  } as any);

  assert.equal(
    result.operations.length > 0,
    true,
    "Defenzivni purchasingCompany fallback musi vest na B2B vetvi.",
  );
});
