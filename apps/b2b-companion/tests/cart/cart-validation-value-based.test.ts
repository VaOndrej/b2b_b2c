import test from "node:test";
import assert from "node:assert/strict";
import { cartValidationsGenerateRun as cartValidationsGenerateRunRaw } from "../../extensions/margin-guard-cart-validation/src/cart_validations_generate_run.js";

/**
 * Value-based floor enforcement at checkout (Shopify Function), beyond the existing
 * totalAmount smoke test: the floor is SEGMENT-AWARE (B2B floor can differ from B2C)
 * and a PER-PRODUCT floor overrides the global one — both evaluated against the actual
 * discounted line total, so the discount's source (ours or native) is irrelevant.
 */

const DEFAULT_LOCALIZATION = { language: { isoCode: "EN" } };
const PRODUCT = "gid://shopify/Product/8679308853419";

function runCartValidation(input: any) {
  return cartValidationsGenerateRunRaw({
    ...input,
    localization: input?.localization ?? DEFAULT_LOCALIZATION,
  } as any);
}

// One line, quantity 1: subtotal (pre-discount base) = 100, totalAmount = the
// discounted line total we vary against the resolved floor.
function cartLine(totalAmount: string, hasAnyTag: boolean) {
  return {
    buyerIdentity: {
      customer: { id: "gid://shopify/Customer/9001", hasAnyTag },
    },
    lines: [
      {
        id: "line-1",
        quantity: 1,
        merchandise: {
          __typename: "ProductVariant",
          product: { id: PRODUCT },
        },
        cost: {
          amountPerQuantity: { amount: "100.00" },
          subtotalAmount: { amount: "100.00" },
          totalAmount: { amount: totalAmount },
        },
      },
    ],
  };
}

function blocked(result: any): boolean {
  return (
    result.operations.length > 0 &&
    (result.operations[0]?.validationAdd?.errors?.length ?? 0) > 0
  );
}

test("checkout floor is segment-aware: same line passes B2C floor, fails stricter B2B floor", () => {
  // Discounted total 60 (40% off). B2C floor 55%, B2B floor 70%.
  const config = {
    globalMinPricePercent: 55,
    b2bGlobalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    perProductFloorPercentsB2C: {},
    perProductFloorPercentsB2B: {},
    perProductAllowZeroFinalPriceB2C: {},
    perProductAllowZeroFinalPriceB2B: {},
  };

  const b2c = runCartValidation({
    cart: cartLine("60.00", false),
    validation: { metafield: { jsonValue: config } },
  });
  assert.equal(blocked(b2c), false, "60 >= B2C floor 55 → allowed");

  const b2b = runCartValidation({
    cart: cartLine("60.00", true),
    validation: { metafield: { jsonValue: config } },
  });
  assert.equal(blocked(b2b), true, "60 < B2B floor 70 → blocked");
});

test("a per-product floor overrides the global floor at checkout", () => {
  // Discounted total 80. Global floor 55% (would pass), product floor 85% (fails).
  const b2c = runCartValidation({
    cart: cartLine("80.00", false),
    validation: {
      metafield: {
        jsonValue: {
          globalMinPricePercent: 55,
          b2bGlobalMinPricePercent: 55,
          allowZeroFinalPrice: false,
          perProductFloorPercentsB2C: { [PRODUCT]: 85 },
          perProductFloorPercentsB2B: {},
          perProductAllowZeroFinalPriceB2C: {},
          perProductAllowZeroFinalPriceB2B: {},
        },
      },
    },
  });
  assert.equal(blocked(b2c), true, "80 < product floor 85 → blocked despite global 55");
});
