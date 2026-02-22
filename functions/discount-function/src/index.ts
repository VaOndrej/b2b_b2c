import { runPricingPipeline } from "../../../core/pricing/pricing.pipeline.ts";
import type { PricingPipelineInput } from "../../../core/pricing/pricing.pipeline.ts";

export function applyDiscountFunction(input: PricingPipelineInput) {
  const result = runPricingPipeline(input);

  if (!result.marginAllowed) {
    return { action: "reject_discount", reason: "PRICE_BELOW_FLOOR", result };
  }

  return { action: "apply_discount", result };
}
