import type { Segment } from "../../core/segment/segment.types";
import {
  resolveQuantityConstraints,
  type QuantityValidationInput,
} from "../../core/quantity/quantity.engine.ts";
import type { QuantityRule } from "../../core/quantity/quantity.rules.ts";

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

interface ProductQuantityRuleRecord {
  productId: string;
  segment?: string | null;
  minimumOrderQuantity?: number | null;
  stepQuantity?: number | null;
  maxOrderQuantity?: number | null;
}

interface ProductCustomerQuantityRuleRecord {
  productId: string;
  customerId: string;
  maxOrderQuantity: number;
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
  productIdByHandle: Record<string, string>;
}

interface StorefrontQuantityConstraintsInput {
  handles: string[];
  productIdByHandle: Record<string, string>;
  segment: Segment;
  rules: ProductQuantityRuleRecord[];
  customerId?: string | null;
  customerMaxRules?: ProductCustomerQuantityRuleRecord[];
}

interface StorefrontQuantityConstraints {
  minimumOrderQuantity: number;
  stepQuantity: number;
  maxOrderQuantity?: number;
}

interface StorefrontQuantityConstraintsByProductInput {
  productIds: string[];
  segment: Segment;
  rules: ProductQuantityRuleRecord[];
  customerId?: string | null;
  customerMaxRules?: ProductCustomerQuantityRuleRecord[];
}

