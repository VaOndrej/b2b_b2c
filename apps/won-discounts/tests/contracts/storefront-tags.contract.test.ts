// Umístění na webu (14 Oct 2026): the theme's own tags, <won-discounts show="…">. The embed makes the HTML in Liquid
// (templates, only for what the app found in the theme) and assets/won-discounts-tags.js moves it into each tag; in
// the theme editor a tag shows the sample its block shows. Run in a real browser (custom elements), no network: the
// page is built here from the extension's own script and stylesheet.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.join(HERE, "../../extensions/won-discounts-storefront");
const read = (relativePath: string) => readFile(path.join(extensionRoot, relativePath), "utf8");
const { chromium } = createRequire(import.meta.url)("playwright") as typeof import("playwright");

let browser: import("playwright").Browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

/** A page with the given body, the extension's stylesheet and the tags script (run like the embed's deferred one). */
async function page(body: string) {
  const p = await browser.newPage();
  await p.setContent(`<!doctype html><html><head><style>${await read("assets/won-discounts.css")}</style></head><body>${body}<script>${await read("assets/won-discounts-tags.js")}</script></body></html>`);
  return p;
}

const LADDER = (size: string) => `<template data-won-tag="milestones-${size}"><div class="won-ms won-ms--${size}" data-won-ms="${size}"><p class="won-ms__text">Ještě 200 Kč</p></div></template>`;

test("milestones: the ladder of the tag's size goes into the tag, redrawn on cart changes like the block's; an unknown size is the block's default", async () => {
  const p = await page(`${LADDER("full")}${LADDER("compact")}
    <won-discounts id="full" show="milestones" size="full" align="center"></won-discounts>
    <won-discounts id="odd" show="milestones" size="huge"></won-discounts>
    <won-discounts id="bar" show="milestones" size="bar"></won-discounts>`);
  const full = await p.$eval("#full > .won-progress", (el) => [el.className, el.getAttribute("data-size"), el.hasAttribute("data-won-discounts-progress"), el.querySelector(".won-ms")?.getAttribute("data-won-ms")]);
  assert.deepEqual(full, ["won-progress won-progress--center", "full", true, "full"]);
  assert.equal(await p.$eval("#odd .won-ms", (el) => el.getAttribute("data-won-ms")), "compact");
  // No template for the size (the app does not know the tag, or no step in this currency): nothing, and no room taken.
  assert.equal(await p.$eval("#bar", (el) => [el.childElementCount, getComputedStyle(el).display].join()), "0,none");
  await p.close();
});

test("campaign: the banner's markup with the campaigns and the tag's own text; the countdown script picks the one that runs", async () => {
  const p = await page(`<template data-won-tag="campaign" data-ends="Končí za {time}" data-units="d,h,min,s"><script type="application/json">[{"n":"Léto","s":1,"e":2}]</script></template>
    <won-discounts id="c" show="campaign" text="Právě běží {name}" align="center"></won-discounts>`);
  const box = await p.$eval("#c > .won-campaign", (el) => ({
    cls: el.className,
    text: el.getAttribute("data-text"),
    ends: el.getAttribute("data-ends"),
    hidden: (el as HTMLElement).hidden,
    json: el.querySelector("script")?.textContent,
    parts: [...el.querySelectorAll("p")].map((x) => x.className),
  }));
  assert.deepEqual(box, { cls: "won-campaign won-campaign--center", text: "Právě běží {name}", ends: "Končí za {time}", hidden: true, json: '[{"n":"Léto","s":1,"e":2}]', parts: ["won-campaign__title", "won-campaign__time"] });
  assert.equal(await p.$eval("#c > .won-campaign", (el) => el.hasAttribute("data-won-discounts-campaign")), true);
  await p.close();
});

