import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStorefrontProjection,
  measureProjectionSize,
} from "../../app/services/storefront-projection.server.ts";
import type { getOrCreateMarginGuardConfig } from "../../app/services/margin-guard-config.server.ts";
import {
  buildCatalogConfigFromCatalogs,
  type CatalogTableInput,
} from "../../core/config/function-config.ts";
import {
  buildCatalogRulesets,
  type CatalogRuleset,
  type CatalogRulesetConfig,
} from "../../core/catalog/catalog.ruleset.ts";

type MarginGuardConfig = Awaited<ReturnType<typeof getOrCreateMarginGuardConfig>>;

// MVP_5_3 #2.3c — the projection's b2b/b2c snapshots are regenerated from catalog
// tables (default catalog → b2c, B2B catalog → b2b). The config now only supplies
// shop-wide scalars (b2bTag / updatedAt / allowRemove).
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
  } as unknown as MarginGuardConfig;
}

function rulesetsFromCatalogs(catalogs: CatalogTableInput[]): CatalogRuleset[] {
  const config = buildCatalogConfigFromCatalogs(
    { b2bTag: "b2b", globalMinPricePercent: 70, allowZeroFinalPrice: false },
    catalogs,
  );
  return buildCatalogRulesets(config as unknown as CatalogRulesetConfig);
}

test("buildStorefrontProjection carries catalog resolution metadata for client-side resolution", () => {
  const resolution = [
    { id: "default", priority: 0, isDefault: true, audienceTags: [], matchCompany: false, marketFilters: [], segment: "B2C" },
    { id: "b2b", priority: 100, isDefault: false, audienceTags: ["b2b"], matchCompany: true, marketFilters: [], segment: "B2B" },
    { id: "loyalty-gold", priority: 90, isDefault: false, audienceTags: ["gold"], matchCompany: false, marketFilters: [{ countryCode: "CZ", currencyCode: null, languageCode: null }], segment: "B2C" },
  ];
  const projection = buildStorefrontProjection({
    config: makeConfig(),
    productHandleRecords: [],
    catalogResolution: resolution,
    catalogTags: ["b2b", "gold"],
    defaultCatalogId: "default",
  });
  assert.equal(projection.defaultCatalogId, "default");
  assert.deepEqual(projection.catalogTags, ["b2b", "gold"]);
  assert.deepEqual(projection.catalogResolution, resolution);
  assert.ok(projection.segments.b2b);
  assert.ok(projection.segments.b2c);
});

test("buildStorefrontProjection carries per-catalog hidden variants for storefront enforcement", () => {
  const catalogVariantVisibility = [
    {
      catalogId: "loyalty-gold",
      hiddenVariantsByProductId: {
        "gid://shopify/Product/100": ["gid://shopify/ProductVariant/1001"],
      },
    },
  ];
  const projection = buildStorefrontProjection({
    config: makeConfig(),
    productHandleRecords: [],
    catalogVariantVisibility,
  });
  assert.deepEqual(projection.catalogVariantVisibility, catalogVariantVisibility);
});

test("buildStorefrontProjection carries per-catalog hidden collection handles", () => {
  const catalogCollectionVisibility = [
    { catalogId: "loyalty-gold", hiddenCollectionHandles: ["wholesale"] },
  ];
  const projection = buildStorefrontProjection({
    config: makeConfig(),
    productHandleRecords: [],
    catalogCollectionVisibility,
  });
  assert.deepEqual(projection.catalogCollectionVisibility, catalogCollectionVisibility);
});

test("buildStorefrontProjection defaults catalog metadata when not provided (back-compat)", () => {
  const projection = buildStorefrontProjection({
    config: makeConfig(),
    productHandleRecords: [],
  });
  assert.equal(projection.defaultCatalogId, "default");
  assert.deepEqual(projection.catalogTags, []);
  assert.deepEqual(projection.catalogResolution, []);
  assert.deepEqual(projection.catalogVariantVisibility, []);
});

