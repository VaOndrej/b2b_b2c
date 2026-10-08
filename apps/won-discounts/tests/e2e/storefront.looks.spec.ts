import { readFileSync } from "node:fs";
import path from "node:path";

import type { Page, TestInfo } from "@playwright/test";
import { assertExtensionAssetsLoaded, assertResponsiveSane } from "@won/testing/playwright";

import { scopeCss } from "@won/core/discounts/scope-css";

import { CARDS_HANDLES } from "../../scripts/e2e/cards-fixture.mjs";
import { LOOK_ACCENT_RGB, LOOK_TEXTS, MARK, OLD_LOOK, OLD_ROOT, parseLooks } from "../../scripts/e2e/looks-fixture.mjs";
import { REWARDS_CART_HANDLE } from "../../scripts/e2e/rewards-fixture.mjs";
import { clearCartQuietly, storefrontJson } from "./support/cart.ts";
import { saveEvidence, saveImage, saveScreenshot } from "./support/evidence.ts";
import { APP_DIR, E2E_PROFILE, expect, STORE_ORIGIN, test, THEME_LABEL } from "./support/fixtures.ts";
import { go, openThemePreview } from "./support/theme-preview.ts";
import { TIERS_PRODUCT_HANDLE } from "../../scripts/e2e/tiers-fixture.mjs";
import { quantityInput } from "./support/tiers.ts";

// SPEC-DRIVEN (úkol 8: Překlady a vzhled u modulů), live on BOTH shared themes. What the storefront does with what
// the merchant saved on Překlady and in a module's "… na webu" section:
//   texts  a page in the shop's default language shows the merchant's own text at every element — the quantity
//          table, the line on a product card, the cart's data, the Milníky ladder (already in the HTML the server
//          sends, before any script) — a page in another language shows that language's own (the one text it has)
//          and otherwise the extension's, and a language with none shows the extension's alone.
//   looks  every ready-made look draws as picked, with its highlight colour, at 390 and 1440 px; the flash of a
//          step just reached runs once and never with "reduce motion".
// Runs only on a seed that carries them (scripts/e2e/looks-fixture.mjs), through scripts/e2e/runbook/looks.sh:
//   conversion  a look stored before the split (one colour and one custom look for every block) draws the table
//          and the ladder pixel for pixel as the stylesheet the old code made of the same settings.
//   seed-mvp1.mjs --profile <p> [--texts] [--looks <element>=<look>[+blink]] [--old-look] --live
//   WON_E2E_PROFILE=<p> [WON_E2E_TEXTS=1] [WON_E2E_LOOKS=…] [WON_E2E_OLD_LOOK=1] npm run test:e2e:local:all -w won-discounts
// The pages are opened on the real store domain previewing the matrix's theme (support/theme-preview.ts).

const TEXTS = String(process.env.WON_E2E_TEXTS ?? "") === "1";
const LOOKS = parseLooks(process.env.WON_E2E_LOOKS);
const CONVERTED = String(process.env.WON_E2E_OLD_LOOK ?? "") === "1";
const PRO = String(process.env.WON_E2E_PLAN ?? "free").trim() === "pro";
const REWARDS = E2E_PROFILE === "rewards" || E2E_PROFILE === "rewards-pro";
const TIERS = E2E_PROFILE === "tiers" || E2E_PROFILE === "tiers-pro";

const LOCALE_FILE = { cs: "cs.json", sk: "sk.json", en: "en.default.json" } as const;
type Lang = keyof typeof LOCALE_FILE;
/** The extension's own text of `key` ("cart.ms_left") in a language. */
function own(lang: Lang, key: string): string {
  const [group, name] = key.split(".") as [string, string];
  const file = JSON.parse(readFileSync(path.join(APP_DIR, "extensions/won-discounts-storefront/locales", LOCALE_FILE[lang]), "utf8")) as Record<string, Record<string, string>>;
  const text = file[group]?.[name];
  expect(text, `${LOCALE_FILE[lang]} has ${key}`).toBeTruthy();
  return text!;
}
/** A text with `{…}` parts as a pattern: every part is "something". */
const shaped = (text: string) => new RegExp(`^${text.split(/\{[a-z]+\}/u).map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join(".+")}$`, "u");
const flat = (text: string | null | undefined) => (text ?? "").replace(/\s+/gu, " ").trim();
const prefix = (lang: Lang) => (lang === "cs" ? "" : `/${lang}`);

