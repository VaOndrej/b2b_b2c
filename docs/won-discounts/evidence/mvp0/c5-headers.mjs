import { createRequire } from "node:module";
const require = createRequire("/Users/ondrej/Development/WonCommerce/Apps/b2b_b2c/package.json");
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
  console.log(JSON.stringify({ path: p, status: res.status(), xfo: h["x-frame-options"] ?? null, csp: h["content-security-policy"] ?? null }));
}
await browser.close();
