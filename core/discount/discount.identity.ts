import type {
  DiscountReferenceType,
  DiscountScope,
} from "./discount.rules.ts";

interface DiscountRuleIdentityInput {
  scope: Exclude<DiscountScope, "INPUT">;
  targetId?: string | null;
  code?: string | null;
  segment?: string | null;
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

  if (input.scope === "COLLECTION") {
    return `${input.scope}|${segmentKey}|COLLECTION:${targetKey}`;
  }
  if (input.scope === "PRODUCT") {
    return `${input.scope}|${segmentKey}|PRODUCT:${targetKey}`;
  }
  if (input.scope === "COUPON") {
    return `${input.scope}|${segmentKey}|COUPON:${codeKey}`;
  }
  return `${input.scope}|${segmentKey}|GLOBAL`;
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