const PRODUCT_BLOCK = '[data-won-discounts-progress][data-size="compact"]';
const PRODUCT_LADDER = `${PRODUCT_BLOCK} .won-ms`;
const TOP_LADDER = "[data-won-discounts-topbar] .won-ms";

async function shots(page: Page, testInfo: TestInfo, name: string, root: string): Promise<void> {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(800);
    await page.locator(root).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400);
    if (width === 390) await assertResponsiveSane(page, { root });
    await saveScreenshot(page, testInfo, `${name}-${width}`, { fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** The cart product × `quantity`, changed as a theme changes the cart (the AJAX cart, then the theme's event — no navigation). */
async function setQuantity(page: Page, quantity: number): Promise<void> {
  await page.evaluate(async (qty) => {
    const product = (await (await fetch(`${location.pathname}.js`)).json()) as { variants: { id: number }[] };
    const cart = (await (await fetch("/cart.js", { cache: "no-store" })).json()) as { items: { key: string; variant_id: number; properties?: Record<string, string> }[] };
    const line = cart.items.find((i) => i.variant_id === product.variants[0]!.id && !i.properties?._won_gift);
    const init = { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" } };
    if (line) await fetch("/cart/change.js", { ...init, body: JSON.stringify({ id: line.key, quantity: qty }) });
    else await fetch("/cart/add.js", { ...init, body: JSON.stringify({ items: [{ id: product.variants[0]!.id, quantity: qty }] }) });
    document.dispatchEvent(new CustomEvent("cart:update"));
  }, quantity);
}

test.describe(`Won Discounts texts and looks on the storefront (úkol 8) [${E2E_PROFILE}]${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(!TEXTS && !CONVERTED && Object.keys(LOOKS).length === 0, "needs a seed with --texts, --looks or --old-look (scripts/e2e/runbook/looks.sh)");

  test.afterEach(async ({ page }) => {
    if (page.url().startsWith(STORE_ORIGIN)) await clearCartQuietly(page);
  });

  test("texts, Milníky: the ladder says the merchant's Czech text in the server's HTML and after the scripts; Slovak has its one text, English none", async ({ page }, testInfo) => {
    test.skip(!TEXTS || !REWARDS, "the rewards seed with --texts");
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openThemePreview(page);
    await go(page, `/products/${REWARDS_CART_HANDLE}`);
    await storefrontJson(page, "POST", "/cart/clear.js", {});
    const seen: Record<string, unknown> = {};
    for (const lang of ["cs", "sk", "en"] as const) {
      await test.step(`a page in ${lang}`, async () => {
        const url = `${prefix(lang)}/products/${REWARDS_CART_HANDLE}`;
        // The first paint: what Liquid printed, read without running a script.
        const html = await (await page.request.get(`${STORE_ORIGIN}${url}`)).text();
        const served = [...html.matchAll(/class="won-ms__text">([^<]*)</gu)].map((m) => flat(m[1]));
        expect(served.length, "the server printed the ladder (the top strip and the product page block)").toBeGreaterThanOrEqual(2);
        await go(page, url);
        expect(await page.evaluate(() => document.documentElement.lang.slice(0, 2)), "the page's language").toBe(lang);
        await assertExtensionAssetsLoaded(page, { match: "won-discounts" });
        await expect(page.locator(PRODUCT_LADDER).first()).toBeVisible({ timeout: 20_000 });
        // (the scripts draw the same markup again 300 ms after the cart is read)
        await page.waitForTimeout(3_000);
        const drawn = flat(await page.locator(`${PRODUCT_LADDER} .won-ms__text`).first().textContent());
        const strip = flat(await page.locator(`${TOP_LADDER} .won-ms__text`).first().textContent());
        const rows = (await page.locator(`${PRODUCT_LADDER} .won-ms__list li span:first-child`).allTextContents()).map(flat);
        const froms = (await page.locator(`${PRODUCT_LADDER} .won-ms__list li span:last-child`).allTextContents()).map(flat);
        const data = await page.locator("#won-discounts-cart-data").evaluate((el) => (JSON.parse(el.textContent ?? "{}") as { lang: string; tx: Record<string, string> }));
        expect(data.lang).toBe(lang);
        const mine = (LOOK_TEXTS as Record<string, Record<string, string>>)[lang] ?? {};
        const text = (key: string) => mine[key] ?? own(lang, key);
        // The sentence: the merchant's in Czech, the extension's elsewhere — with the first step's reward by its name in this language.
        for (const [where, sentence] of [["server", served[0]!], ["server (2nd)", served[1]!], ["drawn", drawn], ["top strip", strip]] as const) {
          expect(sentence, `${lang} ${where}: the sentence`).toMatch(shaped(text("cart.ms_left")));
          expect(sentence, `${lang} ${where}: the reward's name`).toContain(text("cart.ms_ship"));
          expect(sentence.startsWith(MARK), `${lang} ${where}: the merchant's own text only where one is saved`).toBe(mine["cart.ms_left"] !== undefined);
        }
        expect(rows[0], `${lang}: the first step's name`).toBe(text("cart.ms_ship"));
        expect(froms.length, "a row per step").toBe(rows.length);
        for (const from of froms) expect(from, `${lang}: a step's amount`).toMatch(shaped(text("cart.ms_from")));
        // The cart's data: every one of its texts is this language's.
        for (const key of ["ms_left", "ms_done", "ms_from", "ms_ship", "ms_gift", "ms_disc", "code_label", "gift_done", "saved"]) expect(data.tx[key], `${lang} cart data ${key}`).toBe(text(`cart.${key}`));
        seen[lang] = { served, drawn, strip, rows, froms, tx: data.tx };
        if (lang === "cs") await shots(page, testInfo, "texts-ladder-product", PRODUCT_LADDER);
      });
    }
    await saveEvidence(testInfo, "texts-rewards", { at: new Date().toISOString(), theme: THEME_LABEL || null, profile: E2E_PROFILE, seen });
  });

  test("texts, the quantity table: Czech shows the merchant's, Slovak its one text, English the extension's", async ({ page }, testInfo) => {
    test.skip(!TEXTS || !TIERS, "the tiers seed with --texts");
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openThemePreview(page);
    const seen: Record<string, unknown> = {};
    for (const lang of ["cs", "sk", "en"] as const) {
      await test.step(`a page in ${lang}`, async () => {
        const mine = (LOOK_TEXTS as Record<string, Record<string, string>>)[lang] ?? {};
        const text = (key: string) => mine[key] ?? own(lang, key);
        await go(page, `${prefix(lang)}/products/${TIERS_PRODUCT_HANDLE}`);
        expect(await page.evaluate(() => document.documentElement.lang.slice(0, 2)), "the page's language").toBe(lang);
        const block = page.locator("[data-won-discounts-tiers]").first();
        await expect(block).toBeVisible({ timeout: 20_000 });
        const heading = flat(await block.locator(".won-tiers__heading").textContent());
        const quantities = (await block.locator(".won-tiers__qty").allTextContents()).map(flat);
        expect(heading, `${lang}: the table's heading`).toBe(text("tiers.heading"));
        expect(quantities.length).toBeGreaterThan(0);
        for (const quantity of quantities) expect(quantity, `${lang}: a row's quantity`).toMatch(shaped(text("tiers.row_qty")));
        seen[lang] = { heading, quantities };
        if (lang === "cs") await shots(page, testInfo, "texts-table", "[data-won-discounts-tiers]");
      });
    }
    await saveEvidence(testInfo, "texts-tiers", { at: new Date().toISOString(), theme: THEME_LABEL || null, seen });
  });

  test("texts, the line on a product card: Czech shows the merchant's, the other languages the extension's — and never anything but the line", async ({ page }, testInfo) => {
    test.skip(!TEXTS || E2E_PROFILE !== "cards", "the cards seed with --texts");
    test.setTimeout(240_000);
    const handle = CARDS_HANDLES[0]!;
    const card = `[data-won-discounts-card="${handle}"]`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await openThemePreview(page);
    const seen: Record<string, unknown> = {};
    for (const lang of ["cs", "sk", "en"] as const) {
      await test.step(`a page in ${lang}`, async () => {
        const mine = (LOOK_TEXTS as Record<string, Record<string, string>>)[lang] ?? {};
        await go(page, `${prefix(lang)}/search?q=${handle}&type=product`);
        expect(await page.evaluate(() => document.documentElement.lang.slice(0, 2)), "the page's language").toBe(lang);
        await expect(page.locator(card), "the card's line").toHaveCount(1);
        const line = flat(await page.locator(card).innerText());
        expect(line, `${lang}: the card's line`).toMatch(shaped(mine["cards.pct"] ?? own(lang, "cards.pct")));
        // No card of the page carries anything that is not a line (a product whose line says nothing gets none).
        const lines = (await page.locator("[data-won-discounts-card]").allInnerTexts()).map(flat);
        for (const text of lines) expect(text, `${lang}: a card's line is text, never markup`).not.toMatch(/<!--|-->|BEGIN app/u);
        seen[lang] = { line, lines };
        if (lang === "cs") await shots(page, testInfo, "texts-card", card);
      });
    }
    await saveEvidence(testInfo, "texts-cards", { at: new Date().toISOString(), theme: THEME_LABEL || null, seen });
  });

  test("look, Milníky: the ladder draws as the look picked, in the highlight colour; a step just reached flashes once, never with reduced motion", async ({ page }, testInfo) => {
    const look = LOOKS.milestones;
    test.skip(!look || !REWARDS, "the rewards seed with --looks milestones=…");
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openThemePreview(page);
    await go(page, `/products/${REWARDS_CART_HANDLE}`);
    await storefrontJson(page, "POST", "/cart/clear.js", {});
    await go(page, `/products/${REWARDS_CART_HANDLE}`);
    await assertExtensionAssetsLoaded(page, { match: "won-discounts" });
    const ladder = page.locator(PRODUCT_LADDER).first();
    await expect(ladder).toBeVisible({ timeout: 20_000 });
    const drawn = (root: string) =>
      page.evaluate((selector) => {
        const ms = document.querySelector(selector);
        if (!ms) return null;
        const show = (part: string) => getComputedStyle(ms.querySelector(part)!).display;
        const done = ms.querySelector(".won-ms__list li[data-done]");
        return {
          text: show(".won-ms__text"),
          track: show(".won-ms__track"),
          list: ms.querySelector(".won-ms__list") ? show(".won-ms__list") : null,
          accent: getComputedStyle(ms).getPropertyValue("--won-tiers-accent").trim(),
          doneColor: done ? getComputedStyle(done).color : null,
        };
      }, root);
    const before = await drawn(PRODUCT_LADDER);
    const strip = await drawn(TOP_LADDER);
    // The picked look, on the product page (the compact size); the top strip stays one sentence and a thin track.
    expect(before?.text, "the sentence always shows").not.toBe("none");
    expect([before?.track === "none", before?.list === "none"], `the look "${look!.preset}": [track hidden, list hidden]`).toEqual(look!.preset === "checklist" ? [true, false] : [true, true]);
    expect(strip?.track, "the top strip keeps its track").not.toBe("none");
    expect(before?.accent, "the highlight colour is the element's own").toBe("#1a7f45");
    await shots(page, testInfo, `look-milestones-${look!.preset}-product-empty`, PRODUCT_LADDER);

    // Steps reached, as a customer's cart reaches them. Every appearance of the mark of a step just reached is
    // recorded as it happens: when, with what animation, and when it went (the ladder is drawn again on every cart event).
    await page.evaluate((selector) => {
      const w = window as unknown as { __wonFlash: { step: number; at: number; gone: number | null; animation: string }[] };
      w.__wonFlash = [];
      const root = document.querySelector(selector)!;
      const look = () => {
        // (the mark of a step stays on it until the ladder is drawn again without it)
        const fresh = root.querySelector(".won-ms__list [data-new]");
        const step = fresh ? [...fresh.parentElement!.children].indexOf(fresh) : -1;
        const last = w.__wonFlash[w.__wonFlash.length - 1];
        const open = last && last.gone === null ? last : null;
        if (open && open.step !== step) open.gone = performance.now();
        if (fresh && open?.step !== step) w.__wonFlash.push({ step, at: performance.now(), gone: null, animation: getComputedStyle(fresh).animationName });
      };
      new MutationObserver(look).observe(root, { childList: true, subtree: true });
    }, PRODUCT_BLOCK);
    const flashes = () => page.evaluate(() => (window as unknown as { __wonFlash: { step: number; at: number; gone: number | null; animation: string }[] }).__wonFlash);
    const price = (await storefrontJson<{ variants: { price: number }[] }>(page, "GET", `/products/${REWARDS_CART_HANDLE}.js`)).variants[0]!.price;
    const amounts = await page.locator("#won-discounts-cart-data").evaluate((el) => {
      const data = JSON.parse(el.textContent ?? "{}") as { rw: { ship?: Record<string, number>; gifts?: { t: Record<string, number> }[] }; mk: string };
      const at = (m: Record<string, number> | undefined) => m?.[data.mk] ?? m?.[data.mk.split("@")[0]!] ?? 0;
      return [at(data.rw.ship), ...(data.rw.gifts ?? []).map((g) => at(g.t))].filter((n) => n > 0).sort((a, b) => a - b);
    });
    expect(amounts.length, "the seed's free shipping and gift amounts in the cart's currency").toBeGreaterThanOrEqual(2);
    const reach = async (amount: number, steps: number) => {
      await setQuantity(page, Math.ceil(amount / price));
      await expect(page.locator(`${PRODUCT_LADDER} .won-ms__list li[data-done]`)).toHaveCount(steps, { timeout: 30_000 });
      // The flash takes 0.7 s; the panel's own writes (a gift line) follow within a few seconds.
      await page.waitForTimeout(6_000);
    };

    // "Reduce motion": the first step is reached without any animation.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await reach(amounts[0]!, 1);
    const calm = await flashes();
    expect(calm.map((f) => f.step), "the step just reached is marked once").toEqual([0]);
    expect(calm[0]!.animation, "reduced motion: no flash").toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const reached = await drawn(PRODUCT_LADDER);
    if (look!.preset === "checklist") expect(reached?.doneColor, "a reached step is drawn in the highlight colour").toBe(LOOK_ACCENT_RGB);
    await shots(page, testInfo, `look-milestones-${look!.preset}-product-reached`, PRODUCT_LADDER);

    // The second step (a gift: the panel adds its line, the cart changes again): the flash runs once and to its end.
    await reach(amounts[1]!, 2);
    const flash = (await flashes()).slice(1);
    expect(flash.map((f) => f.step), "the second step is marked once, however many times the cart changed").toEqual([1]);
    expect(flash[0]!.animation, look!.blink ? "the step just reached flashes" : "no flash unless switched on").toBe(look!.blink ? "won-ms-new" : "none");
    if (flash[0]!.gone !== null) expect(flash[0]!.gone - flash[0]!.at, "the mark stays for the whole flash (0.7 s)").toBeGreaterThanOrEqual(700);

    // The cart page: the full ladder with the same look.
    await go(page, "/cart");
    const panel = "[data-won-discounts-cart]:visible .won-ms";
    await expect(page.locator(panel).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(3_000);
    await page.locator(panel).first().evaluate((el) => el.setAttribute("data-won-e2e-ladder", ""));
    const full = await drawn("[data-won-e2e-ladder]");
    expect(full?.list === "none", "the cart page").toBe(look!.preset === "sentence");
    await shots(page, testInfo, `look-milestones-${look!.preset}-cart`, "[data-won-e2e-ladder]");
    await saveEvidence(testInfo, `look-milestones-${look!.preset}`, { at: new Date().toISOString(), theme: THEME_LABEL || null, profile: E2E_PROFILE, look, before, strip, reached, calm, flash, full });
  });
  test("conversion: a look stored before the split draws the table and the ladder exactly as its old stylesheet did", async ({ page }, testInfo) => {
    test.skip(!CONVERTED || (!TIERS && !REWARDS), "the tiers or the rewards seed with --old-look");
    test.setTimeout(240_000);
    // What the code of before the split (dd48a75) printed for these settings: the colour, then on Pro the custom look, on the shared root.
    const scoped = scopeCss(OLD_LOOK.custom.css, OLD_ROOT);
    expect(scoped.ok).toBe(true);
    const oldCss =
      `${OLD_ROOT}{--won-tiers-accent:#1a7f45}` +
      (PRO ? `${OLD_ROOT}{--won-tiers-accent:${OLD_LOOK.custom.vars.accent};--won-tiers-tint:${OLD_LOOK.custom.vars.tint};--won-tiers-radius:${OLD_LOOK.custom.vars.radius}px}${scoped.ok ? scoped.css : ""}` : "");
    const handle = TIERS ? TIERS_PRODUCT_HANDLE : REWARDS_CART_HANDLE;
    const root = TIERS ? "[data-won-discounts-tiers]" : PRODUCT_LADDER;
    await page.setViewportSize({ width: 1440, height: 900 });
    await openThemePreview(page);
    await go(page, `/products/${handle}`);
    await storefrontJson(page, "POST", "/cart/clear.js", {});
    await go(page, `/products/${handle}`);
    await assertExtensionAssetsLoaded(page, { match: "won-discounts" });
    await expect(page.locator(root).first()).toBeVisible({ timeout: 20_000 });
    // Something for the colour to show on: a level in force, a step reached.
    if (TIERS) {
      await quantityInput(page).fill("5");
      await quantityInput(page).dispatchEvent("change");
      await expect(page.locator(`${root} .won-tiers__row[data-active="true"]`).first()).toBeAttached({ timeout: 10_000 });
    } else {
      await setQuantity(page, 5);
      await expect(page.locator(`${PRODUCT_LADDER} .won-ms__track i[data-done]`).first()).toBeAttached({ timeout: 30_000 });
      await page.waitForTimeout(3_000);
    }
    const style = page.locator("style#won-discounts-custom");
    await expect(style).toHaveCount(1);
    const newCss = (await style.textContent()) ?? "";
    expect(newCss, "the converted stylesheet has no shared root").not.toContain(":is(");
    expect(newCss.startsWith(oldCss.split(OLD_ROOT).join(".won-tiers")), "the table's part is the old stylesheet under the table's own root").toBe(true);
    const accent = await page.locator(root).first().evaluate((el) => getComputedStyle(el).getPropertyValue("--won-tiers-accent").trim());
    expect(accent, "the element still gets the colour").toBe(PRO ? OLD_LOOK.custom.vars.accent : "#1a7f45");
    const same: Record<string, boolean> = {};
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(800);
      await page.locator(root).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(400);
      const after = await page.locator(root).first().screenshot({ animations: "disabled" });
      await style.evaluate((el, css) => (el.textContent = css), oldCss);
      const before = await page.locator(root).first().screenshot({ animations: "disabled" });
      await style.evaluate((el, css) => (el.textContent = css), newCss);
      const element = TIERS ? "table" : "ladder";
      await saveImage(testInfo, `conversion-${element}-before-${width}`, before);
      await saveImage(testInfo, `conversion-${element}-after-${width}`, after);
      same[String(width)] = before.equals(after);
    }
    await saveEvidence(testInfo, `conversion-${TIERS ? "table" : "ladder"}`, { at: new Date().toISOString(), theme: THEME_LABEL || null, profile: E2E_PROFILE, plan: PRO ? "pro" : "free", oldCss, newCss, accent, same });
    expect(same, "the same pixels before and after, at both widths").toEqual({ "1440": true, "390": true });
  });
});
