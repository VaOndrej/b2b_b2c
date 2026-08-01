// @ts-check

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

const DEFAULT_GLOBAL_FLOOR_PERCENT = 70;
const DEFAULT_B2B_FLOOR_PERCENT = 70;
const DEFAULT_ALLOW_ZERO_FINAL_PRICE = false;

const MESSAGES = {
  EN: {
    visibility:
      "Some items are not available for your customer segment or account. Next step: remove restricted items or use an eligible account.",
    belowFloor:
      "A discount would push at least one item below the minimum allowed price. Next step: reduce discount level or remove discount codes and try again.",
    zeroFinal:
      "A free line item is not allowed for this checkout. Next step: remove the free line or adjust discount settings.",
    combinedCap:
      "Combined discount exceeds the configured maximum for this checkout. Next step: remove one or more discounts and try again.",
    couponSegment:
      "One or more discount codes are not available for your customer segment. Next step: remove unavailable codes and try again.",
    couponStacking:
      "Multiple discount codes are not allowed by current settings. Next step: keep only one code and try again.",
    couponSegmentAndStacking:
      "Some discount codes were rejected by segment eligibility and stacking policy. Next step: keep one eligible code and try again.",
    minimumOrderQuantity:
      "At least one line is below the minimum order quantity for this customer segment. Next step: increase quantity to meet the minimum.",
    stepQuantity:
      "At least one line quantity does not match the required packaging multiple. Next step: adjust quantity to the required step.",
    maximumOrderQuantity:
      "At least one line exceeds the maximum quantity allowed for this customer or segment. Next step: reduce quantity to the allowed maximum.",
    stepQuantitySinglePrefix: "This item must be purchased in steps of ",
    stepQuantitySingleSuffix: ".",
    stepQuantityMultiPrefix: "Items in your cart must follow step multiples: ",
    stepQuantityMultiSuffix: ".",
    maximumOrderQuantitySinglePrefix: "Maximum allowed quantity for this item is ",
    maximumOrderQuantitySingleSuffix: ".",
    maximumOrderQuantityMultiPrefix: "Maximum allowed quantities in your cart: ",
    maximumOrderQuantityMultiSuffix: ".",
    affectedProductSinglePrefix: "Affected product: ",
    affectedProductSingleSuffix: ".",
    affectedProductMultiPrefix: "Affected products: ",
    affectedProductMultiSuffix: ".",
    unknownProductLabel: "Unknown product",
  },
  CS: {
    visibility:
      "Nektere polozky nejsou dostupne pro vas segment nebo ucet. Dalsi krok: odeberte omezenou polozku nebo pouzijte odpovidajici ucet.",
    belowFloor:
      "Sleva by stlacila alespon jednu polozku pod minimalni povolenou cenu. Dalsi krok: snizte slevu nebo odeberte slevovy kod a zkuste znovu.",
    zeroFinal:
      "Polozka zdarma neni pro tento checkout povolena. Dalsi krok: odeberte zdarma polozku nebo upravte slevu.",
    combinedCap:
      "Kombinovana sleva prekrocila nastaveny maximalni limit. Dalsi krok: odeberte jednu nebo vice slev a zkuste znovu.",
    couponSegment:
      "Nektere slevove kody nejsou dostupne pro vas segment. Dalsi krok: odeberte neplatne kody a zkuste znovu.",
    couponStacking:
      "Vice slevovych kodu neni podle aktualniho nastaveni povoleno. Dalsi krok: nechte pouze jeden kod a zkuste znovu.",
    couponSegmentAndStacking:
      "Nektere kody byly odmitnuty kvuli segmentu i pravidlum kombinace. Dalsi krok: nechte jeden platny kod a zkuste znovu.",
    minimumOrderQuantity:
      "Alespon jedna polozka je pod minimalnim objednacim mnozstvim pro vas segment. Dalsi krok: navyste mnozstvi na pozadovane minimum.",
    stepQuantity:
      "Alespon jedna polozka nema pozadovany kartonovy nasobek. Dalsi krok: upravte mnozstvi na pozadovany krok.",
    maximumOrderQuantity:
      "Alespon jedna polozka prekrocila maximalni mnozstvi pro vas segment nebo ucet. Dalsi krok: snizte mnozstvi na povolene maximum.",
    stepQuantitySinglePrefix: "Tato polozka se nakupuje v krocich po ",
    stepQuantitySingleSuffix: ".",
    stepQuantityMultiPrefix: "Polozky v kosiku maji tyto kroky nasobku: ",
    stepQuantityMultiSuffix: ".",
    maximumOrderQuantitySinglePrefix:
      "Maximalni povolene mnozstvi pro tuto polozku je ",
    maximumOrderQuantitySingleSuffix: ".",
    maximumOrderQuantityMultiPrefix: "Maximalni povolena mnozstvi v kosiku: ",
    maximumOrderQuantityMultiSuffix: ".",
    affectedProductSinglePrefix: "Dotceny produkt: ",
    affectedProductSingleSuffix: ".",
    affectedProductMultiPrefix: "Dotcene produkty: ",
    affectedProductMultiSuffix: ".",
    unknownProductLabel: "Neznamy produkt",
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
function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

/**
 * @param {number} value
 */
function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

/**
 * @param {unknown} value
 */
function normalizeVisibilityMode(value) {
  if (value === "B2B_ONLY" || value === "B2C_ONLY" || value === "CUSTOMER_ONLY") {
    return value;
  }
  return null;
}

/**
 * @param {unknown} value
 */
function normalizeCustomerId(value) {
  return String(value ?? "").trim();
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
 * @param {string} value
 */
function parseCouponCodesCsv(value) {
  return value
    .split(/[,\s]+/)
    .map((part) => normalizeCouponCode(part))
    .filter(Boolean);
}

/**
 * @param {CartValidationsGenerateRunInput} input
 */
function collectEnteredDiscountCodes(input) {
  const typedInput = /** @type {any} */ (input);
  /** @type {Array<{ code: string; rejectable: boolean }>} */
  const enteredCodes = [];
  const rawEnteredCodes = Array.isArray(typedInput?.cart?.enteredDiscountCodes)
    ? typedInput.cart.enteredDiscountCodes
    : [];
  for (const rawEnteredCode of rawEnteredCodes) {
    const code = normalizeCouponCode(rawEnteredCode?.code);
    if (!code) {
      continue;
    }
    enteredCodes.push({
      code,
      rejectable: rawEnteredCode?.rejectable !== false,
    });
  }

  const csvSources = [
    typedInput?.cart?.marginGuardDiscountCodes?.value,
    typedInput?.cart?.discountCodes?.value,
  ];
  for (const rawSource of csvSources) {
    if (typeof rawSource !== "string" || !rawSource.trim()) {
      continue;
    }
    for (const code of parseCouponCodesCsv(rawSource)) {
      enteredCodes.push({ code, rejectable: true });
    }
  }

  /** @type {Array<{ code: string; rejectable: boolean }>} */
  const deduped = [];
  const seen = new Map();
  for (const enteredCode of enteredCodes) {
    if (!seen.has(enteredCode.code)) {
      seen.set(enteredCode.code, enteredCode.rejectable);
      continue;
    }
    seen.set(enteredCode.code, seen.get(enteredCode.code) || enteredCode.rejectable);
  }
  for (const [code, rejectable] of seen.entries()) {
    deduped.push({ code, rejectable });
  }
  return deduped;
}

/**
 * @param {Array<{ code: string; rejectable: boolean }>} enteredDiscountCodes
 * @param {Record<string, "B2B" | "B2C" | "ALL">} couponSegmentRules
 * @param {Record<string, string[]>} couponCatalogRules
 * @param {string} catalogId
 * @param {"B2B" | "B2C"} segment
 * @param {boolean} allowStacking
 */
function resolveRejectedDiscountCodes(
  enteredDiscountCodes,
  couponSegmentRules,
  couponCatalogRules,
  catalogId,
  segment,
  allowStacking,
) {
  const rejectedCodes = [];
  let rejectedBySegment = false;
  let rejectedByStacking = false;
  let acceptedRejectableCount = 0;
  for (const enteredCode of enteredDiscountCodes) {
    const code = enteredCode.code;
    const rejectable = enteredCode.rejectable !== false;
    const allowedSegment = couponSegmentRules[code];
    const segmentMismatch =
      allowedSegment != null &&
      allowedSegment !== "ALL" &&
      allowedSegment !== segment;
    // MVP_5_3 #2.0b — a coupon restricted to catalog(s) is rejected outside them.
    const allowedCatalogs = couponCatalogRules ? couponCatalogRules[code] : null;
    const catalogMismatch =
      Array.isArray(allowedCatalogs) &&
      allowedCatalogs.length > 0 &&
      !allowedCatalogs.includes(catalogId);
    const mismatch = segmentMismatch || catalogMismatch;
    if (mismatch && rejectable) {
      rejectedCodes.push({ code });
      rejectedBySegment = true;
      continue;
    }
    if (!mismatch && !allowStacking && rejectable && acceptedRejectableCount >= 1) {
      rejectedCodes.push({ code });
      rejectedByStacking = true;
      continue;
    }
    if (!mismatch && rejectable) {
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
 * @param {CartValidationsGenerateRunInput} input
 */
function resolveMessages(input) {
  const typedInput = /** @type {any} */ (input);
  const isoCode = String(typedInput?.localization?.language?.isoCode ?? "EN").toUpperCase();
  if (isoCode.startsWith("CS")) {
    return MESSAGES.CS;
  }
  return MESSAGES.EN;
}

/**
 * @param {unknown[]} rawStepValues
 */
function normalizeStepViolationValues(rawStepValues) {
  const values = new Set();
  for (const rawStepValue of rawStepValues ?? []) {
    const stepValue = Math.floor(toNumber(rawStepValue, NaN));
    if (!Number.isFinite(stepValue) || stepValue <= 1) {
      continue;
    }
    values.add(stepValue);
  }
  return Array.from(values).sort((a, b) => a - b);
}

/**
 * @param {typeof MESSAGES.EN} messages
 * @param {unknown[]} rawStepValues
 */
function buildStepQuantityViolationMessage(messages, rawStepValues) {
  const stepValues = normalizeStepViolationValues(rawStepValues);
  if (stepValues.length === 1) {
    return (
      messages.stepQuantity +
      " " +
      messages.stepQuantitySinglePrefix +
      stepValues[0] +
      messages.stepQuantitySingleSuffix
    );
  }
  if (stepValues.length > 1) {
    return (
      messages.stepQuantity +
      " " +
      messages.stepQuantityMultiPrefix +
      stepValues.join(", ") +
      messages.stepQuantityMultiSuffix
    );
  }
  return messages.stepQuantity;
}

/**
 * @param {unknown[]} rawMaximumValues
 */
function normalizeMaximumViolationValues(rawMaximumValues) {
  const values = new Set();
  for (const rawMaximumValue of rawMaximumValues ?? []) {
    const maximumValue = Math.floor(toNumber(rawMaximumValue, NaN));
    if (!Number.isFinite(maximumValue) || maximumValue < 1) {
      continue;
    }
    values.add(maximumValue);
  }
  return Array.from(values).sort((a, b) => a - b);
}

/**
 * @param {typeof MESSAGES.EN} messages
 * @param {unknown[]} rawMaximumValues
 */
function buildMaximumOrderQuantityViolationMessage(messages, rawMaximumValues) {
  const maximumValues = normalizeMaximumViolationValues(rawMaximumValues);
  if (maximumValues.length === 1) {
    return (
      messages.maximumOrderQuantity +
      " " +
      messages.maximumOrderQuantitySinglePrefix +
      maximumValues[0] +
      messages.maximumOrderQuantitySingleSuffix
    );
  }
  if (maximumValues.length > 1) {
    return (
      messages.maximumOrderQuantity +
      " " +
      messages.maximumOrderQuantityMultiPrefix +
      maximumValues.join(", ") +
      messages.maximumOrderQuantityMultiSuffix
    );
  }
  return messages.maximumOrderQuantity;
}

/**
 * @param {unknown[]} rawProductNames
 */
function normalizeViolationProductNames(rawProductNames) {
  const values = new Set();
  for (const rawProductName of rawProductNames ?? []) {
    const productName = String(rawProductName ?? "").trim();
    if (!productName) {
      continue;
    }
    values.add(productName);
  }
  return Array.from(values);
}

/**
 * @param {string} message
 * @param {typeof MESSAGES.EN} messages
 * @param {unknown[]} rawProductNames
 */
function buildViolationMessageWithProducts(message, messages, rawProductNames) {
  const productNames = normalizeViolationProductNames(rawProductNames);
  if (productNames.length === 0) {
    return message;
  }
  if (productNames.length === 1) {
    return (
      message +
      " " +
      messages.affectedProductSinglePrefix +
      productNames[0] +
      messages.affectedProductSingleSuffix
    );
  }
  return (
    message +
    " " +
    messages.affectedProductMultiPrefix +
    productNames.join(", ") +
    messages.affectedProductMultiSuffix
  );
}

/**
 * @param {CartValidationsGenerateRunInput["cart"]["lines"][number]} line
 * @param {typeof MESSAGES.EN} messages
 */
function resolveProductDisplayName(line, messages) {
  if (line?.merchandise?.__typename !== "ProductVariant") {
    return messages.unknownProductLabel;
  }
  const title = String(line?.merchandise?.product?.title ?? "").trim();
  if (title) {
    return title;
  }
  const productId = String(line?.merchandise?.product?.id ?? "").trim();
  if (productId) {
    return productId;
  }
  return messages.unknownProductLabel;
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
 * @param {Record<string, unknown>} rawMap
 */
function normalizeMinimumOrderQuantityMap(rawMap) {
  /** @type {Record<string, number>} */
  const normalized = {};
  for (const [productId, rawMinimumOrderQuantity] of Object.entries(rawMap)) {
    const minimumOrderQuantity = Math.floor(toNumber(rawMinimumOrderQuantity, NaN));
    if (!Number.isFinite(minimumOrderQuantity) || minimumOrderQuantity < 1) {
      continue;
    }
    normalized[productId] = minimumOrderQuantity;
  }
  return normalized;
}

/**
 * @param {Record<string, unknown>} rawMap
 */
function normalizeStepQuantityMap(rawMap) {
  /** @type {Record<string, number>} */
  const normalized = {};
  for (const [productId, rawStepQuantity] of Object.entries(rawMap)) {
    const stepQuantity = Math.floor(toNumber(rawStepQuantity, NaN));
    if (!Number.isFinite(stepQuantity) || stepQuantity <= 1) {
      continue;
    }
    normalized[productId] = stepQuantity;
  }
  return normalized;
}

/**
 * @param {Record<string, unknown>} rawMap
 */
function normalizeMaximumOrderQuantityMap(rawMap) {
  /** @type {Record<string, number>} */
  const normalized = {};
  for (const [productId, rawMaximumOrderQuantity] of Object.entries(rawMap)) {
    const maximumOrderQuantity = Math.floor(toNumber(rawMaximumOrderQuantity, NaN));
    if (!Number.isFinite(maximumOrderQuantity) || maximumOrderQuantity < 1) {
      continue;
    }
    normalized[productId] = maximumOrderQuantity;
  }
  return normalized;
}

/**
 * @param {unknown[]} memberships
 * @param {Record<string, number>} perCollectionMaximumOrderQuantities
 */
function resolveCollectionMaximumOrderQuantity(
  memberships,
  perCollectionMaximumOrderQuantities,
) {
  let resolvedMaximumOrderQuantity = null;
  for (const rawMembership of memberships ?? []) {
    const membership = /** @type {{ isMember?: boolean; collectionId?: string } | null | undefined} */ (
      rawMembership
    );
    if (!membership?.isMember) {
      continue;
    }
    const collectionId = String(membership?.collectionId ?? "").trim();
    if (!collectionId) {
      continue;
    }
    const configuredMaximumOrderQuantity = Math.floor(
      toNumber(perCollectionMaximumOrderQuantities[collectionId], NaN),
    );
    if (
      !Number.isFinite(configuredMaximumOrderQuantity) ||
      configuredMaximumOrderQuantity < 1
    ) {
      continue;
    }
    resolvedMaximumOrderQuantity =
      resolvedMaximumOrderQuantity == null
        ? configuredMaximumOrderQuantity
        : Math.min(resolvedMaximumOrderQuantity, configuredMaximumOrderQuantity);
  }
  return resolvedMaximumOrderQuantity;
}

/**
 * @param {Record<string, unknown>} rawMap
 */
function normalizePerCustomerProductMaximumOrderQuantities(rawMap) {
  /** @type {Record<string, Record<string, number>>} */
  const normalized = {};
  for (const [rawCustomerId, rawPerProductMaximums] of Object.entries(rawMap)) {
    const customerId = normalizeCustomerId(rawCustomerId);
    if (!customerId || !rawPerProductMaximums || typeof rawPerProductMaximums !== "object") {
      continue;
    }
    const perProductMaximums = normalizeMaximumOrderQuantityMap(
      /** @type {Record<string, unknown>} */ (rawPerProductMaximums),
    );
    if (Object.keys(perProductMaximums).length === 0) {
      continue;
    }
    normalized[customerId] = perProductMaximums;
  }
  return normalized;
}

/**
 * @param {Record<string, Array<{ minQuantity: number; unitPrice: number }>>} tierMap
 * @param {string | null} productId
 * @param {number} quantity
 */
function resolveTierUnitPrice(tierMap, productId, quantity) {
  if (!productId) {
    return null;
  }
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
 * Cart Validation schema exposes only buyerIdentity.purchasingCompany.company.id.
 * We also probe compatibility fallbacks to avoid drift with webhook payload shapes.
 * @param {CartValidationsGenerateRunInput} input
 */
function resolveHasPurchasingCompany(input) {
  const typedInput = /** @type {any} */ (input);
  return Boolean(
    typedInput?.cart?.buyerIdentity?.purchasingCompany?.company?.id ??
      typedInput?.cart?.buyerIdentity?.purchasingCompany?.id ??
      typedInput?.cart?.purchasingCompany?.company?.id ??
      typedInput?.cart?.purchasing_company?.company?.id ??
      typedInput?.cart?.customer?.purchasingCompany?.company?.id ??
      typedInput?.cart?.customer?.purchasing_company?.company?.id,
  );
}

/**
 * @param {CartValidationsGenerateRunInput} input
 */
function parseConfig(input) {
  const config = input?.validation?.metafield?.jsonValue ?? {};
  const rawPerProductFloorsB2C =
    config && typeof config.perProductFloorPercentsB2C === "object"
      ? config.perProductFloorPercentsB2C
      : config && typeof config.perProductFloorPercents === "object"
        ? config.perProductFloorPercents
        : {};
  const rawPerProductFloorsB2B =
    config && typeof config.perProductFloorPercentsB2B === "object"
      ? config.perProductFloorPercentsB2B
      : {};
  /** @type {Record<string, number>} */
  const perProductFloorPercentsB2C = {};
  /** @type {Record<string, number>} */
  const perProductFloorPercentsB2B = {};
  for (const [productId, floorPercent] of Object.entries(rawPerProductFloorsB2C)) {
    perProductFloorPercentsB2C[productId] = clampPercent(
      toNumber(floorPercent, DEFAULT_GLOBAL_FLOOR_PERCENT),
    );
  }
  for (const [productId, floorPercent] of Object.entries(rawPerProductFloorsB2B)) {
    perProductFloorPercentsB2B[productId] = clampPercent(
      toNumber(floorPercent, DEFAULT_B2B_FLOOR_PERCENT),
    );
  }

  const rawPerProductAllowZeroFinalPriceB2C =
    config && typeof config.perProductAllowZeroFinalPriceB2C === "object"
      ? config.perProductAllowZeroFinalPriceB2C
      : config && typeof config.perProductAllowZeroFinalPrice === "object"
        ? config.perProductAllowZeroFinalPrice
        : {};
  const rawPerProductAllowZeroFinalPriceB2B =
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
  const rawPerProductMinimumOrderQuantitiesB2C =
    config && typeof config.perProductMinimumOrderQuantitiesB2C === "object"
      ? config.perProductMinimumOrderQuantitiesB2C
      : config && typeof config.perProductMinimumOrderQuantities === "object"
        ? config.perProductMinimumOrderQuantities
        : {};
  const rawPerProductMinimumOrderQuantitiesB2B =
    config && typeof config.perProductMinimumOrderQuantitiesB2B === "object"
      ? config.perProductMinimumOrderQuantitiesB2B
      : {};
  const rawPerProductStepQuantitiesB2C =
    config && typeof config.perProductStepQuantitiesB2C === "object"
      ? config.perProductStepQuantitiesB2C
      : config && typeof config.perProductStepQuantities === "object"
        ? config.perProductStepQuantities
        : {};
  const rawPerProductStepQuantitiesB2B =
    config && typeof config.perProductStepQuantitiesB2B === "object"
      ? config.perProductStepQuantitiesB2B
      : {};
  const rawPerProductMaximumOrderQuantitiesB2C =
    config && typeof config.perProductMaximumOrderQuantitiesB2C === "object"
      ? config.perProductMaximumOrderQuantitiesB2C
      : config && typeof config.perProductMaximumOrderQuantities === "object"
        ? config.perProductMaximumOrderQuantities
        : {};
  const rawPerProductMaximumOrderQuantitiesB2B =
    config && typeof config.perProductMaximumOrderQuantitiesB2B === "object"
      ? config.perProductMaximumOrderQuantitiesB2B
      : {};
  const rawPerCollectionMaximumOrderQuantitiesB2C =
    config && typeof config.perCollectionMaximumOrderQuantitiesB2C === "object"
      ? config.perCollectionMaximumOrderQuantitiesB2C
      : {};
  const rawPerCollectionMaximumOrderQuantitiesB2B =
    config && typeof config.perCollectionMaximumOrderQuantitiesB2B === "object"
      ? config.perCollectionMaximumOrderQuantitiesB2B
      : {};
  const rawPerCustomerProductMaximumOrderQuantities =
    config && typeof config.perCustomerProductMaximumOrderQuantities === "object"
      ? config.perCustomerProductMaximumOrderQuantities
      : {};
  const rawPerProductVisibilityModes =
    config && typeof config.perProductVisibilityModes === "object"
      ? config.perProductVisibilityModes
      : {};
  const rawPerProductVisibilityCustomerIds =
    config && typeof config.perProductVisibilityCustomerIds === "object"
      ? config.perProductVisibilityCustomerIds
      : {};
  const rawCouponSegmentRules =
    config && typeof config.couponSegmentRules === "object"
      ? config.couponSegmentRules
      : {};
  /** @type {Record<string, boolean>} */
  const perProductAllowZeroFinalPriceB2C = {};
  /** @type {Record<string, boolean>} */
  const perProductAllowZeroFinalPriceB2B = {};
  /** @type {Record<string, number>} */
  const perProductB2BOverridePrices = {};
  /** @type {Record<string, "B2B_ONLY" | "B2C_ONLY" | "CUSTOMER_ONLY">} */
  const perProductVisibilityModes = {};
  /** @type {Record<string, string>} */
  const perProductVisibilityCustomerIds = {};
  /** @type {Record<string, "B2B" | "B2C" | "ALL">} */
  const couponSegmentRules = {};
  for (const [productId, allowZero] of Object.entries(
    rawPerProductAllowZeroFinalPriceB2C,
  )) {
    if (typeof allowZero === "boolean") {
      perProductAllowZeroFinalPriceB2C[productId] = allowZero;
    }
  }
  for (const [productId, allowZero] of Object.entries(
    rawPerProductAllowZeroFinalPriceB2B,
  )) {
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
  const perProductMinimumOrderQuantitiesB2C = normalizeMinimumOrderQuantityMap(
    /** @type {Record<string, unknown>} */ (rawPerProductMinimumOrderQuantitiesB2C),
  );
  const perProductMinimumOrderQuantitiesB2B = normalizeMinimumOrderQuantityMap(
    /** @type {Record<string, unknown>} */ (rawPerProductMinimumOrderQuantitiesB2B),
  );
  const perProductStepQuantitiesB2C = normalizeStepQuantityMap(
    /** @type {Record<string, unknown>} */ (rawPerProductStepQuantitiesB2C),
  );
  const perProductStepQuantitiesB2B = normalizeStepQuantityMap(
    /** @type {Record<string, unknown>} */ (rawPerProductStepQuantitiesB2B),
  );
  const perProductMaximumOrderQuantitiesB2C = normalizeMaximumOrderQuantityMap(
    /** @type {Record<string, unknown>} */ (rawPerProductMaximumOrderQuantitiesB2C),
  );
  const perProductMaximumOrderQuantitiesB2B = normalizeMaximumOrderQuantityMap(
    /** @type {Record<string, unknown>} */ (rawPerProductMaximumOrderQuantitiesB2B),
  );
  const perCollectionMaximumOrderQuantitiesB2C = normalizeMaximumOrderQuantityMap(
    /** @type {Record<string, unknown>} */ (rawPerCollectionMaximumOrderQuantitiesB2C),
  );
  const perCollectionMaximumOrderQuantitiesB2B = normalizeMaximumOrderQuantityMap(
    /** @type {Record<string, unknown>} */ (rawPerCollectionMaximumOrderQuantitiesB2B),
  );
  const perCustomerProductMaximumOrderQuantities =
    normalizePerCustomerProductMaximumOrderQuantities(
      /** @type {Record<string, unknown>} */ (rawPerCustomerProductMaximumOrderQuantities),
    );
  for (const [productId, visibilityMode] of Object.entries(
    rawPerProductVisibilityModes,
  )) {
    const normalizedVisibilityMode = normalizeVisibilityMode(visibilityMode);
    if (!normalizedVisibilityMode) {
      continue;
    }
    if (normalizedVisibilityMode === "CUSTOMER_ONLY") {
      const normalizedCustomerId = normalizeCustomerId(
        rawPerProductVisibilityCustomerIds[productId],
      );
      if (!normalizedCustomerId) {
        continue;
      }
    }
    perProductVisibilityModes[productId] = normalizedVisibilityMode;
  }
  for (const [productId, customerId] of Object.entries(
    rawPerProductVisibilityCustomerIds,
  )) {
    const normalizedCustomerId = normalizeCustomerId(customerId);
    if (!normalizedCustomerId) {
      continue;
    }
    perProductVisibilityCustomerIds[productId] = normalizedCustomerId;
  }
  for (const [rawCode, allowedSegment] of Object.entries(rawCouponSegmentRules)) {
    const normalizedCode = normalizeCouponCode(rawCode);
    if (!normalizedCode) {
      continue;
    }
    couponSegmentRules[normalizedCode] = normalizeAllowedSegment(allowedSegment);
  }

  return {
    b2bTag: typeof config.b2bTag === "string" ? config.b2bTag : "b2b",
    globalMinPricePercent: clampPercent(
      toNumber(config.globalMinPricePercent, DEFAULT_GLOBAL_FLOOR_PERCENT),
    ),
    b2bGlobalMinPricePercent: clampPercent(
      toNumber(config.b2bGlobalMinPricePercent, DEFAULT_B2B_FLOOR_PERCENT),
    ),
    allowZeroFinalPrice:
      typeof config.allowZeroFinalPrice === "boolean"
        ? config.allowZeroFinalPrice
        : DEFAULT_ALLOW_ZERO_FINAL_PRICE,
    allowStacking: config.allowStacking === true,
    maxCombinedPercentOff: normalizePercentOrNull(config.maxCombinedPercentOff),
    perProductFloorPercentsB2C,
    perProductFloorPercentsB2B,
    perProductAllowZeroFinalPriceB2C,
    perProductAllowZeroFinalPriceB2B,
    perProductB2BOverridePrices,
    perProductTierPricesB2C,
    perProductTierPricesB2B,
    perProductMinimumOrderQuantitiesB2C,
    perProductMinimumOrderQuantitiesB2B,
    perProductStepQuantitiesB2C,
    perProductStepQuantitiesB2B,
    perProductMaximumOrderQuantitiesB2C,
    perProductMaximumOrderQuantitiesB2B,
    perCollectionMaximumOrderQuantitiesB2C,
    perCollectionMaximumOrderQuantitiesB2B,
    perCustomerProductMaximumOrderQuantities,
    perProductVisibilityModes,
    perProductVisibilityCustomerIds,
    couponSegmentRules,
    couponCatalogRules: normalizeCouponCatalogRules(config.couponCatalogRules),
    discountCatalogCaps: normalizeDiscountCatalogCaps(config.discountCatalogCaps),
  };
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
 * @param {CartValidationsGenerateRunInput["cart"]["lines"][number]} line
 */
function resolveBaseUnitPrice(line) {
  const quantity = Math.max(1, toNumber(line?.quantity, 1));
  const subtotal = toNumber(line?.cost?.subtotalAmount?.amount, NaN);
  if (Number.isFinite(subtotal)) {
    return roundMoney(subtotal / quantity);
  }
  return roundMoney(toNumber(line?.cost?.amountPerQuantity?.amount, 0));
}

/**
 * @param {CartValidationsGenerateRunInput["cart"]["lines"][number]} line
 */
function resolveFinalUnitPrice(line) {
  const quantity = Math.max(1, toNumber(line?.quantity, 1));
  const total = toNumber(line?.cost?.totalAmount?.amount, NaN);
  if (Number.isFinite(total)) {
    return roundMoney(total / quantity);
  }
  return roundMoney(toNumber(line?.cost?.amountPerQuantity?.amount, 0));
}

/**
 * Rules are product-level, so MOQ/step must use aggregated quantity
 * across all lines that point to the same product.
 * @param {CartValidationsGenerateRunInput["cart"]["lines"]} lines
 */
function buildProductQuantityTotals(lines) {
  /** @type {Record<string, number>} */
  const totals = {};
  for (const line of lines ?? []) {
    const productId =
      line?.merchandise?.__typename === "ProductVariant"
        ? line.merchandise.product.id
        : null;
    if (!productId) {
      continue;
    }
    const quantity = Math.max(1, Math.floor(toNumber(line?.quantity, 1)));
    totals[productId] = (totals[productId] ?? 0) + quantity;
  }
  return totals;
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
 * core/catalog/catalog.resolver.ts). Highest-priority audience/company/market
 * match wins; falls back to the default catalog.
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
 * MVP_5_3 — resolve the effective pricing/quantity layer for this customer.
 * Catalog-format config → resolveCatalogId + merge(base, delta); legacy
 * B2C/B2B config → the existing isB2B branch (behavior-identical).
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
    const segment = entry && entry.segment === "B2B" ? "B2B" : catalogId === defaultId ? "B2C" : "B2C";
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
      moqMap: normalizeMinimumOrderQuantityMap(eff.perProductMinimumOrderQuantities || {}),
      stepMap: normalizeStepQuantityMap(eff.perProductStepQuantities || {}),
      maxMap: normalizeMaximumOrderQuantityMap(eff.perProductMaximumOrderQuantities || {}),
      collectionMaxMap: normalizeMaximumOrderQuantityMap(
        eff.perCollectionMaximumOrderQuantities || {},
      ),
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
    moqMap: isB2B
      ? parsedConfig.perProductMinimumOrderQuantitiesB2B
      : parsedConfig.perProductMinimumOrderQuantitiesB2C,
    stepMap: isB2B
      ? parsedConfig.perProductStepQuantitiesB2B
      : parsedConfig.perProductStepQuantitiesB2C,
    maxMap: isB2B
      ? parsedConfig.perProductMaximumOrderQuantitiesB2B
      : parsedConfig.perProductMaximumOrderQuantitiesB2C,
    collectionMaxMap: isB2B
      ? parsedConfig.perCollectionMaximumOrderQuantitiesB2B
      : parsedConfig.perCollectionMaximumOrderQuantitiesB2C,
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
 * @param {any} line
 */
function resolveLineCollectionIds(line) {
  const memberships =
    line?.merchandise?.__typename === "ProductVariant"
      ? line?.merchandise?.product?.inCollections ?? []
      : [];
  const ids = [];
  for (const membership of memberships) {
    if (membership?.isMember && membership?.collectionId) {
      ids.push(String(membership.collectionId));
    }
  }
  return ids;
}

/**
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  const rawConfig = input?.validation?.metafield?.jsonValue ?? {};
  const config = parseConfig(input);
  const messages = resolveMessages(input);
  const productQuantityTotals = buildProductQuantityTotals(input?.cart?.lines ?? []);
  const hasPurchasingCompany = resolveHasPurchasingCompany(input);
  const hasB2BTag = Boolean(input?.cart?.buyerIdentity?.customer?.hasAnyTag);
  const customerId = normalizeCustomerId(input?.cart?.buyerIdentity?.customer?.id);
  const matchedTags = [];
  if (hasB2BTag) {
    matchedTags.push(String(rawConfig?.b2bTag ?? config.b2bTag ?? "b2b"));
  }
  const customerTagFlags = input?.cart?.buyerIdentity?.customer?.hasTags;
  if (Array.isArray(customerTagFlags)) {
    for (const flag of customerTagFlags) {
      if (flag && flag.hasTag) matchedTags.push(String(flag.tag));
    }
  }
  const layer = resolveEffectiveLayer(rawConfig, config, {
    hasPurchasingCompany,
    hasB2BTag,
    matchedTags,
    marketContext: resolveMarketContext(input),
  });
  const isB2B = layer.isB2B;
  const segment = /** @type {"B2B" | "B2C"} */ (layer.segment);
  const rejectedCodeResult = resolveRejectedDiscountCodes(
    collectEnteredDiscountCodes(input),
    config.couponSegmentRules,
    config.couponCatalogRules,
    layer.catalogId,
    segment,
    config.allowStacking,
  );
  // MVP_5_3 #2.0d — the resolved catalog's cap overrides the shop-wide cap.
  const effectiveMaxCombinedPercentOff =
    config.discountCatalogCaps && config.discountCatalogCaps[layer.catalogId] != null
      ? config.discountCatalogCaps[layer.catalogId]
      : config.maxCombinedPercentOff;
  const floorPercent = layer.globalFloorPercent;
  const perProductFloorPercents = layer.floorMap;
  const perProductAllowZeroFinalPrice = layer.allowZeroMap;
  const perProductMinimumOrderQuantities = layer.moqMap;
  const perProductStepQuantities = layer.stepMap;
  const perProductMaximumOrderQuantities = layer.maxMap;
  const perCollectionMaximumOrderQuantities = layer.collectionMaxMap;
  const perCustomerProductMaximumOrderQuantities =
    customerId && config.perCustomerProductMaximumOrderQuantities[customerId]
      ? config.perCustomerProductMaximumOrderQuantities[customerId]
      : null;

  let hasVisibilityViolation = false;
  let hasCouponSegmentViolation = false;
  let hasCouponStackingViolation = false;
  let hasZeroFinalPriceViolation = false;
  let hasBelowFloorViolation = false;
  let hasCombinedDiscountCapViolation = false;
  let hasMinimumOrderQuantityViolation = false;
  let hasStepQuantityViolation = false;
  let hasMaximumOrderQuantityViolation = false;
  /** @type {Set<string>} */
  const visibilityViolationProducts = new Set();
  /** @type {Set<string>} */
  const minimumOrderQuantityViolationProducts = new Set();
  /** @type {Set<string>} */
  const stepViolationProducts = new Set();
  /** @type {Set<string>} */
  const maximumViolationProducts = new Set();
  /** @type {Set<string>} */
  const combinedCapViolationProducts = new Set();
  /** @type {Set<string>} */
  const zeroFinalPriceViolationProducts = new Set();
  /** @type {Set<string>} */
  const belowFloorViolationProducts = new Set();
  /** @type {Set<number>} */
  const stepViolationSteps = new Set();
  /** @type {Set<number>} */
  const maximumViolationMaximums = new Set();
  if (rejectedCodeResult.rejectedBySegment) {
    hasCouponSegmentViolation = true;
  }
  if (rejectedCodeResult.rejectedByStacking) {
    hasCouponStackingViolation = true;
  }
  for (const line of input?.cart?.lines ?? []) {
    const productId =
      line?.merchandise?.__typename === "ProductVariant"
        ? line.merchandise.product.id
        : null;
    const variantId =
      line?.merchandise?.__typename === "ProductVariant"
        ? line.merchandise.id ?? null
        : null;
    const productVisibilityMode =
      productId && config.perProductVisibilityModes[productId]
        ? config.perProductVisibilityModes[productId]
        : null;
    const productDisplayName = resolveProductDisplayName(line, messages);
    if (productVisibilityMode === "B2B_ONLY" && !isB2B) {
      hasVisibilityViolation = true;
      visibilityViolationProducts.add(productDisplayName);
      continue;
    }
    if (productVisibilityMode === "B2C_ONLY" && isB2B) {
      hasVisibilityViolation = true;
      visibilityViolationProducts.add(productDisplayName);
      continue;
    }
    if (productVisibilityMode === "CUSTOMER_ONLY") {
      const requiredCustomerId =
        productId && config.perProductVisibilityCustomerIds[productId]
          ? config.perProductVisibilityCustomerIds[productId]
          : "";
      if (!customerId || !requiredCustomerId || customerId !== requiredCustomerId) {
        hasVisibilityViolation = true;
        visibilityViolationProducts.add(productDisplayName);
        continue;
      }
    }
    const lineFloorPercent =
      variantId && layer.variantFloorMap[variantId] != null
        ? layer.variantFloorMap[variantId]
        : productId && perProductFloorPercents[productId] != null
          ? perProductFloorPercents[productId]
          : floorPercent;
    const lineAllowZeroFinalPrice =
      productId && perProductAllowZeroFinalPrice[productId] != null
        ? perProductAllowZeroFinalPrice[productId]
        : layer.allowZeroFinalPrice;
    const quantity = Math.max(1, toNumber(line?.quantity, 1));
    const productQuantity =
      productId && productQuantityTotals[productId] != null
        ? productQuantityTotals[productId]
        : quantity;
    const minimumOrderQuantity =
      productId && perProductMinimumOrderQuantities[productId] != null
        ? perProductMinimumOrderQuantities[productId]
        : 1;
    const stepQuantity =
      productId && perProductStepQuantities[productId] != null
        ? perProductStepQuantities[productId]
        : 1;
    const collectionMaximumOrderQuantity =
      line?.merchandise?.__typename === "ProductVariant"
        ? resolveCollectionMaximumOrderQuantity(
            line?.merchandise?.product?.inCollections,
            perCollectionMaximumOrderQuantities,
          )
        : null;
    const segmentMaximumOrderQuantity =
      productId && perProductMaximumOrderQuantities[productId] != null
        ? perProductMaximumOrderQuantities[productId]
        : collectionMaximumOrderQuantity;
    const customerMaximumOrderQuantity =
      productId &&
      perCustomerProductMaximumOrderQuantities &&
      perCustomerProductMaximumOrderQuantities[productId] != null
        ? perCustomerProductMaximumOrderQuantities[productId]
        : null;
    const maximumOrderQuantity =
      customerMaximumOrderQuantity != null
        ? customerMaximumOrderQuantity
        : segmentMaximumOrderQuantity;
    if (productQuantity < minimumOrderQuantity) {
      hasMinimumOrderQuantityViolation = true;
      minimumOrderQuantityViolationProducts.add(productDisplayName);
    }
    if (stepQuantity > 1 && productQuantity % stepQuantity !== 0) {
      hasStepQuantityViolation = true;
      stepViolationSteps.add(stepQuantity);
      stepViolationProducts.add(productDisplayName);
    }
    if (maximumOrderQuantity != null && productQuantity > maximumOrderQuantity) {
      hasMaximumOrderQuantityViolation = true;
      maximumViolationMaximums.add(maximumOrderQuantity);
      maximumViolationProducts.add(productDisplayName);
    }
    if (
      productQuantity < minimumOrderQuantity ||
      (stepQuantity > 1 && productQuantity % stepQuantity !== 0) ||
      (maximumOrderQuantity != null && productQuantity > maximumOrderQuantity)
    ) {
      continue;
    }
    const baseUnitPrice = resolveBaseUnitPrice(line);
    const finalUnitPrice = resolveFinalUnitPrice(line);
    // Catalog price-list precedence (FIXED override > per-product % > catalog %
    // > base), carried by the resolved catalog only. Tier overrides it below.
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
        : resolveTierUnitPrice(layer.tierMap, productId, quantity);
    const effectiveBaseUnitPrice =
      tierUnitPrice != null ? tierUnitPrice : baseUnitPriceWithOverride;
    const floorUnitPrice = roundMoney(
      effectiveBaseUnitPrice * (lineFloorPercent / 100),
    );
    if (effectiveMaxCombinedPercentOff != null && baseUnitPrice > 0) {
      const lineCombinedPercentOff = clampPercent(
        ((baseUnitPrice - finalUnitPrice) / baseUnitPrice) * 100,
      );
      if (lineCombinedPercentOff - effectiveMaxCombinedPercentOff > 0.0001) {
        hasCombinedDiscountCapViolation = true;
        combinedCapViolationProducts.add(productDisplayName);
        continue;
      }
    }

    if (finalUnitPrice <= 0 && !lineAllowZeroFinalPrice) {
      hasZeroFinalPriceViolation = true;
      zeroFinalPriceViolationProducts.add(productDisplayName);
      continue;
    }

    if (finalUnitPrice < floorUnitPrice) {
      hasBelowFloorViolation = true;
      belowFloorViolationProducts.add(productDisplayName);
    }
  }

  const errors = [];
  if (hasCouponSegmentViolation || hasCouponStackingViolation) {
    let couponMessage = messages.couponSegment;
    if (hasCouponSegmentViolation && hasCouponStackingViolation) {
      couponMessage = messages.couponSegmentAndStacking;
    } else if (hasCouponStackingViolation) {
      couponMessage = messages.couponStacking;
    }
    errors.push({
      message: couponMessage,
      target: "$.cart",
    });
  }
  if (hasCombinedDiscountCapViolation) {
    errors.push({
      message: buildViolationMessageWithProducts(
        messages.combinedCap,
        messages,
        Array.from(combinedCapViolationProducts),
      ),
      target: "$.cart",
    });
  }
  if (hasVisibilityViolation) {
    errors.push({
      message: buildViolationMessageWithProducts(
        messages.visibility,
        messages,
        Array.from(visibilityViolationProducts),
      ),
      target: "$.cart",
    });
  }
  if (hasMinimumOrderQuantityViolation) {
    errors.push({
      message: buildViolationMessageWithProducts(
        messages.minimumOrderQuantity,
        messages,
        Array.from(minimumOrderQuantityViolationProducts),
      ),
      target: "$.cart",
    });
  }
  if (hasStepQuantityViolation) {
    errors.push({
      message: buildViolationMessageWithProducts(
        buildStepQuantityViolationMessage(messages, Array.from(stepViolationSteps)),
        messages,
        Array.from(stepViolationProducts),
      ),
      target: "$.cart",
    });
  }
  if (hasMaximumOrderQuantityViolation) {
    errors.push({
      message: buildViolationMessageWithProducts(
        buildMaximumOrderQuantityViolationMessage(
          messages,
          Array.from(maximumViolationMaximums),
        ),
        messages,
        Array.from(maximumViolationProducts),
      ),
      target: "$.cart",
    });
  }
  if (hasBelowFloorViolation) {
    errors.push({
      message: buildViolationMessageWithProducts(
        messages.belowFloor,
        messages,
        Array.from(belowFloorViolationProducts),
      ),
      target: "$.cart",
    });
  }
  if (hasZeroFinalPriceViolation) {
    errors.push({
      message: buildViolationMessageWithProducts(
        messages.zeroFinal,
        messages,
        Array.from(zeroFinalPriceViolationProducts),
      ),
      target: "$.cart",
    });
  }

  if (errors.length === 0) {
    return { operations: [] };
  }

  const operations = [{ validationAdd: { errors } }];

  return { operations };
}
