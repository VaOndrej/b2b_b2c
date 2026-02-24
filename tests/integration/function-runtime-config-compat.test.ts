import test from "node:test";
import assert from "node:assert/strict";
import { cartValidationsGenerateRun as cartValidationsGenerateRunRaw } from "../../extensions/margin-guard-cart-validation/src/cart_validations_generate_run.js";
import { cartLinesDiscountsGenerateRun as cartLinesDiscountsGenerateRunRaw } from "../../extensions/margin-guard-discount-function/src/cart_lines_discounts_generate_run.js";
import {
  buildCartValidationFunctionConfig,
  buildDiscountFunctionConfig,
} from "../../core/config/function-config.ts";

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

function runDiscountFunction(input: any) {
  const lines = Array.isArray(input?.cart?.lines) ? input.cart.lines : [];
  const normalizedLines = lines.map((line: any) => ({
    ...line,
    cost: {
      ...line?.cost,
      totalAmount:
        line?.cost?.totalAmount ??
        line?.cost?.subtotalAmount ?? { amount: "0.00" },
    },
  }));

  return cartLinesDiscountsGenerateRunRaw({
    ...input,
    cart: {
      ...input?.cart,
      lines: normalizedLines,
    },
    localization: input?.localization ?? DEFAULT_LOCALIZATION,
  } as any);
}

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
  const cartValidationResult = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/1001", hasAnyTag: false },
      },
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
  const discountResult = runDiscountFunction({
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
    enteredDiscountCodes: [],
  });

  assert.equal(Array.isArray(discountResult.operations), true);
  assert.equal(discountResult.operations.length > 0, true);
});

