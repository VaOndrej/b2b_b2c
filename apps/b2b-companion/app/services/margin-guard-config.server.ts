import prisma from "../db.server.ts";
import {
  buildDiscountRuleLookupKey,
  canonicalizeDiscountBlacklistPair,
} from "@won/core/discount/discount.identity";
import type { FloorRuleset } from "@won/core/margin/floor.rules";
import { buildCatalogConfigFromCatalogs } from "@won/core/config/function-config";
import {
  loadAllCatalogsForConfig,
  loadCatalogProductVisibility,
} from "./price-catalog.server.ts";

// MVP_5_3 #2.3c — the per-segment MarginGuardConfig children (floors, tiers,
// quantity, visibility, coupons, discounts) were dropped; price catalogs are the
// single source of truth. This module now only owns shop-wide scalars, margin
// violation logging, and the floor-ruleset + discount-identity helpers still used
// by the webhook / tests. Storefront hidden-handle sync reads catalog tables.

const DEFAULT_CONFIG_ID = "default";

function getMarginGuardPrismaOrThrow() {
  const client = prisma;
  if (!client.marginGuardConfig || !client.marginViolationLog) {
    throw new Error(
      "Prisma client is out of date for Margin Guard models. Run `npm run prisma:generate` and restart `shopify app dev`.",
    );
  }

  return client;
}

export async function getOrCreateMarginGuardConfig() {
  const db = getMarginGuardPrismaOrThrow();
  const existing = await db.marginGuardConfig.findUnique({
    where: { id: DEFAULT_CONFIG_ID },
  });

  if (existing) {
    return existing;
  }

  return db.marginGuardConfig.create({
    data: { id: DEFAULT_CONFIG_ID },
  });
}

export async function updateGlobalMarginGuardConfig(input: {
  b2bTag: string;
  globalMinPricePercent: number;
  b2bGlobalMinPricePercent: number;
  productCatalogSourceType?: string;
  productCatalogAutoImportEnabled?: boolean;
  allowZeroFinalPrice: boolean;
  allowRemoveAtMinimumOrderQuantity: boolean;
  allowStacking: boolean;
  maxCombinedPercentOff: number | null;
  marginGuardEnabled?: boolean;
}) {
  const db = getMarginGuardPrismaOrThrow();
  const productCatalogSourceType = input.productCatalogSourceType ?? "SHOPIFY";
  const productCatalogAutoImportEnabled =
    input.productCatalogAutoImportEnabled ?? true;
  return db.marginGuardConfig.upsert({
    where: { id: DEFAULT_CONFIG_ID },
    update: {
      b2bTag: input.b2bTag,
      globalMinPricePercent: input.globalMinPricePercent,
      b2bGlobalMinPricePercent: input.b2bGlobalMinPricePercent,
      productCatalogSourceType,
      productCatalogAutoImportEnabled,
      allowZeroFinalPrice: input.allowZeroFinalPrice,
      allowRemoveAtMinimumOrderQuantity: input.allowRemoveAtMinimumOrderQuantity,
      allowStacking: input.allowStacking,
      maxCombinedPercentOff: input.maxCombinedPercentOff,
      marginGuardEnabled: input.marginGuardEnabled !== false,
    },
    create: {
      id: DEFAULT_CONFIG_ID,
      b2bTag: input.b2bTag,
      globalMinPricePercent: input.globalMinPricePercent,
      b2bGlobalMinPricePercent: input.b2bGlobalMinPricePercent,
      productCatalogSourceType,
      productCatalogAutoImportEnabled,
      allowZeroFinalPrice: input.allowZeroFinalPrice,
      allowRemoveAtMinimumOrderQuantity: input.allowRemoveAtMinimumOrderQuantity,
      allowStacking: input.allowStacking,
      maxCombinedPercentOff: input.maxCombinedPercentOff,
      marginGuardEnabled: input.marginGuardEnabled !== false,
    },
  });
}

function normalizeCollectionId(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("gid://shopify/Collection/")) {
    return normalized;
  }
  if (/^\d+$/.test(normalized)) {
    return `gid://shopify/Collection/${normalized}`;
  }
  return null;
}

function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

