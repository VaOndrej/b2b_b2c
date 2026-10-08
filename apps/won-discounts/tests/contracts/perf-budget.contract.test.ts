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
/**
 * Feedback 2 (2026-10-06, body 5 a 7): scripts NO page loads by default — only where the merchant adds the block
 * ("Milestones", "Campaign banner") or switches the embed's top bar on. They are outside the per-page
 * budget above on purpose (a default install stays within it) and have a ceiling of their own; a page that uses
 * them goes over SF-2 by that much (the product page: 10 226 B + this file), which docs/won-discounts/bfs-check.md says.
 */
const OPT_IN: Record<string, number> = { "won-discounts-blocks.js": 2048 };
const GZIP_BUDGET_BYTES = 10 * 1024; // 10240 B ceiling (SF-2), per page type
/**
 * Feedback 3 (Ondřej 2026-10-06, bod 4 + rozhodnutí 8): the product page's ceiling is 12 kB. The quantity table
 * now follows the cart without a page load (it re-reads its own section after a cart change), which did not fit
 * into the 14 B left under 10 240 B. Measured: 10 226 B before, 10 800 B after.
 *
 * Feedback 3, body 9 a 10 (Milníky, 8 Oct 2026): the ladder component (`ladder` in won-discounts.js, the embed)
 * serves the cart panel, the "Milestones" block and the top strip. Measured (node gzipSync, as this test does): the product page
 * 10 943 B before, 11 678 B after (of 12 288 B); the cart page 5 778 B → 6 513 B (of 10 240 B);
 * won-discounts-blocks.js 1 910 B → 1 511 B (it no longer builds the rows itself).
 */
const PAGE_BUDGET_BYTES: Record<string, number> = { "product page": 12 * 1024 };
const RAW_THEME_CHECK_BYTES = 10_000; // AssetSizeAppBlockJavaScript default, per file
const present = (file: string) => existsSync(path.join(ASSETS, file));

for (const [page, files] of Object.entries(PAGES)) {
  test(`storefront JS on a ${page} stays within the SF-2 gzip budget`, () => {
    const sizes = files.filter(present).map((file) => ({ file, gz: gzipSync(readFileSync(path.join(ASSETS, file))).length }));
    const total = sizes.reduce((sum, { gz }) => sum + gz, 0);
    const budget = PAGE_BUDGET_BYTES[page] ?? GZIP_BUDGET_BYTES;
    assert.ok(total <= budget, `${page}: ${total} B gzipped (${sizes.map(({ file, gz }) => `${file} ${gz} B`).join(", ")}), over the ${budget} B budget.`);
  });
}

test("every JS file of the extension belongs to a page type above and stays under Theme Check's raw AssetSizeAppBlockJavaScript threshold", () => {
  const all = readdirSync(ASSETS).filter((file) => file.endsWith(".js"));
  const known = new Set([...Object.values(PAGES).flat(), ...Object.keys(OPT_IN)]);
  assert.deepEqual(all.filter((file) => !known.has(file)), [], "a new script must be put on its page type(s) in PAGES");
  for (const file of all) {
    const raw = readFileSync(path.join(ASSETS, file)).length;
    assert.ok(raw <= RAW_THEME_CHECK_BYTES, `${file} is ${raw} B raw, over Theme Check's ${RAW_THEME_CHECK_BYTES} B default.`);
  }
});

for (const [file, ceiling] of Object.entries(OPT_IN)) {
  test(`opt-in storefront script ${file} stays within its own gzip ceiling`, () => {
    const gz = gzipSync(readFileSync(path.join(ASSETS, file))).length;
    assert.ok(gz <= ceiling, `${file}: ${gz} B gzipped, over its ${ceiling} B ceiling.`);
  });
}
