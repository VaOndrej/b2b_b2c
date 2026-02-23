import test from "node:test";
import assert from "node:assert/strict";
import { computeEffectiveBasePrice } from "../../core/pricing/pricing.engine.ts";

test("pricing engine uses B2B override base price only for B2B segment", () => {
  const b2b = computeEffectiveBasePrice({
    productId: "gid://shopify/Product/1",
    segment: "B2B",
    basePrice: 80,
    b2bOverridePrice: 100,
  });
  assert.equal(b2b.effectiveBasePrice, 100);

  const b2c = computeEffectiveBasePrice({
    productId: "gid://shopify/Product/1",
    segment: "B2C",
    basePrice: 80,
    b2bOverridePrice: 100,
  });
  assert.equal(b2c.effectiveBasePrice, 80);
});
