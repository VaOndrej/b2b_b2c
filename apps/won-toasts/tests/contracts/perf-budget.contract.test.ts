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
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET = path.join(
  HERE,
  "../../extensions/won-toasts-storefront/assets/won-toasts.js",
);
const GZIP_BUDGET_BYTES = 15 * 1024; // ~15 kB gz

test("storefront JS stays within the ~15 kB gzip performance budget", () => {
  const raw = readFileSync(ASSET);
  const gz = gzipSync(raw).length;
  assert.ok(
    gz <= GZIP_BUDGET_BYTES,
    `won-toasts.js is ${gz} B gzipped, over the ${GZIP_BUDGET_BYTES} B budget. ` +
      `Trim, lazy-load, or minify before shipping more storefront weight.`,
  );
});
