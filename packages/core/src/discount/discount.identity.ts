import type {
  DiscountReferenceType,
  DiscountScope,
} from "./discount.rules.ts";

interface DiscountRuleIdentityInput {
  scope: Exclude<DiscountScope, "INPUT">;
  targetId?: string | null;
  code?: string | null;
  segment?: string | null;
  /** MVP_5_2 — loyalty tag making an otherwise-identical rule distinct. */
  requiredCustomerTag?: string | null;
}

interface DiscountReferenceIdentity {
  type: DiscountReferenceType;
  value: string;
}

interface DiscountBlacklistIdentityInput {
  leftType: DiscountReferenceType;
  leftValue: string;
  rightType: DiscountReferenceType;
  rightValue: string;
  segment?: string | null;
}

export interface CanonicalDiscountBlacklistPair {
  leftType: DiscountReferenceType;
  leftValue: string;
  rightType: DiscountReferenceType;
  rightValue: string;
  pairKey: string;
}

function normalizeCouponCode(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeReferenceValue(
  type: DiscountReferenceType,
  value: string | null | undefined,
): string {
  const normalized = String(value ?? "").trim();
  if (type === "COUPON_CODE") {
    return normalizeCouponCode(normalized);
  }
  return normalized;
}

function buildReferenceToken(reference: DiscountReferenceIdentity): string {
  return `${reference.type}:${reference.value}`;
}

function parseReferenceToken(token: string): DiscountReferenceIdentity {
  const separatorIndex = token.indexOf(":");
  return {
    type: token.slice(0, separatorIndex) as DiscountReferenceType,
    value: token.slice(separatorIndex + 1),
  };
}

export function buildDiscountRuleLookupKey(
  input: DiscountRuleIdentityInput,
): string {
  const targetKey = String(input.targetId ?? "").trim();
  const codeKey = normalizeCouponCode(input.code);
  const segmentKey =
    input.segment === "B2B" || input.segment === "B2C" ? input.segment : "ALL";

  let base: string;
  if (input.scope === "COLLECTION") {
    base = `${input.scope}|${segmentKey}|COLLECTION:${targetKey}`;
  } else if (input.scope === "PRODUCT") {
    base = `${input.scope}|${segmentKey}|PRODUCT:${targetKey}`;
  } else if (input.scope === "COUPON") {
    base = `${input.scope}|${segmentKey}|COUPON:${codeKey}`;
  } else {
    base = `${input.scope}|${segmentKey}|GLOBAL`;
  }

  // MVP_5_2 — append the loyalty tag only when present so non-loyalty rules
  // keep an identical (backward-compatible) canonical key.
  const loyaltyTag = String(input.requiredCustomerTag ?? "").trim().toLowerCase();
  return loyaltyTag ? `${base}|TAG:${loyaltyTag}` : base;
}

export function canonicalizeDiscountBlacklistPair(
  input: DiscountBlacklistIdentityInput,
): CanonicalDiscountBlacklistPair {
  const segmentKey =
    input.segment === "B2B" || input.segment === "B2C" ? input.segment : "ALL";
  const references = [
    {
      type: input.leftType,
      value: normalizeReferenceValue(input.leftType, input.leftValue),
    },
    {
      type: input.rightType,
      value: normalizeReferenceValue(input.rightType, input.rightValue),
    },
  ]
    .map((reference) => buildReferenceToken(reference))
    .sort((left, right) => left.localeCompare(right));

  const leftReference = parseReferenceToken(references[0] ?? "COUPON_CODE:");
  const rightReference = parseReferenceToken(references[1] ?? "COUPON_CODE:");

  return {
    leftType: leftReference.type,
    leftValue: leftReference.value,
    rightType: rightReference.type,
    rightValue: rightReference.value,
    pairKey: [segmentKey, references[0], references[1]].join("|"),
  };
}
