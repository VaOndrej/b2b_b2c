// @ts-check

/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

// MVP 0 prototype, not the engine. `function_config.prototype.mode` picks one
// behaviour used to verify platform risks C1–C4 on a dev store:
//   echo_codes        1 % on the first line, message echoes the codes (C1/C2)
//   percent_all       `percent` % on every line (C3: metafield size budget)
//   campaign_window   `percent` % (default 10) only while shop.localTime.campaignActive (C4)
//   product_metafield per line: `$app:won_discounts.product` jsonValue.percent (C3)
// Missing or corrupt config yields no operations and never throws (spec §9):
// checkout must never be blocked by this function.

/** Shopify does not document a hard cap; keep messages short. */
const MAX_MESSAGE_LENGTH = 100;
const CAMPAIGN_DEFAULT_PERCENT = 10;
const ECHO_PERCENT = 1;

/** @type {CartLinesDiscountsGenerateRunResult} */
const NO_OPERATIONS = { operations: [] };

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A usable percentage is a finite number in (0, 100]; anything else is corrupt.
 * @param {unknown} value
 * @returns {number | null}
 */
function readPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0 || value > 100) return null;
  return value;
}

/**
 * @param {string} message
 */
function shortMessage(message) {
  return message.length > MAX_MESSAGE_LENGTH ? message.slice(0, MAX_MESSAGE_LENGTH) : message;
}

/**
 * @param {number} percent
 */
function percentMessage(percent) {
  return `WON ${percent}%`;
}

/**
 * One candidate that targets the given lines with one percentage.
 * @param {string} message
 * @param {string[]} lineIds
 * @param {number} percent
 */
function candidate(message, lineIds, percent) {
  return {
    message: shortMessage(message),
    targets: lineIds.map((id) => ({ cartLine: { id } })),
    value: { percentage: { value: percent } },
  };
}

/**
 * @param {ReturnType<typeof candidate>[]} candidates
 * @param {"FIRST" | "ALL"} selectionStrategy
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
function productDiscounts(candidates, selectionStrategy) {
  if (candidates.length === 0) return NO_OPERATIONS;
  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates,
          selectionStrategy: /** @type {any} */ (selectionStrategy),
        },
      },
    ],
  };
}

/**
 * @param {RunInput} input
 * @param {Record<string, unknown>} prototype
 * @param {{ id: string }[]} lines
 */
function echoCodes(input, prototype, lines) {
  const triggering = input.triggeringDiscountCode;
  if (typeof triggering !== "string" || triggering === "") return NO_OPERATIONS;
  const entered = (Array.isArray(input.enteredDiscountCodes) ? input.enteredDiscountCodes : [])
    .map((entry) => (entry && typeof entry.code === "string" ? entry.code : ""))
    .filter((code) => code !== "")
    .sort();
  const message = `WON:${triggering}|${entered.join(",")}`;
  return productDiscounts([candidate(message, [lines[0].id], ECHO_PERCENT)], "FIRST");
}

/**
 * @param {RunInput} input
 * @param {Record<string, unknown>} prototype
 * @param {{ id: string }[]} lines
 */
function percentAll(input, prototype, lines) {
  const percent = readPercent(prototype.percent);
  if (percent === null) return NO_OPERATIONS;
  return productDiscounts(
    [candidate(percentMessage(percent), lines.map((line) => line.id), percent)],
    "FIRST",
  );
}

/**
 * @param {RunInput} input
 * @param {Record<string, unknown>} prototype
 * @param {{ id: string }[]} lines
 */
function campaignWindow(input, prototype, lines) {
  const localTime = input.shop?.localTime;
  if (localTime?.campaignActive !== true) return NO_OPERATIONS;
  const percent =
    prototype.percent === undefined ? CAMPAIGN_DEFAULT_PERCENT : readPercent(prototype.percent);
  if (percent === null) return NO_OPERATIONS;
  const message = `WON:CAMPAIGN|${typeof localTime.date === "string" ? localTime.date : ""}`;
  return productDiscounts([candidate(message, lines.map((line) => line.id), percent)], "FIRST");
}

/**
 * @param {RunInput} input
 * @param {Record<string, unknown>} prototype
 * @param {any[]} lines
 */
function productMetafield(input, prototype, lines) {
  const candidates = [];
  for (const line of lines) {
    const merchandise = line.merchandise;
    if (!merchandise || merchandise.__typename !== "ProductVariant") continue;
    const config = merchandise.product?.wonProduct?.jsonValue;
    if (!isPlainObject(config)) continue;
    const percent = readPercent(config.percent);
    if (percent === null) continue;
    candidates.push(candidate(percentMessage(percent), [line.id], percent));
  }
  // Each candidate targets a different line, so all of them must apply.
  return productDiscounts(candidates, "ALL");
}

/** @type {Record<string, (input: RunInput, prototype: Record<string, unknown>, lines: any[]) => CartLinesDiscountsGenerateRunResult>} */
const MODES = {
  echo_codes: echoCodes,
  percent_all: percentAll,
  campaign_window: campaignWindow,
  product_metafield: productMetafield,
};

/**
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
function run(input) {
  const classes = input.discount?.discountClasses;
  if (!Array.isArray(classes) || !classes.includes(/** @type {any} */ ("PRODUCT"))) {
    return NO_OPERATIONS;
  }

  const lines = Array.isArray(input.cart?.lines)
    ? input.cart.lines.filter((line) => line && typeof line.id === "string")
    : [];
  if (lines.length === 0) return NO_OPERATIONS;

  const config = input.discount.metafield?.jsonValue;
  if (!isPlainObject(config)) return NO_OPERATIONS;
  const prototype = config.prototype;
  if (!isPlainObject(prototype) || typeof prototype.mode !== "string") return NO_OPERATIONS;

  const mode = Object.prototype.hasOwnProperty.call(MODES, prototype.mode)
    ? MODES[prototype.mode]
    : null;
  if (!mode) return NO_OPERATIONS;
  return mode(input, prototype, lines);
}

/**
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  try {
    return run(input);
  } catch {
    return NO_OPERATIONS;
  }
}
