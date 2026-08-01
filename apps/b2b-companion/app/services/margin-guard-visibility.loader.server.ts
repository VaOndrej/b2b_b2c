import {
  E2E_AUDIENCE_OVERRIDE_PARAM,
  resolveStorefrontAudienceOverride,
} from "./storefront-catalog-override.server.ts";
import type { getOrCreateMarginGuardConfig } from "./margin-guard-config.server.ts";
import type {
  fetchProductCollectionIdsByProductIds,
  resolveStorefrontQuantityConstraintsByProductId,
  resolveStorefrontQuantityConstraintsByHandle,
  resolveStorefrontVariantVisibilityByProductId,
  resolveStorefrontVisibilityByHandles,
} from "./storefront-visibility.server.ts";

function parseHandles(value: string | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((handle) => handle.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeProductId(value: string): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("gid://shopify/Product/")) {
    return normalized;
  }
  if (/^\d+$/.test(normalized)) {
    return `gid://shopify/Product/${normalized}`;
  }
  return null;
}

function parseProductIds(value: string | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((raw) => normalizeProductId(raw))
    .filter((productId): productId is string => Boolean(productId));
}

function normalizeCustomerId(value: string | null): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("gid://shopify/Customer/")) {
    return normalized;
  }
  if (/^\d+$/.test(normalized)) {
    return `gid://shopify/Customer/${normalized}`;
  }
  return normalized;
}

function normalizeTag(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function parseLoggedInCustomerTags(value: string | null): string[] {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return [];
  }
  try {
    const parsed = JSON.parse(normalized);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeTag).filter(Boolean);
  } catch {
    return normalized
      .split(",")
      .map(normalizeTag)
      .filter(Boolean);
  }
}

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{
    json(): Promise<{ data?: { customer?: { tags?: unknown[] } } }>;
  }>;
}

import type { resolveCartDiscountConflictsByHandle } from "./discount-conflict.server.ts";
import type { StorefrontCatalogQuantity } from "./catalog-ruleset.server.ts";

const EMPTY_CATALOG_QUANTITY: StorefrontCatalogQuantity = {
  productQuantityRules: [],
  collectionQuantityRules: [],
  customerQuantityRules: [],
};

type VisibilityDependencies = {
  authenticatePublicAppProxy: (
    request: Request,
  ) => Promise<{ admin: AdminGraphqlClient | undefined }>;
  getOrCreateMarginGuardConfig: typeof getOrCreateMarginGuardConfig;
  resolveStorefrontVisibilityByHandles: typeof resolveStorefrontVisibilityByHandles;
  fetchProductCollectionIdsByProductIds: typeof fetchProductCollectionIdsByProductIds;
  resolveStorefrontQuantityConstraintsByHandle: typeof resolveStorefrontQuantityConstraintsByHandle;
  resolveStorefrontQuantityConstraintsByProductId: typeof resolveStorefrontQuantityConstraintsByProductId;
  resolveStorefrontVariantVisibilityByProductId: typeof resolveStorefrontVariantVisibilityByProductId;
  // MVP_5_0_3: optional so existing callers/tests that don't need cart conflict
  // notices keep working unchanged.
  resolveCartDiscountConflictsByHandle?: typeof resolveCartDiscountConflictsByHandle;
  // MVP_5_3 #3: optional per-catalog variant visibility — hides variants for the
  // custom catalog the customer's tags resolve into. Optional so existing
  // tests/callers are unaffected.
  resolveStorefrontCatalogVariantVisibility?: (
    customerTags: string[],
  ) => Promise<Record<string, string[]>>;
  // MVP_5_3 #2.0a: optional per-catalog PRODUCT visibility — hidden product ids
  // for the resolved custom catalog (mapped to handles here).
  resolveStorefrontCatalogProductVisibility?: (
    customerTags: string[],
  ) => Promise<string[]>;
  // MVP_5_3 #2.3c: catalog-sourced quantity hints (MOQ/step/max, collection max,
  // customer-specific max) for the resolved catalog. Replaces the legacy
  // MarginGuardConfig quantity children.
  loadStorefrontCatalogQuantity?: (input: {
    matchedTags: string[];
    hasPurchasingCompany?: boolean;
    customerId?: string | null;
  }) => Promise<StorefrontCatalogQuantity>;
  // MVP_5_4_9: resolves which catalog the customer falls into (from their audience
  // tags) for the informational `catalogId` response field. Optional so existing
  // tests/callers are unaffected (catalogId is null when not wired).
  resolveStorefrontCatalogId?: (input: {
    matchedTags: string[];
    hasPurchasingCompany?: boolean;
  }) => Promise<string | null>;
};

