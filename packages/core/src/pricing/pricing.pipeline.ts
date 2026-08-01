import { resolveDiscounts } from "../discount/discount.orchestrator.ts";
import type {
  DiscountCapAdjustment,
  DiscountDecisionCandidate,
  DiscountDecisionRejection,
  DiscountInput,
  DiscountRules,
} from "../discount/discount.rules.ts";
import { validateMargin } from "../margin/margin.guard.ts";
import type { FloorRuleset } from "../margin/floor.rules.ts";
import { computeEffectiveBasePrice } from "./pricing.engine.ts";
import type { PricingInput } from "./pricing.types.ts";

export interface PricingPipelineInput extends PricingInput {
  discounts: DiscountInput[];
  discountRules: DiscountRules;
  floorRuleset: FloorRuleset;
}

export interface PricingPipelineResult {
  finalPrice: number;
  totalPercentOff: number;
  eligibleDiscounts: DiscountDecisionCandidate[];
  appliedDiscounts: DiscountDecisionCandidate[];
  rejectedDiscounts: DiscountDecisionRejection[];
  capAdjustments: DiscountCapAdjustment[];
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
  const discount = resolveDiscounts(input.discounts, input.discountRules, {
    productId: pricing.productId,
    variantId: pricing.variantId,
    segment: pricing.segment,
    collectionIds: input.collectionIds,
    enteredDiscountCodes: input.enteredDiscountCodes,
  });
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
    eligibleDiscounts: discount.eligibleDiscounts,
    appliedDiscounts: discount.appliedDiscounts,
    rejectedDiscounts: discount.rejectedDiscounts,
    capAdjustments: discount.capAdjustments,
    marginAllowed: margin.allowed,
    floorPrice: margin.floorPrice,
    violationAmount: margin.violationAmount,
    marginReason: margin.reason,
  };
}
