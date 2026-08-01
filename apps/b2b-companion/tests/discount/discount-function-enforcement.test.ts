import test from "node:test";
import assert from "node:assert/strict";
import { cartLinesDiscountsGenerateRun as cartLinesDiscountsGenerateRunRaw } from "../../extensions/margin-guard-discount-function/src/cart_lines_discounts_generate_run.js";

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
    localization: input?.localization ?? {
      language: {
        isoCode: "EN",
      },
    },
  } as any);
}

test("discount function caps discount by margin floor", () => {
  const result = runDiscountFunction({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-1",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "100.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/1",
            },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: {
        jsonValue: {
          globalMinPricePercent: 70,
          b2bGlobalMinPricePercent: 70,
          allowZeroFinalPrice: false,
          marginGuardEnabled: true,
          discountRules: [
            {
              id: "global-rule",
              scope: "GLOBAL",
              targetId: null,
              code: null,
              segment: null,
              percentOff: 50,
              priority: 0,
              stackMode: "EXCLUSIVE",
              minPricePercentOfBasePrice: null,
            },
          ],
        },
      },
    },
    enteredDiscountCodes: [],
  });

  assert.equal(result.operations.length > 0, true);
  const candidate =
    result.operations[0]?.productDiscountsAdd?.candidates?.[0] ?? null;
  assert.equal(candidate != null, true);
  assert.equal(candidate?.value?.percentage?.value, 30);
  console.log("[DISCOUNT FUNCTION PASS] Discount je capnut floor pravidlem.");
});

