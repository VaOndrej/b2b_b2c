// Read-only check of the storefront: do the files of the Won Discounts extension load on a product page?
//
//   node apps/won-discounts/scripts/check-storefront-assets.mjs [product-handle]
//
// Why (7 Oct 2026): the quantity table was on the product page as bare text. The markup, the look and the colour
// were all right; every file of the extension answered 404, because the shop was showing the dev preview of
// `shopify app dev` and its files were gone from the CDN. Exit 1 = some file does not load (the list says which).
// Nothing is written: it logs in to the storefront with the password of .env and reads one page.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(appRoot, "package.json"));
const { chromium } = require("playwright");
const env = Object.fromEntries(
  readFileSync(path.join(appRoot, ".env"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);
const shop = env.SHOPIFY_E2E_SHOP_DOMAIN;
if (!shop) throw new Error("SHOPIFY_E2E_SHOP_DOMAIN is missing in apps/won-discounts/.env");

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  // The POST the storefront's password page sends; the password is never logged.
  if (env.SHOPIFY_E2E_STOREFRONT_PASSWORD) await context.request.post(`https://${shop}/password`, { form: { form_type: "storefront_password", utf8: "✓", password: env.SHOPIFY_E2E_STOREFRONT_PASSWORD } });
  let handle = process.argv[2];
  if (!handle) {
    const list = await context.request.get(`https://${shop}/products.json?limit=1`);
    handle = list.ok() ? (await list.json()).products[0]?.handle : undefined;
  }
  if (!handle) throw new Error("No product to open: pass a product handle.");
  await page.goto(`https://${shop}/products/${handle}`, { waitUntil: "load" });
  const read = await page.evaluate(async () => {
    const urls = new Set();
    for (const el of document.querySelectorAll('link[rel="stylesheet"][href]')) urls.add(el.href);
    for (const el of document.querySelectorAll("script[src]")) urls.add(el.src);
    const wanted = [...urls].filter((u) => /\/extensions\/[^/]+\/[^/]+\/assets\/won-discounts[^/?#]*\.(css|js)(\?|#|$)/.test(u));
    const files = await Promise.all(
      wanted.map(async (url) => {
        try {
          const res = await fetch(url, { cache: "no-store" });
          return { url, status: res.status, type: res.headers.get("content-type") || "" };
        } catch {
          return { url, status: 0, type: "" };
        }
      }),
    );
    const block = document.querySelector("[data-won-discounts-tiers]");
    const list = block && block.querySelector(".won-tiers__list");
    return {
      theme: window.Shopify && window.Shopify.theme ? `${window.Shopify.theme.name} (${window.Shopify.theme.schema_name})` : "?",
      block: block ? { preset: block.getAttribute("data-preset"), state: block.getAttribute("data-state"), styled: list ? getComputedStyle(list).listStyleType === "none" : null } : null,
      embed: !!document.querySelector("[data-won-discounts-embed]"),
      files,
    };
  });
  const missing = read.files.filter((f) => f.status < 200 || f.status > 299 || /text\/html/i.test(f.type));
  const devPreview = read.files.some((f) => /\/extensions\/[^/]+\/dev-/.test(f.url));
  console.log(`page: https://${shop}/products/${handle}`);
  console.log(`storefront look: ${read.theme}`);
  console.log(`Won on the storefront (app embed): ${read.embed ? "on" : "off"}`);
  console.log(`quantity table: ${read.block ? `on the page, look "${read.block.preset}", state ${read.block.state}, ${read.block.styled ? "styled" : "NOT styled"}` : "not on this page"}`);
  for (const f of read.files) console.log(`  ${missing.includes(f) ? "MISSING" : "ok     "} ${f.status} ${f.url.split("/").slice(-3).join("/")}`);
  if (read.files.length === 0) console.log("  no Won Discounts file is linked on this page");
  if (missing.length > 0) {
    console.log(`\n${missing.length} of ${read.files.length} files do not load.`);
    if (devPreview) console.log("The shop shows a dev preview (dev-…) whose files are gone. Start `npm run dev -w won-discounts` again, or put the released version back: `npx shopify app dev clean` in apps/won-discounts.");
    process.exitCode = 1;
  } else if (read.files.length > 0) {
    console.log(`\nAll ${read.files.length} files load.`);
  }
} finally {
  await browser.close();
}
