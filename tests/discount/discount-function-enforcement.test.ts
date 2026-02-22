import test from "node:test";
import assert from "node:assert/strict";
import { cartLinesDiscountsGenerateRun } from "../../extensions/margin-guard-discount-function/src/cart_lines_discounts_generate_run.js";

test("discount function caps discount by margin floor", () => {
  const result = cartLinesDiscountsGenerateRun({
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
  });

  assert.equal(result.operations.length > 0, true);
  const candidate =
    result.operations[0]?.productDiscountsAdd?.candidates?.[0] ?? null;
  assert.equal(candidate != null, true);
  assert.equal(candidate?.value?.percentage?.value, 30);
  console.log("[DISCOUNT FUNCTION PASS] Discount je capnut floor pravidlem.");
});
