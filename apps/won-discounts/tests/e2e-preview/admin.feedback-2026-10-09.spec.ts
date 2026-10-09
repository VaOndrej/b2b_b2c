import { expect, test } from "@playwright/test";

import { open, sideways } from "./support";

// Feedback 9 Oct 2026 (docs/won-discounts/plan-zmen-2026-10-09.md), in a real browser against the dev harness:
// what only real input events and a real layout can show.

test("Milníky: the preview's slider moves with the keyboard and the mouse, and the ladder follows", async ({ page }) => {
  await open(page, "rewards");
  const range = page.locator("[data-won-ms-preview-range]");
  const cart = range.locator("xpath=..").locator("span");
  const before = await cart.innerText();
  expect(await range.inputValue()).toBe("45");
  await range.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => range.inputValue()).toBe("46");
  await expect(cart).not.toHaveText(before);
  // A real drag to the right end: every step is reached.
  const box = (await range.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.46, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await range.inputValue())).toBeGreaterThan(95);
  await expect(page.locator('[data-won-ms-preview-step="ahead"]')).toHaveCount(0);
});

test("Ochrana marže: while the purchase costs are being read the page follows it and ends by itself", async ({ page }) => {
  // The fixture's read ends 4 s from now; nothing is clicked and the page is not reloaded.
  await open(page, `margin?state=running&until=${Date.now() + 4000}`);
  await expect(page.locator("body")).toContainText("Právě načítáme nákupní ceny");
  let navigations = 0;
  page.on("framenavigated", () => navigations++);
  await expect(page.locator("body")).not.toContainText("Právě načítáme nákupní ceny", { timeout: 15_000 });
  expect(navigations).toBe(0);
  // Once it has ended the page stops asking.
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/dev/preview/margin")) reads++;
  });
  await page.waitForTimeout(6000);
  expect(reads).toBe(0);
});

test("Množstevní slevy: the tile \"Tabulka na webu\" carries the state of the table, in the tiles' own words", async ({ page }) => {
  const tile = page.locator('[data-won-view-tile="table"]');
  for (const [path, placement, label] of [
    ["tiers", "in_theme", "Aktivní"],
    ["tiers?state=empty", "missing", "Vyžaduje pozornost"],
    ["tiers?state=block-unknown", "unknown", null],
  ] as const) {
    await open(page, path);
    // The section under the tile says where the table stands; the tile says the same with the tiles' labels.
    await expect(page.locator(`section#block [data-won-placement="${placement}"]`)).toHaveCount(1);
    if (label) await expect(tile.locator("[data-won-state]")).toHaveText(label);
    else await expect(tile.locator("[data-won-state]")).toHaveCount(0);
  }
});

