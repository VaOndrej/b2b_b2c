import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// SF-2: ALL storefront JS of the theme app extension (the app embed + the
// quantity-tiers block, MVP 3) stays within 10 kB gzipped in total — a product
// page with both loads both. Each file is served readable (no build step,
// nova-aplikace §8), so the budget is on real bytes, measured the way Shopify's
// "JS referenced by the schema, compressed" suggestion measures it.
//
// Theme Check's AssetSizeAppBlockJavaScript, which `shopify app dev` / deploy
// run with the 10 000 B default, compares the RAW file size of every file a
// block schema names in `javascript` (@shopify/theme-check-common
// doesFileExceedThreshold → context.fileSize), not the gzipped size — so each
// file also stays ≤ 10 000 B raw, or Shopify's own tooling reports an error
// that `npm run validate:shopify` would not (the Won Toasts lesson, see its
// .theme-check.yml).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "../../extensions/won-discounts-storefront/assets");
const STOREFRONT_JS = ["won-discounts.js", "won-discounts-tiers.js"];
const GZIP_BUDGET_BYTES = 10 * 1024; // 10240 B ceiling (SF-2), all files together
const RAW_THEME_CHECK_BYTES = 10_000; // AssetSizeAppBlockJavaScript default, per file

test("storefront JS (embed + tiers block) stays within the SF-2 gzip budget together", () => {
  const sizes = STOREFRONT_JS.map((file) => ({ file, gz: gzipSync(readFileSync(path.join(ASSETS, file))).length }));
  const total = sizes.reduce((sum, { gz }) => sum + gz, 0);
  assert.ok(
    total <= GZIP_BUDGET_BYTES,
    `storefront JS is ${total} B gzipped (${sizes.map(({ file, gz }) => `${file} ${gz} B`).join(", ")}), over the ${GZIP_BUDGET_BYTES} B budget.`,
  );
});

test("each storefront JS file stays under Theme Check's raw AssetSizeAppBlockJavaScript threshold", () => {
  for (const file of STOREFRONT_JS) {
    const raw = readFileSync(path.join(ASSETS, file)).length;
    assert.ok(raw <= RAW_THEME_CHECK_BYTES, `${file} is ${raw} B raw, over Theme Check's ${RAW_THEME_CHECK_BYTES} B default.`);
  }
});