// MVP_5_4_9 — the storefront no longer derives a binary B2B/B2C segment. It only
// collects the customer's audience tags; catalog resolution (which catalog the
// customer falls into) is done downstream from those tags.
async function resolveCustomerAudienceTags(input: {
  admin: AdminGraphqlClient | undefined;
  customerId: string | null;
  customerTagsHint: string[];
}): Promise<{
  source: "hint_tags" | "admin_tags" | "missing_customer" | "missing_admin" | "fallback";
  normalizedTags: string[];
}> {
  // Trust the storefront-supplied tag hint when present — it carries the full
  // customer.tags list, so we can skip the admin round-trip.
  if (input.customerTagsHint.length > 0) {
    return { source: "hint_tags", normalizedTags: input.customerTagsHint };
  }

  if (!input.customerId) {
    return { source: "missing_customer", normalizedTags: [] };
  }
  if (!input.admin) {
    return { source: "missing_admin", normalizedTags: [] };
  }

  try {
    const response = await input.admin.graphql(
      `#graphql
        query CustomerTags($id: ID!) {
          customer(id: $id) {
            tags
          }
        }`,
      {
        variables: {
          id: input.customerId,
        },
      },
    );
    const payload = await response.json();
    const tags = Array.isArray(payload?.data?.customer?.tags)
      ? payload.data.customer.tags
      : [];
    const normalizedTags = tags.map(normalizeTag).filter(Boolean);
    return { source: "admin_tags", normalizedTags };
  } catch {
    return { source: "fallback", normalizedTags: [] };
  }
}

