// MVP7 — "Preview on my store" signed token. The admin issues a short-lived
// HMAC over (type, expiry); the app proxy verifies it server-side before the
// embed fires a SYNTHETIC toast. The secret never reaches the storefront, so
// the token can't be forged. Node builtins only (server-side + tests).

import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 over `${type}.${expMs}`, hex-encoded. */
export function signTestToken(
  type: string,
  expMs: number,
  secret: string,
): string {
  return createHmac("sha256", secret).update(`${type}.${expMs}`).digest("hex");
}

/** Verify a test token: signature must match AND not be past its expiry. */
export function verifyTestToken(opts: {
  type: string;
  expMs: number;
  sig: string;
  secret: string;
  nowMs: number;
}): boolean {
  if (!Number.isFinite(opts.expMs) || opts.nowMs > opts.expMs) return false;
  const expected = signTestToken(opts.type, opts.expMs, opts.secret);
  if (expected.length !== opts.sig.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(opts.sig, "hex"),
    );
  } catch {
    return false;
  }
}