export function buildDiscountRuleCanonicalKey(input: {
  scope: "GLOBAL" | "COLLECTION" | "PRODUCT" | "COUPON";
  segment?: string | null;
  targetId?: string | null;
  code?: string | null;
  requiredCustomerTag?: string | null;
}) {
  let targetId = String(input.targetId ?? "").trim() || null;
  let code = input.code ?? null;

  if (input.scope === "COLLECTION") {
    targetId = normalizeCollectionId(targetId);
    if (!targetId) {
      return null;
    }
  }

  if (input.scope === "PRODUCT" && !targetId) {
    return null;
  }

  if (input.scope === "COUPON") {
    code = normalizeCouponCode(String(input.code ?? input.targetId ?? ""));
    if (!code) {
      return null;
    }
  }

  return buildDiscountRuleLookupKey({
    scope: input.scope,
    targetId,
    code,
    segment: input.segment,
    requiredCustomerTag: input.requiredCustomerTag,
  });
}

export function buildDiscountCombinationBlacklistCanonicalPairKey(input: {
  leftType: "RULE_ID" | "COUPON_CODE" | "SCOPE";
  leftValue: string;
  rightType: "RULE_ID" | "COUPON_CODE" | "SCOPE";
  rightValue: string;
  segment?: string | null;
}) {
  return canonicalizeDiscountBlacklistPair(input).pairKey;
}

// MVP_5_4_9 — the `margin_guard/hidden_handles` metafield (consumed by the
// storefront Liquid block for anti-flash) carries hidden product handles keyed by
// catalogId: { catalogs: { [catalogId]: handles[] }, defaultCatalogId, b2bTag }.
// The Liquid embed resolves the customer's catalog client-side and reads its list
// — no B2B/B2C branching on the storefront.
export async function syncVisibilityHandlesMetafield(admin: {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}) {
  const config = await getOrCreateMarginGuardConfig();
  const [catalogProductVisibility, allCatalogs] = await Promise.all([
    loadCatalogProductVisibility().catch(() => []),
    loadAllCatalogsForConfig().catch(() => []),
  ]);
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
  const defaultId = catalogConfig.defaultCatalogId;

  // Every resolvable catalog (resolution metadata) plus any catalog with hidden
  // products gets an entry; the default catalog is always present.
  const catalogIds = Array.from(
    new Set<string>(
      [
        String(defaultId),
        ...(catalogConfig.catalogResolution as Array<Record<string, unknown>>).map(
          (entry) => String(entry.id ?? ""),
        ),
        ...catalogProductVisibility.map((entry) => String(entry.catalogId ?? "")),
      ].filter(Boolean),
    ),
  );

  const hiddenFor = (catalogId: string): string[] =>
    catalogProductVisibility.find((entry) => entry.catalogId === catalogId)
      ?.hiddenProductIds ?? [];

  const resolveHandles = async (productIds: string[]): Promise<string[]> => {
    if (!productIds.length) return [];
    const handles: string[] = [];
    const chunkSize = 25;
    for (let i = 0; i < productIds.length; i += chunkSize) {
      const chunk = productIds.slice(i, i + chunkSize);
      const queryParts = chunk
        .map((id) => {
          const numericId = id
            .trim()
            .replace(/^gid:\/\/shopify\/Product\//, "");
          return `(id:${numericId})`;
        })
        .join(" OR ");
      try {
        const response = await admin.graphql(
          `#graphql
            query ProductHandlesByIds($query: String!, $first: Int!) {
              products(first: $first, query: $query) {
                nodes { handle }
              }
            }`,
          { variables: { first: chunk.length, query: queryParts } },
        );
        const payload = await response.json();
        for (const node of payload?.data?.products?.nodes ?? []) {
          const handle = String(node?.handle ?? "").trim().toLowerCase();
          if (handle) handles.push(handle);
        }
      } catch (err) {
        console.error("[syncVisibilityHandlesMetafield] GraphQL error:", err);
      }
    }
    return handles;
  };

  const catalogs: Record<string, string[]> = {};
  await Promise.all(
    catalogIds.map(async (catalogId) => {
      catalogs[catalogId] = [...new Set(await resolveHandles(hiddenFor(catalogId)))];
    }),
  );

  const metafieldValue = JSON.stringify({
    catalogs,
    defaultCatalogId: String(defaultId),
    b2bTag: String(config?.b2bTag ?? "b2b").trim().toLowerCase() || "b2b",
  });

  const shopResponse = await admin.graphql(
    `#graphql
      query ShopId {
        shop { id }
      }`,
  );
  const shopPayload = await shopResponse.json();
  const shopId = shopPayload?.data?.shop?.id;
  if (!shopId) return;

  // Ensure metafield definition exists with storefront access so Liquid can read it.
  try {
    const defResponse = await admin.graphql(
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
            name: "Hidden Handles",
            namespace: "margin_guard",
            key: "hidden_handles",
            type: "json",
            ownerType: "SHOP",
            access: {
              storefront: "PUBLIC_READ",
            },
          },
        },
      },
    );
    const defResult = await defResponse.json();
    const defErrors =
      defResult?.data?.metafieldDefinitionCreate?.userErrors ?? [];
    if (defErrors.length > 0 && defErrors[0]?.code !== "TAKEN") {
      console.error(
        "[syncVisibilityHandlesMetafield] definition error:",
        JSON.stringify(defErrors),
      );
    }
  } catch (e) {
    console.error(
      "[syncVisibilityHandlesMetafield] metafield definition error:",
      e,
    );
  }

  const metafieldResponse = await admin.graphql(
    `#graphql
      mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields { id namespace key }
          userErrors { field, message }
        }
      }`,
    {
      variables: {
        metafields: [
          {
            namespace: "margin_guard",
            key: "hidden_handles",
            ownerId: shopId,
            type: "json",
            value: metafieldValue,
          },
        ],
      },
    },
  );
  const metafieldResult = await metafieldResponse.json();
  const userErrors = metafieldResult?.data?.metafieldsSet?.userErrors ?? [];
  if (userErrors.length > 0) {
    console.error(
      "[syncVisibilityHandlesMetafield] userErrors:",
      JSON.stringify(userErrors),
    );
  }
}

