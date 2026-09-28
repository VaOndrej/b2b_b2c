// @ts-check

/**
 * @typedef {import("../generated/api").DeliveryInput} RunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsDiscountsGenerateRunResult} CartDeliveryOptionsDiscountsGenerateRunResult
 */

// MVP 0: the delivery target is registered so the function can carry shipping
// discounts later; it emits no operations yet and never throws.

/**
 * Receives the DeliveryInput (RunInput) but does not read it yet.
 * @returns {CartDeliveryOptionsDiscountsGenerateRunResult}
 */
export function cartDeliveryOptionsDiscountsGenerateRun() {
  return { operations: [] };
}
