import { storefrontProjection } from "../../config/feature-flags.ts";
import { resolveCollectionRedirectMessage } from "../../core/storefront/storefront-content.engine.ts";
import type { EffectiveCatalogPricingLayer } from "../../core/catalog/catalog.types.ts";
import {
  buildCatalogRulesets,
  type CatalogRuleset,
  type CatalogRulesetConfig,
} from "../../core/catalog/catalog.ruleset.ts";
import { getOrCreateMarginGuardConfig } from "./margin-guard-config.server.ts";
import { buildCatalogConfigFromCatalogs } from "../../core/config/function-config.ts";
import { getCatalogProductMapByIds } from "./product-catalog.server.ts";
import {
  loadAllCatalogsForConfig,
  loadCatalogVariantVisibility,
  loadCatalogCollectionVisibility,
  loadCatalogProductVisibility,
} from "./price-catalog.server.ts";
import {
  resolveStorefrontQuantityConstraintsByHandle,
  resolveStorefrontQuantityConstraintsByProductId,
} from "./storefront-visibility.server.ts";

const STOREFRONT_PROJECTION_SCHEMA_VERSION = 1;
const STOREFRONT_PROJECTION_NAMESPACE = "margin_guard";
const STOREFRONT_PROJECTION_KEY = "storefront_projection";

// Shopify rejects a JSON metafield value larger than 64 KB. We warn well before
// that so a growing catalog surfaces in logs before writes start failing; the
// remediation (chunking / trimming low-value segments) is tracked for a later MVP.
const STOREFRONT_PROJECTION_MAX_BYTES = 64 * 1024;
const STOREFRONT_PROJECTION_WARN_BYTES = Math.floor(STOREFRONT_PROJECTION_MAX_BYTES * 0.8);

export function measureProjectionSize(value: string): {
  byteSize: number;
  withinHardLimit: boolean;
  nearLimit: boolean;
} {
  const byteSize = Buffer.byteLength(value, "utf8");
  return {
    byteSize,
    withinHardLimit: byteSize <= STOREFRONT_PROJECTION_MAX_BYTES,
    nearLimit: byteSize >= STOREFRONT_PROJECTION_WARN_BYTES,
  };
}

type MarginGuardConfig = Awaited<ReturnType<typeof getOrCreateMarginGuardConfig>>;

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

interface ProductHandleRecord {
  productId: string;
  handle: string;
}

type ProjectionQuantityConstraints = Record<
  string,
  {
    minimumOrderQuantity: number;
    stepQuantity: number;
    maxOrderQuantity?: number;
  }
>;

type ProjectionVariantVisibility = Record<
  string,
  {
    hiddenVariantIds: string[];
  }
>;

interface ProjectionSegmentSnapshot {
  hiddenProductHandles: string[];
  hiddenCollectionHandles: string[];
  quantityConstraintsByHandle: ProjectionQuantityConstraints;
  quantityConstraintsByProductId: ProjectionQuantityConstraints;
  variantVisibilityByProductId: ProjectionVariantVisibility;
}

// MVP_5_3 Phase 3c — catalog resolution metadata so the storefront can resolve
// the customer's catalog client-side (from tags + company + market), mirroring
// the Shopify Functions. The legacy segment snapshots stay as the source of
// truth for visibility/quantity (anti-flash preserved); per-catalog visibility
// projection layers on top once the per-catalog visibility model lands.
interface ProjectionCatalogResolutionEntry {
  id: string;
  priority: number;
  isDefault: boolean;
  audienceTags: string[];
  matchCompany: boolean;
  marketFilters: Array<{
    countryCode: string | null;
    currencyCode: string | null;
    languageCode: string | null;
  }>;
  segment: string;
}

