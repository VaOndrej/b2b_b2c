import type { Segment } from "../segment/segment.types";

export interface VisibilityRule {
  productId: string;
  visibleFor: Segment[];
}

export function isProductVisible(
  productId: string,
  segment: Segment,
  rules: VisibilityRule[],
): boolean {
  const rule = rules.find((item) => item.productId === productId);
  if (!rule) {
    return true;
  }

  return rule.visibleFor.includes(segment);
}
