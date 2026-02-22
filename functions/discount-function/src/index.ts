import { runPricingPipeline } from "../../../core/pricing/pricing.pipeline";
import type { PricingPipelineInput } from "../../../core/pricing/pricing.pipeline";

export function applyDiscountFunction(input: PricingPipelineInput) {
  const result = runPricingPipeline(input);

  if (!result.marginAllowed) {
    return { action: "reject_discount", reason: "PRICE_BELOW_FLOOR", result };
  }

  return { action: "apply_discount", result };
}