export interface StorefrontProjectionPayload {
  schemaVersion: number;
  generatedAt: string;
  configUpdatedAt: string | null;
  debug: boolean;
  b2bTag: string;
  defaultCatalogId: string;
  catalogTags: string[];
  catalogResolution: ProjectionCatalogResolutionEntry[];
  catalogVariantVisibility: Array<{
    catalogId: string;
    hiddenVariantsByProductId: Record<string, string[]>;
  }>;
  catalogCollectionVisibility: Array<{
    catalogId: string;
    hiddenCollectionHandles: string[];
  }>;
  allowRemoveAtMinimumOrderQuantity: boolean;
  coverage: {
    productVisibility: "PROJECTED";
    collectionVisibility: "PROJECTED";
    productQuantityRules: "PROJECTED";
    collectionQuantityRules: "RUNTIME_ONLY";
    customerSpecificQuantityRules: "RUNTIME_ONLY";
    variantVisibility: "PROJECTED";
    storefrontContent: "RUNTIME_ONLY";
    pricingPreview: "RESERVED";
  };
  messages: {
    collectionRedirect: {
      en: string;
      cs: string;
    };
  };
  pricingPreview: {
    mode: "RESERVED";
    loyaltyTiers: string[];
    byHandle: Record<string, never>;
  };
  segments: {
    b2b: ProjectionSegmentSnapshot;
    b2c: ProjectionSegmentSnapshot;
  };
}

function normalizeProductId(value: string | null | undefined): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.startsWith("gid://shopify/Product/")) {
    return normalized;
  }
  if (/^\d+$/.test(normalized)) {
    return `gid://shopify/Product/${normalized}`;
  }
  return "";
}

