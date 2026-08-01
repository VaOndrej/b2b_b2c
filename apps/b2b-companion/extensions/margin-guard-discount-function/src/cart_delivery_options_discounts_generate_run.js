/**
 * @typedef {import("../generated/api").DeliveryInput} RunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsDiscountsGenerateRunResult} CartDeliveryOptionsDiscountsGenerateRunResult
 */

/**
 * Margin Guard MVP_1 only enforces product-line discounts.
 * Shipping discounts stay disabled in this function.
 *
 * @param {RunInput} _input
 * @returns {CartDeliveryOptionsDiscountsGenerateRunResult}
 */
export function cartDeliveryOptionsDiscountsGenerateRun(_input) {
  return { operations: [] };
}