test("runtime integration: purchasing company is treated as B2B even without B2B tag", () => {
  const productId = "gid://shopify/Product/SEGMENT_PRECEDENCE";
  const segmentAwareConfig = {
    globalMinPricePercent: 90,
    b2bGlobalMinPricePercent: 90,
    allowZeroFinalPrice: false,
    requestedPercentOff: 100,
    perProductFloorPercentsB2C: {
      [productId]: 90,
    },
    perProductFloorPercentsB2B: {
      [productId]: 40,
    },
    perProductAllowZeroFinalPriceB2C: {},
    perProductAllowZeroFinalPriceB2B: {},
  };

  const cartAsB2C = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/1002", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-b2c",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
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
      metafield: { jsonValue: segmentAwareConfig },
    },
  });
  assert.equal(cartAsB2C.operations.length > 0, true);

  const cartAsB2BByCompany = runCartValidation({
    cart: {
      buyerIdentity: {
        purchasingCompany: { company: { id: "gid://shopify/Company/1" } },
        customer: { id: "gid://shopify/Customer/1003", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-b2b-company",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
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
      metafield: { jsonValue: segmentAwareConfig },
    },
  });
  assert.equal(cartAsB2BByCompany.operations.length, 0);

  const discountAsB2C = runDiscountFunction({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: false },
      },
      lines: [
        {
          id: "line-discount-b2c",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "100.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: { jsonValue: segmentAwareConfig },
    },
    enteredDiscountCodes: [],
  });
  const b2cCandidate =
    discountAsB2C.operations[0]?.productDiscountsAdd?.candidates?.[0] ?? null;
  assert.equal(b2cCandidate?.value?.percentage?.value, 10);

  const discountAsB2BByCompany = runDiscountFunction({
    cart: {
      buyerIdentity: {
        purchasingCompany: { company: { id: "gid://shopify/Company/1" } },
        customer: { hasAnyTag: false },
      },
      lines: [
        {
          id: "line-discount-b2b-company",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "100.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: { jsonValue: segmentAwareConfig },
    },
    enteredDiscountCodes: [],
  });
  const b2bCandidate =
    discountAsB2BByCompany.operations[0]?.productDiscountsAdd?.candidates?.[0] ??
    null;
  assert.equal(b2bCandidate?.value?.percentage?.value, 60);
});

test("runtime integration: per-product B2B override base price is enforced", () => {
  const productId = "gid://shopify/Product/B2B_OVERRIDE";
  const configWithB2BOverride = {
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    productFloors: [
      {
        productId,
        segment: "B2B" as const,
        minPercentOfBasePrice: 70,
        allowZeroFinalPrice: null,
        b2bOverridePrice: 100,
      },
    ],
  };

  const cartConfig = buildCartValidationFunctionConfig(configWithB2BOverride);
  const cartResult = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/1004", hasAnyTag: true },
      },
      lines: [
        {
          id: "line-cart-b2b-override",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "80.00" },
            subtotalAmount: { amount: "80.00" },
            totalAmount: { amount: "60.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(cartResult.operations.length > 0, true);

  const discountConfig = buildDiscountFunctionConfig(configWithB2BOverride);
  const discountResult = runDiscountFunction({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: true },
      },
      lines: [
        {
          id: "line-discount-b2b-override",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "80.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: { jsonValue: discountConfig },
    },
    enteredDiscountCodes: [],
  });
  const candidate =
    discountResult.operations[0]?.productDiscountsAdd?.candidates?.[0] ?? null;
  assert.equal(candidate?.value?.percentage?.value, 12.5);
});

test("runtime integration: B2B floor is computed from B2B override base price", () => {
  const productId = "gid://shopify/Product/B2B_OVERRIDE_1000_TO_300";
  const cartConfig = buildCartValidationFunctionConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    productFloors: [
      {
        productId,
        segment: "B2B",
        minPercentOfBasePrice: 70,
        allowZeroFinalPrice: null,
        b2bOverridePrice: 300,
      },
    ],
  });

  const allowedAtFloor = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/1005", hasAnyTag: true },
      },
      lines: [
        {
          id: "line-b2b-floor-allowed",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "1000.00" },
            subtotalAmount: { amount: "1000.00" },
            totalAmount: { amount: "300.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });

  assert.equal(
    allowedAtFloor.operations.length,
    0,
    "[B2B OVERRIDE FLOOR FAIL] Final 300 should pass because floor is 300 * 0.70 = 210.",
  );

  const blockedBelowFloor = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/1006", hasAnyTag: true },
      },
      lines: [
        {
          id: "line-b2b-floor-blocked",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "1000.00" },
            subtotalAmount: { amount: "1000.00" },
            totalAmount: { amount: "200.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });

  assert.equal(
    blockedBelowFloor.operations.length > 0,
    true,
    "[B2B OVERRIDE FLOOR FAIL] Final 200 should fail because floor is 210.",
  );
});

test("runtime integration: quantity tier pricing is used for B2C floor and discount cap", () => {
  const productId = "gid://shopify/Product/TIER_B2C_5_PLUS";
  const sharedConfig = {
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    productFloors: [
      {
        productId,
        segment: "B2C" as const,
        minPercentOfBasePrice: 70,
        allowZeroFinalPrice: null,
      },
    ],
    productTierPrices: [
      {
        productId,
        segment: "B2C" as const,
        minQuantity: 5,
        unitPrice: 80,
      },
    ],
  };

  const cartConfig = buildCartValidationFunctionConfig(sharedConfig);
  const allowedAtTierFloor = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/1007", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-tier-b2c-allowed",
          quantity: 5,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "500.00" },
            totalAmount: { amount: "300.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });

  assert.equal(
    allowedAtTierFloor.operations.length,
    0,
    "[TIER B2C FAIL] quantity 5 should use tier base 80, floor 56, final 60 should pass.",
  );

  const blockedBelowTierFloor = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/1008", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-tier-b2c-blocked",
          quantity: 5,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "500.00" },
            totalAmount: { amount: "250.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });

  assert.equal(
    blockedBelowTierFloor.operations.length > 0,
    true,
    "[TIER B2C FAIL] quantity 5 should use tier base 80, floor 56, final 50 should fail.",
  );

  const discountConfig = buildDiscountFunctionConfig(sharedConfig);
  const discountResult = runDiscountFunction({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: false },
      },
      lines: [
        {
          id: "line-tier-discount-b2c",
          quantity: 5,
          cost: {
            subtotalAmount: { amount: "500.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: { jsonValue: discountConfig },
    },
    enteredDiscountCodes: [],
  });

  const tierCandidate =
    discountResult.operations[0]?.productDiscountsAdd?.candidates?.[0] ?? null;
  assert.equal(
    tierCandidate?.value?.percentage?.value,
    44,
    "[TIER B2C FAIL] Max percent should be 44% from tier floor line 280/500.",
  );
});

test("runtime integration: tier pricing has precedence over B2B override for quantity break", () => {
  const productId = "gid://shopify/Product/TIER_B2B_OVERRIDE_PRECEDENCE";
  const sharedConfig = {
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    productFloors: [
      {
        productId,
        segment: "B2B" as const,
        minPercentOfBasePrice: 70,
        allowZeroFinalPrice: null,
        b2bOverridePrice: 300,
      },
    ],
    productTierPrices: [
      {
        productId,
        segment: "B2B" as const,
        minQuantity: 10,
        unitPrice: 250,
      },
    ],
  };

  const cartConfig = buildCartValidationFunctionConfig(sharedConfig);
  const cartResult = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/1009", hasAnyTag: true },
      },
      lines: [
        {
          id: "line-tier-b2b-precedence",
          quantity: 10,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "1000.00" },
            subtotalAmount: { amount: "10000.00" },
            totalAmount: { amount: "2000.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });

  assert.equal(
    cartResult.operations.length,
    0,
    "[TIER B2B PRECEDENCE FAIL] Tier base 250 should win over B2B override 300.",
  );

  const discountConfig = buildDiscountFunctionConfig(sharedConfig);
  const discountResult = runDiscountFunction({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: true },
      },
      lines: [
        {
          id: "line-tier-discount-b2b-precedence",
          quantity: 10,
          cost: {
            subtotalAmount: { amount: "10000.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: { jsonValue: discountConfig },
    },
    enteredDiscountCodes: [],
  });

  const candidate =
    discountResult.operations[0]?.productDiscountsAdd?.candidates?.[0] ?? null;
  assert.equal(
    candidate?.value?.percentage?.value,
    82.5,
    "[TIER B2B PRECEDENCE FAIL] Max percent should come from tier base 250 floor.",
  );
});

test("runtime integration: MOQ per segment blocks quantity below configured minimum", () => {
  const productId = "gid://shopify/Product/MOQ_PER_SEGMENT";
  const cartConfig = buildCartValidationFunctionConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 0,
    allowZeroFinalPrice: true,
    productFloors: [],
    productQuantityRules: [
      {
        productId,
        segment: null,
        minimumOrderQuantity: 3,
      },
      {
        productId,
        segment: "B2B" as const,
        minimumOrderQuantity: 5,
      },
    ],
  });

  const blockedB2C = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2010", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-moq-b2c-blocked",
          quantity: 2,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "200.00" },
            totalAmount: { amount: "200.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(blockedB2C.operations.length > 0, true);
  assert.equal(
    blockedB2C.operations[0]?.validationAdd?.errors?.[0]?.message.includes(
      "minimum order quantity",
    ),
    true,
  );

  const allowedB2C = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2011", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-moq-b2c-allowed",
          quantity: 3,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "300.00" },
            totalAmount: { amount: "300.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(allowedB2C.operations.length, 0);

  const blockedB2B = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2012", hasAnyTag: true },
      },
      lines: [
        {
          id: "line-moq-b2b-blocked",
          quantity: 4,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "400.00" },
            totalAmount: { amount: "400.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(blockedB2B.operations.length > 0, true);

  const allowedB2B = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2013", hasAnyTag: true },
      },
      lines: [
        {
          id: "line-moq-b2b-allowed",
          quantity: 5,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "500.00" },
            totalAmount: { amount: "500.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(
    allowedB2B.operations.length,
    0,
    "[MOQ FAIL] B2B quantity equal to MOQ should be allowed.",
  );
});

test("runtime integration: step quantity blocks non-multiples and can combine with MOQ violation", () => {
  const productId = "gid://shopify/Product/STEP_PER_SEGMENT";
  const cartConfig = buildCartValidationFunctionConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 0,
    allowZeroFinalPrice: true,
    productFloors: [],
    productQuantityRules: [
      {
        productId,
        segment: null,
        minimumOrderQuantity: 3,
        stepQuantity: 6,
      },
      {
        productId,
        segment: "B2B" as const,
        minimumOrderQuantity: 5,
        stepQuantity: 4,
      },
    ],
  });

  const blockedB2CByStep = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2020", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-step-b2c-blocked",
          quantity: 5,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "500.00" },
            totalAmount: { amount: "500.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });
  const b2cMessages =
    blockedB2CByStep.operations[0]?.validationAdd?.errors?.map(
      (error: any) => error?.message ?? "",
    ) ?? [];
  assert.equal(blockedB2CByStep.operations.length > 0, true);
  assert.equal(
    b2cMessages.some((message: string) => message.includes("packaging multiple")),
    true,
  );

  const allowedB2C = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2021", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-step-b2c-allowed",
          quantity: 6,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "600.00" },
            totalAmount: { amount: "600.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(allowedB2C.operations.length, 0);

  const blockedB2BWithMoqAndStep = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2022", hasAnyTag: true },
      },
      lines: [
        {
          id: "line-step-b2b-both-blocked",
          quantity: 3,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "300.00" },
            totalAmount: { amount: "300.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });
  const b2bMessages =
    blockedB2BWithMoqAndStep.operations[0]?.validationAdd?.errors?.map(
      (error: any) => error?.message ?? "",
    ) ?? [];
  assert.equal(
    b2bMessages.some((message: string) => message.includes("minimum order quantity")),
    true,
  );
  assert.equal(
    b2bMessages.some((message: string) => message.includes("packaging multiple")),
    true,
  );

  const allowedB2B = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2023", hasAnyTag: true },
      },
      lines: [
        {
          id: "line-step-b2b-allowed",
          quantity: 8,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "800.00" },
            totalAmount: { amount: "800.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(
    allowedB2B.operations.length,
    0,
    "[STEP FAIL] B2B quantity meeting MOQ and step should be allowed.",
  );
});

test("runtime integration: MOQ and step use aggregated quantity for duplicate product lines", () => {
  const productId = "gid://shopify/Product/STEP_AGGREGATED_LINES";
  const cartConfig = buildCartValidationFunctionConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 0,
    allowZeroFinalPrice: true,
    productFloors: [],
    productQuantityRules: [
      {
        productId,
        segment: null,
        minimumOrderQuantity: 2,
        stepQuantity: 2,
      },
    ],
  });

  const blockedSingleLine = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2030", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-agg-single",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
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
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(blockedSingleLine.operations.length > 0, true);

  const allowedSplitLines = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2031", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-agg-split-1",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "100.00" },
          },
        },
        {
          id: "line-agg-split-2",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
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
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(
    allowedSplitLines.operations.length,
    0,
    "[STEP AGG FAIL] Two lines with qty 1+1 should pass MOQ 2 and step 2.",
  );

  const blockedNonMultipleSplit = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2032", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-agg-split-3",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "100.00" },
          },
        },
        {
          id: "line-agg-split-4",
          quantity: 2,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
          cost: {
            amountPerQuantity: { amount: "100.00" },
            subtotalAmount: { amount: "200.00" },
            totalAmount: { amount: "200.00" },
          },
        },
      ],
    },
    validation: {
      metafield: { jsonValue: cartConfig },
    },
  });
  const nonMultipleMessages =
    blockedNonMultipleSplit.operations[0]?.validationAdd?.errors?.map(
      (error: any) => error?.message ?? "",
    ) ?? [];
  assert.equal(blockedNonMultipleSplit.operations.length > 0, true);
  assert.equal(
    nonMultipleMessages.some((message: string) => message.includes("packaging multiple")),
    true,
  );
  assert.equal(
    nonMultipleMessages.some((message: string) => message.includes("steps of 2")),
    true,
  );
});