test("Překlady: the side list, \"Přidat jazyk\" first, and every language says whether it is complete", async ({ page }) => {
  await open(page, "translations?plan=pro&state=downgraded");
  // The side list names the page's sections in order: adding a language is the first one.
  const nav = page.locator("[data-won-section-nav]");
  // (A language's dot is read out before its name: "Aktivní: čeština".)
  await expect(nav.locator("a")).toHaveText(["Přidat jazyk", /čeština$/, /slovenština$/, /němčina$/, "Export a import"]);
  expect(await page.evaluate(() => [...document.querySelectorAll(".won-jump__body section[id]")].map((el) => el.id).filter((id) => id === "add" || id.startsWith("lang-") || id === "csv"))).toEqual(["add", "lang-cs", "lang-sk", "lang-de", "csv"]);
  // The extension's own languages are complete; German has one text of its own and lacks the rest.
  await expect(page.locator("section#lang-cs > button")).toContainText("Hotovo");
  await expect(page.locator("section#lang-sk > button")).toContainText("Hotovo");
  await expect(page.locator("section#lang-de > button")).toContainText(/Chybí \d+ text/);
  await expect(nav.locator('a[href="#lang-de"] [data-won-dot]')).toHaveAttribute("data-won-dot", "attention");
  await expect(nav.locator('a[href="#lang-cs"] [data-won-dot]')).toHaveAttribute("data-won-dot", "active");
  // A click opens the closed section and brings it into view.
  await expect(page.locator("section#lang-de > button")).toHaveAttribute("aria-expanded", "false");
  await nav.locator('a[href="#lang-de"]').click();
  await expect(page.locator("section#lang-de > button")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("section#lang-de")).toBeInViewport();
  // 390 px: the list is one row above the sections and nothing scrolls sideways.
  await open(page, "translations?plan=pro&state=downgraded", 390);
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test("Přehled: the Překlady tile says which languages are complete and which lack texts", async ({ page }) => {
  await open(page, "overview?state=languages");
  const tile = page.locator('[data-won-tile="translations"]');
  await expect(tile).toContainText("Hotovo: čeština a slovenština");
  await expect(tile).toContainText(/Němčina: chybí \d+ text/);
});

test("Ceny na kartách: while it is on, one click opens the storefront's cards and the live theme's editor", async ({ page }) => {
  // On (the `custom` fixture): both links, each in a new tab.
  await open(page, "tiers?plan=pro&state=custom#cards");
  const row = page.locator("section#cards [data-won-cards-view]");
  await expect(row.locator("s-button", { hasText: "Zobrazit na webu" })).toHaveAttribute("href", "https://won-dev.myshopify.com/collections/all");
  await expect(row.locator("s-button", { hasText: "Otevřít v úpravě vzhledu" })).toHaveAttribute("href", "https://won-dev.myshopify.com/admin/themes/current/editor?template=collection");
  await expect(row.locator("s-button").first()).toHaveAttribute("target", "_blank");
  // Off: nothing to see on the site, so no link to it.
  await open(page, "tiers#cards");
  await expect(page.locator("section#cards [data-won-cards-view]")).toHaveCount(0);
});

test("Množstevní slevy: the whole-store discount is a list; its fields open only after \"Upravit\" / \"Přidat\"", async ({ page }) => {
  const list = page.locator("[data-won-tiers-list]");
  const editor = page.locator("[data-won-tiers-editor]");
  // A stored discount: one row that says it runs and what it gives; no field to change by accident.
  await open(page, "tiers");
  await expect(list).toHaveAttribute("data-won-tiers-list", "stored");
  await expect(list.locator("[data-won-state]")).toHaveText("Aktivní");
  await expect(list).toContainText("Od ");
  await expect(editor).toBeHidden();
  // The closed editor is still in the form: a save posts the stored levels unchanged (never an empty set).
  const rows = await page.evaluate(() => [...new FormData(document.querySelector<HTMLFormElement>("form[data-save-bar]")!).keys()].filter((name) => name.includes("row") || name.includes("qty")).length);
  expect(rows).toBeGreaterThan(0);
  await list.locator("s-button", { hasText: "Upravit" }).click();
  await expect(editor).toBeVisible();
  await list.locator("s-button", { hasText: "Zavřít úpravy" }).click();
  await expect(editor).toBeHidden();
  // No discount yet: an empty list and one button that opens the fields.
  await open(page, "tiers?state=empty");
  await expect(list).toHaveAttribute("data-won-tiers-list", "empty");
  await expect(list).toContainText("Zatím žádná množstevní sleva");
  await expect(editor).toBeHidden();
  await list.locator("s-button", { hasText: "Přidat množstevní slevu" }).click();
  await expect(editor).toBeVisible();
  // A refused save opens the editor by itself: the error is next to its field, not behind a closed list.
  await open(page, "tiers?result=invalid");
  await expect(editor).toBeVisible();
});

test("Milníky: the preview's slider is outside the form, so walking the ladder is never an unsaved change", async ({ page }) => {
  await open(page, "rewards");
  // What the Shopify save bar watches: the form's own input / change events and its fields.
  await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>("form[data-save-bar]")!;
    (window as unknown as { __formEvents: number }).__formEvents = 0;
    for (const type of ["input", "change"]) form.addEventListener(type, () => ((window as unknown as { __formEvents: number }).__formEvents += 1));
  });
  const range = page.locator("[data-won-ms-preview-range]");
  expect(await range.evaluate((el) => el.closest("form") === null && (el as HTMLInputElement).form === null)).toBe(true);
  await range.focus();
  for (let i = 0; i < 10; i += 1) await page.keyboard.press("ArrowRight");
  await expect.poll(() => range.inputValue()).toBe("55");
  expect(await page.evaluate(() => (window as unknown as { __formEvents: number }).__formEvents)).toBe(0);
  await expect(page.locator("[data-won-ms-preview-tool]")).toHaveCount(0);
  // Beside the steps on a wide page.
  const [aside, steps] = await Promise.all([page.locator("[data-won-ms-preview-aside]").boundingBox(), page.locator("section#steps").boundingBox()]);
  expect(aside!.x).toBeGreaterThan(steps!.x + steps!.width - 1);
});

test("Množstevní slevy: the preview shows the labelled sample product at a round price, not a shop product for 20 Kč", async ({ page }) => {
  await open(page, "tiers");
  const preview = page.locator("section#global");
  await expect(preview).toContainText("Ukázkový produkt");
  await expect(preview).toContainText("1.000,00 Kč");
});

test("Ochrana marže: \"Nastavení podle kolekcí\" says what it is for, how to fill it in and what the whole store has", async ({ page }) => {
  await open(page, "margin?plan=pro#collections");
  const section = page.locator("section#collections");
  await expect(section.locator("[data-won-margin-collections-how] li")).toHaveCount(3);
  await expect(section).toContainText("Celý obchod má teď: minimální marže 20 % · bez nákupní ceny sleva nejvýš 40 %.");
  await expect(section.locator("s-number-field[details]").first()).toHaveAttribute("details", "Kolik vám má z ceny nejmíň zůstat u produktů této kolekce.");
});

test("Přehled: under the tiles, what Won watches and what it brought — Free without numbers, Pro with them", async ({ page }) => {
  await open(page, "overview?state=margin&watch=some&plan=pro");
  const block = page.locator("section#watch");
  expect(await page.evaluate(() => document.querySelector("[data-won-tiles]")!.compareDocumentPosition(document.querySelector("section#watch")!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  await expect(block.locator('[data-won-watch-margin="some"]')).toContainText("Hlídá a zkracuje 2 slevy u 14 variant");
  await expect(block.locator("s-button", { hasText: "Zobrazit, kde zasahuje" })).toHaveAttribute("href", "/app/margin#impact");
  await expect(block.locator("[data-won-watch-number]")).toHaveCount(4);
  await expect(block.locator("[data-won-watch-soon]")).toContainText("Připravujeme");
  // Free: the same answer, no number (the list of where and by how much is Pro).
  await open(page, "overview?state=margin&watch=some");
  await expect(block.locator('[data-won-watch-margin="some"]')).toContainText("některé slevy zkracuje");
  await expect(block.locator('[data-won-watch-margin="some"]')).not.toContainText(/\d/);
  // Nothing goes below the floor; protection off.
  await open(page, "overview?state=margin");
  await expect(block.locator('[data-won-watch-margin="none"]')).toContainText("Žádná aktivní sleva teď pod vaši hranici nejde");
  await open(page, "overview?state=margin-off");
  await expect(block.locator('[data-won-watch-margin="off"]')).toContainText("Vypnutá");
  await expect(block.locator("s-button", { hasText: "Zapnout ochranu marže" })).toHaveAttribute("href", "/app/margin");
});
