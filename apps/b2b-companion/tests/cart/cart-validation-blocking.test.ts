import test from "node:test";
import assert from "node:assert/strict";
import { validateCartLine } from "../../functions/cart-validation/src/index.ts";

test("cart validation blocks checkout when final price is below floor", () => {
  const blocked = validateCartLine({
    productId: "prod-floor",
    segment: "B2C",
    basePrice: 100,
    discounts: [{ code: "BIGSALE", percentOff: 50 }],
    discountRules: { allowStacking: true },
    floorRuleset: {
      global: { minPercentOfBasePrice: 70, allowZeroFinalPrice: false },
      perProduct: [],
    },
  });

  assert.equal(
    blocked.valid,
    false,
    "[CART VALIDATION FAIL] Checkout měl být blokovaný pod floor. Zkontroluj v admin.shopify -> Zákazníci.",
  );
  assert.equal(blocked.errors.length > 0, true);
  assert.equal(blocked.errors[0]?.code, "PRICE_BELOW_FLOOR");

  const allowed = validateCartLine({
    productId: "prod-floor",
    segment: "B2C",
    basePrice: 100,
    discounts: [{ code: "SAFE", percentOff: 20 }],
    discountRules: { allowStacking: true },
    floorRuleset: {
      global: { minPercentOfBasePrice: 70, allowZeroFinalPrice: false },
      perProduct: [],
    },
  });

  assert.equal(allowed.valid, true);
  assert.equal(allowed.errors.length, 0);
  console.log("[CART VALIDATION PASS] Blokace checkoutu pod floor funguje.");
});
