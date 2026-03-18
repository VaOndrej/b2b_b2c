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
          requestedPercentOff: 100,
          perProductFloorPercentsB2C: {},
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
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
    [{ code: "RETAIL_ONLY" }, { code: "EXTRA10" }],
  );
  assert.equal(
    rejectPayload.message.includes(
      "segment eligibility and stacking policy",
    ),
    true,
  );
});
