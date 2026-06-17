import { storefrontProjection } from "../../config/feature-flags.ts";
import type { Segment } from "../../core/segment/segment.types";
import type { CollectionVisibilityRule } from "../../core/storefront/storefront-content.types.ts";
import {
  resolveCollectionRedirectMessage,
  resolveHiddenCollections,
} from "../../core/storefront/storefront-content.engine.ts";
import { getOrCreateMarginGuardConfig } from "./margin-guard-config.server.ts";
import { getCatalogProductMapByIds } from "./product-catalog.server.ts";
import { getCollectionVisibilityRules } from "./storefront-content.server.ts";
import {
  resolveStorefrontQuantityConstraintsByHandle,
  resolveStorefrontQuantityConstraintsByProductId,
  resolveStorefrontVariantVisibilityByProductId,
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

export interface StorefrontProjectionPayload {
  schemaVersion: number;
  generatedAt: string;
  configUpdatedAt: string | null;
  debug: boolean;
  b2bTag: string;
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

function getProjectedProductVisibilityRules(config: MarginGuardConfig) {
  return config.productVisibilityRules.filter(
    (rule) => rule.visibilityMode === "B2B_ONLY" || rule.visibilityMode === "B2C_ONLY",
  );
}

function getProjectedVariantVisibilityRules(config: MarginGuardConfig) {
  return config.productVariantVisibilityRules.filter(
    (rule) => rule.visibilityMode === "B2B_ONLY" || rule.visibilityMode === "B2C_ONLY",
  );
}

function resolveHiddenProductHandlesForSegment(input: {
  segment: Segment;
  rules: ReturnType<typeof getProjectedProductVisibilityRules>;
  handleByProductId: Record<string, string>;
}): string[] {
  const hiddenHandles = new Set<string>();
  for (const rule of input.rules) {
    const productId = normalizeProductId(rule.productId);
    const handle = normalizeHandle(input.handleByProductId[productId]);
    if (!productId || !handle) {
      continue;
    }
    if (rule.visibilityMode === "B2B_ONLY" && input.segment !== "B2B") {
      hiddenHandles.add(handle);
    }
    if (rule.visibilityMode === "B2C_ONLY" && input.segment !== "B2C") {
      hiddenHandles.add(handle);
    }
  }
  return Array.from(hiddenHandles).sort();
}

function normalizeCollectionVisibilityRules(
  rules: Awaited<ReturnType<typeof getCollectionVisibilityRules>>,
): CollectionVisibilityRule[] {
  return rules
    .filter(
      (rule): rule is typeof rule & { visibilityMode: "B2B_ONLY" | "B2C_ONLY" } =>
        rule.visibilityMode === "B2B_ONLY" || rule.visibilityMode === "B2C_ONLY",
    )
    .map((rule) => ({
      id: rule.id,
      collectionId: rule.collectionId,
      collectionHandle: rule.collectionHandle,
      collectionTitle: rule.collectionTitle ?? null,
      visibilityMode: rule.visibilityMode,
    }));
}

function buildProjectionSegmentSnapshot(input: {
  segment: Segment;
  config: MarginGuardConfig;
  collectionVisibilityRules: Awaited<ReturnType<typeof getCollectionVisibilityRules>>;
  productHandleRecords: ProductHandleRecord[];
}): ProjectionSegmentSnapshot {
  const handles = input.productHandleRecords.map((record) => record.handle);
  const productIds = input.productHandleRecords.map((record) => record.productId);
  const productIdByHandle = buildProductIdByHandle(input.productHandleRecords);
  const handleByProductId = Object.fromEntries(
    input.productHandleRecords.map((record) => [record.productId, record.handle]),
  );
  const normalizedCollectionVisibilityRules = normalizeCollectionVisibilityRules(
    input.collectionVisibilityRules,
  );

  return {
    hiddenProductHandles: resolveHiddenProductHandlesForSegment({
      segment: input.segment,
      rules: getProjectedProductVisibilityRules(input.config),
      handleByProductId,
    }),
    hiddenCollectionHandles: resolveHiddenCollections(
      input.segment,
      normalizedCollectionVisibilityRules,
    ).sort(),
    quantityConstraintsByHandle: resolveStorefrontQuantityConstraintsByHandle({
      handles,
      productIdByHandle,
      segment: input.segment,
      rules: input.config.productQuantityRules,
    }),
    quantityConstraintsByProductId: resolveStorefrontQuantityConstraintsByProductId({
      productIds,
      segment: input.segment,
      rules: input.config.productQuantityRules,
    }),
    variantVisibilityByProductId: resolveStorefrontVariantVisibilityByProductId({
      productIds,
      segment: input.segment,
      rules: getProjectedVariantVisibilityRules(input.config),
    }),
  };
}

export function buildStorefrontProjection(input: {
  config: MarginGuardConfig;
  collectionVisibilityRules: Awaited<ReturnType<typeof getCollectionVisibilityRules>>;
  productHandleRecords: ProductHandleRecord[];
}): StorefrontProjectionPayload {
  return {
    schemaVersion: STOREFRONT_PROJECTION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    configUpdatedAt: input.config.updatedAt
      ? new Date(input.config.updatedAt).toISOString()
      : null,
    debug: storefrontProjection.debug,
    b2bTag: String(input.config.b2bTag ?? "b2b").trim() || "b2b",
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
        segment: "B2B",
        config: input.config,
        collectionVisibilityRules: input.collectionVisibilityRules,
        productHandleRecords: input.productHandleRecords,
      }),
      b2c: buildProjectionSegmentSnapshot({
        segment: "B2C",
        config: input.config,
        collectionVisibilityRules: input.collectionVisibilityRules,
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
  const [config, collectionVisibilityRules] = await Promise.all([
    getOrCreateMarginGuardConfig(),
    getCollectionVisibilityRules(),
  ]);

  const productIds = Array.from(
    new Set(
      [
        ...config.productQuantityRules.map((rule) => rule.productId),
        ...getProjectedProductVisibilityRules(config).map((rule) => rule.productId),
        ...getProjectedVariantVisibilityRules(config).map((rule) => rule.productId),
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
    collectionVisibilityRules,
    productHandleRecords,
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