test("runtime integration: coupon code is rejected when segment rule does not match", () => {
  const productId = "gid://shopify/Product/COUPON_SEGMENT_RULE";
  const config = buildDiscountFunctionConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    productFloors: [],
    couponSegmentRules: [{ code: "VIP20", allowedSegment: "B2B" }],
  });

  const b2cResult = runDiscountFunction({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: false },
      },
      lines: [
        {
          id: "line-coupon-b2c",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "100.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: { jsonValue: config },
    },
    enteredDiscountCodes: [{ code: "vip20", rejectable: true }],
  });

  const rejectOperation = b2cResult.operations.find(
    (operation) => operation?.enteredDiscountCodesReject != null,
  );
  assert.deepEqual(rejectOperation?.enteredDiscountCodesReject?.codes, [
    { code: "VIP20" },
  ]);

  const b2bResult = runDiscountFunction({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: true },
      },
      lines: [
        {
          id: "line-coupon-b2b",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "100.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: { jsonValue: config },
    },
    enteredDiscountCodes: [{ code: "VIP20", rejectable: true }],
  });

  const b2bRejectOperation = b2bResult.operations.find(
    (operation) => operation?.enteredDiscountCodesReject != null,
  );
  assert.equal(
    b2bRejectOperation,
    undefined,
    "[COUPON SEGMENT FAIL] B2B should not reject B2B-only coupon.",
  );
});

