import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveConfiguredPricing,
  resolveConfiguredTierPrices,
} from "../../core/pricing/pricing.config.ts";

test("pricing config resolution prefers exact segment override and merges tier prices deterministically", () => {
  const tierPrices = resolveConfiguredTierPrices(
    {
      productTierPrices: [
        {
          productId: "gid://shopify/Product/TIER_CFG",
          segment: null,
          minQuantity: 5,
          unitPrice: 92,
        },
        {
          productId: "gid://shopify/Product/TIER_CFG",
          segment: null,
          minQuantity: 10,
          unitPrice: 88,
        },
        {
          productId: "gid://shopify/Product/TIER_CFG",
          segment: "B2B",
          minQuantity: 10,
          unitPrice: 79,
        },
        {
          productId: "gid://shopify/Product/TIER_CFG",
          segment: "B2B",
          minQuantity: 20,
          unitPrice: 70,
        },
      ],
    },
    {
      productId: "gid://shopify/Product/TIER_CFG",
      segment: "B2B",
    },
  );

  assert.deepEqual(tierPrices, [
    { minQuantity: 5, unitPrice: 92 },
    { minQuantity: 10, unitPrice: 79 },
    { minQuantity: 20, unitPrice: 70 },
  ]);
});

test("pricing config resolution uses configured B2B override only for B2B and falls back from generic rule", () => {
  const b2b = resolveConfiguredPricing(
    {
      productFloors: [
        {
          productId: "gid://shopify/Product/B2B_CFG",
          segment: null,
          b2bOverridePrice: 95,
        },
        {
          productId: "gid://shopify/Product/B2B_CFG",
          segment: "B2B",
          b2bOverridePrice: 81,
        },
      ],
    },
    {
      productId: "gid://shopify/Product/B2B_CFG",
      segment: "B2B",
    },
  );

  const b2c = resolveConfiguredPricing(
    {
      productFloors: [
        {
          productId: "gid://shopify/Product/B2B_CFG",
          segment: null,
          b2bOverridePrice: 95,
        },
      ],
    },
    {
      productId: "gid://shopify/Product/B2B_CFG",
      segment: "B2C",
    },
  );

  assert.equal(b2b.b2bOverridePrice, 81);
  assert.equal(b2c.b2bOverridePrice, undefined);
});
