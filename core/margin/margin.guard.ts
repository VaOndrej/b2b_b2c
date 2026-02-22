import type { Segment } from "../segment/segment.types";
import type { FloorRuleset } from "./floor.rules";

export interface MarginValidationInput {
  productId: string;
  segment: Segment;
  effectiveBasePrice: number;
  finalPrice: number;
  ruleset: FloorRuleset;
}

export interface MarginValidationResult {
  allowed: boolean;
  floorPrice: number;
  violationAmount: number;
  reason?: "ZERO_FINAL_PRICE_NOT_ALLOWED" | "BELOW_FLOOR";
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveAllowZeroFinalPrice(input: MarginValidationInput): boolean {
  const productRule = input.ruleset.perProduct.find(
    (rule) =>
      rule.productId === input.productId &&
      (rule.segment == null || rule.segment === input.segment),
  );

  if (productRule?.allowZeroFinalPriceOverride != null) {
    return productRule.allowZeroFinalPriceOverride;
  }

  return input.ruleset.global.allowZeroFinalPrice;
}

function resolveFloorPercent(input: MarginValidationInput): number {
  const productRule = input.ruleset.perProduct.find(
    (rule) =>
      rule.productId === input.productId &&
      (rule.segment == null || rule.segment === input.segment),
  );

  return clampPercent(
    productRule?.minPercentOfBasePrice ??
      input.ruleset.global.minPercentOfBasePrice,
  );
}

export function validateMargin(input: MarginValidationInput): MarginValidationResult {
  const floorPercent = resolveFloorPercent(input);
  const floorPrice = roundMoney(input.effectiveBasePrice * (floorPercent / 100));
  const finalPrice = roundMoney(input.finalPrice);
  const allowZeroFinalPrice = resolveAllowZeroFinalPrice(input);
  if (finalPrice <= 0 && !allowZeroFinalPrice) {
    return {
      allowed: false,
      floorPrice,
      violationAmount: roundMoney(Math.max(0, floorPrice - finalPrice)),
      reason: "ZERO_FINAL_PRICE_NOT_ALLOWED",
    };
  }

  const violationAmount = roundMoney(Math.max(0, floorPrice - finalPrice));

  return {
    allowed: violationAmount === 0,
    floorPrice,
    violationAmount,
    reason: violationAmount === 0 ? undefined : "BELOW_FLOOR",
  };
}
