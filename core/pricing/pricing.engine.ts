import type { PricingInput, PricingResult } from "./pricing.types";

export function computeEffectiveBasePrice(input: PricingInput): PricingResult {
  const effectiveBasePrice =
    input.segment === "B2B" && input.b2bOverridePrice != null
      ? input.b2bOverridePrice
      : input.basePrice;

  return {
    productId: input.productId,
    variantId: input.variantId,
    segment: input.segment,
    basePrice: input.basePrice,
    effectiveBasePrice,
  };
}
