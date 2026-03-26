import type {
  ConfiguredDiscountRule,
  DiscountBlacklistRule,
  DiscountCapAdjustment,
  DiscountDecisionCandidate,
  DiscountDecisionRejection,
  DiscountInput,
  DiscountResolutionContext,
  DiscountResult,
  DiscountRules,
  DiscountScope,
  DiscountStackMode,
} from "./discount.rules.ts";

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function roundPercent(value: number): number {
  return Math.round(clampPercent(value) * 100) / 100;
}

function normalizeCode(code: string | undefined): string | undefined {
  const normalized = String(code ?? "").trim().toUpperCase();
  return normalized || undefined;
}

function normalizeStackMode(
  value: DiscountStackMode | undefined,
  allowStacking: boolean,
): DiscountStackMode {
  if (
    value === "STACKABLE" ||
    value === "EXCLUSIVE" ||
    value === "NEVER_WITH_COUPONS"
  ) {
    return value;
  }
  return allowStacking ? "STACKABLE" : "EXCLUSIVE";
}

function resolveScopeWeight(scope: DiscountScope): number {
  switch (scope) {
    case "INPUT":
      return 500;
    case "PRODUCT":
      return 400;
    case "COUPON":
      return 300;
    case "COLLECTION":
      return 200;
    case "GLOBAL":
    default:
      return 100;
  }
}

function compareCandidates(
  left: DiscountDecisionCandidate,
  right: DiscountDecisionCandidate,
): number {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  const scopeDiff = resolveScopeWeight(right.scope) - resolveScopeWeight(left.scope);
  if (scopeDiff !== 0) {
    return scopeDiff;
  }
  if (left.appliedPercentOff !== right.appliedPercentOff) {
    return right.appliedPercentOff - left.appliedPercentOff;
  }
  if (left.sequence != null && right.sequence != null && left.sequence !== right.sequence) {
    return left.sequence - right.sequence;
  }
  return left.id.localeCompare(right.id);
}

function isCouponCandidate(candidate: DiscountDecisionCandidate): boolean {
  return candidate.scope === "COUPON" || candidate.code != null;
}

function buildCandidateKeys(candidate: DiscountDecisionCandidate): string[] {
  const keys = [`RULE_ID:${candidate.id}`, `SCOPE:${candidate.scope}`];
  const normalizedCode = normalizeCode(candidate.code);
  if (normalizedCode) {
    keys.push(`COUPON_CODE:${normalizedCode}`);
  }
  return keys;
}

function matchesBlacklistRule(
  left: DiscountDecisionCandidate,
  right: DiscountDecisionCandidate,
  rule: DiscountBlacklistRule,
): boolean {
  const leftKeys = buildCandidateKeys(left);
  const rightKeys = buildCandidateKeys(right);
  const directLeft = `${rule.leftType}:${rule.leftValue}`;
  const directRight = `${rule.rightType}:${rule.rightValue}`;
  const reverseLeft = `${rule.rightType}:${rule.rightValue}`;
  const reverseRight = `${rule.leftType}:${rule.leftValue}`;

  return (
    (leftKeys.includes(directLeft) && rightKeys.includes(directRight)) ||
    (leftKeys.includes(reverseLeft) && rightKeys.includes(reverseRight))
  );
}

function findBlacklistConflict(
  candidate: DiscountDecisionCandidate,
  selected: DiscountDecisionCandidate[],
  rules: DiscountBlacklistRule[],
  segment: DiscountResolutionContext["segment"],
): DiscountDecisionCandidate | null {
  for (const selectedCandidate of selected) {
    for (const rule of rules) {
      if (rule.segment && rule.segment !== "ALL" && rule.segment !== segment) {
        continue;
      }
      if (matchesBlacklistRule(candidate, selectedCandidate, rule)) {
        return selectedCandidate;
      }
    }
  }
  return null;
}

function hasCouponStackingConflict(
  candidate: DiscountDecisionCandidate,
  selected: DiscountDecisionCandidate[],
): DiscountDecisionCandidate | null {
  if (!isCouponCandidate(candidate) && candidate.stackMode !== "NEVER_WITH_COUPONS") {
    return null;
  }

  for (const selectedCandidate of selected) {
    const selectedIsCoupon = isCouponCandidate(selectedCandidate);
    if (!selectedIsCoupon && selectedCandidate.stackMode !== "NEVER_WITH_COUPONS") {
      continue;
    }
    if (isCouponCandidate(candidate) && selectedCandidate.stackMode === "NEVER_WITH_COUPONS") {
      return selectedCandidate;
    }
    if (candidate.stackMode === "NEVER_WITH_COUPONS" && selectedIsCoupon) {
      return selectedCandidate;
    }
  }

  return null;
}

