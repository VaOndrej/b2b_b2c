// Discount codes travel to the function as short hashes, not as text (fix round
// 1, decision 3): a rule's code list can be long (influencer campaigns), and 11 B
// per code instead of up to 255 keeps it inside the 9 000 B shared-config budget.
// The engine hashes each ENTERED code the same way and matches by hash.
//
// FNV-1a, 32 bit, over the normalized code (trimmed, upper-cased — Shopify codes
// are case-insensitive), as 8 lowercase hex digits. Two different codes can share
// a hash; the admin refuses to save such a config (function-payload.ts
// findCodeHashCollisions). A shopper typing a foreign code that collides with a
// Won code is a ~n/2³² event per code; it would only make the engine think that
// Won code was entered, and that code's node still never runs without its real code.

import { normalizeCode } from "./cart.ts";

export function codeHash(code: string): string {
  return fnv1a32Hex(normalizeCode(code));
}

/** FNV-1a, 32 bit, over the UTF-16 units of `text`, as 8 lowercase hex digits. */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