test("buildStorefrontProjection regenerates b2b/b2c snapshots from catalog tables", () => {
  // default catalog (→ b2c) owns product 200 quantity + hides product 100 + the
  // wholesale collection; the b2b catalog (→ b2b) owns product 100 quantity +
  // hides a variant.
  const catalogRulesets = rulesetsFromCatalogs([
    {
      id: "default",
      isDefault: true,
      priority: 0,
      quantityRules: [
        { productId: "gid://shopify/Product/200", moq: 4, step: 4, max: 20 },
      ],
    },
    {
      id: "b2b",
      priority: 100,
      segment: "B2B",
      matchCompany: true,
      audienceTags: ["b2b"],
      quantityRules: [{ productId: "gid://shopify/Product/100", moq: 12, step: 6 }],
    },
  ]);

  const projection = buildStorefrontProjection({
    config: makeConfig(),
    productHandleRecords: [
      { productId: "gid://shopify/Product/100", handle: "b2b-carton" },
      { productId: "gid://shopify/Product/200", handle: "all-segments-pack" },
    ],
    catalogRulesets,
    catalogProductVisibility: [
      { catalogId: "default", hiddenProductIds: ["gid://shopify/Product/100"] },
    ],
    catalogVariantVisibility: [
      {
        catalogId: "b2b",
        hiddenVariantsByProductId: {
          "gid://shopify/Product/100": ["gid://shopify/ProductVariant/1001"],
        },
      },
    ],
    catalogCollectionVisibility: [
      { catalogId: "default", hiddenCollectionHandles: ["wholesale"] },
    ],
  });

  assert.equal(projection.schemaVersion, 1);
  assert.equal(projection.b2bTag, "b2b");
  assert.equal(projection.coverage.productQuantityRules, "PROJECTED");
  assert.equal(projection.pricingPreview.mode, "RESERVED");

  // Product 100 is hidden from the default catalog → hidden in the b2c snapshot.
  assert.deepEqual(projection.segments.b2b.hiddenProductHandles, []);
  assert.deepEqual(projection.segments.b2c.hiddenProductHandles, ["b2b-carton"]);
  assert.deepEqual(projection.segments.b2b.hiddenCollectionHandles, []);
  assert.deepEqual(projection.segments.b2c.hiddenCollectionHandles, ["wholesale"]);

  // Quantity comes from each catalog's effective layer.
  assert.deepEqual(projection.segments.b2b.quantityConstraintsByHandle["b2b-carton"], {
    minimumOrderQuantity: 12,
    stepQuantity: 6,
  });
  assert.deepEqual(projection.segments.b2c.quantityConstraintsByHandle["all-segments-pack"], {
    minimumOrderQuantity: 4,
    stepQuantity: 4,
    maxOrderQuantity: 20,
  });
  // The default (b2c) catalog has no quantity for product 100.
  assert.equal(
    projection.segments.b2c.quantityConstraintsByHandle["b2b-carton"],
    undefined,
  );

  assert.deepEqual(
    projection.segments.b2b.variantVisibilityByProductId["gid://shopify/Product/100"],
    { hiddenVariantIds: ["gid://shopify/ProductVariant/1001"] },
  );
  assert.equal(
    projection.segments.b2c.variantVisibilityByProductId["gid://shopify/Product/100"],
    undefined,
  );
});

test("buildStorefrontProjection only projects catalog-provided visibility (no customer leakage)", () => {
  // Customer-specific visibility is never catalog data — it stays runtime-only,
  // so a product without a catalog visibility rule is never in the snapshot.
  const projection = buildStorefrontProjection({
    config: makeConfig(),
    productHandleRecords: [
      { productId: "gid://shopify/Product/100", handle: "b2b-carton" },
      { productId: "gid://shopify/Product/200", handle: "all-segments-pack" },
    ],
    catalogRulesets: rulesetsFromCatalogs([
      { id: "default", isDefault: true, priority: 0 },
      { id: "b2b", priority: 100, segment: "B2B", matchCompany: true, audienceTags: ["b2b"] },
    ]),
    catalogProductVisibility: [
      { catalogId: "default", hiddenProductIds: ["gid://shopify/Product/100"] },
    ],
  });

  for (const segment of ["b2b", "b2c"] as const) {
    assert.ok(
      !projection.segments[segment].hiddenProductHandles.includes("all-segments-pack"),
      `${segment} hidden handles must only include catalog-hidden products`,
    );
    assert.equal(
      projection.segments[segment].variantVisibilityByProductId["gid://shopify/Product/200"],
      undefined,
      `${segment} variant visibility must only include catalog-hidden variants`,
    );
  }
});

test("buildStorefrontProjection marks collection quantity and customer quantity rules as runtime-only", () => {
  const projection = buildStorefrontProjection({
    config: makeConfig(),
    productHandleRecords: [
      { productId: "gid://shopify/Product/200", handle: "all-segments-pack" },
    ],
    catalogRulesets: rulesetsFromCatalogs([
      {
        id: "default",
        isDefault: true,
        priority: 0,
        quantityRules: [
          { productId: "gid://shopify/Product/200", moq: 4, step: 4, max: 20 },
        ],
      },
    ]),
  });

  assert.equal(projection.coverage.collectionQuantityRules, "RUNTIME_ONLY");
  assert.equal(projection.coverage.customerSpecificQuantityRules, "RUNTIME_ONLY");

  // The product-scoped catalog quantity (max 20) is projected; customer-specific
  // maximums are never part of the projection.
  const b2c = projection.segments.b2c.quantityConstraintsByHandle["all-segments-pack"];
  assert.equal(b2c?.maxOrderQuantity, 20);
});

test("buildStorefrontProjection produces a valid, fully-formed payload for an empty config", () => {
  const projection = buildStorefrontProjection({
    config: makeConfig(),
    productHandleRecords: [],
  });

  for (const segment of ["b2b", "b2c"] as const) {
    const snapshot = projection.segments[segment];
    assert.deepEqual(snapshot.hiddenProductHandles, []);
    assert.deepEqual(snapshot.hiddenCollectionHandles, []);
    assert.deepEqual(snapshot.quantityConstraintsByHandle, {});
    assert.deepEqual(snapshot.quantityConstraintsByProductId, {});
    assert.deepEqual(snapshot.variantVisibilityByProductId, {});
  }

  const serialized = JSON.stringify(projection);
  assert.doesNotThrow(() => JSON.parse(serialized));
});

test("measureProjectionSize flags payloads near and over the metafield limit", () => {
  const small = measureProjectionSize("{}");
  assert.equal(small.withinHardLimit, true);
  assert.equal(small.nearLimit, false);

  const near = measureProjectionSize("a".repeat(60 * 1024));
  assert.equal(near.withinHardLimit, true);
  assert.equal(near.nearLimit, true);

  const over = measureProjectionSize("a".repeat(70 * 1024));
  assert.equal(over.withinHardLimit, false);
  assert.equal(over.nearLimit, true);
});
