import type { Segment } from "../../core/segment/segment.types";
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
};

async function resolveVisibilitySegment(input: {
  admin: AdminGraphqlClient | undefined;
  customerId: string | null;
  b2bTag: string;
  customerTagsHint: string[];
}): Promise<{
  segment: Segment;
  source: "hint_tags" | "admin_tags" | "missing_customer" | "missing_admin" | "fallback";
  expectedTag: string;
  normalizedTags: string[];
}> {
  const expectedTag = normalizeTag(input.b2bTag || "b2b") || "b2b";

  if (!input.customerId || !input.admin) {
    if (input.customerTagsHint.includes(expectedTag)) {
      return {
        segment: "B2B",
        source: "hint_tags",
        expectedTag,
        normalizedTags: input.customerTagsHint,
      };
    }
    return {
      segment: "B2C",
      source: input.customerId ? "missing_admin" : "missing_customer",
      expectedTag,
      normalizedTags: input.customerTagsHint,
    };
  }

  if (input.customerTagsHint.includes(expectedTag)) {
    return {
      segment: "B2B",
      source: "hint_tags",
      expectedTag,
      normalizedTags: input.customerTagsHint,
    };
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
    return {
      segment: normalizedTags.includes(expectedTag) ? "B2B" : "B2C",
      source: "admin_tags",
      expectedTag,
      normalizedTags,
    };
  } catch {
    return {
      segment: "B2C",
      source: "fallback",
      expectedTag,
      normalizedTags: input.customerTagsHint,
    };
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
    const segmentResolution = await resolveVisibilitySegment({
      admin,
      customerId,
      b2bTag: config.b2bTag,
      customerTagsHint,
    });
    const segment = segmentResolution.segment;
    const visibility = await deps.resolveStorefrontVisibilityByHandles({
      admin,
      handles,
      segment,
      customerId,
      rules: config.productVisibilityRules,
    });
    const collectionQuantityRules = Array.isArray(config.collectionQuantityRules)
      ? config.collectionQuantityRules
      : [];
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
      segment,
      rules: config.productQuantityRules,
      collectionRules: collectionQuantityRules,
      productCollectionIdsByProductId,
      customerId,
      customerMaxRules: config.productCustomerQuantityRules,
    });
    const quantityConstraintsByProductId = deps.resolveStorefrontQuantityConstraintsByProductId({
      productIds,
      segment,
      rules: config.productQuantityRules,
      collectionRules: collectionQuantityRules,
      productCollectionIdsByProductId,
      customerId,
      customerMaxRules: config.productCustomerQuantityRules,
    });
    const variantVisibilityByProductId =
      deps.resolveStorefrontVariantVisibilityByProductId({
        productIds: allRelevantProductIds,
        segment,
        customerId,
        rules: Array.isArray((config as any).productVariantVisibilityRules)
          ? (config as any).productVariantVisibilityRules
          : [],
      });

    return Response.json(
      {
        segment,
        customerId: customerId ?? null,
        b2bTag: config.b2bTag,
        segmentDebug: {
          source: segmentResolution.source,
          expectedTag: segmentResolution.expectedTag,
          normalizedTags: segmentResolution.normalizedTags,
          customerTagsHint,
          hasAdminClient: Boolean(admin),
        },
        allowRemoveAtMinimumOrderQuantity:
          config.allowRemoveAtMinimumOrderQuantity !== false,
        configUpdatedAt: config.updatedAt,
        quantityConstraintsByHandle,
        quantityConstraintsByProductId,
        variantVisibilityByProductId,
        ...visibility,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  };
}
