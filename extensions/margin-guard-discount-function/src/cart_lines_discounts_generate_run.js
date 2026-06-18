/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

const DEFAULT_GLOBAL_FLOOR_PERCENT = 70;
const DEFAULT_B2B_FLOOR_PERCENT = 70;

const MESSAGES = {
  EN: {
    candidatePrefix: "Eligible discount",
    rejectByFloor:
      "This discount code cannot be applied because it would reduce the price below the minimum allowed. Next step: remove the discount code and try again.",
    rejectBySegment:
      "One or more discount codes are not available for your customer segment. Next step: remove unavailable codes and try again.",
    rejectByStacking:
      "Multiple discount codes are not allowed by current settings. Next step: keep only one code and try again.",
    rejectByBlacklist:
      "Some discount codes cannot be combined. Next step: remove conflicting codes and try again.",
    rejectBySegmentAndStacking:
      "Some discount codes were rejected by segment eligibility and stacking policy. Next step: keep one eligible code and try again.",
    rejectBySegmentAndBlacklist:
      "Some discount codes were rejected by segment eligibility and blacklist rules. Next step: remove unavailable or conflicting codes and try again.",
    rejectByStackingAndBlacklist:
      "Some discount codes were rejected by stacking policy and blacklist rules. Next step: keep only compatible codes and try again.",
    rejectBySegmentStackingAndBlacklist:
      "Some discount codes were rejected by segment eligibility, stacking policy, and blacklist rules. Next step: keep only compatible eligible codes and try again.",
  },
  CS: {
    candidatePrefix: "Povolena sleva",
    rejectByFloor:
      "Tento slevovy kod nelze pouzit, protoze by snizil cenu pod povolene minimum. Dalsi krok: odeberte slevovy kod a zkuste znovu.",
    rejectBySegment:
      "Nektere slevove kody nejsou dostupne pro vas segment. Dalsi krok: odeberte neplatne kody a zkuste znovu.",
    rejectByStacking:
      "Vice slevovych kodu neni podle aktualniho nastaveni povoleno. Dalsi krok: nechte pouze jeden kod a zkuste znovu.",
    rejectByBlacklist:
      "Nektere slevove kody nelze kombinovat. Dalsi krok: odeberte konfliktni kody a zkuste znovu.",
    rejectBySegmentAndStacking:
      "Nektere kody byly odmitnuty kvuli segmentu i pravidlum kombinace. Dalsi krok: nechte jeden platny kod a zkuste znovu.",
    rejectBySegmentAndBlacklist:
      "Nektere kody byly odmitnuty kvuli segmentu i blacklist pravidlum. Dalsi krok: odeberte neplatne nebo konfliktni kody a zkuste znovu.",
    rejectByStackingAndBlacklist:
      "Nektere kody byly odmitnuty kvuli pravidlum kombinace i blacklistu. Dalsi krok: nechte pouze kompatibilni kody a zkuste znovu.",
    rejectBySegmentStackingAndBlacklist:
      "Nektere kody byly odmitnuty kvuli segmentu, pravidlum kombinace i blacklistu. Dalsi krok: nechte pouze kompatibilni platne kody a zkuste znovu.",
  },
};

/**
 * @param {unknown} value
 * @param {number} fallback
 */
function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {number} value
 */
function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

/**
 * @param {number} value
 */
function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @param {number} value
 */
function roundPercent(value) {
  return Math.round(clampPercent(value) * 100) / 100;
}

/**
 * @param {unknown} value
 */
function normalizePercentOrNull(value) {
  if (value == null) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return roundPercent(parsed);
}

/**
 * @param {RunInput} input
 */
function resolveMessages(input) {
  const isoCode = String(input?.localization?.language?.isoCode ?? "EN").toUpperCase();
  if (isoCode.startsWith("CS")) {
    return MESSAGES.CS;
  }
  return MESSAGES.EN;
}

/**
 * @param {string} code
 */
function normalizeCouponCode(code) {
  return String(code ?? "").trim().toUpperCase();
}

/**
 * MVP_5_2 — loyalty tags are compared case-insensitively, mirroring the TS core.
 * @param {unknown} value
 */
function normalizeLoyaltyTag(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * @param {unknown} value
 */
function normalizeAllowedSegment(value) {
  if (value === "B2B" || value === "B2C") {
    return value;
  }
  return "ALL";
}

/**
 * MVP_5_3 #2.0b — code → catalog ids the coupon is allowed for.
 * @param {any} raw
 */
function normalizeCouponCatalogRules(raw) {
  /** @type {Record<string, string[]>} */
  const out = {};
  if (!raw || typeof raw !== "object") {
    return out;
  }
  for (const [code, ids] of Object.entries(raw)) {
    const normalizedCode = normalizeCouponCode(code);
    if (normalizedCode && Array.isArray(ids)) {
      out[normalizedCode] = ids.map((value) => String(value));
    }
  }
  return out;
}

/**
 * MVP_5_3 #2.0d — catalog id → max combined discount cap.
 * @param {any} raw
 */
function normalizeDiscountCatalogCaps(raw) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!raw || typeof raw !== "object") {
    return out;
  }
  for (const [catalogId, max] of Object.entries(raw)) {
    const normalized = normalizePercentOrNull(max);
    if (normalized != null) {
      out[String(catalogId)] = normalized;
    }
  }
  return out;
}

/**
 * @param {unknown} value
 */
function normalizeDiscountRuleScope(value) {
  if (
    value === "GLOBAL" ||
    value === "COLLECTION" ||
    value === "PRODUCT" ||
    value === "COUPON"
  ) {
    return value;
  }
  return "GLOBAL";
}

/**
 * @param {unknown} value
 */
function normalizeDiscountStackMode(value) {
  if (
    value === "STACKABLE" ||
    value === "EXCLUSIVE" ||
    value === "NEVER_WITH_COUPONS"
  ) {
    return value;
  }
  return "STACKABLE";
}

/**
 * @param {unknown} value
 */
function normalizeDiscountReferenceType(value) {
  if (value === "RULE_ID" || value === "COUPON_CODE" || value === "SCOPE") {
    return value;
  }
  return "COUPON_CODE";
}

/**
 * @param {Record<string, unknown>} rawMap
 */
function normalizeTierPriceMap(rawMap) {
  /** @type {Record<string, Array<{ minQuantity: number; unitPrice: number }>>} */
  const normalized = {};
  for (const [productId, rawTiers] of Object.entries(rawMap)) {
    if (!Array.isArray(rawTiers)) {
      continue;
    }
    const tiers = [];
    for (const rawTier of rawTiers) {
      const minQuantity = Math.floor(toNumber(rawTier?.minQuantity, NaN));
      const unitPrice = toNumber(rawTier?.unitPrice, NaN);
      if (
        !Number.isFinite(minQuantity) ||
        !Number.isFinite(unitPrice) ||
        minQuantity < 1 ||
        unitPrice < 0
      ) {
        continue;
      }
      tiers.push({
        minQuantity,
        unitPrice: roundMoney(unitPrice),
      });
    }
    tiers.sort((a, b) => a.minQuantity - b.minQuantity);
    if (tiers.length > 0) {
      normalized[productId] = tiers;
    }
  }
  return normalized;
}

