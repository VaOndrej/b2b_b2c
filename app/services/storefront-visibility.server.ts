import type { Segment } from "../../core/segment/segment.types";

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

interface ProductVisibilityRuleRecord {
  productId: string;
  visibilityMode: string;
  customerId?: string | null;
}

export interface StorefrontVisibilityInput {
  admin: AdminGraphqlClient | undefined;
  handles: string[];
  segment: Segment;
  customerId?: string | null;
  rules: ProductVisibilityRuleRecord[];
}

export interface StorefrontVisibilityResult {
  visibilityByHandle: Record<string, boolean>;
  hiddenHandles: string[];
  hiddenProductIds: string[];
}

function normalizeHandle(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

function normalizeCustomerId(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function isVisibleForContext(input: {
  segment: Segment;
  customerId: string;
  rule: ProductVisibilityRuleRecord;
}): boolean {
  if (input.rule.visibilityMode === "B2B_ONLY") {
    return input.segment === "B2B";
  }
  if (input.rule.visibilityMode === "B2C_ONLY") {
    return input.segment === "B2C";
  }
  if (input.rule.visibilityMode === "CUSTOMER_ONLY") {
    return Boolean(input.customerId) && input.customerId === normalizeCustomerId(input.rule.customerId);
  }
  return true;
}

async function fetchProductIdsByHandles(
  admin: AdminGraphqlClient,
  handles: string[],
): Promise<Record<string, string>> {
  const uniqueHandles = Array.from(new Set(handles.map(normalizeHandle))).filter(Boolean);
  if (uniqueHandles.length === 0) {
    return {};
  }

  const result: Record<string, string> = {};
  const chunkSize = 25;
  for (let index = 0; index < uniqueHandles.length; index += chunkSize) {
    const chunk = uniqueHandles.slice(index, index + chunkSize);
    const queryString = chunk.map((handle) => `handle:${handle}`).join(" OR ");
    const response = await admin.graphql(
      `#graphql
        query ProductsByHandle($query: String!, $first: Int!) {
          products(first: $first, query: $query) {
            nodes {
              id
              handle
            }
          }
        }`,
      {
        variables: {
          first: chunk.length,
          query: queryString,
        },
      },
    );
    const payload = await response.json();
    const nodes = payload?.data?.products?.nodes ?? [];
    for (const node of nodes) {
      const handle = normalizeHandle(node?.handle);
      const id = String(node?.id ?? "").trim();
      if (!handle || !id) {
        continue;
      }
      result[handle] = id;
    }
  }

  return result;
}

export async function resolveStorefrontVisibilityByHandles(
  input: StorefrontVisibilityInput,
): Promise<StorefrontVisibilityResult> {
  const normalizedHandles = Array.from(new Set(input.handles.map(normalizeHandle))).filter(
    Boolean,
  );
  if (normalizedHandles.length === 0) {
    return {
      visibilityByHandle: {},
      hiddenHandles: [],
      hiddenProductIds: [],
    };
  }

  if (!input.admin) {
    return {
      visibilityByHandle: Object.fromEntries(normalizedHandles.map((handle) => [handle, true])),
      hiddenHandles: [],
      hiddenProductIds: [],
    };
  }

  const productIdByHandle = await fetchProductIdsByHandles(input.admin, normalizedHandles);
  const visibilityByHandle: Record<string, boolean> = {};
  const hiddenProductIds = new Set<string>();
  const customerId = normalizeCustomerId(input.customerId);
  const ruleByProductId = new Map<string, ProductVisibilityRuleRecord>();
  for (const rule of input.rules) {
    const productId = String(rule.productId ?? "").trim();
    if (!productId) {
      continue;
    }
    ruleByProductId.set(productId, rule);
  }

  for (const handle of normalizedHandles) {
    const productId = productIdByHandle[handle];
    if (!productId) {
      visibilityByHandle[handle] = true;
      continue;
    }
    const rule = ruleByProductId.get(productId);
    if (!rule) {
      visibilityByHandle[handle] = true;
      continue;
    }
    const visible = isVisibleForContext({
      segment: input.segment,
      customerId,
      rule,
    });
    visibilityByHandle[handle] = visible;
    if (!visible) {
      hiddenProductIds.add(productId);
    }
  }

  const hiddenHandles = Object.entries(visibilityByHandle)
    .filter(([, visible]) => !visible)
    .map(([handle]) => handle);

  return {
    visibilityByHandle,
    hiddenHandles,
    hiddenProductIds: Array.from(hiddenProductIds),
  };
}
