// Milníky on the storefront without a store: one static page with the extension's REAL stylesheet and scripts
// (won-discounts.css, won-discounts.js, won-discounts-cart.js, won-discounts-blocks.js) and the four places the
// ladder shows — the top strip (size "bar"), the product page block ("compact"), the cart drawer ("compact") and
// the cart page ("full") — over a fake cart. The script walks the cart through the steps, checks that every place
// follows it without a page load, and takes screenshots at 390 and 1440 px.
//
//   node apps/won-discounts/scripts/milestones-web-preview.mjs <outDir>
//
// It proves the component (markup, styles, the cart script's numbers). It does NOT prove a theme: where a theme
// puts the drawer and the cart summary is what tests/e2e/storefront.rewards.spec.ts checks on Horizon and Dawn.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(HERE, "../extensions/won-discounts-storefront");
const require = createRequire(path.join(HERE, "../../../package.json"));
const { chromium } = require("playwright");

const out = process.argv[2];
if (!out) throw new Error("Usage: milestones-web-preview.mjs <outDir>");
mkdirSync(out, { recursive: true });

const asset = (name) => readFileSync(path.join(EXT, "assets", name), "utf8");
const tx = JSON.parse(readFileSync(path.join(EXT, "locales/cs.json"), "utf8")).cart;
// The storefront config's rewards (core storefront-config.ts): amounts in Liquid units (major × 100).
const rw = {
  ship: { CZK: 100000 },
  gifts: [{ id: "gift-1", t: { CZK: 150000 }, c: [{ v: 9001, h: "ponozky" }] }],
  other: false,
  disc: [
    { id: "ms-five", t: { CZK: 200000 }, pct: 5 },
    { id: "ms-fixed", t: { CZK: 500000 }, off: { CZK: 50000 } },
  ],
};
const data = { on: true, rw, mk: "CZK@cz", exp: 2, lang: "cs", proxy: "", g: { 9001: { t: "Ponožky Won — M", a: true } }, tx };

const html = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Milníky na webu</title>
<style>
body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#1c1c1c;background:#fff}
main{max-width:1100px;margin:0 auto;padding:16px;display:grid;gap:24px}
h2{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#666;margin:0 0 8px}
.place{border:1px solid #e3e3e3;border-radius:12px;padding:16px}
.cols{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))}
.drawer__footer,.won-cart-slot{max-width:420px}
${asset("won-discounts.css")}
</style></head><body>
<main>
<section class="cols">
  <div class="place" data-place="product"><h2>Stránka produktu (kompaktní)</h2><div class="won-progress won-progress--start" data-won-discounts-progress data-size="compact"></div></div>
  <div class="place" data-place="drawer"><h2>Boční košík (kompaktní)</h2><div id="CartDrawer"><div class="drawer__footer"></div></div></div>