test("discount function prefers segment mismatch rejection before stacking and still rejects extra eligible codes", () => {
  const result = runDiscountFunction({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: true } },
      lines: [
        {
          id: "line-stack-1",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "100.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/777",
            },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: {
        jsonValue: {
          globalMinPricePercent: 0,
          b2bGlobalMinPricePercent: 0,
          allowZeroFinalPrice: true,
          allowStacking: false,
          requestedPercentOff: 5,
          discountRules: [
            {
              id: "wholesale-rule",
              scope: "COUPON",
              targetId: null,
              code: "WHOLESALE10",
              segment: "B2B",
              percentOff: 10,
              priority: 200,
              stackMode: "STACKABLE",
              minPricePercentOfBasePrice: null,
            },
            {
              id: "extra-rule",
              scope: "COUPON",
              targetId: null,
              code: "EXTRA10",
              segment: null,
              percentOff: 5,
              priority: 100,
              stackMode: "STACKABLE",
              minPricePercentOfBasePrice: null,
            },
          ],
          couponSegmentRules: {
            RETAIL_ONLY: "B2C",
            WHOLESALE10: "B2B",
            EXTRA10: "ALL",
          },
          perProductFloorPercentsB2C: {},
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
    enteredDiscountCodes: [
      { code: "RETAIL_ONLY", rejectable: true },
      { code: "WHOLESALE10", rejectable: true },
      { code: "EXTRA10", rejectable: true },
    ],
  });

  const rejectOperation = result.operations.find(
    (operation: any) => operation?.enteredDiscountCodesReject,
  );
  if (!rejectOperation?.enteredDiscountCodesReject) {
    assert.fail(
      "Discount runtime musi vratit enteredDiscountCodesReject operaci pro mixed segment+stacking scenario.",
    );
  }
  const rejectPayload = rejectOperation.enteredDiscountCodesReject;
  assert.deepEqual(
    rejectPayload.codes,
    [{ code: "EXTRA10" }, { code: "RETAIL_ONLY" }],
  );
  assert.equal(
    rejectPayload.message.includes(
      "segment eligibility and stacking policy",
    ),
    true,
  );
});

test("discount function rejects blacklisted coupon combinations and still applies eligible discount rules", () => {
  const result = runDiscountFunction({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-blacklist-1",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "100.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/BLACKLIST",
            },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: {
        jsonValue: {
          globalMinPricePercent: 0,
          b2bGlobalMinPricePercent: 0,
          allowZeroFinalPrice: true,
          allowStacking: true,
          discountRules: [
            {
              id: "vip-rule",
              scope: "COUPON",
              targetId: null,
              code: "VIP20",
              segment: null,
              percentOff: 20,
              priority: 200,
              stackMode: "STACKABLE",
              minPricePercentOfBasePrice: null,
            },
            {
              id: "extra-rule",
              scope: "COUPON",
              targetId: null,
              code: "EXTRA10",
              segment: null,
              percentOff: 10,
              priority: 100,
              stackMode: "STACKABLE",
              minPricePercentOfBasePrice: null,
            },
          ],
          discountCombinationBlacklistRules: [
            {
              leftType: "COUPON_CODE",
              leftValue: "VIP20",
              rightType: "COUPON_CODE",
              rightValue: "EXTRA10",
              segment: "ALL",
            },
          ],
          perProductFloorPercentsB2C: {},
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
    enteredDiscountCodes: [
      { code: "VIP20", rejectable: true },
      { code: "EXTRA10", rejectable: true },
    ],
  });

  const rejectOperation = result.operations.find(
    (operation: any) => operation?.enteredDiscountCodesReject,
  );
  assert.equal(Boolean(rejectOperation?.enteredDiscountCodesReject), true);
  assert.deepEqual(rejectOperation?.enteredDiscountCodesReject?.codes, [
    { code: "EXTRA10" },
  ]);
  const candidates =
    result.operations.find((operation: any) => operation?.productDiscountsAdd)
      ?.productDiscountsAdd?.candidates ?? [];
  assert.deepEqual(
    candidates.map((candidate: any) => candidate?.value?.percentage?.value),
    [20],
  );
});

test("discount function resolves blacklisted coupon codes by configured precedence, not entered order", () => {
  const result = runDiscountFunction({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-precedence-1",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "100.00" },
            totalAmount: { amount: "100.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: {
              id: "gid://shopify/Product/PRECEDENCE",
            },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT" as any],
      metafield: {
        jsonValue: {
          globalMinPricePercent: 0,
          b2bGlobalMinPricePercent: 0,
          allowZeroFinalPrice: true,
          allowStacking: true,
          discountRules: [
            {
              id: "vip-rule",
              scope: "COUPON",
              targetId: null,
              code: "VIP20",
              segment: null,
              percentOff: 20,
              priority: 200,
              stackMode: "STACKABLE",
              minPricePercentOfBasePrice: null,
            },
            {
              id: "extra-rule",
              scope: "COUPON",
              targetId: null,
              code: "EXTRA10",
              segment: null,
              percentOff: 10,
              priority: 100,
              stackMode: "STACKABLE",
              minPricePercentOfBasePrice: null,
            },
          ],
          discountCombinationBlacklistRules: [
            {
              leftType: "COUPON_CODE",
              leftValue: "VIP20",
              rightType: "COUPON_CODE",
              rightValue: "EXTRA10",
              segment: "ALL",
            },
          ],
          perProductFloorPercentsB2C: {},
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
    enteredDiscountCodes: [
      { code: "EXTRA10", rejectable: true },
      { code: "VIP20", rejectable: true },
    ],
  });

  const rejectOperation = result.operations.find(
    (operation: any) => operation?.enteredDiscountCodesReject,
  );
  assert.deepEqual(rejectOperation?.enteredDiscountCodesReject?.codes, [
    { code: "EXTRA10" },
  ]);
  const candidate =
    result.operations.find((operation: any) => operation?.productDiscountsAdd)
      ?.productDiscountsAdd?.candidates?.[0] ?? null;
  assert.equal(candidate?.value?.percentage?.value, 20);
});

test("discount function returns no operations when marginGuardEnabled is false", () => {
  const result = runDiscountFunction({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-1",
          quantity: 1,
          cost: { subtotalAmount: { amount: "100.00" } },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: "gid://shopify/Product/1" },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT"],
      metafield: {
        jsonValue: {
          globalMinPricePercent: 70,
          marginGuardEnabled: false,
          discountRules: [
            {
              id: "global-rule",
              scope: "GLOBAL",
              targetId: null,
              code: null,
              segment: null,
              percentOff: 30,
              priority: 0,
              stackMode: "EXCLUSIVE",
              minPricePercentOfBasePrice: null,
            },
          ],
        },
      },
    },
    enteredDiscountCodes: [],
  });

  assert.deepEqual(
    result.operations,
    [],
    "Kdyz je marginGuardEnabled false, funkce musi vratit prazdne operations (pass-through).",
  );
});

test("discount function does not generate discount for product without rules (fallback removed)", () => {
  const result = runDiscountFunction({
    cart: {
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-1",
          quantity: 1,
          cost: { subtotalAmount: { amount: "600.00" } },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: "gid://shopify/Product/999" },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT"],
      metafield: {
        jsonValue: {
          globalMinPricePercent: 70,
          marginGuardEnabled: true,
        },
      },
    },
    enteredDiscountCodes: [],
  });

  const discountOp = result.operations.find(
    (op: any) => op?.productDiscountsAdd,
  );
  assert.equal(
    discountOp ?? null,
    null,
    "Produkt bez discount rules nesmí dostat žádnou slevu (fallback byl odstraněn).",
  );
});

test("discount function rejects entered code when order-level discount pushes price below floor", () => {
  const result = runDiscountFunction({
    cart: {
      cost: {
        subtotalAmount: { amount: "600.00" },
        totalAmount: { amount: "120.00" },
        totalTaxAmount: { amount: "0.00" },
      },
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-1",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "600.00" },
            totalAmount: { amount: "600.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: "gid://shopify/Product/1" },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT"],
      metafield: {
        jsonValue: {
          globalMinPricePercent: 70,
          marginGuardEnabled: true,
        },
      },
    },
    enteredDiscountCodes: [{ code: "TEST100", rejectable: true }],
  });

  const rejectOp = result.operations.find(
    (op: any) => op?.enteredDiscountCodesReject,
  );
  assert.ok(
    rejectOp?.enteredDiscountCodesReject?.codes?.some((c: any) => c.code === "TEST100"),
    "Kód TEST100 musí být odmítnut — order discount 80% by snížil cenu na 120, floor je 420 (70% z 600).",
  );
});

test("discount function does not reject entered code when order-level discount stays above floor", () => {
  const result = runDiscountFunction({
    cart: {
      cost: {
        subtotalAmount: { amount: "600.00" },
        totalAmount: { amount: "420.00" },
        totalTaxAmount: { amount: "0.00" },
      },
      buyerIdentity: { customer: { hasAnyTag: false } },
      lines: [
        {
          id: "line-1",
          quantity: 1,
          cost: {
            subtotalAmount: { amount: "600.00" },
            totalAmount: { amount: "600.00" },
          },
          merchandise: {
            __typename: "ProductVariant",
            product: { id: "gid://shopify/Product/1" },
          },
        },
      ],
    },
    discount: {
      discountClasses: ["PRODUCT"],
      metafield: {
        jsonValue: {
          globalMinPricePercent: 70,
          marginGuardEnabled: true,
        },
      },
    },
    enteredDiscountCodes: [{ code: "SAFE30", rejectable: true }],
  });

  const rejectOp = result.operations.find(
    (op: any) => op?.enteredDiscountCodesReject,
  );
  assert.equal(
    rejectOp ?? null,
    null,
    "Kód SAFE30 s 30% slevou (výsledek přesně na flooru 70%) nesmí být odmítnut.",
  );
});

test("discount function gates a loyalty-tag rule on customer.hasTags (MVP_5_2)", () => {
  const metafield = {
    jsonValue: {
      globalMinPricePercent: 70,
      b2bGlobalMinPricePercent: 70,
      allowZeroFinalPrice: false,
      marginGuardEnabled: true,
      discountRules: [
        {
          id: "loyalty-rule",
          scope: "GLOBAL",
          targetId: null,
          code: null,
          segment: null,
          percentOff: 10,
          priority: 0,
          stackMode: "STACKABLE",
          minPricePercentOfBasePrice: null,
          requiredCustomerTag: "loyalty-gold",
        },
      ],
    },
  };
  const line = {
    id: "line-1",
    quantity: 1,
    cost: { subtotalAmount: { amount: "100.00" } },
    merchandise: {
      __typename: "ProductVariant",
      product: { id: "gid://shopify/Product/1" },
    },
  };

  // Customer WITHOUT the loyalty tag → no discount applied.
  const without = runDiscountFunction({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: false, hasTags: [{ tag: "loyalty-gold", hasTag: false }] },
      },
      lines: [line],
    },
    discount: { discountClasses: ["PRODUCT" as any], metafield },
    enteredDiscountCodes: [],
  });
  assert.equal(
    without.operations.some((op: any) => op.productDiscountsAdd),
    false,
  );

  // Customer WITH the loyalty tag (case-insensitive) → 10% applied.
  const withTag = runDiscountFunction({
    cart: {
      buyerIdentity: {
        customer: { hasAnyTag: false, hasTags: [{ tag: "Loyalty-Gold", hasTag: true }] },
      },
      lines: [line],
    },
    discount: { discountClasses: ["PRODUCT" as any], metafield },
    enteredDiscountCodes: [],
  });
  const candidate =
    withTag.operations[0]?.productDiscountsAdd?.candidates?.[0] ?? null;
  assert.equal(candidate?.value?.percentage?.value, 10);
  console.log("[DISCOUNT FUNCTION PASS] Loyalty tag gating funguje (hasTags).");
});
