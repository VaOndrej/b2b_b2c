import type { Segment } from "../segment/segment.types";

interface BaseVisibilityRule {
  visibilityMode: "ALL" | "B2B_ONLY" | "B2C_ONLY" | "CUSTOMER_ONLY";
  customerId?: string;
}

export interface VisibilityRule extends BaseVisibilityRule {
  productId: string;
}

export interface VariantVisibilityRule extends BaseVisibilityRule {
  variantId: string;
}

export interface ProductVisibilityInput {
  productId: string;
  segment: Segment;
  customerId?: string;
  rules: VisibilityRule[];
}

function normalizeCustomerId(value: string | undefined): string {
  return String(value ?? "").trim();
}

function isVisibleForContext(input: {
  rule: BaseVisibilityRule | undefined;
  segment: Segment;
  customerId?: string;
}): boolean {
  const rule = input.rule;
  if (!rule) {
    return true;
  }
  if (rule.visibilityMode === "ALL") {
    return true;
  }
  if (rule.visibilityMode === "B2B_ONLY") {
    return input.segment === "B2B";
  }
  if (rule.visibilityMode === "B2C_ONLY") {
    return input.segment === "B2C";
  }
  if (rule.visibilityMode === "CUSTOMER_ONLY") {
    const expectedCustomerId = normalizeCustomerId(rule.customerId);
    const currentCustomerId = normalizeCustomerId(input.customerId);
    return Boolean(expectedCustomerId) && expectedCustomerId === currentCustomerId;
  }

  return true;
}

export function isProductVisible(
  input: ProductVisibilityInput,
): boolean {
  return isVisibleForContext({
    rule: input.rules.find((item) => item.productId === input.productId),
    segment: input.segment,
    customerId: input.customerId,
  });
}

export interface VariantVisibilityInput {
  variantId: string;
  segment: Segment;
  customerId?: string;
  rules: VariantVisibilityRule[];
}

export function isVariantVisible(
  input: VariantVisibilityInput,
): boolean {
  return isVisibleForContext({
    rule: input.rules.find((item) => item.variantId === input.variantId),
    segment: input.segment,
    customerId: input.customerId,
  });
}
