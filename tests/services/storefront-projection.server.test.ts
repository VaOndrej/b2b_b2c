import test from "node:test";
import assert from "node:assert/strict";
import { buildStorefrontProjection } from "../../app/services/storefront-projection.server.ts";
import type { getOrCreateMarginGuardConfig } from "../../app/services/margin-guard-config.server.ts";

type MarginGuardConfig = Awaited<ReturnType<typeof getOrCreateMarginGuardConfig>>;

function makeConfig(): MarginGuardConfig {
  return {
    id: "default",
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    b2bGlobalMinPricePercent: 70,
    productCatalogSourceType: "SHOPIFY",
    productCatalogAutoImportEnabled: true,
    productCatalogLastSyncAt: null,
    productCatalogLastSyncError: null,
    allowZeroFinalPrice: false,
    allowRemoveAtMinimumOrderQuantity: false,
    allowStacking: false,
    maxCombinedPercentOff: null,
    marginGuardEnabled: true,
    cartValidationStatus: "UNKNOWN",
    cartValidationLastError: null,
    cartValidationLastSyncAt: null,
    createdAt: new Date("2026-03-29T10:00:00.000Z"),
    updatedAt: new Date("2026-03-29T11:00:00.000Z"),
    productFloors: [],
    productTierPrices: [],
    productQuantityRules: [
      {
        id: "qty_b2b",
        configId: "default",
        productId: "gid://shopify/Product/100",
        segment: "B2B",
        minimumOrderQuantity: 12,
        stepQuantity: 6,
        maxOrderQuantity: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "qty_all",
        configId: "default",
        productId: "gid://shopify/Product/200",
        segment: null,
        minimumOrderQuantity: 4,
        stepQuantity: 4,
        maxOrderQuantity: 20,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    collectionQuantityRules: [
      {
        id: "collection_runtime_only",
        configId: "default",
        collectionId: "gid://shopify/Collection/300",
        segment: "B2B",
        maxOrderQuantity: 50,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    productCustomerQuantityRules: [
      {
        id: "customer_runtime_only",
        configId: "default",
        productId: "gid://shopify/Product/200",
        customerId: "gid://shopify/Customer/500",
        maxOrderQuantity: 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    productVisibilityRules: [
      {
        id: "pv_b2b_only",
        configId: "default",
        productId: "gid://shopify/Product/100",
        visibilityMode: "B2B_ONLY",
        customerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "pv_customer_only",
        configId: "default",
        productId: "gid://shopify/Product/200",
        visibilityMode: "CUSTOMER_ONLY",
        customerId: "gid://shopify/Customer/500",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    productVariantVisibilityRules: [
      {
        id: "vv_b2c_only",
        configId: "default",
        productId: "gid://shopify/Product/100",
        variantId: "gid://shopify/ProductVariant/1001",
        visibilityMode: "B2C_ONLY",
        customerId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "vv_customer_only",
        configId: "default",
        productId: "gid://shopify/Product/200",
        variantId: "gid://shopify/ProductVariant/2001",
        visibilityMode: "CUSTOMER_ONLY",
        customerId: "gid://shopify/Customer/500",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    collectionVisibilityRules: [],
    couponSegmentRules: [],
    discountRules: [],
    discountCombinationBlacklistRules: [],
    discountSegmentCaps: [],
  };
}

test("buildStorefrontProjection projects the current storefront rules and reserves loyalty pricing space", () => {
  const projection = buildStorefrontProjection({
    config: makeConfig(),
    collectionVisibilityRules: [
      {
        id: "collection_b2b_only",
        configId: "default",
        collectionId: "gid://shopify/Collection/300",
        collectionHandle: "wholesale",
        collectionTitle: "Wholesale",
        visibilityMode: "B2B_ONLY",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    productHandleRecords: [
      {
        productId: "gid://shopify/Product/100",
        handle: "b2b-carton",
      },
      {
        productId: "gid://shopify/Product/200",
        handle: "all-segments-pack",
      },
    ],
  });

  assert.equal(projection.schemaVersion, 1);
  assert.equal(projection.b2bTag, "b2b");
  assert.equal(projection.allowRemoveAtMinimumOrderQuantity, false);
  assert.equal(projection.coverage.productQuantityRules, "PROJECTED");
  assert.equal(projection.coverage.collectionQuantityRules, "RUNTIME_ONLY");
  assert.equal(projection.pricingPreview.mode, "RESERVED");
  assert.deepEqual(projection.pricingPreview.loyaltyTiers, []);

  assert.deepEqual(projection.segments.b2b.hiddenProductHandles, []);
  assert.deepEqual(projection.segments.b2c.hiddenProductHandles, ["b2b-carton"]);
  assert.deepEqual(projection.segments.b2b.hiddenCollectionHandles, []);
  assert.deepEqual(projection.segments.b2c.hiddenCollectionHandles, ["wholesale"]);

  assert.deepEqual(projection.segments.b2b.quantityConstraintsByHandle["b2b-carton"], {
    minimumOrderQuantity: 12,
    stepQuantity: 6,
  });
  assert.deepEqual(projection.segments.b2c.quantityConstraintsByHandle["all-segments-pack"], {
    minimumOrderQuantity: 4,
    stepQuantity: 4,
    maxOrderQuantity: 20,
  });
  assert.equal(
    projection.segments.b2c.quantityConstraintsByHandle["b2b-carton"],
    undefined,
  );
  assert.deepEqual(
    projection.segments.b2b.variantVisibilityByProductId["gid://shopify/Product/100"],
    {
      hiddenVariantIds: ["gid://shopify/ProductVariant/1001"],
    },
  );
  assert.equal(
    projection.segments.b2c.variantVisibilityByProductId["gid://shopify/Product/100"],
    undefined,
  );
});