test("runtime integration: allowStacking=false rejects extra entered discount codes", () => {
  const productId = "gid://shopify/Product/STACKING_RULE";
  const config = buildDiscountFunctionConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 0,
    allowZeroFinalPrice: false,
    allowStacking: false,
    productFloors: [],
  });

  const result = runDiscountFunction({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: false },
      },
      lines: [
        {
          id: "line-stacking",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "100.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: { jsonValue: config },
    },
    enteredDiscountCodes: [
      { code: "first10", rejectable: true },
      { code: "second5", rejectable: true },
    ],
    localization: {
      language: { isoCode: "EN" as any },
    },
  } as any);

  const rejectOperation = result.operations.find(
    (operation) => operation?.enteredDiscountCodesReject != null,
  );
  assert.deepEqual(rejectOperation?.enteredDiscountCodesReject?.codes, [
    { code: "SECOND5" },
  ]);
  assert.equal(
    rejectOperation?.enteredDiscountCodesReject?.message.includes("Multiple discount codes"),
    true,
  );
});

test("runtime integration: maxCombinedPercentOff caps candidate by remaining percent", () => {
  const productId = "gid://shopify/Product/COMBINED_CAP";
  const config = buildDiscountFunctionConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 0,
    allowZeroFinalPrice: false,
    allowStacking: true,
    maxCombinedPercentOff: 40,
    productFloors: [],
  });

  const capped = runDiscountFunction({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: false },
      },
      lines: [
        {
          id: "line-combined-cap-1",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "80.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: { jsonValue: config },
    },
    enteredDiscountCodes: [],
  } as any);

  const candidate =
    capped.operations[0]?.productDiscountsAdd?.candidates?.[0] ?? null;
  assert.equal(
    candidate?.value?.percentage?.value,
    20,
    "[COMBINED CAP FAIL] Existing 20% discount should leave only 20% for this function.",
  );

  const fullyBlocked = runDiscountFunction({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: false },
      },
      lines: [
        {
          id: "line-combined-cap-2",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "50.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: productId },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: { jsonValue: config },
    },
    enteredDiscountCodes: [],
  } as any);

  const fullBlockCandidate =
    fullyBlocked.operations[0]?.productDiscountsAdd?.candidates?.[0] ?? null;
  assert.equal(
    fullBlockCandidate,
    null,
    "[COMBINED CAP FAIL] Existing 50% discount should block new candidate when max cap is 40%.",
  );
});