export function createVisibilityLoader(deps: VisibilityDependencies) {
  return async ({ request }: { request: Request }) => {
    const { admin } = await deps.authenticatePublicAppProxy(request);
    const url = new URL(request.url);
    const handles = parseHandles(url.searchParams.get("handles"));
    const productIds = parseProductIds(url.searchParams.get("product_ids"));
    const config = await deps.getOrCreateMarginGuardConfig();
    const customerId = normalizeCustomerId(url.searchParams.get("logged_in_customer_id"));
    const customerTagsHint = parseLoggedInCustomerTags(
      url.searchParams.get("logged_in_customer_tags"),
    );
    // Gated E2E escape hatch: when armed, force the matched audience tags from
    // `mg_e2e_audience` and skip the customer tag lookup entirely. Inert in
    // production / without the runner-owned flag — see
    // resolveStorefrontAudienceOverride. Catalog resolution is tag-based, so the
    // injected tags drive which catalog resolves (e.g. a dedicated e2e catalog);
    // an empty list forces the base/default context.
    const overrideTags = resolveStorefrontAudienceOverride(
      url.searchParams.get(E2E_AUDIENCE_OVERRIDE_PARAM),
    );
    const audienceResolution = overrideTags
      ? {
          source: "e2e_override" as const,
          normalizedTags: overrideTags,
        }
      : await resolveCustomerAudienceTags({
          admin,
          customerId,
          customerTagsHint,
        });
    const matchedTags = audienceResolution.normalizedTags;

    // MVP_5_4_9 — informational: which catalog the customer resolves into. The
    // storefront no longer thinks in B2B/B2C; this just labels the response.
    const catalogId = deps.resolveStorefrontCatalogId
      ? await deps
          .resolveStorefrontCatalogId({ matchedTags })
          .catch(() => null)
      : null;

    // MVP_5_3 #2.3c — quantity hints come from the customer's resolved catalog
    // (catalog tables), not the legacy MarginGuardConfig quantity children.
    const catalogQuantity = deps.loadStorefrontCatalogQuantity
      ? await deps
          .loadStorefrontCatalogQuantity({
            matchedTags,
            customerId,
          })
          .catch(() => EMPTY_CATALOG_QUANTITY)
      : EMPTY_CATALOG_QUANTITY;

    // Product/variant visibility now flow solely from per-catalog visibility
    // (merged below); no segment-keyed rules are read, so pass none —
    // resolveStorefrontVisibilityByHandles still resolves the handle→productId
    // map the rest of the loader needs.
    const visibility = await deps.resolveStorefrontVisibilityByHandles({
      admin,
      handles,
      customerId,
      rules: [],
    });
    const collectionQuantityRules = catalogQuantity.collectionQuantityRules;
    const allRelevantProductIds = Array.from(
      new Set([
        ...productIds,
        ...Object.values(visibility.productIdByHandle).map((value) => String(value ?? "")),
      ]),
    ).filter(Boolean);
    const productCollectionIdsByProductId = await deps.fetchProductCollectionIdsByProductIds({
      admin,
      productIds: allRelevantProductIds,
      collectionIds: collectionQuantityRules.map((rule) => String(rule.collectionId ?? "")),
    });
    const quantityConstraintsByHandle = deps.resolveStorefrontQuantityConstraintsByHandle({
      handles,
      productIdByHandle: visibility.productIdByHandle,
      rules: catalogQuantity.productQuantityRules,
      collectionRules: collectionQuantityRules,
      productCollectionIdsByProductId,
      customerId,
      customerMaxRules: catalogQuantity.customerQuantityRules,
    });
    const quantityConstraintsByProductId = deps.resolveStorefrontQuantityConstraintsByProductId({
      productIds,
      rules: catalogQuantity.productQuantityRules,
      collectionRules: collectionQuantityRules,
      productCollectionIdsByProductId,
      customerId,
      customerMaxRules: catalogQuantity.customerQuantityRules,
    });
    // Variant visibility flows solely from per-catalog variant visibility
    // (merged below); no segment-keyed variant rules are read.
    const variantVisibilityByProductId =
      deps.resolveStorefrontVariantVisibilityByProductId({
        productIds: allRelevantProductIds,
        customerId,
        rules: [],
      });

    // MVP_5_3 #3 — merge per-catalog hidden variants (custom catalog resolved
    // from the customer's tags) on top of the base variant visibility.
    let mergedVariantVisibilityByProductId = variantVisibilityByProductId;
    if (deps.resolveStorefrontCatalogVariantVisibility) {
      const catalogHiddenVariants = await deps
        .resolveStorefrontCatalogVariantVisibility(matchedTags)
        .catch(() => ({}) as Record<string, string[]>);
      if (Object.keys(catalogHiddenVariants).length > 0) {
        mergedVariantVisibilityByProductId = { ...variantVisibilityByProductId };
        for (const [productId, variantIds] of Object.entries(catalogHiddenVariants)) {
          const existing =
            mergedVariantVisibilityByProductId[productId]?.hiddenVariantIds ?? [];
          mergedVariantVisibilityByProductId[productId] = {
            hiddenVariantIds: Array.from(new Set([...existing, ...variantIds])),
          };
        }
      }
    }

    // MVP_5_3 #2.0a — hide whole products for the resolved custom catalog by
    // mapping its hidden product ids onto the requested handles.
    let mergedVisibility = visibility;
    if (deps.resolveStorefrontCatalogProductVisibility) {
      const catalogHiddenProductIds = new Set(
        (
          await deps
            .resolveStorefrontCatalogProductVisibility(matchedTags)
            .catch(() => [] as string[])
        ).map((value) => String(value)),
      );
      if (catalogHiddenProductIds.size > 0) {
        const extraHiddenHandles: string[] = [];
        const extraHiddenProductIds: string[] = [];
        for (const [handle, productId] of Object.entries(
          visibility.productIdByHandle ?? {},
        )) {
          if (catalogHiddenProductIds.has(String(productId))) {
            extraHiddenHandles.push(handle);
            extraHiddenProductIds.push(String(productId));
          }
        }
        if (extraHiddenHandles.length > 0) {
          mergedVisibility = {
            ...visibility,
            hiddenHandles: Array.from(
              new Set([...(visibility.hiddenHandles ?? []), ...extraHiddenHandles]),
            ),
            hiddenProductIds: Array.from(
              new Set([...(visibility.hiddenProductIds ?? []), ...extraHiddenProductIds]),
            ),
          };
        }
      }
    }

    const discountConflictsByHandle = deps.resolveCartDiscountConflictsByHandle
      ? await deps
          .resolveCartDiscountConflictsByHandle({
            admin,
            matchedTags,
            handles,
            productIdByHandle: visibility.productIdByHandle,
            productCollectionIdsByProductId,
          })
          .catch(() => ({}))
      : {};

    return Response.json(
      {
        catalogId,
        customerId: customerId ?? null,
        b2bTag: config.b2bTag,
        discountConflictsByHandle,
        audienceDebug: {
          source: audienceResolution.source,
          normalizedTags: matchedTags,
          customerTagsHint,
          hasAdminClient: Boolean(admin),
        },
        allowRemoveAtMinimumOrderQuantity:
          config.allowRemoveAtMinimumOrderQuantity !== false,
        configUpdatedAt: config.updatedAt,
        quantityConstraintsByHandle,
        quantityConstraintsByProductId,
        variantVisibilityByProductId: mergedVariantVisibilityByProductId,
        ...mergedVisibility,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  };
}