function normalizeHandle(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

function escapeSearchValue(raw: string): string {
  return String(raw ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildHandleSearchQuery(handle: string): string {
  return `handle:'${escapeSearchValue(handle)}'`;
}

function normalizeCustomerId(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function normalizeSegment(value: string | null | undefined): "B2B" | "B2C" | undefined {
  if (value === "B2B" || value === "B2C") {
    return value;
  }
  return undefined;
}

function normalizeQuantityValue(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return undefined;
  }
  return Math.floor(parsed);
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

function buildQuantityRules(rules: ProductQuantityRuleRecord[]): QuantityRule[] {
  const normalizedRules: QuantityRule[] = [];
  for (const rule of rules) {
    const productId = String(rule.productId ?? "").trim();
    const minimumOrderQuantity = normalizeQuantityValue(rule.minimumOrderQuantity);
    const stepQuantity = normalizeQuantityValue(rule.stepQuantity);
    const maxOrderQuantity = normalizeQuantityValue(rule.maxOrderQuantity);
    if (
      !productId ||
      (minimumOrderQuantity == null &&
        stepQuantity == null &&
        maxOrderQuantity == null)
    ) {
      continue;
    }
    normalizedRules.push({
      productId,
      segment: normalizeSegment(rule.segment),
      minimumOrderQuantity,
      stepQuantity,
      maxOrderQuantity,
    });
  }
  return normalizedRules;
}

function buildCustomerMaximumQuantityMap(
  rules: ProductCustomerQuantityRuleRecord[],
): Record<string, Record<string, number>> {
  const normalized: Record<string, Record<string, number>> = {};
  for (const rule of rules) {
    const productId = normalizeProductId(rule.productId);
    const customerId = normalizeCustomerId(rule.customerId);
    const maxOrderQuantity = normalizeQuantityValue(rule.maxOrderQuantity);
    if (!productId || !customerId || maxOrderQuantity == null) {
      continue;
    }
    normalized[customerId] ??= {};
    normalized[customerId][productId] = maxOrderQuantity;
  }
  return normalized;
}

function resolveCustomerMaximumOrderQuantity(input: {
  customerId?: string | null;
  productId: string;
  customerMaxByCustomerId: Record<string, Record<string, number>>;
}): number | null {
  const customerId = normalizeCustomerId(input.customerId);
  if (!customerId) {
    return null;
  }
  const productMaxMap = input.customerMaxByCustomerId[customerId];
  if (!productMaxMap) {
    return null;
  }
  const maxOrderQuantity = normalizeQuantityValue(productMaxMap[input.productId]);
  return maxOrderQuantity ?? null;
}

function toStorefrontQuantityConstraints(
  constraints: ReturnType<typeof resolveQuantityConstraints>,
): StorefrontQuantityConstraints {
  if (constraints.maxOrderQuantity != null) {
    return {
      minimumOrderQuantity: constraints.minimumOrderQuantity,
      stepQuantity: constraints.stepQuantity,
      maxOrderQuantity: constraints.maxOrderQuantity,
    };
  }
  return {
    minimumOrderQuantity: constraints.minimumOrderQuantity,
    stepQuantity: constraints.stepQuantity,
  };
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
    const queryString = chunk.map(buildHandleSearchQuery).join(" OR ");
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

  const missingHandles = uniqueHandles.filter((handle) => !result[handle]);
  for (const handle of missingHandles) {
    const response = await admin.graphql(
      `#graphql
        query ProductBySingleHandle($query: String!) {
          products(first: 1, query: $query) {
            nodes {
              id
              handle
            }
          }
        }`,
      {
        variables: {
          query: buildHandleSearchQuery(handle),
        },
      },
    );
    const payload = await response.json();
    const node = payload?.data?.products?.nodes?.[0];
    const normalizedHandle = normalizeHandle(node?.handle);
    const productId = String(node?.id ?? "").trim();
    if (!normalizedHandle || !productId) {
      continue;
    }
    result[normalizedHandle] = productId;
  }

  return result;
}

export function resolveStorefrontQuantityConstraintsByHandle(
  input: StorefrontQuantityConstraintsInput,
): Record<string, StorefrontQuantityConstraints> {
  const normalizedHandles = Array.from(new Set(input.handles.map(normalizeHandle))).filter(
    Boolean,
  );
  if (normalizedHandles.length === 0) {
    return {};
  }

  const rules = buildQuantityRules(input.rules);
  const customerMaxByCustomerId = buildCustomerMaximumQuantityMap(
    input.customerMaxRules ?? [],
  );
  if (rules.length === 0) {
    const hasCustomerOverrides = Object.keys(customerMaxByCustomerId).length > 0;
    if (!hasCustomerOverrides) {
      return {};
    }
  }

  const result: Record<string, StorefrontQuantityConstraints> = {};
  for (const handle of normalizedHandles) {
    const productId = String(input.productIdByHandle[handle] ?? "").trim();
    if (!productId) {
      continue;
    }
    const constraints = resolveQuantityConstraints({
      quantity: 1,
      productId,
      segment: input.segment,
      rules,
    } satisfies QuantityValidationInput);
    const customerMaxOrderQuantity = resolveCustomerMaximumOrderQuantity({
      customerId: input.customerId,
      productId,
      customerMaxByCustomerId,
    });
    const effectiveConstraints = {
      ...constraints,
      maxOrderQuantity:
        customerMaxOrderQuantity != null
          ? customerMaxOrderQuantity
          : constraints.maxOrderQuantity,
    };
    if (
      effectiveConstraints.minimumOrderQuantity > 1 ||
      effectiveConstraints.stepQuantity > 1 ||
      effectiveConstraints.maxOrderQuantity != null
    ) {
      result[handle] = toStorefrontQuantityConstraints(effectiveConstraints);
    }
  }

  return result;
}

export function resolveStorefrontQuantityConstraintsByProductId(
  input: StorefrontQuantityConstraintsByProductInput,
): Record<string, StorefrontQuantityConstraints> {
  const normalizedProductIds = Array.from(
    new Set(
      input.productIds
        .map((productId) => normalizeProductId(productId))
        .filter(Boolean),
    ),
  );
  if (normalizedProductIds.length === 0) {
    return {};
  }

  const rules = buildQuantityRules(input.rules);
  const customerMaxByCustomerId = buildCustomerMaximumQuantityMap(
    input.customerMaxRules ?? [],
  );
  if (rules.length === 0) {
    const hasCustomerOverrides = Object.keys(customerMaxByCustomerId).length > 0;
    if (!hasCustomerOverrides) {
      return {};
    }
  }

  const result: Record<string, StorefrontQuantityConstraints> = {};
  for (const productId of normalizedProductIds) {
    const constraints = resolveQuantityConstraints({
      quantity: 1,
      productId,
      segment: input.segment,
      rules,
    } satisfies QuantityValidationInput);
    const customerMaxOrderQuantity = resolveCustomerMaximumOrderQuantity({
      customerId: input.customerId,
      productId,
      customerMaxByCustomerId,
    });
    const effectiveConstraints = {
      ...constraints,
      maxOrderQuantity:
        customerMaxOrderQuantity != null
          ? customerMaxOrderQuantity
          : constraints.maxOrderQuantity,
    };
    if (
      effectiveConstraints.minimumOrderQuantity > 1 ||
      effectiveConstraints.stepQuantity > 1 ||
      effectiveConstraints.maxOrderQuantity != null
    ) {
      result[productId] = toStorefrontQuantityConstraints(effectiveConstraints);
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
      productIdByHandle: {},
    };
  }

  if (!input.admin) {
    return {
      visibilityByHandle: Object.fromEntries(normalizedHandles.map((handle) => [handle, true])),
      hiddenHandles: [],
      hiddenProductIds: [],
      productIdByHandle: {},
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
    productIdByHandle,
  };
}
