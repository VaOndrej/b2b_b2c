import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// MVP14 release gate: the storefront asset must stay within the Built-for-Shopify
// performance budget. What ships over the wire is gzipped, so we assert the
// GZIP size (not raw bytes). This is the authoritative perf check; the
// theme-check raw-byte rule is a coarser proxy.
//
// Budget note: the spec target is "~15 kB gz". The shipped asset is now the
// esbuild-MINIFIED build of storefront-src/won-toasts.js (see build-storefront.mjs
// and the storefront-build drift contract). The full MVP6–14 feature set lands
// at ~9.5 kB gz minified — comfortably under target. The ceiling here is 11 kB:
// a REGRESSION guard with real headroom, not a hard line. When a feature would
// push past it, the lever is trimming logic, not raising this number.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET = path.join(
  HERE,
  "../../extensions/won-toasts-storefront/assets/won-toasts.js",
);
const GZIP_BUDGET_BYTES = 11 * 1024; // minified ~9.5 kB + regression headroom

test("storefront JS stays within the storefront gzip performance budget", () => {
  const raw = readFileSync(ASSET);
  const gz = gzipSync(raw).length;
  assert.ok(
    gz <= GZIP_BUDGET_BYTES,
    `won-toasts.js is ${gz} B gzipped, over the ${GZIP_BUDGET_BYTES} B budget. ` +
      `The asset is already minified — trim storefront logic rather than raising the budget.`,
  );
});
