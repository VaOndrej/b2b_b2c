import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOrderLine } from "../../app/services/orders-create-webhook.server.ts";

const PRODUCT_ID = "gid://shopify/Product/1";

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

test("uses B2B segment from customer tags and applies b2bOverridePrice", () => {
  const config = {
    ...baseConfig(),
    productFloors: [
      {
        productId: PRODUCT_ID,
        segment: null,
        minPercentOfBasePrice: 70,
        allowZeroFinalPrice: null,
        b2bOverridePrice: 80,
      },
    ],
  };

  const lineItem = {
    product_id: PRODUCT_ID,
    quantity: 1,
    price: 100,
    total_discount: 0,
  };

  const result = evaluateOrderLine({
    lineItem,
    segment: "B2B",
    config,
  });

  assert.ok(result);
  assert.equal(result?.segment, "B2B");
  assert.equal(result?.effectiveBasePrice, 80);
  assert.equal(result?.validation.allowed, true);
});

test("prefers tier pricing over b2b override when quantity meets threshold", () => {
  const config = {
    ...baseConfig(),
    productFloors: [
      {
        productId: PRODUCT_ID,
        segment: "B2B",
        minPercentOfBasePrice: 70,
        allowZeroFinalPrice: null,
        b2bOverridePrice: 80,
      },
    ],
    productTierPrices: [
      {
        productId: PRODUCT_ID,
        segment: "B2B",
        minQuantity: 10,
        unitPrice: 70,
      },
    ],
  };

  const lineItem = {
    product_id: PRODUCT_ID,
    quantity: 12,
    price: 100,
    total_discount: 0,
  };

  const result = evaluateOrderLine({
    lineItem,
    segment: "B2B",
    config,
  });

  assert.ok(result);
  assert.equal(result?.effectiveBasePrice, 70);
  assert.equal(result?.validation.allowed, true);
});

test("B2C flow flags margin violation when discount drops below floor", () => {
  const config = {
    ...baseConfig(),
    productFloors: [
      {
        productId: PRODUCT_ID,
        segment: null,
        minPercentOfBasePrice: 70,
        allowZeroFinalPrice: null,
        b2bOverridePrice: null,
      },
    ],
  };

  const lineItem = {
    product_id: PRODUCT_ID,
    quantity: 1,
    price: 100,
    total_discount: 50,
  };

  const result = evaluateOrderLine({
    lineItem,
    segment: "B2C",
    config,
  });

  assert.ok(result);
  assert.equal(result?.segment, "B2C");
  assert.equal(result?.validation.allowed, false);
  assert.equal(result?.validation.reason, "BELOW_FLOOR");
});
