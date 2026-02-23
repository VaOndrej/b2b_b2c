import type { PricingInput, PricingResult, TierPrice } from "./pricing.types";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeQuantity(quantity: number | undefined): number {
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(1, Math.floor(parsed));
}

function resolveTierPrice(
  tierPrices: TierPrice[] | undefined,
  quantity: number,
): TierPrice | undefined {
  if (!Array.isArray(tierPrices) || tierPrices.length === 0) {
    return undefined;
  }

  let selected: TierPrice | undefined;
  for (const tier of tierPrices) {
    if (
      !tier ||
      !Number.isFinite(tier.minQuantity) ||
      !Number.isFinite(tier.unitPrice)
    ) {
      continue;
    }
    if (tier.minQuantity < 1 || tier.unitPrice < 0) {
      continue;
    }
    if (quantity < tier.minQuantity) {
      continue;
    }
    if (!selected || tier.minQuantity > selected.minQuantity) {
      selected = {
        minQuantity: Math.floor(tier.minQuantity),
        unitPrice: roundMoney(tier.unitPrice),
      };
    }
  }

  return selected;
}

export function computeEffectiveBasePrice(input: PricingInput): PricingResult {
  const quantity = normalizeQuantity(input.quantity);
  const appliedTierPrice = resolveTierPrice(input.tierPrices, quantity);
  const b2bOverridePrice =
    input.segment === "B2B" &&
    input.b2bOverridePrice != null &&
    Number.isFinite(input.b2bOverridePrice) &&
    input.b2bOverridePrice >= 0
      ? roundMoney(input.b2bOverridePrice)
      : undefined;
  const effectiveBasePrice =
    appliedTierPrice?.unitPrice ??
    b2bOverridePrice ??
    roundMoney(input.basePrice);

  return {
    productId: input.productId,
    variantId: input.variantId,
    segment: input.segment,
    basePrice: roundMoney(input.basePrice),
    quantity,
    effectiveBasePrice,
    appliedTierPrice,
  };
}
