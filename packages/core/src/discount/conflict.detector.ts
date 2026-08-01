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

/**
 * MVP_5_2 — the conflict detector is value-aware. Native Shopify discounts come
 * in several value shapes; we convert what we can to an effective price and
 * compare against the floor, and explicitly flag what we cannot verify so the
 * merchant is warned in the admin instead of silently ignored.
 */
export type AutomaticDiscountValueType =
  | "PERCENTAGE"
  | "FIXED_AMOUNT"
  | "UNSUPPORTED";

export interface AutomaticDiscount {
  id: string;
  title?: string;
  /** Defaults to PERCENTAGE when omitted (backward compatible). */
  valueType?: AutomaticDiscountValueType;
  /** For PERCENTAGE — percent off (0..100). */
  percentOff?: number;
  /** For FIXED_AMOUNT — money amount off. */
  amount?: number;
  /** For FIXED_AMOUNT — whether the amount applies per unit or once per order. */
  amountScope?: "PER_UNIT" | "PER_ORDER";
  /** For UNSUPPORTED — human label of the native kind (e.g. "Buy X get Y"). */
  unsupportedKind?: string;
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
  reason:
    | "BELOW_FLOOR"
    | "ZERO_FINAL_PRICE_NOT_ALLOWED"
    /** MVP_5_2 — native discount we cannot convert to an effective price. */
    | "UNVERIFIABLE_AGAINST_FLOOR";
  offendingDiscount: {
    id: string;
    title?: string;
    valueType: AutomaticDiscountValueType;
    /** Derived/equivalent percent off; 0 for unverifiable discounts. */
    percentOff: number;
    /** Present for FIXED_AMOUNT discounts. */
    amount?: number;
    /** Present for UNSUPPORTED discounts. */
    unsupportedKind?: string;
  };
}

const DEFAULT_SEGMENTS: Segment[] = ["B2B", "B2C"];

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * Convert a native automatic discount into the percent-off the orchestrator
 * understands, given a product's effective base price. Returns null when the
 * discount has no effect (skip), or `{ unverifiable: true }` when the discount
 * cannot be reliably converted to an effective price (flag for manual review).
 */
function resolveDiscountEffect(
  discount: AutomaticDiscount,
  effectiveBasePrice: number,
): { percentOff: number } | { unverifiable: true } | null {
  const valueType = discount.valueType ?? "PERCENTAGE";

  if (valueType === "PERCENTAGE") {
    const percentOff = Number(discount.percentOff ?? 0);
    return percentOff > 0 ? { percentOff: clampPercent(percentOff) } : null;
  }

  if (valueType === "FIXED_AMOUNT") {
    const amount = Number(discount.amount ?? 0);
    if (!(amount > 0)) {
      return null;
    }
    // A per-order fixed amount is spread across the whole cart at checkout; we
    // cannot attribute it to a single line's floor reliably → flag it.
    if (discount.amountScope === "PER_ORDER") {
      return { unverifiable: true };
    }
    // Per-unit fixed amount → exact percent equivalent against the base price.
    return { percentOff: clampPercent((amount / effectiveBasePrice) * 100) };
  }

  // UNSUPPORTED (BXGY, bundle, etc.) — cannot be converted to an effective price.
  return { unverifiable: true };
}

function isAutomaticDiscountApplicable(
  discount: AutomaticDiscount,
  product: ConflictDetectionProduct,
  segment: Segment,
): boolean {
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
        const valueType = discount.valueType ?? "PERCENTAGE";
        const effect = resolveDiscountEffect(discount, product.effectiveBasePrice);
        if (effect == null) {
          continue;
        }

        const offendingDiscount = {
          id: discount.id,
          title: discount.title,
          valueType,
          percentOff: "percentOff" in effect ? roundMoney(effect.percentOff) : 0,
          ...(discount.amount != null ? { amount: roundMoney(discount.amount) } : {}),
          ...(discount.unsupportedKind != null
            ? { unsupportedKind: discount.unsupportedKind }
            : {}),
        };

        // Discounts we cannot convert to an effective price: surface them so the
        // merchant can check them manually rather than ignoring them silently.
        if ("unverifiable" in effect) {
          const margin = validateMargin({
            productId: product.productId,
            segment,
            effectiveBasePrice: product.effectiveBasePrice,
            finalPrice: product.effectiveBasePrice,
            ruleset: input.floorRuleset,
          });
          conflicts.push({
            productId: product.productId,
            title: product.title,
            handle: product.handle,
            segment,
            effectiveBasePrice: roundMoney(product.effectiveBasePrice),
            floorPrice: margin.floorPrice,
            projectedFinalPrice: roundMoney(product.effectiveBasePrice),
            totalPercentOff: 0,
            violationAmount: 0,
            reason: "UNVERIFIABLE_AGAINST_FLOOR",
            offendingDiscount,
          });
          continue;
        }

        const discountInput: DiscountInput = {
          sourceId: discount.id,
          percentOff: effect.percentOff,
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
          offendingDiscount,
        });
      }
    }
  }

  return conflicts;
}
