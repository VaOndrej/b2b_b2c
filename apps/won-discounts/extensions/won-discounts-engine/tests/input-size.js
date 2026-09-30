// The size Shopify's function limits count: MessagePack bytes, not JSON.
//
// Shopify hands a function its input as MessagePack and its resource limits
// (128 kB of input for up to 200 cart lines, scaled with the lines above that;
// shopify.dev/docs/api/functions/2026-04 "Resource limits", 1 kB = 1000 B) count
// those bytes: every one of the dev store's 802 logged runs
// (apps/won-discounts/.shopify/logs, `payload.inputBytes` and `outputBytes`) is
// exactly `messagePackBytes` of its `input` and `output` — about 80–99 % of the
// compact JSON. The encoding is rmp's compact one: an integer in its smallest
// form, any other number as a 64-bit float, strings and containers with the
// smallest length header.

const UTF8 = new TextEncoder();

/**
 * MessagePack bytes of a JSON value.
 * @param {unknown} value
 * @returns {number}
 */
export function messagePackBytes(value) {
  if (value === null || typeof value === "boolean") return 1;
  if (typeof value === "number") {
    if (Number.isInteger(value) && Math.abs(value) < 2 ** 63) {
      if ((value >= 0 && value < 128) || (value < 0 && value >= -32)) return 1;
      const magnitude = value < 0 ? -value - 1 : value;
      if (magnitude < 2 ** 8) return 2;
      if (magnitude < 2 ** 16) return 3;
      if (magnitude < 2 ** 32) return 5;
      return 9;
    }
    return 9;
  }
  if (typeof value === "string") {
    const n = UTF8.encode(value).length;
    return n + (n < 32 ? 1 : n < 256 ? 2 : n < 65536 ? 3 : 5);
  }
  if (Array.isArray(value)) {
    const n = value.length;
    return (n < 16 ? 1 : n < 65536 ? 3 : 5) + value.reduce((sum, item) => sum + messagePackBytes(item), 0);
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(record);
  const n = keys.length;
  return (n < 16 ? 1 : n < 65536 ? 3 : 5) + keys.reduce((sum, key) => sum + messagePackBytes(key) + messagePackBytes(record[key]), 0);
}

/** Shopify's input limit for carts up to 200 lines, MessagePack bytes (1 kB = 1000 B). */
export const INPUT_LIMIT_BYTES = 128_000;

/** The input limit of a cart of `lines` lines: scaled with the lines above 200. */
export const inputLimit = (/** @type {number} */ lines) => Math.floor((INPUT_LIMIT_BYTES * Math.max(200, lines)) / 200);
