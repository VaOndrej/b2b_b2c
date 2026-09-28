import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// SF-2 (task-4-brief.md): the MVP0 storefront foundation must stay small.
// Budget: <= 10 kB gzipped. It only sets window.WonDiscounts and reads the
// config script tag defensively, so this ceiling is generous.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSET = path.join(
  HERE,
  "../../extensions/won-discounts-storefront/assets/won-discounts.js",
);
const GZIP_BUDGET_BYTES = 10 * 1024; // 10240 B ceiling (SF-2)

test("storefront JS stays within the MVP0 gzip performance budget", () => {
  const raw = readFileSync(ASSET);
  const gz = gzipSync(raw).length;
  assert.ok(
    gz <= GZIP_BUDGET_BYTES,
    `won-discounts.js is ${gz} B gzipped, over the ${GZIP_BUDGET_BYTES} B budget.`,
  );
});
