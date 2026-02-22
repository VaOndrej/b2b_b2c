import { resolveDiscounts } from "../discount/discount.orchestrator";
import type { DiscountInput, DiscountRules } from "../discount/discount.rules";
import { validateMargin } from "../margin/margin.guard";
import type { FloorRuleset } from "../margin/floor.rules";
import { computeEffectiveBasePrice } from "./pricing.engine";
import type { PricingInput } from "./pricing.types";

export interface PricingPipelineInput extends PricingInput {
  discounts: DiscountInput[];
  discountRules: DiscountRules;
  floorRuleset: FloorRuleset;
}

export interface PricingPipelineResult {
  finalPrice: number;
  totalPercentOff: number;
  marginAllowed: boolean;
  floorPrice: number;
  violationAmount: number;
  marginReason?: "ZERO_FINAL_PRICE_NOT_ALLOWED" | "BELOW_FLOOR";
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function runPricingPipeline(
  input: PricingPipelineInput,
): PricingPipelineResult {
  const pricing = computeEffectiveBasePrice(input);
  const discount = resolveDiscounts(input.discounts, input.discountRules);
  const finalPrice = roundMoney(
    pricing.effectiveBasePrice * (1 - discount.totalPercentOff / 100),
  );
  const margin = validateMargin({
    productId: pricing.productId,
    segment: pricing.segment,
    effectiveBasePrice: pricing.effectiveBasePrice,
    finalPrice,
    ruleset: input.floorRuleset,
  });

  return {
    finalPrice,
    totalPercentOff: discount.totalPercentOff,
    marginAllowed: margin.allowed,
    floorPrice: margin.floorPrice,
    violationAmount: margin.violationAmount,
    marginReason: margin.reason,
  };
}
