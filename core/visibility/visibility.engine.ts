import type { Segment } from "../segment/segment.types";

export interface VisibilityRule {
  productId: string;
  visibilityMode: "ALL" | "B2B_ONLY" | "B2C_ONLY" | "CUSTOMER_ONLY";
  customerId?: string;
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

export function isProductVisible(
  input: ProductVisibilityInput,
): boolean {
  const rule = input.rules.find((item) => item.productId === input.productId);
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
