import { runPricingPipeline } from "../../../core/pricing/pricing.pipeline";
import type { PricingPipelineInput } from "../../../core/pricing/pricing.pipeline";

export function validateCartLine(input: PricingPipelineInput) {
  const result = runPricingPipeline(input);

  return {
    valid: result.marginAllowed,
    errors: result.marginAllowed
      ? []
      : [
          {
            code: "PRICE_BELOW_FLOOR",
            message: "Discounted line price is below minimum allowed margin floor.",
          },
        ],
    result,
  };
}
