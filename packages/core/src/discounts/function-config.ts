// Function-config size budget (doctrine C3, spec §2): the discount function has no
// DB and reads its rules from the discount-node metafield in one call, so the whole
// serialized config must fit in that metafield. 9000 B leaves ~10% headroom under
// Shopify's 10 kB app metafield ceiling for JSON overhead. The admin must refuse to
// save a config that would not fit (§13) — this module only measures, it does not
// enforce; the caller decides what to do with `fits: false`.

import type { WonDiscountsConfig } from "./config.ts";

export const FUNCTION_CONFIG_BUDGET_BYTES = 9000;

export interface EncodedFunctionConfig {
  json: string;
  bytes: number;
  fits: boolean;
}

/**
 * Serialize the config and measure it in UTF-8 bytes — not JS string length/UTF-16
 * code units, which would under-count anything outside ASCII (e.g. "Kč" is 2 UTF-16
 * code units but 3 UTF-8 bytes). Uses the platform TextEncoder rather than Node's
 * Buffer so this stays usable from the (framework-free) discount function runtime.
 */
export function encodeFunctionConfig(c: WonDiscountsConfig): EncodedFunctionConfig {
  const json = JSON.stringify(c);
  const bytes = new TextEncoder().encode(json).length;
  return { json, bytes, fits: bytes <= FUNCTION_CONFIG_BUDGET_BYTES };
}