test("card-tier: the page's text for the tag's product, as text; a product the page did not list gets nothing", async () => {
  const p = await page(`<script type="application/json" id="won-discounts-cards">{"mug":"Od 3 ks −10 %","bad":"<img src=x onerror=alert(1)>"}</script>
    <won-discounts id="mug" show="card-tier" product="mug"></won-discounts>
    <won-discounts id="bad" show="card-tier" product="bad"></won-discounts>
    <won-discounts id="none" show="card-tier" product="other"></won-discounts>`);
  assert.deepEqual(await p.$eval("#mug > p", (el) => [el.className, el.getAttribute("data-won-discounts-card"), el.textContent]), ["won-card-tier", "mug", "Od 3 ks −10 %"]);
  assert.deepEqual(await p.$eval("#bad", (el) => [el.querySelector("img"), el.textContent]), [null, "<img src=x onerror=alert(1)>"]);
  assert.equal(await p.$eval("#none", (el) => el.childElementCount), 0);
  await p.close();
});

test("a tag the theme draws later (a re-rendered drawer, a loaded section) is filled too, and a filled tag is never filled twice", async () => {
  const p = await page(`${LADDER("compact")}<div id="drawer"></div>`);
  await p.evaluate(() => {
    document.getElementById("drawer")!.innerHTML = '<won-discounts show="milestones"></won-discounts>';
  });
  assert.equal(await p.$eval("#drawer won-discounts", (el) => el.querySelectorAll(".won-ms").length), 1);
  await p.evaluate(() => {
    const tag = document.querySelector("#drawer won-discounts")!;
    tag.remove();
    document.body.append(tag);
  });
  assert.equal(await p.$eval("body > won-discounts", (el) => el.querySelectorAll(".won-ms").length), 1);
  await p.close();
});

test("theme editor: every tag shows its block's sample with the reason; in a cart tag the sample gives way to the real panel", async () => {
  const p = await page(`<template data-won-tag="milestones-compact-sample"><div data-won-discounts-sample="milestones"><p data-won-sample-note>Ukázka.</p></div></template>
    <template data-won-tag="campaign-sample" data-sample="Název kampaně"><script type="application/json">[]</script></template>
    <template data-won-tag="card-tier-sample"><div data-won-discounts-sample="card"><p class="won-card-tier">Od 3 ks −10 %</p></div></template>
    <template data-won-tag="cart-sample"><div class="won-cart won-cart--drawer" data-won-discounts-sample="cart"><p data-won-sample-note>Ukázka.</p></div></template>
    <won-discounts id="ms" show="milestones"></won-discounts>
    <won-discounts id="cp" show="campaign"></won-discounts>
    <won-discounts id="cd" show="card-tier" product="x"></won-discounts>
    <won-discounts id="ct" show="cart"></won-discounts>`);
  // A sample ladder is not the cart script's to redraw.
  assert.deepEqual(await p.$eval("#ms > .won-progress", (el) => [el.hasAttribute("data-won-discounts-progress"), !!el.querySelector("[data-won-discounts-sample]")]), [false, true]);
  assert.equal(await p.$eval("#cp > .won-campaign", (el) => el.getAttribute("data-sample")), "Název kampaně");
  assert.equal(await p.$eval("#cd", (el) => !!el.querySelector("[data-won-discounts-sample] .won-card-tier")), true);
  const sample = () => p.$eval("#ct > [data-won-discounts-sample]", (el) => getComputedStyle(el).display);
  assert.notEqual(await sample(), "none");
  // The cart script puts its panel first in the tag.
  await p.evaluate(() => {
    const panel = document.createElement("div");
    panel.className = "won-cart";
    panel.setAttribute("data-won-discounts-cart", "");
    panel.textContent = "panel";
    document.getElementById("ct")!.prepend(panel);
  });
  assert.equal(await sample(), "none");
  await p.close();
});