function buildInputCandidate(
  discount: DiscountInput,
  index: number,
  allowStacking: boolean,
): DiscountDecisionCandidate | null {
  const requestedPercentOff = roundPercent(Number(discount.percentOff ?? 0));
  if (requestedPercentOff <= 0) {
    return null;
  }

  return {
    id: discount.sourceId?.trim() || `input-${index + 1}`,
    code: normalizeCode(discount.code),
    scope: "INPUT",
    requestedPercentOff,
    appliedPercentOff: requestedPercentOff,
    priority:
      Number.isFinite(discount.priority) && discount.priority != null
        ? Math.floor(discount.priority)
        : 1_000,
    stackMode: normalizeStackMode(discount.stackMode, allowStacking),
    origin: "INPUT",
    sequence: index,
  };
}

function matchesRule(
  rule: ConfiguredDiscountRule,
  context: DiscountResolutionContext,
  enteredCodes: Set<string>,
): boolean {
  if (rule.segment && rule.segment !== context.segment) {
    return false;
  }

  switch (rule.scope) {
    case "GLOBAL":
      return true;
    case "PRODUCT":
      return Boolean(context.productId && rule.targetId === context.productId);
    case "COLLECTION":
      return Boolean(
        rule.targetId &&
          (context.collectionIds ?? []).some((collectionId) => collectionId === rule.targetId),
      );
    case "COUPON": {
      const normalizedCode = normalizeCode(rule.code ?? rule.targetId);
      return normalizedCode != null && enteredCodes.has(normalizedCode);
    }
    default:
      return false;
  }
}

function buildRuleCandidate(
  rule: ConfiguredDiscountRule,
  sequence: number,
  allowStacking: boolean,
): DiscountDecisionCandidate | null {
  const requestedPercentOff = roundPercent(rule.percentOff);
  if (requestedPercentOff <= 0) {
    return null;
  }

  const minPricePercent = rule.minPricePercentOfBasePrice;
  const capByLocalMinPrice =
    minPricePercent != null ? clampPercent(100 - minPricePercent) : 100;
  const appliedPercentOff = roundPercent(
    Math.min(requestedPercentOff, capByLocalMinPrice),
  );
  if (appliedPercentOff <= 0) {
    return null;
  }

  return {
    id: rule.id,
    code: normalizeCode(rule.code),
    scope: rule.scope,
    requestedPercentOff,
    appliedPercentOff,
    priority:
      Number.isFinite(rule.priority) && rule.priority != null
        ? Math.floor(rule.priority)
        : 100,
    stackMode: normalizeStackMode(rule.stackMode, allowStacking),
    origin: "RULE",
    targetId: rule.targetId,
    sequence,
  };
}

function collectEligibleDiscounts(
  discounts: DiscountInput[],
  rules: DiscountRules,
  context: DiscountResolutionContext,
): DiscountDecisionCandidate[] {
  const enteredCodes = new Set(
    (context.enteredDiscountCodes ?? [])
      .map((code) => normalizeCode(code))
      .filter((code): code is string => Boolean(code)),
  );

  const eligible: DiscountDecisionCandidate[] = [];
  for (const [index, discount] of discounts.entries()) {
    const candidate = buildInputCandidate(discount, index, rules.allowStacking);
    if (candidate) {
      eligible.push(candidate);
    }
  }

  for (const [index, rule] of (rules.rules ?? []).entries()) {
    if (!matchesRule(rule, context, enteredCodes)) {
      continue;
    }
    const candidate = buildRuleCandidate(rule, index, rules.allowStacking);
    if (candidate) {
      eligible.push(candidate);
    }
  }

  return eligible.sort(compareCandidates);
}

function resolveConfiguredCap(
  rules: DiscountRules,
  context: DiscountResolutionContext,
): { cap: number | null; reason: DiscountCapAdjustment["reason"] | null } {
  const globalCap =
    rules.maxCombinedPercentOff != null
      ? roundPercent(rules.maxCombinedPercentOff)
      : null;
  const segmentCapRule =
    (rules.segmentCaps ?? []).find((cap) => cap.segment === context.segment) ??
    (rules.segmentCaps ?? []).find((cap) => cap.segment === "ALL");
  const segmentCap =
    segmentCapRule != null ? roundPercent(segmentCapRule.maxCombinedPercentOff) : null;

  if (globalCap == null && segmentCap == null) {
    return { cap: null, reason: null };
  }
  if (globalCap != null && segmentCap != null) {
    return {
      cap: Math.min(globalCap, segmentCap),
      reason: "GLOBAL_AND_SEGMENT_CAP",
    };
  }
  if (segmentCap != null) {
    return { cap: segmentCap, reason: "SEGMENT_CAP" };
  }
  return { cap: globalCap, reason: "GLOBAL_CAP" };
}

