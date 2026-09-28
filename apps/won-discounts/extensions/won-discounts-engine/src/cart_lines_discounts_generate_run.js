// @ts-check

/**
 * @typedef {import("../generated/api").CartInput} RunInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 */

// MVP 1: the engine (@won/core planCart + emitForNode, via src/adapt.js). Every
// Won node plans the whole cart and emits only its own product and order
// candidates. Any error or missing/invalid config yields no operations and
// never throws: checkout is never blocked by this function (principle 4).

import { runCartLines } from "./adapt.js";

/**
 * @param {RunInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  return /** @type {CartLinesDiscountsGenerateRunResult} */ (runCartLines(input));
}
