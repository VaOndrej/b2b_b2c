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
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
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
  const floorPrice = input.effectiveBasePrice * (floorPercent / 100);
  const violationAmount = Math.max(0, floorPrice - input.finalPrice);

  return {
    allowed: violationAmount === 0,
    floorPrice,
    violationAmount,
  };
}
