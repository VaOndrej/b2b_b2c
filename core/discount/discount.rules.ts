import type { Segment } from "../segment/segment.types.ts";

export type DiscountScope =
  | "GLOBAL"
  | "COLLECTION"
  | "PRODUCT"
  | "COUPON"
  | "INPUT";

export type DiscountStackMode =
  | "STACKABLE"
  | "EXCLUSIVE"
  | "NEVER_WITH_COUPONS";

export type DiscountReferenceType = "RULE_ID" | "COUPON_CODE" | "SCOPE";

export interface DiscountInput {
  code?: string;
  percentOff?: number;
  priority?: number;
  sourceId?: string;
  stackMode?: DiscountStackMode;
}

export interface ConfiguredDiscountRule {
  id: string;
  scope: Exclude<DiscountScope, "INPUT">;
  targetId?: string;
  code?: string;
  segment?: Segment;
  percentOff: number;
  priority?: number;
  stackMode?: DiscountStackMode;
  minPricePercentOfBasePrice?: number;
  /**
   * MVP_5_2 — loyalty eligibility. When set, the rule only matches when the
   * customer carries this tag (case-insensitive). Loyalty is an independent
   * eligibility layer on top of the binary B2B/B2C segment; it is NOT a segment.
   */
  requiredCustomerTag?: string;
}

export interface DiscountBlacklistRule {
  leftType: DiscountReferenceType;
  leftValue: string;
  rightType: DiscountReferenceType;
  rightValue: string;
  segment?: Segment | "ALL";
}

export interface DiscountSegmentCap {
  segment: Segment | "ALL";
  maxCombinedPercentOff: number;
}

export interface DiscountResolutionContext {
  productId?: string;
  variantId?: string;
  segment?: Segment;
  collectionIds?: string[];
  enteredDiscountCodes?: string[];
  /** MVP_5_2 — customer loyalty tags used to gate loyalty discount rules. */
  customerTags?: string[];
}

export interface DiscountRules {
  allowStacking: boolean;
  maxCombinedPercentOff?: number;
  rules?: ConfiguredDiscountRule[];
  blacklists?: DiscountBlacklistRule[];
  segmentCaps?: DiscountSegmentCap[];
}

export interface DiscountDecisionCandidate {
  id: string;
  code?: string;
  scope: DiscountScope;
  requestedPercentOff: number;
  appliedPercentOff: number;
  priority: number;
  stackMode: DiscountStackMode;
  origin: "RULE" | "INPUT";
  targetId?: string;
  sequence?: number;
}

export interface DiscountDecisionRejection {
  id: string;
  code?: string;
  scope: DiscountScope;
  requestedPercentOff: number;
  priority: number;
  reason:
    | "NOT_ELIGIBLE"
    | "BLACKLISTED"
    | "STACKING_CONFLICT"
    | "CAP_REDUCED_TO_ZERO";
  blockedById?: string;
  blockedByCode?: string;
}

export interface DiscountCapAdjustment {
  id: string;
  code?: string;
  scope: DiscountScope;
  fromPercentOff: number;
  toPercentOff: number;
  reason: "GLOBAL_CAP" | "SEGMENT_CAP" | "GLOBAL_AND_SEGMENT_CAP";
}

export interface DiscountResult {
  totalPercentOff: number;
  appliedCodes: string[];
  eligibleDiscounts: DiscountDecisionCandidate[];
  appliedDiscounts: DiscountDecisionCandidate[];
  rejectedDiscounts: DiscountDecisionRejection[];
  capAdjustments: DiscountCapAdjustment[];
}
