/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

const DEFAULT_GLOBAL_FLOOR_PERCENT = 70;

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

  /** @type {Record<string, number>} */
  const perProductFloorPercentsB2C = {};
  /** @type {Record<string, number>} */
  const perProductFloorPercentsB2B = {};
  /** @type {Record<string, boolean>} */
  const perProductAllowZeroFinalPriceB2C = {};
  /** @type {Record<string, boolean>} */
  const perProductAllowZeroFinalPriceB2B = {};

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
    requestedPercentOff: clampPercent(toNumber(config.requestedPercentOff, 100)),
    perProductFloorPercentsB2C,
    perProductFloorPercentsB2B,
    perProductAllowZeroFinalPriceB2C,
    perProductAllowZeroFinalPriceB2B,
  };
}

/**
 * @param {number} requestedPercentOff
 * @param {number} floorPercent
 * @param {boolean} allowZeroFinalPrice
 */
function resolveAllowedPercent(requestedPercentOff, floorPercent, allowZeroFinalPrice) {
  const maxByFloor = clampPercent(100 - floorPercent);
  const maxByZeroPolicy = allowZeroFinalPrice ? 100 : 99.99;
  return clampPercent(Math.min(requestedPercentOff, maxByFloor, maxByZeroPolicy));
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
  const isB2B = Boolean(input?.cart?.buyerIdentity?.customer?.hasAnyTag);
  const globalFloorPercent = isB2B
    ? config.b2bGlobalMinPricePercent
    : config.globalMinPricePercent;
  const floorMap = isB2B
    ? config.perProductFloorPercentsB2B
    : config.perProductFloorPercentsB2C;
  const allowZeroMap = isB2B
    ? config.perProductAllowZeroFinalPriceB2B
    : config.perProductAllowZeroFinalPriceB2C;

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
    const allowedPercentOff = resolveAllowedPercent(
      config.requestedPercentOff,
      floorPercent,
      allowZeroFinalPrice,
    );
    if (allowedPercentOff <= 0) {
      continue;
    }

    candidates.push({
      message: `Margin Guard discount (${allowedPercentOff.toFixed(2)}% max)`,
      targets: [{ cartLine: { id: line.id } }],
      value: {
        percentage: {
          value: allowedPercentOff,
        },
      },
    });
  }

  if (candidates.length === 0) {
    return { operations: [] };
  }

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: "ALL",
        },
      },
    ],
  };
}
