import type { Segment } from "../segment/segment.types.ts";
import type { FloorRuleset } from "../margin/floor.rules.ts";
import { validateMargin } from "../margin/margin.guard.ts";
import { resolveDiscounts } from "./discount.orchestrator.ts";
import type { DiscountInput, DiscountRules } from "./discount.rules.ts";

/**
 * MVP_5_0_3 — discount/floor conflict detection.
 *
 * Detects products where an automatic Shopify discount (one we do not control
 * via our discount function) combined with the configured margin-guard discount
 * rules would push the final price below the margin floor. At checkout the cart
 * validation function would block such a line, so we surface the conflict in the
 * admin proactively and mirror it in the cart.
 *
 * This is intentionally a thin composition of the existing discount orchestrator
 * and margin guard so the warning reflects exactly what enforcement will do.
 */

export interface AutomaticDiscount {
  id: string;
  title?: string;
  percentOff: number;
  scope: "GLOBAL" | "COLLECTION" | "PRODUCT";
  /** Product or collection gid for PRODUCT/COLLECTION scope. */
  targetId?: string;
  /** When set, the discount only applies to this customer segment. */
  segment?: Segment;
}

export interface ConflictDetectionProduct {
  productId: string;
  title?: string;
  handle?: string;
  effectiveBasePrice: number;
  collectionIds?: string[];
}

export interface DiscountFloorConflict {
  productId: string;
  title?: string;
  handle?: string;
  segment: Segment;
  effectiveBasePrice: number;
  floorPrice: number;
  projectedFinalPrice: number;
  totalPercentOff: number;
  violationAmount: number;
  reason: "BELOW_FLOOR" | "ZERO_FINAL_PRICE_NOT_ALLOWED";
  offendingDiscount: {
    id: string;
    title?: string;
    percentOff: number;
  };
}

const DEFAULT_SEGMENTS: Segment[] = ["B2B", "B2C"];

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function isAutomaticDiscountApplicable(
  discount: AutomaticDiscount,
  product: ConflictDetectionProduct,
  segment: Segment,
): boolean {
  if (discount.percentOff <= 0) {
    return false;
  }
  if (discount.segment && discount.segment !== segment) {
    return false;
  }
  switch (discount.scope) {
    case "GLOBAL":
      return true;
    case "PRODUCT":
      return Boolean(discount.targetId && discount.targetId === product.productId);
    case "COLLECTION":
      return Boolean(
        discount.targetId &&
          (product.collectionIds ?? []).some((id) => id === discount.targetId),
      );
    default:
      return false;
  }
}

/**
 * For each (product × segment), evaluate every applicable automatic discount
 * together with the configured margin-guard discount rules. Each automatic
 * discount is evaluated independently (Shopify automatic discounts are exclusive
 * by default), so the report names the specific discount that breaks the floor.
 */
export function detectDiscountFloorConflicts(input: {
  products: ConflictDetectionProduct[];
  automaticDiscounts: AutomaticDiscount[];
  configuredDiscountRules: DiscountRules;
  floorRuleset: FloorRuleset;
  segments?: Segment[];
}): DiscountFloorConflict[] {
  const segments = input.segments ?? DEFAULT_SEGMENTS;
  const conflicts: DiscountFloorConflict[] = [];

  for (const product of input.products) {
    if (!(product.effectiveBasePrice > 0)) {
      continue;
    }
    for (const segment of segments) {
      const applicable = input.automaticDiscounts.filter((discount) =>
        isAutomaticDiscountApplicable(discount, product, segment),
      );
      if (applicable.length === 0) {
        continue;
      }

      for (const discount of applicable) {
        const discountInput: DiscountInput = {
          sourceId: discount.id,
          percentOff: discount.percentOff,
          // Automatic Shopify discounts win priority at checkout; mark high so the
          // orchestrator keeps them when stacked with configured rules.
          priority: 1000,
        };

        const resolution = resolveDiscounts(
          [discountInput],
          input.configuredDiscountRules,
          {
            productId: product.productId,
            segment,
            collectionIds: product.collectionIds,
          },
        );

        const projectedFinalPrice = roundMoney(
          product.effectiveBasePrice * (1 - resolution.totalPercentOff / 100),
        );
        const margin = validateMargin({
          productId: product.productId,
          segment,
          effectiveBasePrice: product.effectiveBasePrice,
          finalPrice: projectedFinalPrice,
          ruleset: input.floorRuleset,
        });

        if (margin.allowed || !margin.reason) {
          continue;
        }

        conflicts.push({
          productId: product.productId,
          title: product.title,
          handle: product.handle,
          segment,
          effectiveBasePrice: roundMoney(product.effectiveBasePrice),
          floorPrice: margin.floorPrice,
          projectedFinalPrice,
          totalPercentOff: resolution.totalPercentOff,
          violationAmount: margin.violationAmount,
          reason: margin.reason,
          offendingDiscount: {
            id: discount.id,
            title: discount.title,
            percentOff: discount.percentOff,
          },
        });
      }
    }
  }

  return conflicts;
}
