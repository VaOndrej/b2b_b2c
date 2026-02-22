import test from "node:test";
import assert from "node:assert/strict";
import { validateMargin } from "../../core/margin/margin.guard.ts";

function discountedPrice(basePrice: number, percentOff: number): number {
  return Math.round(basePrice * (1 - percentOff / 100) * 100) / 100;
}

test("global floor policy scenarios", () => {
  const scenario1 = validateMargin({
    productId: "prod-100",
    segment: "B2C",
    effectiveBasePrice: 100,
    finalPrice: discountedPrice(100, 30),
    ruleset: {
      global: { minPercentOfBasePrice: 60, allowZeroFinalPrice: false },
      perProduct: [],
    },
  });
  assert.equal(
    scenario1.allowed,
    true,
    "[MARGIN TEST FAIL] Scenario 1 měl být povolený. Zkontroluj v admin.shopify -> Zákazníci.",
  );

  const scenario2 = validateMargin({
    productId: "prod-100",
    segment: "B2C",
    effectiveBasePrice: 100,
    finalPrice: discountedPrice(100, 99),
    ruleset: {
      global: { minPercentOfBasePrice: 10, allowZeroFinalPrice: false },
      perProduct: [],
    },
  });
  assert.equal(
    scenario2.allowed,
    false,
    "[MARGIN TEST FAIL] Scenario 2 měl být blokovaný (a test tím pádem PASS). Zkontroluj v admin.shopify -> Zákazníci.",
  );

  const edgeCases = [
    { floor: 0, discount: 0, expectedAllowed: true },
    { floor: 50, discount: 50, expectedAllowed: true },
    { floor: 50, discount: 51, expectedAllowed: false },
    { floor: 10, discount: 99, expectedAllowed: false },
  ] as const;

  for (const edge of edgeCases) {
    const result = validateMargin({
      productId: "prod-1-czk",
      segment: "B2C",
      effectiveBasePrice: 1,
      finalPrice: discountedPrice(1, edge.discount),
      ruleset: {
        global: {
          minPercentOfBasePrice: edge.floor,
          allowZeroFinalPrice: false,
        },
        perProduct: [],
      },
    });

    assert.equal(
      result.allowed,
      edge.expectedAllowed,
      `[MARGIN TEST FAIL] Edge case base=1 floor=${edge.floor}% discount=${edge.discount}% neocekavany vysledek. Zkontroluj v admin.shopify -> Zákazníci.`,
    );
  }

  const scenario4 = validateMargin({
    productId: "prod-free-not-allowed",
    segment: "B2C",
    effectiveBasePrice: 100,
    finalPrice: discountedPrice(100, 100),
    ruleset: {
      global: { minPercentOfBasePrice: 0, allowZeroFinalPrice: false },
      perProduct: [],
    },
  });
  assert.equal(
    scenario4.allowed,
    false,
    "[MARGIN TEST FAIL] Scenario 4 měl být blokovaný (100% sleva bez výjimky). Zkontroluj v admin.shopify -> Zákazníci.",
  );
  assert.equal(
    scenario4.reason,
    "ZERO_FINAL_PRICE_NOT_ALLOWED",
    "[MARGIN TEST FAIL] Scenario 4 má vracet ZERO_FINAL_PRICE_NOT_ALLOWED.",
  );

  const scenario5 = validateMargin({
    productId: "prod-free-allowed",
    segment: "B2C",
    effectiveBasePrice: 100,
    finalPrice: discountedPrice(100, 100),
    ruleset: {
      global: { minPercentOfBasePrice: 0, allowZeroFinalPrice: false },
      perProduct: [
        {
          productId: "prod-free-allowed",
          minPercentOfBasePrice: 0,
          allowZeroFinalPriceOverride: true,
        },
      ],
    },
  });
  assert.equal(
    scenario5.allowed,
    true,
    "[MARGIN TEST FAIL] Scenario 5 měl být povolený kvůli per-product výjimce. Zkontroluj v admin.shopify -> Zákazníci.",
  );

  console.log(
    "[MARGIN TEST PASS] Global floor policy scénáře (1-5) prošly.",
  );
});
