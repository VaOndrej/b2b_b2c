// C5 evidence (MVP 0): can the storefront be framed inside the admin? Reads the
// framing headers of password-unlocked storefront pages. Run from the repo root:
//   node --env-file=apps/won-discounts/.env docs/won-discounts/evidence/mvp0/c5-headers.mjs
// Prints one JSON line per page; the password is read from the env, never printed.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const require = createRequire(path.join(repoRoot, "package.json"));
const { chromium } = require("@playwright/test");
const shop = process.env.SHOPIFY_E2E_SHOP_DOMAIN;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`https://${shop}/password`, { waitUntil: "domcontentloaded" });
const pw = page.locator("input[type='password']").first();
await pw.fill(process.env.SHOPIFY_E2E_STOREFRONT_PASSWORD);
await Promise.all([page.waitForLoadState("domcontentloaded"), pw.press("Enter")]);
await page.waitForTimeout(2500);
for (const p of ["/products/won-e2e-simple-a", "/products/won-e2e-simple-a?preview_theme_id=", "/cart"]) {
  const res = await page.goto(`https://${shop}${p}`, { waitUntil: "domcontentloaded" });
  const h = res.headers();
  console.log(JSON.stringify({ path: p, status: res.status(), xfo: h["x-frame-options"] ?? null, csp: h["content-security-policy"] ?? null, checkedAt: new Date().toISOString() }));
}
await browser.close();
