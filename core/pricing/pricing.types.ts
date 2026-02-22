import type { Segment } from "../segment/segment.types";

export interface ProductContext {
  productId: string;
  variantId?: string;
}

export interface PricingInput extends ProductContext {
  segment: Segment;
  basePrice: number;
  b2bOverridePrice?: number;
}

export interface PricingResult extends ProductContext {
  segment: Segment;
  basePrice: number;
  effectiveBasePrice: number;
}
