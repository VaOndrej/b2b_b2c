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

  const cartAsB2C = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: false },
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

  const cartAsB2BByCompany = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: {
        purchasingCompany: { company: { id: "gid://shopify/Company/1" } },
        customer: { hasAnyTag: false },
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

  const discountAsB2C = cartLinesDiscountsGenerateRun({
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

  const discountAsB2BByCompany = cartLinesDiscountsGenerateRun({
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
  const cartResult = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: true },
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
  const discountResult = cartLinesDiscountsGenerateRun({
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

  const allowedAtFloor = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: true },
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

  const blockedBelowFloor = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: true },
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
  const allowedAtTierFloor = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: false },
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

  const blockedBelowTierFloor = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: false },
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
  const discountResult = cartLinesDiscountsGenerateRun({
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
  const cartResult = cartValidationsGenerateRun({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: true },
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
  const discountResult = cartLinesDiscountsGenerateRun({
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

test("runtime integration: coupon code is rejected when segment rule does not match", () => {
  const productId = "gid://shopify/Product/COUPON_SEGMENT_RULE";
  const config = buildDiscountFunctionConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    productFloors: [],
    couponSegmentRules: [{ code: "VIP20", allowedSegment: "B2B" }],
  });

  const b2cResult = cartLinesDiscountsGenerateRun({
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

  const b2bResult = cartLinesDiscountsGenerateRun({
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
