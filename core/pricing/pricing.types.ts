import type { Segment } from "../segment/segment.types";

export interface ProductContext {
  productId: string;
  variantId?: string;
}

export interface PricingInput extends ProductContext {
  segment: Segment;
  basePrice: number;
  b2bOverridePrice?: number;
  quantity?: number;
  tierPrices?: TierPrice[];
}

export interface PricingResult extends ProductContext {
  segment: Segment;
  basePrice: number;
  quantity: number;
  effectiveBasePrice: number;
  appliedTierPrice?: TierPrice;
}

export interface TierPrice {
  minQuantity: number;
  unitPrice: number;
}
