import type { DiscountInput } from "../../core/discount/discount.rules.ts";
import { resolveConfiguredPricing } from "../../core/pricing/pricing.config.ts";
import type { TierPrice } from "../../core/pricing/pricing.types.ts";
import type { PricingPipelineInput } from "../../core/pricing/pricing.pipeline.ts";
import type { Segment } from "../../core/segment/segment.types.ts";
import {
  buildDiscountRuleset,
  buildFloorRuleset,
} from "./margin-guard-config.server.ts";

interface ProductFloorLike {
  productId: string;
  segment: string | null;
  minPercentOfBasePrice: number;
  allowZeroFinalPrice: boolean | null;
  b2bOverridePrice?: number | null;
}

interface ProductTierPriceLike {
  productId: string;
  segment: string | null;
  minQuantity: number;
  unitPrice: number;
}

interface DiscountRuleLike {
  id: string;
  scope: string;
  targetId: string | null;
  code: string | null;
  segment: string | null;
  percentOff: number;
  priority: number;
  stackMode: string;
  minPricePercentOfBasePrice: number | null;
}

interface DiscountBlacklistRuleLike {
  leftType: string;
  leftValue: string;
  rightType: string;
  rightValue: string;
  segment: string | null;
}

interface DiscountSegmentCapLike {
  segment: string;
  maxCombinedPercentOff: number;
}

export interface PricingPreviewConfig {
  allowStacking: boolean;
  maxCombinedPercentOff?: number | null;
  globalMinPricePercent: number;
  b2bGlobalMinPricePercent?: number;
  allowZeroFinalPrice: boolean;
  productFloors: ProductFloorLike[];
  productTierPrices?: ProductTierPriceLike[];
  discountRules?: DiscountRuleLike[];
  discountCombinationBlacklistRules?: DiscountBlacklistRuleLike[];
  discountSegmentCaps?: DiscountSegmentCapLike[];
}

export interface PricingPreviewInput {
  productId: string;
  variantId?: string;
  segment: Segment;
  basePrice: number;
  b2bOverridePrice?: number | null;
  quantity?: number;
  tierPrices?: TierPrice[];
  collectionIds?: string[];
  enteredDiscountCodes?: string[];
  discounts: DiscountInput[];
}

function normalizeQuantity(value: number | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
}

function normalizeStringList(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function normalizeEnteredCodes(values: string[] | undefined): string[] {
  return normalizeStringList(values).map((code) => code.toUpperCase());
}

export function resolvePricingSimulationInput(
  config: PricingPreviewConfig,
  input: PricingPreviewInput,
): PricingPipelineInput {
  const quantity = normalizeQuantity(input.quantity);
  const configuredPricing = resolveConfiguredPricing(config, {
    productId: input.productId,
    segment: input.segment,
  });

  return {
    productId: input.productId,
    variantId: input.variantId,
    segment: input.segment,
    basePrice: input.basePrice,
    b2bOverridePrice:
      input.b2bOverridePrice ?? configuredPricing.b2bOverridePrice ?? undefined,
    quantity,
    tierPrices: input.tierPrices ?? configuredPricing.tierPrices,
    collectionIds: normalizeStringList(input.collectionIds),
    enteredDiscountCodes: normalizeEnteredCodes(input.enteredDiscountCodes),
    discounts: input.discounts,
    discountRules: buildDiscountRuleset(config),
    floorRuleset: buildFloorRuleset(config),
  };
}