/**
 * @param {Record<string, Array<{ minQuantity: number; unitPrice: number }>>} tierMap
 * @param {string} productId
 * @param {number} quantity
 */
function resolveTierUnitPrice(tierMap, productId, quantity) {
  const tiers = tierMap[productId] ?? [];
  let selected = null;
  for (const tier of tiers) {
    if (quantity < tier.minQuantity) {
      continue;
    }
    if (!selected || tier.minQuantity > selected.minQuantity) {
      selected = tier;
    }
  }
  return selected ? selected.unitPrice : null;
}

/**
 * @param {RunInput["cart"]["lines"][number]} line
 */
function resolveLineSubtotal(line) {
  return Math.max(0, toNumber(line?.cost?.subtotalAmount?.amount, 0));
}

/**
 * @param {RunInput["cart"]["lines"][number]} line
 */
function resolveLineTotal(line) {
  return Math.max(0, toNumber(line?.cost?.totalAmount?.amount, 0));
}

/**
 * @param {number} requestedPercentOff
 * @param {number} maxPercentByFloor
 * @param {boolean} allowZeroFinalPrice
 * @param {number | null} maxRemainingCombinedPercent
 */
function resolveAllowedPercent(
  requestedPercentOff,
  maxPercentByFloor,
  allowZeroFinalPrice,
  maxRemainingCombinedPercent,
) {
  const maxByZeroPolicy = allowZeroFinalPrice ? 100 : 99.99;
  const maxByCombined =
    maxRemainingCombinedPercent == null
      ? 100
      : clampPercent(maxRemainingCombinedPercent);
  return roundPercent(
    Math.min(requestedPercentOff, maxPercentByFloor, maxByZeroPolicy, maxByCombined),
  );
}

/**
 * @param {RunInput["cart"]["lines"][number]} line
 */
function resolveLineCollectionIds(line) {
  const memberships = line?.merchandise?.product?.inCollections ?? [];
  return memberships
    .filter((membership) => membership?.isMember && membership?.collectionId)
    .map((membership) => String(membership.collectionId));
}

/**
 * @param {Array<{
 *   id: string,
 *   scope: string,
 *   code?: string | null,
 *   percentOff?: number,
 *   appliedPercentOff?: number,
 *   priority: number,
 *   stackMode: string,
 *   sequence?: number
 * }>} candidates
 */
function sortCandidates(candidates) {
  const scopeWeight = {
    PRODUCT: 400,
    COUPON: 300,
    COLLECTION: 200,
    GLOBAL: 100,
    LEGACY: 50,
  };
  return [...candidates].sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    const leftScopeWeight = scopeWeight[left.scope] ?? 0;
    const rightScopeWeight = scopeWeight[right.scope] ?? 0;
    if (leftScopeWeight !== rightScopeWeight) {
      return rightScopeWeight - leftScopeWeight;
    }
    const leftPercent =
      Number.isFinite(left.appliedPercentOff) && left.appliedPercentOff != null
        ? left.appliedPercentOff
        : Number.isFinite(left.percentOff) && left.percentOff != null
          ? left.percentOff
          : 0;
    const rightPercent =
      Number.isFinite(right.appliedPercentOff) && right.appliedPercentOff != null
        ? right.appliedPercentOff
        : Number.isFinite(right.percentOff) && right.percentOff != null
          ? right.percentOff
          : 0;
    if (leftPercent !== rightPercent) {
      return rightPercent - leftPercent;
    }
    if (left.sequence != null && right.sequence != null && left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
    return String(left.id).localeCompare(String(right.id));
  });
}

/**
 * @param {{ id: string, scope: string, code?: string | null }} candidate
 */
function buildCandidateKeys(candidate) {
  const keys = [`RULE_ID:${candidate.id}`, `SCOPE:${candidate.scope}`];
  const normalizedCode = normalizeCouponCode(candidate.code ?? "");
  if (normalizedCode) {
    keys.push(`COUPON_CODE:${normalizedCode}`);
  }
  return keys;
}

/**
 * @param {{ id: string, scope: string, code?: string | null }} left
 * @param {{ id: string, scope: string, code?: string | null }} right
 * @param {{ leftType: string, leftValue: string, rightType: string, rightValue: string, segment?: string | null }} rule
 */
