// Screenshots + noise metrics of every admin screen in the dev harness, at 1440 and 390 px.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = (process.env.WON_PREVIEW_BASE_URL ?? "http://localhost:3411") + "/dev/preview/";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });

const SCREENS = [
  ["overview", "overview?state=live"],
  ["overview-pro", "overview?state=live&plan=pro"],
  ["overview-empty", "overview?state=empty"],
  ["onboarding", "onboarding"],
  ["discounts", "discounts?sync=ok"],
  ["discounts-empty", "discounts?state=empty"],
  ["rule-new", "rule-editor?rule=new&recipe=percent"],
  ["rule-edit", "rule-editor?rule=dev-f2-collection"],
  ["rule-edit-pro", "rule-editor?rule=dev-f2-collection&plan=pro"],
  ["tiers", "tiers"],
  ["tiers-pro", "tiers?plan=pro"],
  ["rewards", "rewards"],
  ["outlet", "outlet"],
  ["campaigns", "campaigns"],
  ["margin", "margin"],
  ["margin-pro", "margin?plan=pro"],
  ["try-cart", "try-cart"],
  ["analytics", "analytics"],
  ["translations", "translations"],
  ["placements", "placements"],
  ["settings", "settings"],
  ["plan", "plan"],
];

const metrics = async (page) =>
  page.evaluate(() => {
    const count = (s) => document.querySelectorAll(s).length;
    const text = document.body.innerText || "";
    return {
      words: text.split(/\s+/).filter(Boolean).length,
      sections: count("s-section"),
      boxes: count("s-box"),
      badges: count("s-badge"),
      banners: count("s-banner"),
      buttons: count("s-button") + count("s-link"),
      primary: count('s-button[variant="primary"]'),
      fields: count("s-text-field,s-number-field,s-select,s-switch,s-checkbox,s-choice-list,s-color-field,s-date-field,s-search-field,s-money-field"),
      rawControls: count("button:not([hidden]),input:not([type=hidden]),select,textarea"),
      headings: count("s-heading,h1,h2,h3"),
      inlineStyles: count("[style]"),
      height: document.documentElement.scrollHeight,
      sideways: document.documentElement.scrollWidth - window.innerWidth,
    };
  });

const browser = await chromium.launch();
const rows = [];
for (const [name, path] of SCREENS) {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
    try {
      const res = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForFunction(() => customElements.get("s-page") !== undefined, null, { timeout: 15000 }).catch(() => errors.push("s-page never defined"));
      await page.waitForTimeout(600);
      const m = await metrics(page);
      await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
      rows.push({ name, width, status: res?.status(), ...m, errors: errors.length, firstError: errors[0] ?? "" });
    } catch (e) {
      rows.push({ name, width, status: "ERR", firstError: String(e.message).slice(0, 160) });
    }
    await page.close();
  }
}
await browser.close();
writeFileSync(`${OUT}/metrics.json`, JSON.stringify(rows, null, 2));
console.table(rows.map(({ firstError, ...r }) => r));
for (const r of rows) if (r.firstError) console.log(r.name, r.width, r.firstError);
