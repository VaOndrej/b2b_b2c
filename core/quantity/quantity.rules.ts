export interface QuantityRule {
  productId?: string;
  collectionId?: string;
  segment?: "B2B" | "B2C";
  minimumOrderQuantity?: number;
  stepQuantity?: number;
  maxOrderQuantity?: number;
}
