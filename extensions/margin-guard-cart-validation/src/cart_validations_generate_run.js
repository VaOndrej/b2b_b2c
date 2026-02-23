// @ts-check

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

const DEFAULT_GLOBAL_FLOOR_PERCENT = 70;
const DEFAULT_B2B_FLOOR_PERCENT = 70;
const DEFAULT_ALLOW_ZERO_FINAL_PRICE = false;

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
  /** @type {Record<string, boolean>} */
  const perProductAllowZeroFinalPriceB2C = {};
  /** @type {Record<string, boolean>} */
  const perProductAllowZeroFinalPriceB2B = {};
  /** @type {Record<string, number>} */
  const perProductB2BOverridePrices = {};
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
    perProductFloorPercentsB2C,
    perProductFloorPercentsB2B,
    perProductAllowZeroFinalPriceB2C,
    perProductAllowZeroFinalPriceB2B,
    perProductB2BOverridePrices,
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
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  const config = parseConfig(input);
  const hasPurchasingCompany = Boolean(
    input?.cart?.buyerIdentity?.purchasingCompany?.company?.id,
  );
  const hasB2BTag = Boolean(input?.cart?.buyerIdentity?.customer?.hasAnyTag);
  const isB2B = hasPurchasingCompany || hasB2BTag;
  const floorPercent = isB2B
    ? config.b2bGlobalMinPricePercent
    : config.globalMinPricePercent;

  let hasZeroFinalPriceViolation = false;
  let hasBelowFloorViolation = false;
  for (const line of input?.cart?.lines ?? []) {
    const productId =
      line?.merchandise?.__typename === "ProductVariant"
        ? line.merchandise.product.id
        : null;
    const perProductFloorPercents = isB2B
      ? config.perProductFloorPercentsB2B
      : config.perProductFloorPercentsB2C;
    const perProductAllowZeroFinalPrice = isB2B
      ? config.perProductAllowZeroFinalPriceB2B
      : config.perProductAllowZeroFinalPriceB2C;
    const lineFloorPercent =
      productId && perProductFloorPercents[productId] != null
        ? perProductFloorPercents[productId]
        : floorPercent;
    const lineAllowZeroFinalPrice =
      productId && perProductAllowZeroFinalPrice[productId] != null
        ? perProductAllowZeroFinalPrice[productId]
        : config.allowZeroFinalPrice;
    const baseUnitPrice = resolveBaseUnitPrice(line);
    const finalUnitPrice = resolveFinalUnitPrice(line);
    const b2bOverrideBaseUnitPrice =
      isB2B && productId && config.perProductB2BOverridePrices[productId] != null
        ? config.perProductB2BOverridePrices[productId]
        : null;
    const effectiveBaseUnitPrice =
      b2bOverrideBaseUnitPrice != null ? b2bOverrideBaseUnitPrice : baseUnitPrice;
    const floorUnitPrice = roundMoney(
      effectiveBaseUnitPrice * (lineFloorPercent / 100),
    );

    if (finalUnitPrice <= 0 && !lineAllowZeroFinalPrice) {
      hasZeroFinalPriceViolation = true;
      continue;
    }

    if (finalUnitPrice < floorUnitPrice) {
      hasBelowFloorViolation = true;
    }
  }

  const errors = [];
  if (hasBelowFloorViolation) {
    errors.push({
      message:
        "Some discounts can't be applied because at least one item would fall below the minimum allowed price. Review your cart and try again.",
      target: "$.cart",
    });
  }
  if (hasZeroFinalPriceViolation) {
    errors.push({
      message:
        "Some discounts can't be applied because a free line item is not allowed for this checkout.",
      target: "$.cart",
    });
  }

  if (errors.length === 0) {
    return { operations: [] };
  }

  const operations = [{ validationAdd: { errors } }];

  return { operations };
}
