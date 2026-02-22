import { runPricingPipeline } from "../../core/pricing/pricing.pipeline";
import { resolveSegment } from "../../core/segment/segment.engine";
import type { DiscountInput, DiscountRules } from "../../core/discount/discount.rules";
import type { FloorRuleset } from "../../core/margin/floor.rules";

export interface MarginGuardEvaluationInput {
  customerTags?: string[];
  b2bTag?: string;
  productId: string;
  basePrice: number;
  b2bOverridePrice?: number;
  discounts: DiscountInput[];
  discountRules: DiscountRules;
  floorRuleset: FloorRuleset;
}

export function evaluateMarginGuard(input: MarginGuardEvaluationInput) {
  const segment = resolveSegment({
    customerTags: input.customerTags,
    b2bTag: input.b2bTag,
  });

  const pricing = runPricingPipeline({
    productId: input.productId,
    segment: segment.segment,
    basePrice: input.basePrice,
    b2bOverridePrice: input.b2bOverridePrice,
    discounts: input.discounts,
    discountRules: input.discountRules,
    floorRuleset: input.floorRuleset,
  });

  return {
    segment: segment.segment,
    segmentSource: segment.source,
    ...pricing,
  };
}