test("the cart script draws its panel into a cart tag, in the tag's size, and uses no drawer address while one is on the page and never guesses the cart page", async () => {
  const js = await read("assets/won-discounts-cart.js");
  assert.match(js, /const TAG = 'won-discounts\[show="cart"\]';/);
  assert.match(js, /\[SLOT, TAG, \.\.\.\(tagged \? \[\] : drawers\(\)\)\]/);
  // Zásuvka košíku, varianta 1 (15 Oct 2026): Horizon's and Dawn's drawer in the spot the Won embed's setting picks.
  assert.match(js, /summary: \["cart-drawer-component \.cart-drawer__summary", "#CartDrawer \.drawer__footer"\]/);
  assert.match(js, /top: \["cart-drawer-component \.cart-drawer__content", "#CartDrawer cart-drawer-items"\]/);
  assert.match(js, /const drawers = \(\) => \(data\.dp === "off" \? \[\] : DRAWERS\[data\.dp\] \|\| DRAWERS\.summary\);/);
  const embed = await read("blocks/won_discounts_embed.liquid");
  assert.match(embed, /"dp":\{\{ block\.settings\.drawer_position \| default: 'summary' \| json \}\}/);
  const schema = JSON.parse(/\{% schema %\}([\s\S]*?)\{% endschema %\}/.exec(embed)![1]!) as { settings: { id?: string; default?: string; options?: { value: string }[] }[] };
  const setting = schema.settings.find((x) => x.id === "drawer_position")!;
  assert.deepEqual([setting.default, setting.options!.map((o) => o.value)], ["summary", ["summary", "top", "off"]]);
  // Balík C: the cart page is never guessed (the block or a tag only).
  assert.doesNotMatch(js, /PAGES|cart-page__summary|main-cart-footer/);
  assert.match(js, /slot\.matches\?\.\(TAG\) \? \(slot\.getAttribute\("size"\) === "full" \? "full" : "compact"\)/);
});

test("the embed makes the tags' HTML only for what the theme holds (tg), the samples only in the theme editor, and loads the script only then", async () => {
  const liquid = await read("blocks/won_discounts_embed.liquid");
  assert.match(liquid, /\{%- if won_tg != blank or request\.design_mode -%\}/);
  assert.match(liquid, /\{%- for won_size in won_tg\.ms -%\}[\s\S]*render 'won-milestones', rw: rw, cur: cur, size: won_size[\s\S]*<template data-won-tag="milestones-\{\{ won_size \}\}">/);
  assert.match(liquid, /\{%- if won_tg\.cp == 1 and won_camps != blank -%\}\s*<template data-won-tag="campaign"/);
  assert.match(liquid, /\{%- if request\.design_mode -%\}[\s\S]*data-won-tag="milestones-\{\{ won_size \}\}-sample"[\s\S]*data-won-tag="cart-sample"/);
  assert.match(liquid, /<script src="\{\{ 'won-discounts-tags\.js' \| asset_url \}\}" defer><\/script>/);
  // B2: the texts and the app proxy for cards the page does not list, only with card tags known and cards on.
  assert.match(liquid, /\{%- if won_tg\.cd == 1 and won_discounts_config_raw\.cards == 1 -%\}[\s\S]*<template data-won-tag="card-tier-texts" data-pct="[^"]+" data-off="[^"]+" data-proxy="\{\{ won_proxy \| escape \}\}"/);
  assert.ok(liquid.indexOf("{{ 'won-discounts-tags.js' | asset_url }}") < liquid.indexOf("{{ 'won-discounts-cart.js' | asset_url }}"), "the tags are filled before the cart script looks for them");
});