function normalizeHandle(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function buildProductIdByHandle(records: ProductHandleRecord[]): Record<string, string> {
  return Object.fromEntries(records.map((record) => [record.handle, record.productId]));
}

// MVP_5_3 #2.3c — the b2b/b2c projection snapshots (consumed by the storefront
// Liquid block for anti-flash) are now regenerated from catalog tables: the
// default catalog feeds the b2c snapshot, the B2B catalog feeds the b2b one. The
// payload shape is unchanged so no Liquid/script edit is needed.
interface CatalogSnapshotSources {
  effectiveLayer: EffectiveCatalogPricingLayer | null;
  hiddenProductIds: string[];
  hiddenVariantsByProductId: Record<string, string[]>;
  hiddenCollectionHandles: string[];
}

function buildQuantityRulesFromLayer(layer: EffectiveCatalogPricingLayer | null) {
  if (!layer) {
    return [];
  }
  const productIds = new Set<string>([
    ...Object.keys(layer.perProductMinimumOrderQuantities),
    ...Object.keys(layer.perProductStepQuantities),
    ...Object.keys(layer.perProductMaximumOrderQuantities),
  ]);
  return Array.from(productIds).map((productId) => ({
    productId,
    segment: null as string | null,
    minimumOrderQuantity: layer.perProductMinimumOrderQuantities[productId] ?? null,
    stepQuantity: layer.perProductStepQuantities[productId] ?? null,
    maxOrderQuantity: layer.perProductMaximumOrderQuantities[productId] ?? null,
  }));
}

function buildProjectionSegmentSnapshot(input: {
  sources: CatalogSnapshotSources;
  productHandleRecords: ProductHandleRecord[];
}): ProjectionSegmentSnapshot {
  const handles = input.productHandleRecords.map((record) => record.handle);
  const productIds = input.productHandleRecords.map((record) => record.productId);
  const productIdByHandle = buildProductIdByHandle(input.productHandleRecords);
  const handleByProductId = Object.fromEntries(
    input.productHandleRecords.map((record) => [record.productId, record.handle]),
  );
  const quantityRules = buildQuantityRulesFromLayer(input.sources.effectiveLayer);

  const hiddenProductHandles = Array.from(
    new Set(
      input.sources.hiddenProductIds
        .map((productId) =>
          normalizeHandle(handleByProductId[normalizeProductId(productId)]),
        )
        .filter(Boolean),
    ),
  ).sort();

  const variantVisibilityByProductId: ProjectionVariantVisibility = {};
  for (const [productId, variantIds] of Object.entries(
    input.sources.hiddenVariantsByProductId,
  )) {
    const ids = Array.from(new Set(variantIds.map(String).filter(Boolean)));
    if (ids.length > 0) {
      variantVisibilityByProductId[productId] = { hiddenVariantIds: ids };
    }
  }

  return {
    hiddenProductHandles,
    hiddenCollectionHandles: Array.from(
      new Set(
        input.sources.hiddenCollectionHandles.map(normalizeHandle).filter(Boolean),
      ),
    ).sort(),
    quantityConstraintsByHandle: resolveStorefrontQuantityConstraintsByHandle({
      handles,
      productIdByHandle,
      segment: "B2C",
      rules: quantityRules,
    }),
    quantityConstraintsByProductId: resolveStorefrontQuantityConstraintsByProductId({
      productIds,
      segment: "B2C",
      rules: quantityRules,
    }),
    variantVisibilityByProductId,
  };
}

export function buildStorefrontProjection(input: {
  config: MarginGuardConfig;
  productHandleRecords: ProductHandleRecord[];
  catalogResolution?: ProjectionCatalogResolutionEntry[];
  catalogTags?: string[];
  defaultCatalogId?: string;
  catalogRulesets?: CatalogRuleset[];
  catalogProductVisibility?: Array<{
    catalogId: string;
    hiddenProductIds: string[];
  }>;
  catalogVariantVisibility?: Array<{
    catalogId: string;
    hiddenVariantsByProductId: Record<string, string[]>;
  }>;
  catalogCollectionVisibility?: Array<{
    catalogId: string;
    hiddenCollectionHandles: string[];
  }>;
}): StorefrontProjectionPayload {
  const defaultId =
    input.defaultCatalogId ??
    (input.catalogRulesets ?? []).find((ruleset) => ruleset.isDefault)?.catalogId ??
    "default";
  // The b2b snapshot is fed by the (non-default) catalog mapped to the B2B
  // audience; falls back to the conventional "b2b" id when no catalog metadata
  // is available (back-compat / empty shop).
  const b2bCatalogId =
    (input.catalogRulesets ?? []).find(
      (ruleset) => !ruleset.isDefault && ruleset.segment === "B2B",
    )?.catalogId ??
    (input.catalogResolution ?? []).find(
      (entry) => !entry.isDefault && entry.segment === "B2B",
    )?.id ??
    "b2b";

  const sourcesForCatalog = (catalogId: string): CatalogSnapshotSources => ({
    effectiveLayer:
      (input.catalogRulesets ?? []).find((r) => r.catalogId === catalogId)
        ?.effectiveLayer ?? null,
    hiddenProductIds:
      (input.catalogProductVisibility ?? []).find((e) => e.catalogId === catalogId)
        ?.hiddenProductIds ?? [],
    hiddenVariantsByProductId:
      (input.catalogVariantVisibility ?? []).find((e) => e.catalogId === catalogId)
        ?.hiddenVariantsByProductId ?? {},
    hiddenCollectionHandles:
      (input.catalogCollectionVisibility ?? []).find((e) => e.catalogId === catalogId)
        ?.hiddenCollectionHandles ?? [],
  });

  return {
    schemaVersion: STOREFRONT_PROJECTION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    configUpdatedAt: input.config.updatedAt
      ? new Date(input.config.updatedAt).toISOString()
      : null,
    debug: storefrontProjection.debug,
    b2bTag: String(input.config.b2bTag ?? "b2b").trim() || "b2b",
    defaultCatalogId: input.defaultCatalogId ?? "default",
    catalogTags: input.catalogTags ?? [],
    catalogResolution: input.catalogResolution ?? [],
    catalogVariantVisibility: input.catalogVariantVisibility ?? [],
    catalogCollectionVisibility: input.catalogCollectionVisibility ?? [],
    allowRemoveAtMinimumOrderQuantity:
      input.config.allowRemoveAtMinimumOrderQuantity !== false,
    coverage: {
      productVisibility: "PROJECTED",
      collectionVisibility: "PROJECTED",
      productQuantityRules: "PROJECTED",
      collectionQuantityRules: "RUNTIME_ONLY",
      customerSpecificQuantityRules: "RUNTIME_ONLY",
      variantVisibility: "PROJECTED",
      storefrontContent: "RUNTIME_ONLY",
      pricingPreview: "RESERVED",
    },
    messages: {
      collectionRedirect: {
        en: resolveCollectionRedirectMessage("en"),
        cs: resolveCollectionRedirectMessage("cs"),
      },
    },
    pricingPreview: {
      mode: "RESERVED",
      loyaltyTiers: [],
      byHandle: {},
    },
    segments: {
      b2b: buildProjectionSegmentSnapshot({
        sources: sourcesForCatalog(b2bCatalogId),
        productHandleRecords: input.productHandleRecords,
      }),
      b2c: buildProjectionSegmentSnapshot({
        sources: sourcesForCatalog(defaultId),
        productHandleRecords: input.productHandleRecords,
      }),
    },
  };
}

async function resolveProductHandleRecords(input: {
  admin: AdminGraphqlClient;
  productIds: string[];
}): Promise<ProductHandleRecord[]> {
  const normalizedProductIds = Array.from(
    new Set(input.productIds.map((productId) => normalizeProductId(productId)).filter(Boolean)),
  );
  if (normalizedProductIds.length === 0) {
    return [];
  }

  const catalogMap = await getCatalogProductMapByIds(normalizedProductIds);
  const resolvedRecords = new Map<string, ProductHandleRecord>();

  for (const productId of normalizedProductIds) {
    const handle = normalizeHandle(catalogMap[productId]?.handle);
    if (!handle) {
      continue;
    }
    resolvedRecords.set(productId, { productId, handle });
  }

  const missingProductIds = normalizedProductIds.filter((productId) => !resolvedRecords.has(productId));
  const chunkSize = 100;
  for (let index = 0; index < missingProductIds.length; index += chunkSize) {
    const chunk = missingProductIds.slice(index, index + chunkSize);
    try {
      const response = await input.admin.graphql(
        `#graphql
          query ProductHandlesByIds($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on Product {
                id
                handle
              }
            }
          }`,
        {
          variables: {
            ids: chunk,
          },
        },
      );
      const payload = await response.json();
      const nodes = Array.isArray(payload?.data?.nodes) ? payload.data.nodes : [];
      for (const node of nodes) {
        const productId = normalizeProductId(node?.id);
        const handle = normalizeHandle(node?.handle);
        if (!productId || !handle) {
          continue;
        }
        resolvedRecords.set(productId, { productId, handle });
      }
    } catch {
      continue;
    }
  }

  return Array.from(resolvedRecords.values()).sort((left, right) =>
    left.handle.localeCompare(right.handle),
  );
}

async function ensureProjectionMetafieldDefinition(admin: AdminGraphqlClient) {
  try {
    const response = await admin.graphql(
      `#graphql
        mutation MetafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id }
            userErrors { field message code }
          }
        }`,
      {
        variables: {
          definition: {
            name: "Storefront Projection",
            namespace: STOREFRONT_PROJECTION_NAMESPACE,
            key: STOREFRONT_PROJECTION_KEY,
            type: "json",
            ownerType: "SHOP",
            access: {
              storefront: "PUBLIC_READ",
            },
          },
        },
      },
    );
    const payload = await response.json();
    const userErrors = payload?.data?.metafieldDefinitionCreate?.userErrors ?? [];
    if (userErrors.length > 0 && userErrors[0]?.code !== "TAKEN") {
      console.error("[syncStorefrontProjectionMetafields] definition error:", JSON.stringify(userErrors));
    }
  } catch (error) {
    console.error("[syncStorefrontProjectionMetafields] metafield definition error:", error);
  }
}

export async function syncStorefrontProjectionMetafields(admin: AdminGraphqlClient) {
  const config = await getOrCreateMarginGuardConfig();

  // MVP_5_3 #2.3c — the projection (incl. the b2b/b2c anti-flash snapshots) is
  // sourced entirely from catalog tables. Resilient to missing catalog tables
  // (falls back to default/b2b only).
  const allCatalogs = await loadAllCatalogsForConfig().catch(() => []);
  const catalogConfig = buildCatalogConfigFromCatalogs(
    {
      b2bTag: config.b2bTag,
      globalMinPricePercent: config.globalMinPricePercent,
      allowZeroFinalPrice: config.allowZeroFinalPrice,
      allowStacking: config.allowStacking,
      maxCombinedPercentOff: config.maxCombinedPercentOff,
      marginGuardEnabled: config.marginGuardEnabled,
    },
    allCatalogs,
  );
  const catalogRulesets = buildCatalogRulesets(
    catalogConfig as unknown as CatalogRulesetConfig,
  );
  const [catalogVariantVisibility, catalogCollectionVisibility, catalogProductVisibility] =
    await Promise.all([
      loadCatalogVariantVisibility().catch(() => []),
      loadCatalogCollectionVisibility().catch(() => []),
      loadCatalogProductVisibility().catch(() => []),
    ]);

  // Resolve handles for every product referenced by a catalog snapshot source
  // (quantity rule, hidden product, or hidden variant).
  const productIds = Array.from(
    new Set(
      [
        ...catalogRulesets.flatMap((ruleset) => [
          ...Object.keys(ruleset.effectiveLayer.perProductMinimumOrderQuantities),
          ...Object.keys(ruleset.effectiveLayer.perProductStepQuantities),
          ...Object.keys(ruleset.effectiveLayer.perProductMaximumOrderQuantities),
        ]),
        ...catalogProductVisibility.flatMap((entry) => entry.hiddenProductIds),
        ...catalogVariantVisibility.flatMap((entry) =>
          Object.keys(entry.hiddenVariantsByProductId),
        ),
      ]
        .map((productId) => normalizeProductId(productId))
        .filter(Boolean),
    ),
  );

  const productHandleRecords = await resolveProductHandleRecords({
    admin,
    productIds,
  });
  const projection = buildStorefrontProjection({
    config,
    productHandleRecords,
    catalogResolution:
      catalogConfig.catalogResolution as unknown as ProjectionCatalogResolutionEntry[],
    catalogTags: catalogConfig.catalogTags,
    defaultCatalogId: catalogConfig.defaultCatalogId,
    catalogRulesets,
    catalogProductVisibility,
    catalogVariantVisibility,
    catalogCollectionVisibility,
  });

  const shopResponse = await admin.graphql(
    `#graphql
      query ShopId {
        shop { id }
      }`,
  );
  const shopPayload = await shopResponse.json();
  const shopId = shopPayload?.data?.shop?.id;
  if (!shopId) {
    return;
  }

  await ensureProjectionMetafieldDefinition(admin);

  const serializedProjection = JSON.stringify(projection);
  const size = measureProjectionSize(serializedProjection);
  if (!size.withinHardLimit) {
    console.error(
      `[syncStorefrontProjectionMetafields] projection is ${size.byteSize} bytes, over the ${STOREFRONT_PROJECTION_MAX_BYTES} byte metafield limit; the write will be rejected. Catalog has likely outgrown a single metafield (chunking required).`,
    );
  } else if (size.nearLimit) {
    console.warn(
      `[syncStorefrontProjectionMetafields] projection is ${size.byteSize} bytes, approaching the ${STOREFRONT_PROJECTION_MAX_BYTES} byte metafield limit.`,
    );
  }

  const response = await admin.graphql(
    `#graphql
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key }
          userErrors { field message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            namespace: STOREFRONT_PROJECTION_NAMESPACE,
            key: STOREFRONT_PROJECTION_KEY,
            ownerId: shopId,
            type: "json",
            value: serializedProjection,
          },
        ],
      },
    },
  );
  const payload = await response.json();
  const userErrors = payload?.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    console.error("[syncStorefrontProjectionMetafields] userErrors:", JSON.stringify(userErrors));
  } else if (storefrontProjection.debug) {
    console.log("[syncStorefrontProjectionMetafields] synced");
  }
}
