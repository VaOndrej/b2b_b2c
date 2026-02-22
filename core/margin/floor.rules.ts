import type { Segment } from "../segment/segment.types";

export interface GlobalFloorRule {
  minPercentOfBasePrice: number;
  allowZeroFinalPrice: boolean;
}

export interface ProductFloorRule {
  productId: string;
  segment?: Segment;
  minPercentOfBasePrice: number;
  allowZeroFinalPriceOverride?: boolean;
}

export interface FloorRuleset {
  global: GlobalFloorRule;
  perProduct: ProductFloorRule[];
}
