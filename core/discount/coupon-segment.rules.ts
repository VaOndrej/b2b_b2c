import type { Segment } from "../segment/segment.types";

export type CouponAllowedSegment = Segment | "ALL";

export interface CouponSegmentRule {
  code: string;
  allowedSegment: CouponAllowedSegment;
}

export interface EnteredCouponInput {
  code: string;
  rejectable?: boolean;
}

export interface CouponSegmentValidationInput {
  segment: Segment;
  enteredCoupons: EnteredCouponInput[];
  rules: CouponSegmentRule[];
}

export interface CouponSegmentValidationResult {
  acceptedCodes: string[];
  rejectedCodes: string[];
  nonRejectableMismatches: string[];
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function normalizeAllowedSegment(value: string): CouponAllowedSegment {
  if (value === "B2B" || value === "B2C") {
    return value;
  }
  return "ALL";
}

export function normalizeCouponSegmentRule(input: {
  code: string;
  allowedSegment: string;
}): CouponSegmentRule | null {
  const code = normalizeCode(input.code);
  if (!code) {
    return null;
  }

  return {
    code,
    allowedSegment: normalizeAllowedSegment(input.allowedSegment),
  };
}

export function validateCouponsBySegment(
  input: CouponSegmentValidationInput,
): CouponSegmentValidationResult {
  const ruleMap = new Map<string, CouponAllowedSegment>();
  for (const rawRule of input.rules) {
    const normalizedRule = normalizeCouponSegmentRule({
      code: rawRule.code,
      allowedSegment: rawRule.allowedSegment,
    });
    if (!normalizedRule) {
      continue;
    }
    ruleMap.set(normalizedRule.code, normalizedRule.allowedSegment);
  }

  const acceptedCodes: string[] = [];
  const rejectedCodes: string[] = [];
  const nonRejectableMismatches: string[] = [];

  for (const entered of input.enteredCoupons) {
    const normalizedCode = normalizeCode(entered.code);
    if (!normalizedCode) {
      continue;
    }
    const allowedSegment = ruleMap.get(normalizedCode);
    if (
      !allowedSegment ||
      allowedSegment === "ALL" ||
      allowedSegment === input.segment
    ) {
      acceptedCodes.push(normalizedCode);
      continue;
    }

    if (entered.rejectable === false) {
      nonRejectableMismatches.push(normalizedCode);
      continue;
    }

    rejectedCodes.push(normalizedCode);
  }

  return {
    acceptedCodes,
    rejectedCodes,
    nonRejectableMismatches,
  };
}
