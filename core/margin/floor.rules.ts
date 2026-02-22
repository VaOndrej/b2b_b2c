import type { Segment } from "../segment/segment.types";

export interface GlobalFloorRule {
  minPercentOfBasePrice: number;
}

export interface ProductFloorRule {
  productId: string;
  segment?: Segment;
  minPercentOfBasePrice: number;
}

export interface FloorRuleset {
  global: GlobalFloorRule;
  perProduct: ProductFloorRule[];
}