export function resolveDiscounts(
  discounts: DiscountInput[],
  rules: DiscountRules,
  context: DiscountResolutionContext = {},
): DiscountResult {
  const eligibleDiscounts = collectEligibleDiscounts(discounts, rules, context);
  if (eligibleDiscounts.length === 0) {
    return {
      totalPercentOff: 0,
      appliedCodes: [],
      eligibleDiscounts: [],
      appliedDiscounts: [],
      rejectedDiscounts: [],
      capAdjustments: [],
    };
  }

  const rejectedDiscounts: DiscountDecisionRejection[] = [];
  const selected: DiscountDecisionCandidate[] = [];
  const blacklistRules = rules.blacklists ?? [];

  for (const candidate of eligibleDiscounts) {
    const blacklistConflict = findBlacklistConflict(
      candidate,
      selected,
      blacklistRules,
      context.segment,
    );
    if (blacklistConflict) {
      rejectedDiscounts.push({
        id: candidate.id,
        code: candidate.code,
        scope: candidate.scope,
        requestedPercentOff: candidate.requestedPercentOff,
        priority: candidate.priority,
        reason: "BLACKLISTED",
        blockedById: blacklistConflict.id,
        blockedByCode: blacklistConflict.code,
      });
      continue;
    }

    if (!rules.allowStacking && selected.length > 0) {
      rejectedDiscounts.push({
        id: candidate.id,
        code: candidate.code,
        scope: candidate.scope,
        requestedPercentOff: candidate.requestedPercentOff,
        priority: candidate.priority,
        reason: "STACKING_CONFLICT",
        blockedById: selected[0]?.id,
        blockedByCode: selected[0]?.code,
      });
      continue;
    }

    const exclusiveConflict = selected.find(
      (selectedCandidate) =>
        selectedCandidate.stackMode === "EXCLUSIVE" ||
        candidate.stackMode === "EXCLUSIVE",
    );
    if (exclusiveConflict) {
      rejectedDiscounts.push({
        id: candidate.id,
        code: candidate.code,
        scope: candidate.scope,
        requestedPercentOff: candidate.requestedPercentOff,
        priority: candidate.priority,
        reason: "STACKING_CONFLICT",
        blockedById: exclusiveConflict.id,
        blockedByCode: exclusiveConflict.code,
      });
      continue;
    }

    const couponConflict = hasCouponStackingConflict(candidate, selected);
    if (couponConflict) {
      rejectedDiscounts.push({
        id: candidate.id,
        code: candidate.code,
        scope: candidate.scope,
        requestedPercentOff: candidate.requestedPercentOff,
        priority: candidate.priority,
        reason: "STACKING_CONFLICT",
        blockedById: couponConflict.id,
        blockedByCode: couponConflict.code,
      });
      continue;
    }

    selected.push({ ...candidate });
  }

  const capAdjustments: DiscountCapAdjustment[] = [];
  const configuredCap = resolveConfiguredCap(rules, context);
  if (configuredCap.cap != null) {
      const runningTotal = roundPercent(
        selected.reduce((sum, item) => sum + item.appliedPercentOff, 0),
      );

    if (runningTotal > configuredCap.cap) {
      const selectedByLowestPriority = [...selected].sort(compareCandidates).reverse();
      let remainingExcess = roundPercent(runningTotal - configuredCap.cap);

      for (const candidate of selectedByLowestPriority) {
        if (remainingExcess <= 0) {
          break;
        }

        const original = candidate.appliedPercentOff;
        const reduced = roundPercent(Math.max(0, original - remainingExcess));
        remainingExcess = roundPercent(Math.max(0, remainingExcess - original));
        candidate.appliedPercentOff = reduced;
        capAdjustments.push({
          id: candidate.id,
          code: candidate.code,
          scope: candidate.scope,
          fromPercentOff: original,
          toPercentOff: reduced,
          reason: configuredCap.reason ?? "GLOBAL_CAP",
        });
      }

      for (const candidate of selected.filter((item) => item.appliedPercentOff <= 0)) {
        rejectedDiscounts.push({
          id: candidate.id,
          code: candidate.code,
          scope: candidate.scope,
          requestedPercentOff: candidate.requestedPercentOff,
          priority: candidate.priority,
          reason: "CAP_REDUCED_TO_ZERO",
        });
      }
    }
  }

  const appliedDiscounts = selected
    .filter((candidate) => candidate.appliedPercentOff > 0)
    .sort(compareCandidates);
  const totalPercentOff = roundPercent(
    appliedDiscounts.reduce((sum, item) => sum + item.appliedPercentOff, 0),
  );

  return {
    totalPercentOff,
    appliedCodes: [...appliedDiscounts]
      .sort((left, right) => {
        if (left.sequence != null && right.sequence != null) {
          return left.sequence - right.sequence;
        }
        return compareCandidates(left, right);
      })
      .map((item) => item.code)
      .filter((code): code is string => Boolean(code)),
    eligibleDiscounts,
    appliedDiscounts,
    rejectedDiscounts,
    capAdjustments,
  };
}