function matchesBlacklistRule(left, right, rule) {
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

/**
 * @param {Array<{ leftType: string, leftValue: string, rightType: string, rightValue: string, segment?: string | null }>} rules
 * @param {{ id: string, scope: string, code?: string | null }} candidate
 * @param {Array<{ id: string, scope: string, code?: string | null }>} selected
 * @param {"B2B" | "B2C"} segment
 */
function findBlacklistConflict(rules, candidate, selected, segment, catalogId) {
  for (const selectedCandidate of selected) {
    for (const rule of rules) {
      if (rule.segment && rule.segment !== "ALL" && rule.segment !== segment) {
        continue;
      }
      if (rule.catalogId && rule.catalogId !== catalogId) {
        continue;
      }
      if (matchesBlacklistRule(candidate, selectedCandidate, rule)) {
        return selectedCandidate;
      }
    }
  }
  return null;
}

/**
 * @param {{ scope: string, code?: string | null, stackMode: string }} candidate
 */
function isCouponCandidate(candidate) {
  return candidate.scope === "COUPON" || Boolean(candidate.code);
}

/**
 * @param {{ scope: string, code?: string | null, stackMode: string }} candidate
 * @param {Array<{ scope: string, code?: string | null, stackMode: string }>} selected
 */
function findCouponStackingConflict(candidate, selected) {
  const candidateIsCoupon = isCouponCandidate(candidate);
  for (const selectedCandidate of selected) {
    const selectedIsCoupon = isCouponCandidate(selectedCandidate);
    if (
      candidateIsCoupon &&
      selectedCandidate.stackMode === "NEVER_WITH_COUPONS"
    ) {
      return selectedCandidate;
    }
    if (
      candidate.stackMode === "NEVER_WITH_COUPONS" &&
      selectedIsCoupon
    ) {
      return selectedCandidate;
    }
  }
  return null;
}

/**
 * @param {Array<{ segment: string, maxCombinedPercentOff: number }>} segmentCaps
 * @param {"B2B" | "B2C"} segment
 */
function resolveSegmentCap(segmentCaps, segment) {
  const exact = segmentCaps.find((cap) => cap.segment === segment);
  if (exact) {
    return exact.maxCombinedPercentOff;
  }
  const fallback = segmentCaps.find((cap) => cap.segment === "ALL");
  return fallback ? fallback.maxCombinedPercentOff : null;
}

/**
 * @param {RunInput["enteredDiscountCodes"]} enteredDiscountCodes
 * @param {Record<string, "B2B" | "B2C" | "ALL">} couponSegmentRules
 * @param {Array<{ leftType: string, leftValue: string, rightType: string, rightValue: string, segment?: string | null }>} blacklistRules
 * @param {"B2B" | "B2C"} segment
 * @param {boolean} allowStacking
 */
function resolveRejectedDiscountCodes(
  enteredDiscountCodes,
  couponSegmentRules,
  couponCatalogRules,
  catalogId,
  discountRules,
  blacklistRules,
  segment,
  allowStacking,
) {
  const rejectedCodes = [];
  let rejectedBySegment = false;
  let rejectedByStacking = false;
  let rejectedByBlacklist = false;
  const seen = new Set();
  const acceptedCodes = [];
  let acceptedRejectableCount = 0;
  const enteredCandidates = [];

  for (const enteredCode of enteredDiscountCodes ?? []) {
    const normalizedCode = normalizeCouponCode(enteredCode?.code);
    if (!normalizedCode || seen.has(normalizedCode)) {
      continue;
    }
    seen.add(normalizedCode);
    const rejectable = enteredCode?.rejectable !== false;
    const allowedSegment = couponSegmentRules[normalizedCode];
    const segmentMismatchRaw =
      allowedSegment != null &&
      allowedSegment !== "ALL" &&
      allowedSegment !== segment;
    // MVP_5_3 #2.0b — coupon restricted to catalog(s) → mismatch outside them.
    const allowedCatalogs = couponCatalogRules ? couponCatalogRules[normalizedCode] : null;
    const catalogMismatch =
      Array.isArray(allowedCatalogs) &&
      allowedCatalogs.length > 0 &&
      !allowedCatalogs.includes(catalogId);
    const segmentMismatch = segmentMismatchRaw || catalogMismatch;
    const matchingRule = (discountRules ?? []).find((rule) => {
      if (rule?.scope !== "COUPON") {
        return false;
      }
      const ruleCode = normalizeCouponCode(rule?.code ?? rule?.targetId ?? "");
      return ruleCode === normalizedCode;
    });
    const normalizedPercentOff = normalizePercentOrNull(matchingRule?.percentOff);
    enteredCandidates.push({
      id: matchingRule?.id ?? `coupon-${normalizedCode}`,
      scope: "COUPON",
      code: normalizedCode,
      priority:
        matchingRule != null && Number.isFinite(matchingRule.priority)
          ? Math.floor(matchingRule.priority)
          : 0,
      percentOff: normalizedPercentOff != null ? normalizedPercentOff : 0,
      appliedPercentOff: normalizedPercentOff != null ? normalizedPercentOff : 0,
      stackMode: normalizeDiscountStackMode(matchingRule?.stackMode),
      rejectable,
      segmentMismatch,
      sequence:
        matchingRule != null && Number.isFinite(matchingRule.sequence)
          ? Math.floor(matchingRule.sequence)
          : undefined,
    });
  }

  for (const candidate of sortCandidates(enteredCandidates)) {
    if (candidate.segmentMismatch && candidate.rejectable) {
      rejectedCodes.push({ code: candidate.code });
      rejectedBySegment = true;
      continue;
    }

    const blacklistConflict = acceptedCodes.some((acceptedCode) =>
      blacklistRules.some((rule) => {
        if (rule.segment && rule.segment !== "ALL" && rule.segment !== segment) {
          return false;
        }
        if (rule.catalogId && rule.catalogId !== catalogId) {
          return false;
        }
        return matchesBlacklistRule(
          {
            id: candidate.id,
            scope: candidate.scope,
            code: candidate.code,
          },
          acceptedCode,
          rule,
        );
      }),
    );
    if (blacklistConflict && candidate.rejectable) {
      rejectedCodes.push({ code: candidate.code });
      rejectedByBlacklist = true;
      continue;
    }

    if (
      !candidate.segmentMismatch &&
      !allowStacking &&
      candidate.rejectable &&
      acceptedRejectableCount >= 1
    ) {
      rejectedCodes.push({ code: candidate.code });
      rejectedByStacking = true;
      continue;
    }

    acceptedCodes.push({
      id: candidate.id,
      scope: candidate.scope,
      code: candidate.code,
    });
    if (!candidate.segmentMismatch && candidate.rejectable) {
      acceptedRejectableCount += 1;
    }
  }

  return {
    rejectedCodes,
    rejectedBySegment,
    rejectedByStacking,
    rejectedByBlacklist,
  };
}

/**
 * @param {RunInput} input
 */
function parseConfig(input) {
  const config = input?.discount?.metafield?.jsonValue ?? {};
  const rawB2CFloors =
    config && typeof config.perProductFloorPercentsB2C === "object"
      ? config.perProductFloorPercentsB2C
      : config && typeof config.perProductFloorPercents === "object"
        ? config.perProductFloorPercents
        : {};
  const rawB2BFloors =
    config && typeof config.perProductFloorPercentsB2B === "object"
      ? config.perProductFloorPercentsB2B
      : {};
  const rawB2CAllowZero =
    config && typeof config.perProductAllowZeroFinalPriceB2C === "object"
      ? config.perProductAllowZeroFinalPriceB2C
      : config && typeof config.perProductAllowZeroFinalPrice === "object"
        ? config.perProductAllowZeroFinalPrice
        : {};
  const rawB2BAllowZero =
    config && typeof config.perProductAllowZeroFinalPriceB2B === "object"
      ? config.perProductAllowZeroFinalPriceB2B
      : {};
  const rawPerProductB2BOverridePrices =
    config && typeof config.perProductB2BOverridePrices === "object"
      ? config.perProductB2BOverridePrices
      : {};
  const rawPerProductTierPricesB2C =
    config && typeof config.perProductTierPricesB2C === "object"
      ? config.perProductTierPricesB2C
      : {};
  const rawPerProductTierPricesB2B =
    config && typeof config.perProductTierPricesB2B === "object"
      ? config.perProductTierPricesB2B
      : {};
  const rawCouponSegmentRules =
    config && typeof config.couponSegmentRules === "object"
      ? config.couponSegmentRules
      : {};
  const rawDiscountRules = Array.isArray(config?.discountRules)
    ? config.discountRules
    : [];
  const rawDiscountCombinationBlacklistRules = Array.isArray(
    config?.discountCombinationBlacklistRules,
  )
    ? config.discountCombinationBlacklistRules
    : [];
  const rawDiscountSegmentCaps = Array.isArray(config?.discountSegmentCaps)
    ? config.discountSegmentCaps
    : [];

  /** @type {Record<string, number>} */
  const perProductFloorPercentsB2C = {};
  /** @type {Record<string, number>} */
  const perProductFloorPercentsB2B = {};
  /** @type {Record<string, boolean>} */
  const perProductAllowZeroFinalPriceB2C = {};
  /** @type {Record<string, boolean>} */
  const perProductAllowZeroFinalPriceB2B = {};
  /** @type {Record<string, number>} */
  const perProductB2BOverridePrices = {};
  /** @type {Record<string, "B2B" | "B2C" | "ALL">} */
  const couponSegmentRules = {};
  const discountRules = [];
  const discountCombinationBlacklistRules = [];
  const discountSegmentCaps = [];

  for (const [productId, floorPercent] of Object.entries(rawB2CFloors)) {
    perProductFloorPercentsB2C[productId] = clampPercent(
      toNumber(floorPercent, DEFAULT_GLOBAL_FLOOR_PERCENT),
    );
  }
  for (const [productId, floorPercent] of Object.entries(rawB2BFloors)) {
    perProductFloorPercentsB2B[productId] = clampPercent(
      toNumber(floorPercent, DEFAULT_B2B_FLOOR_PERCENT),
    );
  }
  for (const [productId, allowZero] of Object.entries(rawB2CAllowZero)) {
    if (typeof allowZero === "boolean") {
      perProductAllowZeroFinalPriceB2C[productId] = allowZero;
    }
  }
  for (const [productId, allowZero] of Object.entries(rawB2BAllowZero)) {
    if (typeof allowZero === "boolean") {
      perProductAllowZeroFinalPriceB2B[productId] = allowZero;
    }
  }
  for (const [productId, overridePrice] of Object.entries(
    rawPerProductB2BOverridePrices,
  )) {
    const parsed = toNumber(overridePrice, NaN);
    if (Number.isFinite(parsed) && parsed >= 0) {
      perProductB2BOverridePrices[productId] = roundMoney(parsed);
    }
  }
  const perProductTierPricesB2C = normalizeTierPriceMap(
    /** @type {Record<string, unknown>} */ (rawPerProductTierPricesB2C),
  );
  const perProductTierPricesB2B = normalizeTierPriceMap(
    /** @type {Record<string, unknown>} */ (rawPerProductTierPricesB2B),
  );
  for (const [rawCode, allowedSegment] of Object.entries(rawCouponSegmentRules)) {
    const normalizedCode = normalizeCouponCode(rawCode);
    if (!normalizedCode) {
      continue;
    }
    couponSegmentRules[normalizedCode] = normalizeAllowedSegment(allowedSegment);
  }

  for (const [sequence, rule] of rawDiscountRules.entries()) {
    const scope = normalizeDiscountRuleScope(rule?.scope);
    const percentOff = normalizePercentOrNull(rule?.percentOff);
    if (percentOff == null || percentOff <= 0) {
      continue;
    }
    let targetId = String(rule?.targetId ?? "").trim();
    let code = normalizeCouponCode(String(rule?.code ?? ""));
    if (scope === "COLLECTION" && !targetId) {
      continue;
    }
    if (scope === "PRODUCT" && !targetId) {
      continue;
    }
    if (scope === "COUPON") {
      code = normalizeCouponCode(String(rule?.code ?? rule?.targetId ?? ""));
      targetId = "";
      if (!code) {
        continue;
      }
    }
    discountRules.push({
      id: String(rule?.id ?? `${scope}-${discountRules.length + 1}`),
      scope,
      targetId: targetId || null,
      code: code || null,
      segment:
        rule?.segment === "B2B" || rule?.segment === "B2C" ? rule.segment : null,
      percentOff,
      priority: Number.isFinite(rule?.priority) ? Math.floor(rule.priority) : 100,
      stackMode: normalizeDiscountStackMode(rule?.stackMode),
      minPricePercentOfBasePrice: normalizePercentOrNull(
        rule?.minPricePercentOfBasePrice,
      ),
      requiredCustomerTag: normalizeLoyaltyTag(rule?.requiredCustomerTag) || null,
      catalogId: rule?.catalogId ? String(rule.catalogId) : null,
      sequence,
    });
  }

  for (const rule of rawDiscountCombinationBlacklistRules) {
    const leftType = normalizeDiscountReferenceType(rule?.leftType);
    const rightType = normalizeDiscountReferenceType(rule?.rightType);
    const leftValue = String(rule?.leftValue ?? "").trim();
    const rightValue = String(rule?.rightValue ?? "").trim();
    if (!leftValue || !rightValue) {
      continue;
    }
    discountCombinationBlacklistRules.push({
      leftType,
      leftValue: leftType === "COUPON_CODE" ? normalizeCouponCode(leftValue) : leftValue,
      rightType,
      rightValue:
        rightType === "COUPON_CODE" ? normalizeCouponCode(rightValue) : rightValue,
      segment:
        rule?.segment === "B2B" || rule?.segment === "B2C" || rule?.segment === "ALL"
          ? rule.segment
          : null,
      catalogId: rule?.catalogId ? String(rule.catalogId) : null,
    });
  }

  for (const cap of rawDiscountSegmentCaps) {
    const maxCombinedPercentOff = normalizePercentOrNull(cap?.maxCombinedPercentOff);
    if (maxCombinedPercentOff == null) {
      continue;
    }
    discountSegmentCaps.push({
      segment:
        cap?.segment === "B2B" || cap?.segment === "B2C" ? cap.segment : "ALL",
      maxCombinedPercentOff,
    });
  }

  return {
    globalMinPricePercent: clampPercent(
      toNumber(config.globalMinPricePercent, DEFAULT_GLOBAL_FLOOR_PERCENT),
    ),
    b2bGlobalMinPricePercent: clampPercent(
      toNumber(config.b2bGlobalMinPricePercent, DEFAULT_B2B_FLOOR_PERCENT),
    ),
    allowZeroFinalPrice:
      typeof config.allowZeroFinalPrice === "boolean"
        ? config.allowZeroFinalPrice
        : false,
    allowStacking: config.allowStacking === true,
    maxCombinedPercentOff: normalizePercentOrNull(config.maxCombinedPercentOff),
    requestedPercentOff: clampPercent(toNumber(config.requestedPercentOff, 100)),
    marginGuardEnabled: config.marginGuardEnabled !== false,
    perProductFloorPercentsB2C,
    perProductFloorPercentsB2B,
    perProductAllowZeroFinalPriceB2C,
    perProductAllowZeroFinalPriceB2B,
    perProductB2BOverridePrices,
    perProductTierPricesB2C,
    perProductTierPricesB2B,
    couponSegmentRules,
    couponCatalogRules: normalizeCouponCatalogRules(config.couponCatalogRules),
    discountCatalogCaps: normalizeDiscountCatalogCaps(config.discountCatalogCaps),
    discountRules,
    discountCombinationBlacklistRules,
    discountSegmentCaps,
  };
}

/**
 * @param {Array<{ id: string, scope: string, code?: string | null, percentOff: number, priority: number, stackMode: string }>} candidates
 * @param {Array<{ leftType: string, leftValue: string, rightType: string, rightValue: string, segment?: string | null }>} blacklistRules
 * @param {"B2B" | "B2C"} segment
 * @param {boolean} allowStacking
 * @param {number | null} remainingCap
 */
function resolveSelectedCandidates(
  candidates,
  blacklistRules,
  segment,
  allowStacking,
  remainingCap,
  catalogId,
) {
  const selected = [];
  const sorted = sortCandidates(candidates);

  for (const candidate of sorted) {
    const blacklistConflict = findBlacklistConflict(
      blacklistRules,
      candidate,
      selected,
      segment,
      catalogId,
    );
    if (blacklistConflict) {
      continue;
    }
    if (!allowStacking && selected.length > 0) {
      continue;
    }
    const exclusiveConflict = selected.find(
      (selectedCandidate) =>
        selectedCandidate.stackMode === "EXCLUSIVE" ||
        candidate.stackMode === "EXCLUSIVE",
    );
    if (exclusiveConflict) {
      continue;
    }
    const couponConflict = findCouponStackingConflict(candidate, selected);
    if (couponConflict) {
      continue;
    }
    selected.push({ ...candidate });
  }

  if (remainingCap != null) {
    let total = roundPercent(selected.reduce((sum, item) => sum + item.percentOff, 0));
    if (total > remainingCap) {
      const byLowestPriority = sortCandidates(selected).reverse();
      let remainingExcess = roundPercent(total - remainingCap);
      for (const candidate of byLowestPriority) {
        if (remainingExcess <= 0) {
          break;
        }
        const original = candidate.percentOff;
        const reduced = roundPercent(Math.max(0, original - remainingExcess));
        remainingExcess = roundPercent(Math.max(0, remainingExcess - original));
        candidate.percentOff = reduced;
      }
      total = roundPercent(selected.reduce((sum, item) => sum + item.percentOff, 0));
      if (total > remainingCap && selected.length > 0) {
        selected[selected.length - 1].percentOff = roundPercent(
          Math.max(0, selected[selected.length - 1].percentOff - (total - remainingCap)),
        );
      }
    }
  }

  return sortCandidates(selected).filter((candidate) => candidate.percentOff > 0);
}

/**
 * MVP_5_3 — merge a catalog delta onto the base layer (mirrors
 * core/catalog/catalog.merge.ts). Record maps merge per-key; scalars override.
 * @param {any} base
 * @param {any} delta
 */
function mergeLayerJS(base, delta) {
  const safeBase = base && typeof base === "object" ? base : {};
  const safeDelta = delta && typeof delta === "object" ? delta : {};
  const recordKeys = [
    "perProductPricePercents",
    "perCollectionPricePercents",
    "perVariantOverrideBasePrices",
    "perVariantPricePercents",
    "perVariantFloorPercents",
    "perVariantTierPrices",
    "perProductFloorPercents",
    "perProductAllowZeroFinalPrice",
    "perProductOverrideBasePrices",
    "perProductTierPrices",
    "perProductMinimumOrderQuantities",
    "perProductStepQuantities",
    "perProductMaximumOrderQuantities",
    "perCollectionMaximumOrderQuantities",
  ];
  /** @type {any} */
  const merged = {
    globalMinPricePercent:
      safeDelta.globalMinPricePercent != null
        ? safeDelta.globalMinPricePercent
        : safeBase.globalMinPricePercent != null
          ? safeBase.globalMinPricePercent
          : DEFAULT_GLOBAL_FLOOR_PERCENT,
    allowZeroFinalPrice:
      safeDelta.allowZeroFinalPrice != null
        ? safeDelta.allowZeroFinalPrice
        : safeBase.allowZeroFinalPrice === true,
    pricePercent:
      safeDelta.pricePercent != null
        ? safeDelta.pricePercent
        : safeBase.pricePercent != null
          ? safeBase.pricePercent
          : null,
  };
  for (const key of recordKeys) {
    merged[key] = { ...(safeBase[key] || {}), ...(safeDelta[key] || {}) };
  }
  return merged;
}

/**
 * @param {any} filter
 * @param {any} context
 */
function marketFilterMatchesJS(filter, context) {
  if (!filter || typeof filter !== "object") {
    return true;
  }
  for (const field of ["countryCode", "currencyCode", "languageCode"]) {
    const expected = filter[field];
    if (expected == null || expected === "") {
      continue;
    }
    const actual = context ? context[field] : null;
    if (
      String(actual ?? "").trim().toUpperCase() !==
      String(expected).trim().toUpperCase()
    ) {
      return false;
    }
  }
  return true;
}

/**
 * MVP_5_3 — resolve the catalog a customer falls into (mirrors
 * core/catalog/catalog.resolver.ts).
 * @param {any} catalogResolution
 * @param {string} defaultCatalogId
 * @param {{ matchedTags?: string[], hasPurchasingCompany?: boolean, marketContext?: any }} ctx
 */
function resolveCatalogIdJS(catalogResolution, defaultCatalogId, ctx) {
  const entries = Array.isArray(catalogResolution) ? catalogResolution : [];
  const tagSet = new Set(
    (ctx.matchedTags || [])
      .map((tag) => String(tag).trim().toLowerCase())
      .filter(Boolean),
  );
  const hasCompany = ctx.hasPurchasingCompany === true;
  const marketContext = ctx.marketContext || null;
  const defaultEntry = entries.find((entry) => entry && entry.isDefault) || null;
  const matching = entries
    .filter((entry) => entry && !entry.isDefault)
    .filter((entry) => marketFilterMatchesJS(entry.marketFilter, marketContext))
    .filter((entry) => {
      if (entry.matchCompany && hasCompany) {
        return true;
      }
      return (
        Array.isArray(entry.audienceTags) &&
        entry.audienceTags.some((/** @type {string} */ tag) =>
          tagSet.has(String(tag).trim().toLowerCase()),
        )
      );
    });
  if (matching.length > 0) {
    matching.sort(
      (left, right) =>
        right.priority - left.priority ||
        String(left.id).localeCompare(String(right.id)),
    );
    return String(matching[0].id);
  }
  return defaultEntry ? String(defaultEntry.id) : defaultCatalogId;
}

/**
 * @param {any} rawMap
 */
function normalizeFloorMap(rawMap) {
  /** @type {Record<string, number>} */
  const normalized = {};
  for (const [productId, floorPercent] of Object.entries(rawMap || {})) {
    normalized[productId] = clampPercent(
      toNumber(floorPercent, DEFAULT_GLOBAL_FLOOR_PERCENT),
    );
  }
  return normalized;
}

/**
 * @param {any} rawMap
 */
function normalizePricePercentMap(rawMap) {
  /** @type {Record<string, number>} */
  const normalized = {};
  for (const [productId, percent] of Object.entries(rawMap || {})) {
    const parsed = toNumber(percent, NaN);
    if (Number.isFinite(parsed) && parsed >= 0) {
      normalized[productId] = parsed;
    }
  }
  return normalized;
}

/**
 * @param {any} rawMap
 */
function normalizeBoolMap(rawMap) {
  /** @type {Record<string, boolean>} */
  const normalized = {};
  for (const [key, value] of Object.entries(rawMap || {})) {
    if (typeof value === "boolean") {
      normalized[key] = value;
    }
  }
  return normalized;
}

/**
 * @param {any} rawMap
 */
function normalizeOverrideMap(rawMap) {
  /** @type {Record<string, number>} */
  const normalized = {};
  for (const [key, value] of Object.entries(rawMap || {})) {
    const parsed = toNumber(value, NaN);
    if (Number.isFinite(parsed) && parsed >= 0) {
      normalized[key] = roundMoney(parsed);
    }
  }
  return normalized;
}

/**
 * @param {any} input
 */
function resolveMarketContext(input) {
  const localization = input && input.localization ? input.localization : null;
  if (!localization) {
    return null;
  }
  return {
    countryCode: localization.country ? localization.country.isoCode : null,
    currencyCode: localization.presentmentCurrency
      ? localization.presentmentCurrency.isoCode
      : localization.currency
        ? localization.currency.isoCode
        : null,
    languageCode: localization.language ? localization.language.isoCode : null,
  };
}

/**
 * MVP_5_3 — resolve the effective pricing layer for this customer. Catalog-
 * format config → resolveCatalogId + merge(base, delta); legacy B2C/B2B config
 * → the existing isB2B branch (behavior-identical).
 * @param {any} rawConfig
 * @param {any} parsedConfig
 * @param {{ hasPurchasingCompany?: boolean, hasB2BTag?: boolean, matchedTags?: string[], marketContext?: any }} ctx
 */
function resolveEffectiveLayer(rawConfig, parsedConfig, ctx) {
  const isCatalogFormat =
    rawConfig &&
    Array.isArray(rawConfig.catalogResolution) &&
    rawConfig.base &&
    typeof rawConfig.base === "object" &&
    rawConfig.catalogs &&
    typeof rawConfig.catalogs === "object";
  if (isCatalogFormat) {
    const defaultId = String(rawConfig.defaultCatalogId || "default");
    const catalogId = resolveCatalogIdJS(rawConfig.catalogResolution, defaultId, ctx);
    const entry = (rawConfig.catalogResolution || []).find(
      (/** @type {any} */ e) => e && e.id === catalogId,
    );
    const segment = entry && entry.segment === "B2B" ? "B2B" : "B2C";
    const eff = mergeLayerJS(rawConfig.base, rawConfig.catalogs[catalogId]);
    return {
      catalogId,
      segment,
      isB2B: segment === "B2B",
      globalFloorPercent: clampPercent(
        toNumber(eff.globalMinPricePercent, DEFAULT_GLOBAL_FLOOR_PERCENT),
      ),
      allowZeroFinalPrice: eff.allowZeroFinalPrice === true,
      pricePercent: eff.pricePercent != null ? Math.max(0, toNumber(eff.pricePercent, 0)) : null,
      pricePercentMap: normalizePricePercentMap(eff.perProductPricePercents),
      collectionPricePercentMap: normalizePricePercentMap(eff.perCollectionPricePercents),
      variantOverrideMap: normalizeOverrideMap(eff.perVariantOverrideBasePrices),
      variantPricePercentMap: normalizePricePercentMap(eff.perVariantPricePercents),
      variantFloorMap: normalizeFloorMap(eff.perVariantFloorPercents),
      variantTierMap: normalizeTierPriceMap(eff.perVariantTierPrices || {}),
      floorMap: normalizeFloorMap(eff.perProductFloorPercents),
      allowZeroMap: normalizeBoolMap(eff.perProductAllowZeroFinalPrice),
      overrideMap: normalizeOverrideMap(eff.perProductOverrideBasePrices),
      tierMap: normalizeTierPriceMap(eff.perProductTierPrices || {}),
    };
  }
  const isB2B = ctx.hasPurchasingCompany || ctx.hasB2BTag;
  return {
    catalogId: isB2B ? "b2b" : "default",
    segment: isB2B ? "B2B" : "B2C",
    isB2B,
    globalFloorPercent: isB2B
      ? parsedConfig.b2bGlobalMinPricePercent
      : parsedConfig.globalMinPricePercent,
    allowZeroFinalPrice: parsedConfig.allowZeroFinalPrice,
    pricePercent: null,
    pricePercentMap: {},
    collectionPricePercentMap: {},
    variantOverrideMap: {},
    variantPricePercentMap: {},
    variantFloorMap: /** @type {Record<string, number>} */ ({}),
    variantTierMap: {},
    floorMap: isB2B
      ? parsedConfig.perProductFloorPercentsB2B
      : parsedConfig.perProductFloorPercentsB2C,
    allowZeroMap: isB2B
      ? parsedConfig.perProductAllowZeroFinalPriceB2B
      : parsedConfig.perProductAllowZeroFinalPriceB2C,
    overrideMap: isB2B ? parsedConfig.perProductB2BOverridePrices : {},
    tierMap: isB2B
      ? parsedConfig.perProductTierPricesB2B
      : parsedConfig.perProductTierPricesB2C,
  };
}

/**
 * Most aggressive (lowest) per-collection % among the line's collections.
 * @param {Record<string, number>|undefined} map
 * @param {string[]|undefined} collectionIds
 */
function resolveCollectionPricePercent(map, collectionIds) {
  if (!map || !Array.isArray(collectionIds) || collectionIds.length === 0) {
    return null;
  }
  let lowest = null;
  for (const collectionId of collectionIds) {
    const value = map[collectionId];
    if (typeof value === "number" && Number.isFinite(value)) {
      lowest = lowest == null ? value : Math.min(lowest, value);
    }
  }
  return lowest;
}

/**
 * Pre-tier catalog base unit price (mirrors core/pricing/price-list.engine.ts):
 * variant FIXED > product FIXED > variant % > product % > collection % > catalog % > base.
 * @param {number} baseUnitPrice
 * @param {string|null} productId
 * @param {string|null} variantId
 * @param {any} layer
 * @param {string[]} [collectionIds]
 */
function resolvePriceListUnitPrice(baseUnitPrice, productId, variantId, layer, collectionIds) {
  if (variantId && layer.variantOverrideMap && layer.variantOverrideMap[variantId] != null) {
    return layer.variantOverrideMap[variantId];
  }
  if (productId && layer.overrideMap[productId] != null) {
    return layer.overrideMap[productId];
  }
  if (variantId && layer.variantPricePercentMap && layer.variantPricePercentMap[variantId] != null) {
    return roundMoney(baseUnitPrice * (layer.variantPricePercentMap[variantId] / 100));
  }
  if (productId && layer.pricePercentMap && layer.pricePercentMap[productId] != null) {
    return roundMoney(baseUnitPrice * (layer.pricePercentMap[productId] / 100));
  }
  const collectionPercent = resolveCollectionPricePercent(
    layer.collectionPricePercentMap,
    collectionIds,
  );
  if (collectionPercent != null) {
    return roundMoney(baseUnitPrice * (collectionPercent / 100));
  }
  if (layer.pricePercent != null) {
    return roundMoney(baseUnitPrice * (layer.pricePercent / 100));
  }
  return baseUnitPrice;
}

/**
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  if (!input.cart.lines.length) {
    return { operations: [] };
  }

  const hasProductDiscountClass = input.discount.discountClasses.includes("PRODUCT");
  if (!hasProductDiscountClass) {
    return { operations: [] };
  }

  const rawConfig = input?.discount?.metafield?.jsonValue ?? {};
  const config = parseConfig(input);
  if (config.marginGuardEnabled === false) {
    return { operations: [] };
  }
  const messages = resolveMessages(input);
  const hasPurchasingCompany = Boolean(
    input?.cart?.buyerIdentity?.purchasingCompany?.company?.id,
  );
  const hasB2BTag = Boolean(input?.cart?.buyerIdentity?.customer?.hasAnyTag);
  const matchedTags = [];
  if (hasB2BTag) {
    matchedTags.push(String(rawConfig?.b2bTag ?? "b2b"));
  }
  for (const flag of input?.cart?.buyerIdentity?.customer?.hasTags ?? []) {
    if (flag && flag.hasTag) matchedTags.push(String(flag.tag));
  }
  const layer = resolveEffectiveLayer(rawConfig, config, {
    hasPurchasingCompany,
    hasB2BTag,
    matchedTags,
    marketContext: resolveMarketContext(input),
  });
  const isB2B = layer.isB2B;
  const segment = /** @type {"B2B" | "B2C"} */ (layer.segment);
  const resolvedCatalogId = layer.catalogId;
  // MVP_5_2 — loyalty eligibility: collect the tags the customer actually
  // carries (hasTags returns per-tag booleans for the configured loyaltyTags).
  const customerLoyaltyTags = new Set(
    (input?.cart?.buyerIdentity?.customer?.hasTags ?? [])
      .filter((entry) => entry?.hasTag)
      .map((entry) => normalizeLoyaltyTag(entry?.tag))
      .filter(Boolean),
  );
  const enteredCodes = (input?.enteredDiscountCodes ?? [])
    .map((enteredCode) => normalizeCouponCode(enteredCode?.code))
    .filter(Boolean);
  const rejectedCodeResult = resolveRejectedDiscountCodes(
    input?.enteredDiscountCodes,
    config.couponSegmentRules,
    config.couponCatalogRules,
    resolvedCatalogId,
    config.discountRules,
    config.discountCombinationBlacklistRules,
    segment,
    config.allowStacking,
  );
  // MVP_5_3 #2.0d — resolved catalog's cap (if any) overrides the segment/shop cap.
  const catalogCapPercent =
    config.discountCatalogCaps && config.discountCatalogCaps[resolvedCatalogId] != null
      ? config.discountCatalogCaps[resolvedCatalogId]
      : null;
  const globalFloorPercent = layer.globalFloorPercent;
  const floorMap = layer.floorMap;
  const allowZeroMap = layer.allowZeroMap;
  const tierMap = layer.tierMap;
  const segmentCap = resolveSegmentCap(config.discountSegmentCaps, segment);

  const cartSubtotal = Math.max(
    0,
    toNumber(input?.cart?.cost?.subtotalAmount?.amount, 0),
  );
  const cartTotal = Math.max(
    0,
    toNumber(input?.cart?.cost?.totalAmount?.amount, 0),
  );
  const cartTax = Math.max(
    0,
    toNumber(input?.cart?.cost?.totalTaxAmount?.amount, 0),
  );
  const cartTotalAfterDiscountsBeforeTax = Math.max(0, cartTotal - cartTax);
  const orderDiscountFactor =
    cartSubtotal > 0
      ? Math.max(0, Math.min(1, cartTotalAfterDiscountsBeforeTax / cartSubtotal))
      : 1;

  const candidates = [];
  let floorViolationByExternalDiscount = false;
  for (const line of input.cart.lines) {
    const productId =
      line.merchandise?.__typename === "ProductVariant"
        ? line.merchandise.product.id
        : null;
    if (!productId) {
      continue;
    }
    const variantId =
      line.merchandise?.__typename === "ProductVariant"
        ? line.merchandise.id ?? null
        : null;

    const floorPercent =
      variantId && layer.variantFloorMap[variantId] != null
        ? layer.variantFloorMap[variantId]
        : floorMap[productId] != null
          ? floorMap[productId]
          : globalFloorPercent;
    const allowZeroFinalPrice =
      allowZeroMap[productId] != null
        ? allowZeroMap[productId]
        : layer.allowZeroFinalPrice;
    const lineSubtotal = resolveLineSubtotal(line);
    const lineTotal = resolveLineTotal(line);
    if (lineSubtotal <= 0) {
      continue;
    }
    const quantity = Math.max(1, toNumber(line?.quantity, 1));
    const baseUnitPrice = roundMoney(lineSubtotal / quantity);
    const baseUnitPriceWithOverride = resolvePriceListUnitPrice(
      baseUnitPrice,
      productId,
      variantId,
      layer,
      resolveLineCollectionIds(line),
    );
    const variantTierUnitPrice = variantId
      ? resolveTierUnitPrice(layer.variantTierMap, variantId, quantity)
      : null;
    const tierUnitPrice =
      variantTierUnitPrice != null
        ? variantTierUnitPrice
        : resolveTierUnitPrice(tierMap, productId, quantity);
    const effectiveBaseUnitPrice =
      tierUnitPrice != null ? tierUnitPrice : baseUnitPriceWithOverride;
    const floorUnitPrice = roundMoney(effectiveBaseUnitPrice * (floorPercent / 100));
    const floorLinePrice = roundMoney(floorUnitPrice * quantity);
    const maxPercentByFloor = clampPercent(
      ((lineSubtotal - floorLinePrice) / lineSubtotal) * 100,
    );
    const existingPercentOff = clampPercent(
      ((lineSubtotal - lineTotal) / lineSubtotal) * 100,
    );
    const effectiveLineTotal = roundMoney(lineSubtotal * orderDiscountFactor);
    if (
      !allowZeroFinalPrice &&
      (lineTotal < floorLinePrice - 0.005 ||
        effectiveLineTotal < floorLinePrice - 0.005)
    ) {
      floorViolationByExternalDiscount = true;
    }
    const remainingGlobalCap =
      config.maxCombinedPercentOff == null
        ? null
        : roundPercent(config.maxCombinedPercentOff - existingPercentOff);
    const remainingSegmentCap =
      segmentCap == null ? null : roundPercent(segmentCap - existingPercentOff);
    const remainingCatalogCap =
      catalogCapPercent == null ? null : roundPercent(catalogCapPercent - existingPercentOff);
    const remainingCapCandidates = [
      remainingGlobalCap,
      remainingSegmentCap,
      remainingCatalogCap,
    ].filter((value) => value != null);
    const remainingCap =
      remainingCapCandidates.length > 0 ? Math.min(...remainingCapCandidates) : null;

    const eligibleCandidates = [];
    const lineCollectionIds = resolveLineCollectionIds(line);
    for (const rule of config.discountRules) {
      if (rule.segment && rule.segment !== segment) {
        continue;
      }
      // MVP_5_3 — catalog-scoped discount only applies in its catalog; rules
      // without a catalogId stay shop-wide (legacy / segment-scoped).
      if (rule.catalogId && rule.catalogId !== resolvedCatalogId) {
        continue;
      }
      // MVP_5_2 — tag-gated loyalty rule only matches when the customer carries
      // the required tag (mirrors matchesRule in the TS core).
      if (rule.requiredCustomerTag && !customerLoyaltyTags.has(rule.requiredCustomerTag)) {
        continue;
      }
      if (rule.scope === "PRODUCT" && rule.targetId !== productId) {
        continue;
      }
      if (
        rule.scope === "COLLECTION" &&
        (!rule.targetId || !lineCollectionIds.includes(rule.targetId))
      ) {
        continue;
      }
      if (rule.scope === "COUPON") {
        const ruleCode = normalizeCouponCode(rule.code ?? "");
        if (!ruleCode || !enteredCodes.includes(ruleCode)) {
          continue;
        }
      }

      const ruleFloorPercent =
        rule.minPricePercentOfBasePrice == null
          ? maxPercentByFloor
          : Math.min(maxPercentByFloor, clampPercent(100 - rule.minPricePercentOfBasePrice));
      const allowedPercentOff = resolveAllowedPercent(
        rule.percentOff,
        ruleFloorPercent,
        allowZeroFinalPrice,
        remainingCap,
      );
      if (allowedPercentOff <= 0) {
        continue;
      }
      eligibleCandidates.push({
        id: rule.id,
        code: rule.code,
        scope: rule.scope,
        percentOff: allowedPercentOff,
        appliedPercentOff: allowedPercentOff,
        priority: rule.priority,
        stackMode: rule.stackMode,
        sequence: Number.isFinite(rule.sequence) ? Math.floor(rule.sequence) : undefined,
        label:
          rule.scope === "COUPON"
            ? `coupon ${rule.code}`
            : rule.scope === "COLLECTION"
              ? `collection rule`
              : rule.scope === "PRODUCT"
                ? `product rule`
                : `global rule`,
      });
    }


    const selectedCandidates = resolveSelectedCandidates(
      eligibleCandidates,
      config.discountCombinationBlacklistRules,
      segment,
      config.allowStacking,
      remainingCap,
      resolvedCatalogId,
    );

    for (const selectedCandidate of selectedCandidates) {
      candidates.push({
        message: `${messages.candidatePrefix} ${selectedCandidate.label} (${selectedCandidate.percentOff.toFixed(2)}% max)`,
        targets: [{ cartLine: { id: line.id } }],
        value: {
          percentage: {
            value: selectedCandidate.percentOff,
          },
        },
      });
    }
  }

  const alreadyRejectedCodes = new Set(
    rejectedCodeResult.rejectedCodes.map((c) => c.code),
  );
  const floorRejectedCodes =
    floorViolationByExternalDiscount
      ? (input?.enteredDiscountCodes ?? [])
          .filter((c) => c?.rejectable !== false && !alreadyRejectedCodes.has(c?.code))
          .map((c) => ({ code: c.code }))
      : [];

  if (
    candidates.length === 0 &&
    rejectedCodeResult.rejectedCodes.length === 0 &&
    floorRejectedCodes.length === 0
  ) {
    return { operations: [] };
  }

  const operations = [];
  if (rejectedCodeResult.rejectedCodes.length > 0) {
    let rejectionMessage = messages.rejectBySegment;
    if (
      rejectedCodeResult.rejectedBySegment &&
      rejectedCodeResult.rejectedByStacking &&
      rejectedCodeResult.rejectedByBlacklist
    ) {
      rejectionMessage = messages.rejectBySegmentStackingAndBlacklist;
    } else if (
      rejectedCodeResult.rejectedBySegment &&
      rejectedCodeResult.rejectedByStacking
    ) {
      rejectionMessage = messages.rejectBySegmentAndStacking;
    } else if (
      rejectedCodeResult.rejectedBySegment &&
      rejectedCodeResult.rejectedByBlacklist
    ) {
      rejectionMessage = messages.rejectBySegmentAndBlacklist;
    } else if (
      rejectedCodeResult.rejectedByStacking &&
      rejectedCodeResult.rejectedByBlacklist
    ) {
      rejectionMessage = messages.rejectByStackingAndBlacklist;
    } else if (rejectedCodeResult.rejectedByBlacklist) {
      rejectionMessage = messages.rejectByBlacklist;
    } else if (rejectedCodeResult.rejectedByStacking) {
      rejectionMessage = messages.rejectByStacking;
    }
    operations.push({
      enteredDiscountCodesReject: {
        codes: rejectedCodeResult.rejectedCodes,
        message: rejectionMessage,
      },
    });
  }
  if (floorRejectedCodes.length > 0) {
    operations.push({
      enteredDiscountCodesReject: {
        codes: floorRejectedCodes,
        message: messages.rejectByFloor,
      },
    });
  }
  if (candidates.length > 0) {
    operations.push({
      productDiscountsAdd: {
        candidates,
        selectionStrategy: "ALL",
      },
    });
  }

  return {
    operations,
  };
}