test("balík D, tiers and outlet: the product page's table and badge go into their tags; off the product page the editor's sample says where they work; a filled tag hides the block's", async () => {
  const TABLE = (id: string) => `<div class="won-tiers won-tiers--default" data-won-discounts-tiers data-state="ready" id="${id}"><p class="won-tiers__heading">Množstevní sleva</p></div>`;
  const BADGE = (id: string) => `<div class="won-outlet" data-won-discounts-outlet id="${id}"><p class="won-outlet__row"><span class="won-outlet__badge">Výprodej</span></p></div>`;
  const p = await page(`<template data-won-tag="tiers">${TABLE("in-tag")}</template><template data-won-tag="outlet">${BADGE("badge-in-tag")}</template>
    <section class="shopify-section">${TABLE("block")}${BADGE("badge-block")}</section>
    <won-discounts id="t" show="tiers"></won-discounts><won-discounts id="o" show="outlet"></won-discounts>`);
  assert.equal(await p.$eval("#t > [data-won-discounts-tiers]", (el) => el.id), "in-tag");
  assert.equal(await p.$eval("#o > [data-won-discounts-outlet]", (el) => el.id), "badge-in-tag");
  // Never twice: the block's table and badge give way to the tag's.
  assert.equal(await p.$eval("#block", (el) => getComputedStyle(el).display), "none");
  assert.equal(await p.$eval("#badge-block", (el) => getComputedStyle(el).display), "none");
  assert.notEqual(await p.$eval("#in-tag", (el) => getComputedStyle(el).display), "none");
  await p.close();
  const off = await page(`<template data-won-tag="tiers-sample"><div data-won-discounts-sample="tiers"><p data-won-sample-note>Jen na stránce produktu</p></div></template>
    <section class="shopify-section">${TABLE("block")}</section><won-discounts id="t" show="tiers"></won-discounts><won-discounts id="o" show="outlet"></won-discounts>`);
  assert.equal(await off.$eval("#t [data-won-sample-note]", (el) => el.textContent), "Jen na stránce produktu");
  assert.equal(await off.$eval("#o", (el) => [el.childElementCount, getComputedStyle(el).display].join()), "0,none", "no template, no sample: nothing, no room");
  assert.notEqual(await off.$eval("#block", (el) => getComputedStyle(el).display), "none", "a sample is no table: the block stays");
  await off.close();
});

test("balík D, the embed: the table and the badge from their blocks' snippets, on the product page only, only for what the theme holds; their scripts after the tags script; in a tag the table never asks a section for its cart counts", async () => {
  const liquid = await read("blocks/won_discounts_embed.liquid");
  assert.match(liquid, /if template\.name == 'product' and product != blank/);
  assert.match(liquid, /\{%- if won_tg\.ti == 1 or request\.design_mode -%\}[\s\S]*?render 'won-tiers', scripts: false[\s\S]*?<template data-won-tag="tiers">/);
  assert.match(liquid, /\{%- if won_tg\.ob == 1 or request\.design_mode -%\}[\s\S]*?render 'won-outlet', attrs: '', scripts: false[\s\S]*?<template data-won-tag="outlet">/);
  assert.match(liquid, /\{%- elsif request\.design_mode -%\}[\s\S]*?'sample\.tag_product' \| t[\s\S]*?data-won-tag="tiers-sample"[\s\S]*?data-won-tag="outlet-sample"/);
  const tags = liquid.indexOf("{{ 'won-discounts-tags.js' | asset_url }}");
  assert.ok(tags > 0 && tags < liquid.indexOf("<script src=\"{{ 'won-discounts-tiers.js' | asset_url }}\""), "the tags are filled before the table script scans");
  assert.match(await read("blocks/quantity_tiers.liquid"), /render 'won-tiers', accent: block\.settings\.accent, scripts: true/);
  assert.match(await read("blocks/outlet_badge.liquid"), /render 'won-outlet', attrs: block\.shopify_attributes, scripts: true/);
  // SF-1: the table never reads the cart; a tag has no section of its own, so a cart change zeroes the counts.
  const tiersJs = await read("assets/won-discounts-tiers.js");
  assert.match(tiersJs, /if \(inTag\(roots\)\) return zero\(\);/);
  assert.match(tiersJs, /n\.tagName === "WON-DISCOUNTS"/);
  for (const locale of ["cs", "sk", "en.default"]) assert.ok(JSON.parse(await read(`locales/${locale}.json`)).sample.tag_product, locale);
});

