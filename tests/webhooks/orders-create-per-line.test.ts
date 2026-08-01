import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOrderLine } from "../../app/services/orders-create-webhook.server.ts";

/**
 * The orders/create webhook logs a margin violation PER LINE. That relies on
 * evaluateOrderLine judging each line independently: a violating line is flagged, an
 * in-floor line on the same order is not, and a line without a product id is skipped
 * (→ nothing logged). This pins that per-line contract.
 */

const PRODUCT_A = "gid://shopify/Product/A";
const PRODUCT_B = "gid://shopify/Product/B";

function baseConfig() {
  return {
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    b2bGlobalMinPricePercent: 55,
    allowZeroFinalPrice: false,
    productFloors: [],
    productTierPrices: [],
  };
}

test("each order line is judged independently against the floor", () => {
  const config = baseConfig();

  // Line A: 50% discount → final 50 < floor 70 → violation.
  const violating = evaluateOrderLine({
    lineItem: { product_id: PRODUCT_A, quantity: 1, price: 100, total_discount: 50 },
    segment: "B2C",
    config,
  });
  assert.ok(violating);
  assert.equal(violating?.validation.allowed, false);
  assert.equal(violating?.validation.reason, "BELOW_FLOOR");
  assert.equal(violating?.productId, PRODUCT_A);

  // Line B: 10% discount → final 90 >= floor 70 → fine.
  const allowed = evaluateOrderLine({
    lineItem: { product_id: PRODUCT_B, quantity: 1, price: 100, total_discount: 10 },
    segment: "B2C",
    config,
  });
  assert.ok(allowed);
  assert.equal(allowed?.validation.allowed, true);
  assert.equal(allowed?.productId, PRODUCT_B);
});

test("a line without a product id is skipped (nothing to log)", () => {
  const result = evaluateOrderLine({
    lineItem: { quantity: 1, price: 100, total_discount: 90 },
    segment: "B2C",
    config: baseConfig(),
  });
  assert.equal(result, null);
});
