import type { DiscountInput } from "#core/discount/discount.rules";
import { resolveConfiguredPricing } from "#core/pricing/pricing.config";
import type { TierPrice } from "#core/pricing/pricing.types";
import type { PricingPipelineInput } from "#core/pricing/pricing.pipeline";
import type { Segment } from "#core/segment/segment.types";
import type { CatalogRuleset } from "#core/catalog/catalog.ruleset";

// MVP_5_3 #2.3c — the admin pricing preview simulates against the customer's
// resolved price catalog (the same per-catalog ruleset the cart validation /
// discount functions enforce), not the legacy MarginGuardConfig children.

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
  ruleset: CatalogRuleset,
  input: PricingPreviewInput,
): PricingPipelineInput {
  const quantity = normalizeQuantity(input.quantity);
  const configuredPricing = resolveConfiguredPricing(
    {
      productFloors: ruleset.productFloors,
      productTierPrices: ruleset.productTierPrices,
    },
    {
      productId: input.productId,
      segment: input.segment,
    },
  );

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
    discountRules: ruleset.discountRuleset,
    floorRuleset: ruleset.floorRuleset,
  };
}
