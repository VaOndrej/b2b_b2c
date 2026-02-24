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
    minimumOrderQuantity:
      "At least one line is below the minimum order quantity for this customer segment. Next step: increase quantity to meet the minimum.",
    stepQuantity:
      "At least one line quantity does not match the required packaging multiple. Next step: adjust quantity to the required step.",
    stepQuantitySinglePrefix: "This item must be purchased in steps of ",
    stepQuantitySingleSuffix: ".",
    stepQuantityMultiPrefix: "Items in your cart must follow step multiples: ",
    stepQuantityMultiSuffix: ".",
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
    minimumOrderQuantity:
      "Alespon jedna polozka je pod minimalnim objednacim mnozstvim pro vas segment. Dalsi krok: navyste mnozstvi na pozadovane minimum.",
    stepQuantity:
      "Alespon jedna polozka nema pozadovany kartonovy nasobek. Dalsi krok: upravte mnozstvi na pozadovany krok.",
    stepQuantitySinglePrefix: "Tato polozka se nakupuje v krocich po ",
    stepQuantitySingleSuffix: ".",
    stepQuantityMultiPrefix: "Polozky v kosiku maji tyto kroky nasobku: ",
    stepQuantityMultiSuffix: ".",
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
  const rawPerProductVisibilityModes =
    config && typeof config.perProductVisibilityModes === "object"
      ? config.perProductVisibilityModes
      : {};
  const rawPerProductVisibilityCustomerIds =
    config && typeof config.perProductVisibilityCustomerIds === "object"
      ? config.perProductVisibilityCustomerIds
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
    perProductVisibilityModes,
    perProductVisibilityCustomerIds,
  };
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
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  const config = parseConfig(input);
  const messages = resolveMessages(input);
  const productQuantityTotals = buildProductQuantityTotals(input?.cart?.lines ?? []);
  const hasPurchasingCompany = Boolean(
    input?.cart?.buyerIdentity?.purchasingCompany?.company?.id,
  );
  const hasB2BTag = Boolean(input?.cart?.buyerIdentity?.customer?.hasAnyTag);
  const customerId = normalizeCustomerId(input?.cart?.buyerIdentity?.customer?.id);
  const isB2B = hasPurchasingCompany || hasB2BTag;
  const floorPercent = isB2B
    ? config.b2bGlobalMinPricePercent
    : config.globalMinPricePercent;

  let hasVisibilityViolation = false;
  let hasZeroFinalPriceViolation = false;
  let hasBelowFloorViolation = false;
  let hasCombinedDiscountCapViolation = false;
  let hasMinimumOrderQuantityViolation = false;
  let hasStepQuantityViolation = false;
  /** @type {Set<number>} */
  const stepViolationSteps = new Set();
  for (const line of input?.cart?.lines ?? []) {
    const productId =
      line?.merchandise?.__typename === "ProductVariant"
        ? line.merchandise.product.id
        : null;
    const productVisibilityMode =
      productId && config.perProductVisibilityModes[productId]
        ? config.perProductVisibilityModes[productId]
        : null;
    if (productVisibilityMode === "B2B_ONLY" && !isB2B) {
      hasVisibilityViolation = true;
      continue;
    }
    if (productVisibilityMode === "B2C_ONLY" && isB2B) {
      hasVisibilityViolation = true;
      continue;
    }
    if (productVisibilityMode === "CUSTOMER_ONLY") {
      const requiredCustomerId =
        productId && config.perProductVisibilityCustomerIds[productId]
          ? config.perProductVisibilityCustomerIds[productId]
          : "";
      if (!customerId || !requiredCustomerId || customerId !== requiredCustomerId) {
        hasVisibilityViolation = true;
        continue;
      }
    }
    const perProductFloorPercents = isB2B
      ? config.perProductFloorPercentsB2B
      : config.perProductFloorPercentsB2C;
    const perProductAllowZeroFinalPrice = isB2B
      ? config.perProductAllowZeroFinalPriceB2B
      : config.perProductAllowZeroFinalPriceB2C;
    const perProductMinimumOrderQuantities = isB2B
      ? config.perProductMinimumOrderQuantitiesB2B
      : config.perProductMinimumOrderQuantitiesB2C;
    const perProductStepQuantities = isB2B
      ? config.perProductStepQuantitiesB2B
      : config.perProductStepQuantitiesB2C;
    const lineFloorPercent =
      productId && perProductFloorPercents[productId] != null
        ? perProductFloorPercents[productId]
        : floorPercent;
    const lineAllowZeroFinalPrice =
      productId && perProductAllowZeroFinalPrice[productId] != null
        ? perProductAllowZeroFinalPrice[productId]
        : config.allowZeroFinalPrice;
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
    if (productQuantity < minimumOrderQuantity) {
      hasMinimumOrderQuantityViolation = true;
    }
    if (stepQuantity > 1 && productQuantity % stepQuantity !== 0) {
      hasStepQuantityViolation = true;
      stepViolationSteps.add(stepQuantity);
    }
    if (
      productQuantity < minimumOrderQuantity ||
      (stepQuantity > 1 && productQuantity % stepQuantity !== 0)
    ) {
      continue;
    }
    const baseUnitPrice = resolveBaseUnitPrice(line);
    const finalUnitPrice = resolveFinalUnitPrice(line);
    const b2bOverrideBaseUnitPrice =
      isB2B && productId && config.perProductB2BOverridePrices[productId] != null
        ? config.perProductB2BOverridePrices[productId]
        : null;
    const baseUnitPriceWithOverride =
      b2bOverrideBaseUnitPrice != null ? b2bOverrideBaseUnitPrice : baseUnitPrice;
    const tierMap = isB2B
      ? config.perProductTierPricesB2B
      : config.perProductTierPricesB2C;
    const tierUnitPrice = resolveTierUnitPrice(tierMap, productId, quantity);
    const effectiveBaseUnitPrice =
      tierUnitPrice != null ? tierUnitPrice : baseUnitPriceWithOverride;
    const floorUnitPrice = roundMoney(
      effectiveBaseUnitPrice * (lineFloorPercent / 100),
    );
    if (config.maxCombinedPercentOff != null && baseUnitPrice > 0) {
      const lineCombinedPercentOff = clampPercent(
        ((baseUnitPrice - finalUnitPrice) / baseUnitPrice) * 100,
      );
      if (lineCombinedPercentOff - config.maxCombinedPercentOff > 0.0001) {
        hasCombinedDiscountCapViolation = true;
        continue;
      }
    }

    if (finalUnitPrice <= 0 && !lineAllowZeroFinalPrice) {
      hasZeroFinalPriceViolation = true;
      continue;
    }

    if (finalUnitPrice < floorUnitPrice) {
      hasBelowFloorViolation = true;
    }
  }

  const errors = [];
  if (hasCombinedDiscountCapViolation) {
    errors.push({
      message: messages.combinedCap,
      target: "$.cart",
    });
  }
  if (hasVisibilityViolation) {
    errors.push({
      message: messages.visibility,
      target: "$.cart",
    });
  }
  if (hasMinimumOrderQuantityViolation) {
    errors.push({
      message: messages.minimumOrderQuantity,
      target: "$.cart",
    });
  }
  if (hasStepQuantityViolation) {
    errors.push({
      message: buildStepQuantityViolationMessage(messages, Array.from(stepViolationSteps)),
      target: "$.cart",
    });
  }
  if (hasBelowFloorViolation) {
    errors.push({
      message: messages.belowFloor,
      target: "$.cart",
    });
  }
  if (hasZeroFinalPriceViolation) {
    errors.push({
      message: messages.zeroFinal,
      target: "$.cart",
    });
  }

  if (errors.length === 0) {
    return { operations: [] };
  }

  const operations = [{ validationAdd: { errors } }];

  return { operations };
}