test("the tags' description (theme-tags.ts: the reference, the admin guide, the AI brief) says what the script does", async () => {
  const { THEME_TAGS, THEME_TAG } = await import("../../app/components/model/theme-tags.ts");
  const js = await read("assets/won-discounts-tags.js");
  assert.match(js, /customElements\.define\(\s*"won-discounts"/);
  assert.equal(THEME_TAG, "won-discounts");
  for (const tag of THEME_TAGS) assert.ok(js.includes(`show === "${tag.show}"`), tag.show);
  const size = THEME_TAGS.find((t) => t.show === "milestones")!.attrs.find((a) => a.name === "size")!;
  assert.match(js, new RegExp(`const SIZES = ${JSON.stringify(size.values).replace(/[[\]]/g, "\\$&").replace(/,/g, ", ")};`));
  assert.match(js, new RegExp(`: "${size.fallback}";`));
  for (const tag of THEME_TAGS) for (const block of tag.blocks) assert.ok((await read(`blocks/${block}.liquid`)).length > 0, block);
});

test("card-tier for a product the page does not list: one app proxy request for all such tags, worded with the page's texts, remembered", async () => {
  const p = await browser.newPage();
  await p.setContent(`<!doctype html><html><body>
    <template data-won-tag="card-tier-texts" data-pct="Od {min} ks −{pct} %" data-off="Od {min} ks −{amount} za kus" data-proxy="/apps/won-discounts/card-tiers" data-cur="CZK" data-mk="cz" data-lang="cs"></template>
    <script type="application/json" id="won-discounts-cards">{"listed":"Od 2 ks −5 %"}</script>
    <won-discounts id="a" show="card-tier" product="mug"></won-discounts>
    <won-discounts id="b" show="card-tier" product="cup"></won-discounts>
    <won-discounts id="c" show="card-tier" product="mug"></won-discounts>
    <won-discounts id="l" show="card-tier" product="listed"></won-discounts>
    <won-discounts id="n" show="card-tier" product="none"></won-discounts>
    <script>
      window.Shopify = { country: "CZ" };
      window.WonDiscounts = { money: (cents, cur) => (cents / 100) + " " + cur };
      window.__asked = [];
      window.fetch = (url) => {
        window.__asked.push(String(url));
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, cards: { mug: { min: 3, pct: 7.5 }, cup: { min: 2, off: 500 } } }) });
      };
    </script>
    <script>${await read("assets/won-discounts-tags.js")}</script></body></html>`);
  await p.waitForFunction(() => document.querySelector("#a p, #b p"));
  const text = (id: string) => p.$eval(`#${id}`, (el) => el.textContent);
  assert.equal(await text("a"), "Od 3 ks −7,5 %");
  assert.equal(await text("c"), "Od 3 ks −7,5 %");
  assert.equal(await text("b"), "Od 2 ks −5 CZK za kus");
  assert.equal(await text("l"), "Od 2 ks −5 %", "the page's own text needs no request");
  assert.equal(await p.$eval("#n", (el) => el.childElementCount), 0, "nothing for a product the app says nothing about");
  assert.deepEqual(await p.evaluate(() => (window as unknown as { __asked: string[] }).__asked), ["/apps/won-discounts/card-tiers?h=mug%2Ccup%2Cnone&cur=CZK&mk=cz&c=CZ"]);
  // A re-rendered card: the answer is remembered, no second request.
  await p.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<won-discounts id="d" show="card-tier" product="cup"></won-discounts>'));
  assert.equal(await text("d"), "Od 2 ks −5 CZK za kus");
  assert.equal(await p.evaluate(() => (window as unknown as { __asked: string[] }).__asked.length), 1);
  await p.close();
});
