import type { QuantityRule } from "./quantity.rules";

export interface QuantityValidationInput {
  quantity: number;
  rules: QuantityRule[];
}

export function validateQuantity(input: QuantityValidationInput): boolean {
  const minRule = input.rules.find((rule) => rule.minimumOrderQuantity != null);
  const stepRule = input.rules.find((rule) => rule.stepQuantity != null);

  if (minRule?.minimumOrderQuantity != null && input.quantity < minRule.minimumOrderQuantity) {
    return false;
  }

  if (stepRule?.stepQuantity != null && input.quantity % stepRule.stepQuantity !== 0) {
    return false;
  }

  return true;
}