test("runtime integration: product visibility rules block disallowed segment and customer", () => {
  const b2bOnlyProductId = "gid://shopify/Product/VISIBILITY_B2B_ONLY";
  const customerOnlyProductId = "gid://shopify/Product/VISIBILITY_CUSTOMER_ONLY";
  const allowedCustomerId = "gid://shopify/Customer/4242";
  const cartConfig = buildCartValidationFunctionConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    productFloors: [],
    productVisibilityRules: [
      {
        productId: b2bOnlyProductId,
        visibilityMode: "B2B_ONLY",
      },
      {
        productId: customerOnlyProductId,
        visibilityMode: "CUSTOMER_ONLY",
        customerId: allowedCustomerId,
      },
    ],
  });

  const blockedB2C = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2001", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-visibility-b2c-blocked",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: b2bOnlyProductId },
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
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(blockedB2C.operations.length > 0, true);
  assert.equal(
    blockedB2C.operations[0]?.validationAdd?.errors?.[0]?.message.includes(
      "not available",
    ),
    true,
  );

  const allowedB2B = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/2002", hasAnyTag: true },
      },
      lines: [
        {
          id: "line-visibility-b2b-allowed",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: b2bOnlyProductId },
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
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(
    allowedB2B.operations.length,
    0,
    "[VISIBILITY FAIL] B2B customer should be allowed for B2B-only product.",
  );

  const blockedCustomerMismatch = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: "gid://shopify/Customer/9999", hasAnyTag: false },
      },
      lines: [
        {
          id: "line-visibility-customer-blocked",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: customerOnlyProductId },
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
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(blockedCustomerMismatch.operations.length > 0, true);

  const allowedSpecificCustomer = runCartValidation({
    cart: {
      buyerIdentity: {
        customer: { id: allowedCustomerId, hasAnyTag: false },
      },
      lines: [
        {
          id: "line-visibility-customer-allowed",
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            product: { id: customerOnlyProductId },
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
      metafield: { jsonValue: cartConfig },
    },
  });
  assert.equal(
    allowedSpecificCustomer.operations.length,
    0,
    "[VISIBILITY FAIL] Specific customer should be allowed for customer-only product.",
  );
});
