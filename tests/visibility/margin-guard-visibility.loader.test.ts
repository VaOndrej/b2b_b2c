import test from "node:test";
import assert from "node:assert/strict";
import { createVisibilityLoader } from "../../app/services/margin-guard-visibility.loader.server.ts";
import type { getOrCreateMarginGuardConfig } from "../../app/services/margin-guard-config.server.ts";

type MarginGuardConfig = Awaited<ReturnType<typeof getOrCreateMarginGuardConfig>>;

function stubConfig(): MarginGuardConfig {
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
    allowRemoveAtMinimumOrderQuantity: true,
    allowStacking: false,
    maxCombinedPercentOff: null,
    cartValidationStatus: "UNKNOWN",
    cartValidationLastError: null,
    cartValidationLastSyncAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    productFloors: [],
    productTierPrices: [],
    productQuantityRules: [],
    collectionQuantityRules: [],
    productCustomerQuantityRules: [],
    productVisibilityRules: [],
    productVariantVisibilityRules: [],
    collectionVisibilityRules: [],
    couponSegmentRules: [],
    discountRules: [],
    discountCombinationBlacklistRules: [],
    discountSegmentCaps: [],
  };
}

function baseDeps() {
  return {
    resolveStorefrontVisibilityByHandles: async () => ({
      productIdByHandle: {},
      hiddenHandles: [],
      hiddenProductIds: [],
      visibilityByHandle: {},
    }),
    fetchProductCollectionIdsByProductIds: async () => ({}),
    resolveStorefrontQuantityConstraintsByHandle: () => ({}),
    resolveStorefrontQuantityConstraintsByProductId: () => ({}),
    resolveStorefrontVariantVisibilityByProductId: () => ({}),
  };
}

test("visibility loader ignores ?segment= from querystring", async () => {
  const loader = createVisibilityLoader({
    async authenticatePublicAppProxy() {
      return { admin: undefined };
    },
    getOrCreateMarginGuardConfig: async () => stubConfig(),
    ...baseDeps(),
  });

  const request = new Request("https://example.com/apps/margin-guard/visibility?segment=B2B");
  const response = await loader({ request });
  const payload = await response.json();

  assert.equal(payload.segment, "B2C");
  assert.equal(payload.customerId, null);
});

test("visibility loader trusts logged_in_customer_id and ignores spoofed customerId param", async () => {
  const adminCalls: Array<Record<string, unknown> | undefined> = [];
  const loader = createVisibilityLoader({
    async authenticatePublicAppProxy() {
      return {
        admin: {
          async graphql(_query: string, options?: { variables?: Record<string, unknown> }) {
            adminCalls.push(options?.variables);
            return {
              async json() {
                return { data: { customer: { tags: ["b2b"] } } };
              },
            };
          },
        },
      };
    },
    getOrCreateMarginGuardConfig: async () => stubConfig(),
    ...baseDeps(),
  });

  const request = new Request(
    "https://example.com/apps/margin-guard/visibility?customerId=gid://shopify/Customer/SPOOFED&segment=B2C&logged_in_customer_id=gid://shopify/Customer/REAL",
  );
  const response = await loader({ request });
  const payload = await response.json();

  assert.equal(payload.segment, "B2B");
  assert.equal(adminCalls[0]?.id, "gid://shopify/Customer/REAL");
});

test("visibility loader prefers logged_in_customer_tags hint for B2B detection", async () => {
  const loader = createVisibilityLoader({
    async authenticatePublicAppProxy() {
      return {
        admin: {
          async graphql() {
            throw new Error("admin lookup should not be required when tags hint is present");
          },
        },
      };
    },
    getOrCreateMarginGuardConfig: async () => stubConfig(),
    ...baseDeps(),
  });

  const request = new Request(
    `https://example.com/apps/margin-guard/visibility?logged_in_customer_id=gid://shopify/Customer/REAL&logged_in_customer_tags=${encodeURIComponent(JSON.stringify(["b2b", "vip"]))}`,
  );
  const response = await loader({ request });
  const payload = await response.json();

  assert.equal(payload.segment, "B2B");
  assert.equal(payload.segmentDebug.source, "hint_tags");
  assert.deepEqual(payload.segmentDebug.normalizedTags, ["b2b", "vip"]);
});

test("visibility loader returns variant visibility payload alongside quantity rules", async () => {
  const loader = createVisibilityLoader({
    async authenticatePublicAppProxy() {
      return { admin: undefined };
    },
    getOrCreateMarginGuardConfig: async () => ({
      ...stubConfig(),
      productVariantVisibilityRules: [
        {
          id: "rule_1",
          configId: "default",
          productId: "gid://shopify/Product/500",
          variantId: "gid://shopify/ProductVariant/900",
          visibilityMode: "B2B_ONLY",
          customerId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    }),
    resolveStorefrontVisibilityByHandles: async () => ({
      productIdByHandle: {},
      hiddenHandles: [],
      hiddenProductIds: [],
      visibilityByHandle: {},
    }),
    fetchProductCollectionIdsByProductIds: async () => ({}),
    resolveStorefrontQuantityConstraintsByHandle: () => ({}),
    resolveStorefrontQuantityConstraintsByProductId: () => ({}),
    resolveStorefrontVariantVisibilityByProductId: () => ({
      "gid://shopify/Product/500": {
        hiddenVariantIds: ["gid://shopify/ProductVariant/900"],
      },
    }),
  });

  const request = new Request(
    "https://example.com/apps/margin-guard/visibility?product_ids=gid://shopify/Product/500",
  );
  const response = await loader({ request });
  const payload = await response.json();

  assert.deepEqual(payload.variantVisibilityByProductId, {
    "gid://shopify/Product/500": {
      hiddenVariantIds: ["gid://shopify/ProductVariant/900"],
    },
  });
});
