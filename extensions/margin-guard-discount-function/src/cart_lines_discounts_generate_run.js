/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

const DEFAULT_GLOBAL_FLOOR_PERCENT = 70;

const MESSAGES = {
  EN: {
    candidatePrefix: "Eligible discount",
    rejectBySegment:
      "One or more discount codes are not available for your customer segment. Next step: remove unavailable codes and try again.",
    rejectByStacking:
      "Multiple discount codes are not allowed by current settings. Next step: keep only one code and try again.",
    rejectBySegmentAndStacking:
      "Some discount codes were rejected by segment eligibility and stacking policy. Next step: keep one eligible code and try again.",
  },
  CS: {
    candidatePrefix: "Povolena sleva",
    rejectBySegment:
      "Nektere slevove kody nejsou dostupne pro vas segment. Dalsi krok: odeberte neplatne kody a zkuste znovu.",
    rejectByStacking:
      "Vice slevovych kodu neni podle aktualniho nastaveni povoleno. Dalsi krok: nechte pouze jeden kod a zkuste znovu.",
    rejectBySegmentAndStacking:
      "Nektere kody byly odmitnuty kvuli segmentu i pravidlum kombinace. Dalsi krok: nechte jeden platny kod a zkuste znovu.",
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
  return roundMoney(clampPercent(parsed));
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
 * @param {unknown} value
 */
function normalizeAllowedSegment(value) {
  if (value === "B2B" || value === "B2C") {
    return value;
  }
  return "ALL";
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
 * @param {RunInput["enteredDiscountCodes"]} enteredDiscountCodes
 * @param {Record<string, "B2B" | "B2C" | "ALL">} couponSegmentRules
 * @param {"B2B" | "B2C"} segment
 * @param {boolean} allowStacking
 */
function resolveRejectedDiscountCodes(
  enteredDiscountCodes,
  couponSegmentRules,
  segment,
  allowStacking,
) {
  const rejectedCodes = [];
  let rejectedBySegment = false;
  let rejectedByStacking = false;
  const seen = new Set();
  let acceptedRejectableCount = 0;
  for (const enteredCode of enteredDiscountCodes ?? []) {
    const normalizedCode = normalizeCouponCode(enteredCode?.code);
    if (!normalizedCode || seen.has(normalizedCode)) {
      continue;
    }
    seen.add(normalizedCode);
    const rejectable = enteredCode?.rejectable !== false;
    const allowedSegment = couponSegmentRules[normalizedCode];
    const segmentMismatch =
      allowedSegment != null &&
      allowedSegment !== "ALL" &&
      allowedSegment !== segment;
    if (segmentMismatch && rejectable) {
      rejectedCodes.push({ code: normalizedCode });
      rejectedBySegment = true;
      continue;
    }
    if (
      !segmentMismatch &&
      !allowStacking &&
      rejectable &&
      acceptedRejectableCount >= 1
    ) {
      rejectedCodes.push({ code: normalizedCode });
      rejectedByStacking = true;
      continue;
    }
    if (!segmentMismatch && rejectable) {
      acceptedRejectableCount += 1;
    }
  }

  return {
    rejectedCodes,
    rejectedBySegment,
    rejectedByStacking,
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

  for (const [productId, floorPercent] of Object.entries(rawB2CFloors)) {
    perProductFloorPercentsB2C[productId] = clampPercent(
      toNumber(floorPercent, DEFAULT_GLOBAL_FLOOR_PERCENT),
    );
  }
  for (const [productId, floorPercent] of Object.entries(rawB2BFloors)) {
    perProductFloorPercentsB2B[productId] = clampPercent(
      toNumber(floorPercent, DEFAULT_GLOBAL_FLOOR_PERCENT),
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

  return {
    globalMinPricePercent: clampPercent(
      toNumber(config.globalMinPricePercent, DEFAULT_GLOBAL_FLOOR_PERCENT),
    ),
    b2bGlobalMinPricePercent: clampPercent(
      toNumber(config.b2bGlobalMinPricePercent, DEFAULT_GLOBAL_FLOOR_PERCENT),
    ),
    allowZeroFinalPrice:
      typeof config.allowZeroFinalPrice === "boolean"
        ? config.allowZeroFinalPrice
        : false,
    allowStacking: config.allowStacking === true,
    maxCombinedPercentOff: normalizePercentOrNull(config.maxCombinedPercentOff),
    requestedPercentOff: clampPercent(toNumber(config.requestedPercentOff, 100)),
    perProductFloorPercentsB2C,
    perProductFloorPercentsB2B,
    perProductAllowZeroFinalPriceB2C,
    perProductAllowZeroFinalPriceB2B,
    perProductB2BOverridePrices,
    perProductTierPricesB2C,
    perProductTierPricesB2B,
    couponSegmentRules,
  };
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
  return clampPercent(
    Math.min(requestedPercentOff, maxPercentByFloor, maxByZeroPolicy, maxByCombined),
  );
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
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  if (!input.cart.lines.length) {
    return { operations: [] };
  }

  const hasProductDiscountClass = input.discount.discountClasses.includes(
    "PRODUCT",
  );
  if (!hasProductDiscountClass) {
    return { operations: [] };
  }

  const config = parseConfig(input);
  const messages = resolveMessages(input);
  const hasPurchasingCompany = Boolean(
    input?.cart?.buyerIdentity?.purchasingCompany?.company?.id,
  );
  const hasB2BTag = Boolean(input?.cart?.buyerIdentity?.customer?.hasAnyTag);
  const isB2B = hasPurchasingCompany || hasB2BTag;
  const segment = isB2B ? "B2B" : "B2C";
  const globalFloorPercent = isB2B
    ? config.b2bGlobalMinPricePercent
    : config.globalMinPricePercent;
  const floorMap = isB2B
    ? config.perProductFloorPercentsB2B
    : config.perProductFloorPercentsB2C;
  const allowZeroMap = isB2B
    ? config.perProductAllowZeroFinalPriceB2B
    : config.perProductAllowZeroFinalPriceB2C;
  const tierMap = isB2B
    ? config.perProductTierPricesB2B
    : config.perProductTierPricesB2C;
  const rejectedCodeResult = resolveRejectedDiscountCodes(
    input?.enteredDiscountCodes,
    config.couponSegmentRules,
    segment,
    config.allowStacking,
  );

  const candidates = [];
  for (const line of input.cart.lines) {
    const productId =
      line.merchandise?.__typename === "ProductVariant"
        ? line.merchandise.product.id
        : null;
    if (!productId) {
      continue;
    }

    const floorPercent =
      floorMap[productId] != null ? floorMap[productId] : globalFloorPercent;
    const allowZeroFinalPrice =
      allowZeroMap[productId] != null
        ? allowZeroMap[productId]
        : config.allowZeroFinalPrice;
    const lineSubtotal = resolveLineSubtotal(line);
    const lineTotal = resolveLineTotal(line);
    if (lineSubtotal <= 0) {
      continue;
    }
    const quantity = Math.max(1, toNumber(line?.quantity, 1));
    const baseUnitPrice = roundMoney(lineSubtotal / quantity);
    const baseUnitPriceWithOverride =
      isB2B && config.perProductB2BOverridePrices[productId] != null
        ? config.perProductB2BOverridePrices[productId]
        : baseUnitPrice;
    const tierUnitPrice = resolveTierUnitPrice(tierMap, productId, quantity);
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
    const maxRemainingCombinedPercent =
      config.maxCombinedPercentOff == null
        ? null
        : roundMoney(config.maxCombinedPercentOff - existingPercentOff);
    const allowedPercentOff = resolveAllowedPercent(
      config.requestedPercentOff,
      maxPercentByFloor,
      allowZeroFinalPrice,
      maxRemainingCombinedPercent,
    );
    if (allowedPercentOff <= 0) {
      continue;
    }

    candidates.push({
      message: `${messages.candidatePrefix} (${allowedPercentOff.toFixed(2)}% max)`,
      targets: [{ cartLine: { id: line.id } }],
      value: {
        percentage: {
          value: allowedPercentOff,
        },
      },
    });
  }

  if (candidates.length === 0 && rejectedCodeResult.rejectedCodes.length === 0) {
    return { operations: [] };
  }

  const operations = [];
  if (rejectedCodeResult.rejectedCodes.length > 0) {
    let rejectionMessage = messages.rejectBySegment;
    if (rejectedCodeResult.rejectedBySegment && rejectedCodeResult.rejectedByStacking) {
      rejectionMessage = messages.rejectBySegmentAndStacking;
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
