// @ts-check

/**
 * @typedef {import("../generated/api").DeliveryInput} RunInput
 * @typedef {import("../generated/api").CartDeliveryOptionsDiscountsGenerateRunResult} CartDeliveryOptionsDiscountsGenerateRunResult
 */

// MVP 1: the same plan as the lines target (src/adapt.js); the node emits its
// shipping winner (free shipping rules) on every delivery group. Never throws.

import { runDelivery } from "./adapt.js";

/**
 * @param {RunInput} input
 * @returns {CartDeliveryOptionsDiscountsGenerateRunResult}
 */
export function cartDeliveryOptionsDiscountsGenerateRun(input) {
  return /** @type {CartDeliveryOptionsDiscountsGenerateRunResult} */ (runDelivery(input));
}