export async function listMarginViolationLogs(limit = 100) {
  const db = getMarginGuardPrismaOrThrow();
  return db.marginViolationLog.findMany({
    take: limit,
    orderBy: { createdAt: "desc" },
  });
}

export async function recordMarginViolation(input: {
  shop: string;
  productId: string;
  customerId?: string;
  segment: "B2B" | "B2C";
  basePrice: number;
  finalPrice: number;
  floorPrice: number;
  violationAmount: number;
  source: string;
}) {
  const db = getMarginGuardPrismaOrThrow();
  return db.marginViolationLog.create({
    data: {
      configId: DEFAULT_CONFIG_ID,
      shop: input.shop,
      productId: input.productId,
      customerId: input.customerId,
      segment: input.segment,
      basePrice: input.basePrice,
      finalPrice: input.finalPrice,
      floorPrice: input.floorPrice,
      violationAmount: input.violationAmount,
      source: input.source,
    },
  });
}

// Pure mapper from a floor config (now sourced from catalog rulesets) to the
// margin-guard FloorRuleset. Still used by the orders/create webhook.
export function buildFloorRuleset(config: {
  globalMinPricePercent: number;
  b2bGlobalMinPricePercent?: number;
  allowZeroFinalPrice: boolean;
  productFloors: Array<{
    productId: string;
    segment: string | null;
    minPercentOfBasePrice: number;
    allowZeroFinalPrice: boolean | null;
    b2bOverridePrice?: number | null;
  }>;
}): FloorRuleset {
  return {
    global: {
      minPercentOfBasePrice: config.globalMinPricePercent,
      b2bMinPercentOfBasePrice:
        config.b2bGlobalMinPricePercent ?? config.globalMinPricePercent,
      allowZeroFinalPrice: config.allowZeroFinalPrice,
    },
    perProduct: config.productFloors.map((rule) => ({
      productId: rule.productId,
      segment:
        rule.segment === "B2B" || rule.segment === "B2C"
          ? rule.segment
          : undefined,
      minPercentOfBasePrice: rule.minPercentOfBasePrice,
      allowZeroFinalPriceOverride: rule.allowZeroFinalPrice ?? undefined,
    })),
  };
}
