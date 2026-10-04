import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// SF-2 (Ondřej 2026-10-04): the storefront JS of the theme app extension stays within 10 kB gzipped PER PAGE
// TYPE — what a shopper's browser loads on one page — not all files together (Shopify's suggestion is 10 KB of
// compressed JS per extension surface). Which file loads where (blocks/*.liquid):
//   every page          won-discounts.js (the embed) + won-discounts-cart.js (the embed loads it when the shop
//                       has cart rewards: the cart drawer lives on every page)
//   product page        + won-discounts-tiers.js + won-discounts-tiers-core.js (the quantity tiers block)
//   collection / search + won-discounts-cards.js (MVP 7 BETA: prices by quantity on product cards, themes whose
//                       card takes no app block)
// Each file is served readable (no build step, nova-aplikace §8), so the budget is on real bytes.
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
const EVERY_PAGE = ["won-discounts.js", "won-discounts-cart.js"];
const PAGES: Record<string, string[]> = {
  "product page": [...EVERY_PAGE, "won-discounts-tiers.js", "won-discounts-tiers-core.js"],
  "cart page": [...EVERY_PAGE],
  "collection / search": [...EVERY_PAGE, "won-discounts-cards.js"],
};
const GZIP_BUDGET_BYTES = 10 * 1024; // 10240 B ceiling (SF-2), per page type
const RAW_THEME_CHECK_BYTES = 10_000; // AssetSizeAppBlockJavaScript default, per file
const present = (file: string) => existsSync(path.join(ASSETS, file));

for (const [page, files] of Object.entries(PAGES)) {
  test(`storefront JS on a ${page} stays within the SF-2 gzip budget`, () => {
    const sizes = files.filter(present).map((file) => ({ file, gz: gzipSync(readFileSync(path.join(ASSETS, file))).length }));
    const total = sizes.reduce((sum, { gz }) => sum + gz, 0);
    assert.ok(total <= GZIP_BUDGET_BYTES, `${page}: ${total} B gzipped (${sizes.map(({ file, gz }) => `${file} ${gz} B`).join(", ")}), over the ${GZIP_BUDGET_BYTES} B budget.`);
  });
}

test("every JS file of the extension belongs to a page type above and stays under Theme Check's raw AssetSizeAppBlockJavaScript threshold", () => {
  const all = readdirSync(ASSETS).filter((file) => file.endsWith(".js"));
  const known = new Set(Object.values(PAGES).flat());
  assert.deepEqual(all.filter((file) => !known.has(file)), [], "a new script must be put on its page type(s) in PAGES");
  for (const file of all) {
    const raw = readFileSync(path.join(ASSETS, file)).length;
    assert.ok(raw <= RAW_THEME_CHECK_BYTES, `${file} is ${raw} B raw, over Theme Check's ${RAW_THEME_CHECK_BYTES} B default.`);
  }
});
