import type { Segment } from "../segment/segment.types.ts";
import type { TierPrice } from "./pricing.types.ts";

interface ProductFloorLike {
  productId: string;
  segment?: string | null;
  b2bOverridePrice?: number | null;
}

interface ProductTierPriceLike {
  productId: string;
  segment?: string | null;
  minQuantity: number;
  unitPrice: number;
}

export interface PricingConfigLookup {
  productFloors?: ProductFloorLike[];
  productTierPrices?: ProductTierPriceLike[];
}

export interface PricingConfigResolutionInput {
  productId: string;
  segment: Segment;
}

export interface PricingConfigResolution {
  b2bOverridePrice?: number;
  tierPrices?: TierPrice[];
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeSegment(segment: string | null | undefined): Segment | undefined {
  if (segment === "B2B" || segment === "B2C") {
    return segment;
  }
  return undefined;
}

function isNonNegativeNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

function resolveB2BOverridePrice(
  config: PricingConfigLookup,
  input: PricingConfigResolutionInput,
): number | undefined {
  if (input.segment !== "B2B") {
    return undefined;
  }

  const exactRule = (config.productFloors ?? []).find(
    (rule) =>
      rule.productId === input.productId &&
      normalizeSegment(rule.segment) === input.segment &&
      isNonNegativeNumber(rule.b2bOverridePrice),
  );
  if (exactRule?.b2bOverridePrice != null) {
    return roundMoney(exactRule.b2bOverridePrice);
  }

  const fallbackRule = (config.productFloors ?? []).find(
    (rule) =>
      rule.productId === input.productId &&
      normalizeSegment(rule.segment) == null &&
      isNonNegativeNumber(rule.b2bOverridePrice),
  );
  return fallbackRule?.b2bOverridePrice != null
    ? roundMoney(fallbackRule.b2bOverridePrice)
    : undefined;
}

export function resolveConfiguredTierPrices(
  config: PricingConfigLookup,
  input: PricingConfigResolutionInput,
): TierPrice[] | undefined {
  const tierMap = new Map<number, number>();

  for (const rule of config.productTierPrices ?? []) {
    if (rule.productId !== input.productId || normalizeSegment(rule.segment) != null) {
      continue;
    }
    if (!isNonNegativeNumber(rule.unitPrice) || !Number.isFinite(rule.minQuantity)) {
      continue;
    }
    const minQuantity = Math.floor(rule.minQuantity);
    if (minQuantity < 1) {
      continue;
    }
    tierMap.set(minQuantity, roundMoney(rule.unitPrice));
  }

  for (const rule of config.productTierPrices ?? []) {
    if (
      rule.productId !== input.productId ||
      normalizeSegment(rule.segment) !== input.segment
    ) {
      continue;
    }
    if (!isNonNegativeNumber(rule.unitPrice) || !Number.isFinite(rule.minQuantity)) {
      continue;
    }
    const minQuantity = Math.floor(rule.minQuantity);
    if (minQuantity < 1) {
      continue;
    }
    tierMap.set(minQuantity, roundMoney(rule.unitPrice));
  }

  const tierPrices = Array.from(tierMap.entries())
    .map(([minQuantity, unitPrice]) => ({ minQuantity, unitPrice }))
    .sort((left, right) => left.minQuantity - right.minQuantity);

  return tierPrices.length > 0 ? tierPrices : undefined;
}

export function resolveConfiguredPricing(
  config: PricingConfigLookup,
  input: PricingConfigResolutionInput,
): PricingConfigResolution {
  return {
    b2bOverridePrice: resolveB2BOverridePrice(config, input),
    tierPrices: resolveConfiguredTierPrices(config, input),
  };
}