</section>
<section class="place" data-place="cart"><h2>Stránka košíku (plná)</h2><div class="won-cart-slot" data-won-discounts-cart-slot></div></section>
</main>
<div id="won-discounts-root" data-won-discounts-embed data-won-discounts-status="loading" data-won-discounts-currency="CZK" hidden></div>
<script type="application/json" id="won-discounts-config">{}</script>
<script type="application/json" id="won-discounts-cart-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
<div class="won-topbar" data-won-discounts-topbar style="--won-topbar-bg:#111111;--won-topbar-text:#ffffff" hidden><div class="won-progress" data-won-discounts-progress data-size="bar"></div></div>
<script>
// A fake cart: one line of goods whose price the test sets; the gift line the cart script adds.
window.__lines = [];
window.__goods = 0;
const cartNow = () => {
  const goods = window.__goods > 0 ? [{ key: "a", variant_id: 1, product_id: 1, quantity: 1, original_price: window.__goods, original_line_price: window.__goods, final_line_price: window.__goods, product_title: "Tričko", properties: {} }] : [];
  const items = [...goods, ...window.__lines];
  const total = items.reduce((s, i) => s + i.original_line_price, 0);
  return { currency: "CZK", items, attributes: {}, discount_codes: [], cart_level_discount_applications: [], original_total_price: total, total_price: total };
};
const realFetch = window.fetch;
window.fetch = (url, init) => (String(url).startsWith("/cart.js") ? Promise.resolve({ ok: true, json: async () => cartNow() }) : realFetch(url, init));
window.Shopify = { currency: { rate: "1.0" }, country: "CZ", actions: { updateCart: async (payload) => {
  for (const line of payload.lines || []) {
    if (line.merchandiseId) window.__lines.push({ key: "gift", variant_id: Number(line.merchandiseId.split("/").pop()), product_id: 9, quantity: 1, original_price: 30000, original_line_price: 30000, final_line_price: 30000, product_title: "Ponožky Won", properties: Object.fromEntries(line.attributes.map((a) => [a.key, a.value])) });
    else if (line.quantity === 0) window.__lines = window.__lines.filter((l) => l.key !== line.id);
  }
  return { cart: {} };
} } };
// What a theme does after the customer changes the cart.
window.__setGoods = (cents) => { window.__goods = cents; document.dispatchEvent(new CustomEvent("cart:update")); };
</script>
<script>${asset("won-discounts.js")}</script>
<script>${asset("won-discounts-cart.js")}</script>
<script>${asset("won-discounts-blocks.js")}</script>
</body></html>`;
const file = path.join(out, "milniky-web.html");
writeFileSync(file, html);

// The cart values the walk goes through (Kč) and, for each, how many steps are reached and what the sentence names.
const WALK = [
  { kc: 0, done: 0, next: "Doprava zdarma" },
  { kc: 999, done: 0, next: "Doprava zdarma" },
  { kc: 1200, done: 1, next: "Dárek: Ponožky Won — M" },
  { kc: 1700, done: 2, next: "Sleva 5\u00a0%" },
  { kc: 2600, done: 3, next: "Sleva 500\u00a0Kč" },
  { kc: 6000, done: 4, next: null },
];

const browser = await chromium.launch();
let failed = 0;
const check = (ok, text) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
};
for (const width of [390, 1440]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(`file://${file}`, { waitUntil: "load" });
  let loads = 0;
  page.on("load", () => (loads += 1));
  for (const step of WALK) {
    await page.evaluate((cents) => window.__setGoods(cents), step.kc * 100);
    // The cart script waits 300 ms after a cart event, and keeps its own writes 1.5 s apart (the gift line).
    await page.waitForTimeout(2600);
    const seen = await page.evaluate(() =>
      Object.fromEntries(
        ["[data-won-discounts-topbar]", '[data-place="product"]', '[data-place="drawer"]', '[data-place="cart"]'].map((sel) => {
          const el = document.querySelector(sel);
          const ms = el.querySelector(".won-ms");
          return [
            sel,
            {
              size: ms?.getAttribute("data-won-ms") ?? null,
              text: ms?.querySelector(".won-ms__text")?.textContent ?? null,
              marks: ms ? ms.querySelectorAll(".won-ms__track i").length : 0,
              marksDone: ms ? ms.querySelectorAll(".won-ms__track i[data-done]").length : 0,
              rows: ms ? [...ms.querySelectorAll(".won-ms__list li")].map((li) => `${li.hasAttribute("data-done") ? "✓" : "·"} ${li.textContent}`) : [],
              now: ms?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") ?? null,
            },
          ];
        }),
      ),
    );
    const [bar, product, drawer, cart] = Object.values(seen);
    const sentence = step.next ? `a získáte: ${step.next}` : "Máte všechny odměny.";
    check(bar.size === "bar" && product.size === "compact" && drawer.size === "compact" && cart.size === "full", `${width}px ${step.kc} Kč: sizes bar / compact / compact / full`);
    check([bar, product, drawer, cart].every((x) => x.text?.includes(sentence)), `${width}px ${step.kc} Kč: every place says "${sentence}" (${cart.text})`);
    check(bar.marks === 0 && product.marks === 4 && drawer.marks === 4 && cart.marks === 4, `${width}px ${step.kc} Kč: a mark per step in compact and full, none in the strip`);
    check(product.marksDone === step.done && cart.rows.filter((r) => r.startsWith("✓")).length === step.done, `${width}px ${step.kc} Kč: ${step.done} of 4 steps reached (${cart.rows.join(" | ")})`);
    if (step.kc === 1700 || step.kc === 0 || step.kc === 6000) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflow === 0, `${width}px ${step.kc} Kč: no horizontal scroll (overflow ${overflow})`);
      await page.screenshot({ path: path.join(out, `web-${step.kc}kc-${width}.png`), fullPage: true });
    }
  }
  check(loads === 0, `${width}px: the ladder followed the cart without a page load`);
  await ctx.close();
}
await browser.close();
console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
