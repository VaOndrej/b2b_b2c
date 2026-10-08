import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { open, sideways, typeInto } from "./support";

// Překlady, the look of each storefront element and "Časté kombinace" (úkoly 8 a 9), in a real browser against
// the dev harness. What only a browser can show: a language is added and removed without a reload, a text that
// loses its `{…}` part says so while it is typed, the CSV really downloads and an uploaded one is planned before
// anything is saved, a look's form posts what was picked, and a combination opens in the manual cart.
// The harness saves nothing: a save answers "Tohle je náhled obrazovky".

const PREVIEW_ONLY = "Tohle je náhled obrazovky";
const tables = (page: Page) => page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('input[name="lang"]')].map((el) => el.value));

/** The fields of the next form the page posts. */
async function posted(page: Page, act: () => Promise<void>): Promise<URLSearchParams> {
  const [request] = await Promise.all([page.waitForRequest((r) => r.method() === "POST"), act()]);
  return new URLSearchParams(request.postData() ?? "");
}

test("Překlady: a language is added from the shop's languages and removed again; Free stops at two", async ({ page }) => {
  await open(page, "translations?plan=pro");
  expect(await tables(page)).toEqual(["cs", "sk"]);
  // The picker offers only what Shopify has on and the page does not list yet.
  expect(await page.evaluate(() => [...document.querySelectorAll('s-select[name="add"] s-option')].map((o) => o.getAttribute("value")))).toEqual(["de", "en"]);
  await typeInto(page, "add", "en");
  await page.locator("s-button", { hasText: "Přidat jazyk" }).click();
  await expect.poll(() => tables(page)).toEqual(["cs", "sk", "en"]);
  // The new table is open and carries the extension's English texts as the defaults.
  await expect(page.locator("section#lang-en > button")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator('section#lang-en [data-won-text="tiers.heading"] [data-won-text-default]')).not.toBeEmpty();
  expect(await page.evaluate(() => [...document.querySelectorAll('s-select[name="add"] s-option')].map((o) => o.getAttribute("value")))).toEqual(["de"]);
  await page.locator("section#lang-en s-button", { hasText: "Odebrat jazyk" }).click();
  await expect.poll(() => tables(page)).toEqual(["cs", "sk"]);
  // The default language has no "remove".
  await expect(page.locator("section#lang-cs s-button", { hasText: "Odebrat jazyk" })).toHaveCount(0);

  // Free with two tables: no picker, the amber note with what Pro gives.
  await open(page, "translations");
  await expect(page.locator("[data-won-add-language]")).toHaveCount(0);
  await expect(page.locator("section#add")).toContainText("Pro");
  // Free with one: the second language can still be added, then the picker goes.
  await open(page, "translations?state=empty");
  expect(await tables(page)).toEqual(["cs"]);
  await page.locator("s-button", { hasText: "Přidat jazyk" }).click();
  await expect.poll(async () => (await tables(page)).length).toBe(2);
  await expect(page.locator("[data-won-add-language]")).toHaveCount(0);
});

test("Překlady: a text that loses its {…} part says so while it is typed; no sideways scroll at 390 px", async ({ page }) => {
  await open(page, "translations?plan=pro");
  const row = page.locator('section#lang-cs [data-won-text="cart.saved"]');
  await typeInto(page, "tx.cs.cart.saved", "Ušetříte celkem");
  await expect(row).toContainText("V textu chybí {amount}");
  await typeInto(page, "tx.cs.cart.saved", "Ušetříte {amount} a {extra}");
  await expect(row).toContainText("Text obsahuje {extra}");
  await typeInto(page, "tx.cs.cart.saved", "Celkem ušetříte {amount}");
  await expect(row).not.toContainText("V textu chybí");
  await expect(row).not.toContainText("Text obsahuje");
  // The table's summary follows the form too.
  await typeInto(page, "tx.cs.tiers.heading", "");
  await typeInto(page, "tx.cs.cart.saved", "");
  await expect(page.locator("section#lang-cs > button")).not.toContainText("Kup víc");
  for (const path of ["translations?plan=pro", "translations?state=import&plan=pro", "translations?state=downgraded", "translations?state=no-scope&locale=en"]) {
    await open(page, path, 390);
    expect(await sideways(page), path).toBeLessThanOrEqual(0);
  }
});

test("Překlady: the CSV downloads, an upload is planned first — one row changed, one refused with its reason — and nothing is saved before the confirmation", async ({ page }) => {
  await open(page, "translations?plan=pro");
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("s-button", { hasText: "Stáhnout CSV" }).click()]);
  expect(download.suggestedFilename()).toBe("won-discounts-translations.csv");
  const csv = await readFile(await download.path(), "utf8");
  expect(csv).toContain("Kúp viac, zaplať menej");
  expect(csv).toContain("Ušetříte celkem {amount}");
  // One text changed, one that lost its {amount}.
  const edited = csv.replace("Kúp viac, zaplať menej", "Kúp viac a ušetri").replace("Ušetříte celkem {amount}", "Ušetříte celkem");
  await page.locator("[data-won-csv-file]").setInputFiles({ name: "preklady.csv", mimeType: "text/csv", buffer: Buffer.from(edited, "utf8") });
  const preview = page.locator("[data-won-import-preview]");
  await expect(preview).toBeVisible();
  await expect(preview.locator("[data-won-import-changes] li")).toHaveCount(1);
  await expect(preview.locator("[data-won-import-changes] li")).toContainText("Kúp viac a ušetri");
  await expect(preview.locator("[data-won-import-refused] li")).toHaveCount(1);
  await expect(preview.locator("[data-won-import-refused] li")).toContainText("{amount}");
  // Nothing changed in the tables yet.
  expect(await page.evaluate(() => document.querySelector<HTMLElement & { value: string }>('[name="tx.sk.tiers.heading"]')?.value)).toBe("Kúp viac, zaplať menej");
  // The confirmation posts the same file with the intent that saves.
  const form = await posted(page, () => preview.locator("s-button", { hasText: "Uložit změny z importu" }).click());
  expect(form.get("intent")).toBe("import-apply");
  // (the browser reads the file without the byte order mark Excel needs in the download)
  expect(form.get("csv")).toBe(edited.replace(/^\uFEFF/, ""));
  await expect(page.locator("s-page")).toContainText(PREVIEW_ONLY);

  // "Zrušit import" drops the plan; on Free the file cannot be picked at all.
  await open(page, "translations?state=import&plan=pro");
  await expect(page.locator("[data-won-import-preview]")).toBeVisible();
  await page.locator("s-button", { hasText: "Zrušit import" }).click();
  await expect(page.locator("[data-won-import-preview]")).toHaveCount(0);
  await open(page, "translations");
  await expect(page.locator("[data-won-csv-file]")).toBeDisabled();
});

test("Překlady without the permission: once the merchant grants it, the page tells the app to look — it does not wait for a manual reload", async ({ page, baseURL }) => {
  // The grant dialog is Shopify's (App Bridge, only inside the admin's frame): the page runs in a frame here and
  // the dialog answers "granted".
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent(`<iframe src="${baseURL}/dev/preview/translations?state=no-scope" style="width:100%;height:880px;border:0"></iframe>`);
  const frame = page.frames()[1]!;
  await frame.waitForLoadState("networkidle");
  await frame.waitForFunction(() => customElements.get("s-page") !== undefined);
  const grant = frame.locator("s-button", { hasText: "Povolit čtení jazyků" });
  await expect(grant).toBeVisible();
  await expect(frame.locator("[data-won-add-language]")).toHaveCount(0);
  const asked: string[][] = [];
  await page.exposeFunction("wonAsked", (scopes: string[]) => asked.push(scopes));
  await frame.evaluate(() => {
    const w = window as unknown as { shopify: unknown; wonAsked: (scopes: string[]) => Promise<void> };
    w.shopify = { scopes: { request: async (scopes: string[]) => (await w.wonAsked(scopes), { result: "granted-all" }) } };
  });
  const [request] = await Promise.all([page.waitForRequest((r) => r.method() === "POST"), grant.click()]);
  expect(asked).toEqual([["read_locales"]]);
  expect(new URLSearchParams(request.postData() ?? "").get("intent")).toBe("scopes");
});

for (const [path, tile, element, preset] of [
  ["rewards", "web", "milestones", "checklist"],
  ["rewards?plan=pro", "web", "milestones", "sentence"],
  ["outlet?plan=pro", "info", "outlet", "countdown"],
  ["outlet?plan=pro", "info", "outlet", "strip"],
  ["campaigns?plan=pro", "places", "campaign", "strip"],
  ["campaigns?plan=pro", "places", "campaign", "card"],
] as const) {
  test(`the look of ${element} on ${path}: "${preset}" is picked, previewed and posted with its colour`, async ({ page }) => {
    await open(page, path);
    await page.locator(`[data-won-view-tile="${tile}"]`).click();
    const form = page.locator(`[data-won-look-form="${element}"]`);
    await expect(form).toBeVisible();
    // Every ready-made look has a live preview with the extension's own markup.
    const looks = await form.locator('input[name="preset"]').count();
    expect(looks).toBe(3);
    expect(await form.locator("[role=radiogroup] label [aria-hidden=true]").count()).toBeGreaterThanOrEqual(looks);
    await form.locator(`label:has(input[name="preset"][value="${preset}"])`).click();
    await expect(form.locator(`input[name="preset"][value="${preset}"]`)).toBeChecked();
    await form.locator('label:has(input[name="accent"][value="green"])').click();
    const sent = await posted(page, () => form.locator("s-button", { hasText: "Uložit vzhled" }).click());
    expect(sent.get("intent")).toBe("save");
    expect(sent.get("element")).toBe(element);
    expect(sent.get("preset")).toBe(preset);
    expect(sent.get("accent")).toBe("green");
    // Free: the locked Pro fields are not in the form at all.
    expect(sent.has("look.css")).toBe(path.includes("plan=pro"));
    await expect(form).toContainText(PREVIEW_ONLY);
    await open(page, path, 390);
    await page.locator(`[data-won-view-tile="${tile}"]`).click();
    expect(await sideways(page)).toBeLessThanOrEqual(0);
  });
}

test("the table's look: the ready-made look, the colour and (Pro) the CSS typed go out in ONE save, and the preview follows them", async ({ page }) => {
  await open(page, "tiers?plan=pro&state=custom");
  await page.locator('[data-won-view-tile="table"]').click();
  const form = page.locator('[data-won-look-form="tiers"]');
  await expect(form).toBeVisible();
  await typeInto(page, "look.css", ".won-tiers__row { letter-spacing: 3px; }");
  await expect.poll(() => form.evaluate((el) => getComputedStyle(el.querySelector(".won-tiers__row") ?? el).letterSpacing)).toBe("3px");
  // The four ready-made looks are picked in the same form: the preview's table changes its class at once.
  await form.locator('label:has(input[name="preset"][value="tiles"])').click();
  await expect(form.locator(".won-tiers").first()).toHaveClass(/won-tiers--tiles/);
  await form.locator('label:has(input[name="accent"][value="violet"])').click();
  await expect(form.locator("s-button", { hasText: "Uložit vzhled" })).toHaveCount(1);
  const sent = await posted(page, () => form.locator("s-button", { hasText: "Uložit vzhled" }).click());
  expect([sent.get("element"), sent.get("preset"), sent.get("accent")]).toEqual(["tiers", "tiles", "violet"]);
  expect(sent.get("look.css")).toBe(".won-tiers__row { letter-spacing: 3px; }");
  await expect(form).toContainText(PREVIEW_ONLY);
  // The page's own form (the levels) carries nothing of the look, and offers no second place to pick it.
  await expect(page.locator('form[data-save-bar] input[name="preset"]')).toHaveCount(0);
  expect(await page.locator('input[type="radio"][name="preset"]').count()).toBe(4);
  // Free: the same section saves the look and the colour; the custom look's fields are locked and not posted.
  await open(page, "tiers");
  await page.locator('[data-won-view-tile="table"]').click();
  const free = page.locator('[data-won-look-form="tiers"]');
  await free.locator('label:has(input[name="preset"][value="chips"])').click();
  const freeSent = await posted(page, () => free.locator("s-button", { hasText: "Uložit vzhled" }).click());
  expect([freeSent.get("element"), freeSent.get("preset"), freeSent.has("look.css")]).toEqual(["tiers", "chips", false]);
});

test("the cart and the top strip have their own look on Milníky (Pro): the CSS typed styles the sample panel and is posted for the cart", async ({ page }) => {
  await open(page, "rewards?plan=pro");
  await page.locator('[data-won-view-tile="web"]').click();
  const form = page.locator('[data-won-look-form="cart"]');
  // Nothing set: the section is closed; it has no ready-made looks and no colour of its own to pick.
  await page.locator("section#look-cart > button").click();
  await expect(form).toBeVisible();
  await expect(form.locator('input[name="preset"], input[name="accent"]')).toHaveCount(0);
  await form.evaluate((el) => {
    const field = el.querySelector<HTMLElement & { value: string }>('[name="look.css"]')!;
    field.value = ".won-cart__saved { letter-spacing: 2px; }";
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(() => form.evaluate((el) => getComputedStyle(el.querySelector(".won-cart__saved") ?? el).letterSpacing)).toBe("2px");
  const sent = await posted(page, () => form.locator("s-button", { hasText: "Uložit vzhled" }).click());
  expect([sent.get("element"), sent.get("look.css")]).toEqual(["cart", ".won-cart__saved { letter-spacing: 2px; }"]);
  // The ladder's own look is next to it, its own form.
  await expect(page.locator('[data-won-look-form="milestones"]')).toBeVisible();
});

test("Časté kombinace: Pro lists every combination with its state and the setting behind a warning; one opens in the manual cart", async ({ page }) => {
  await open(page, "try-cart?combos=on&plan=pro");
  const rows = page.locator("[data-won-combo]");
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(12);
  const summary = await page.locator("section#combos").innerText();
  const warnings = await page.locator('[data-won-combo-status="warning"]').count();
  expect(summary).toContain(`${count - warnings} v pořádku, ${warnings} upozornění`);
  // A warning says what happened and links to the setting behind it; a combination in order has no finding.
  for (const row of await page.locator('[data-won-combo-status="warning"]').all()) {
    expect(await row.locator("[data-won-combo-finding]").count()).toBeGreaterThan(0);
    for (const link of await row.locator("[data-won-combo-finding] s-link").all()) expect(await link.getAttribute("href")).toMatch(/^\/app\//);
  }
  await expect(page.locator('[data-won-combo-status="ok"] [data-won-combo-finding]')).toHaveCount(0);

  // "Otevřít v košíku" carries the combination's id; the harness serves the same page under /dev/preview.
  const href = await rows.first().locator("s-link", { hasText: "Otevřít v košíku" }).getAttribute("href");
  expect(href).toMatch(/^\/app\/try-cart\?scenario=/);
  const id = new URL(href ?? "", "http://x").searchParams.get("scenario") ?? "";
  await open(page, `try-cart?combos=on&plan=pro&scenario=${encodeURIComponent(id)}`);
  await expect(page.locator("s-page")).toContainText("Košík je připravený podle kombinace");
  // The cart holds the combination's product and quantity, and nothing is calculated yet.
  expect(Number(await page.evaluate(() => document.querySelector<HTMLElement & { value: string }>('[name="quantity"]')?.value))).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.querySelector<HTMLInputElement>('input[name="variantId"]')?.value)).toMatch(/^gid:\/\/shopify\/ProductVariant\//);
  // An id that is not a combination opens the page as usual.
  await open(page, "try-cart?combos=on&plan=pro&scenario=nope");
  await expect(page.locator("s-page")).not.toContainText("Košík je připravený podle kombinace");
});

test("Časté kombinace: Free sees the counts and a locked list, the home tile says the same counts; nothing overflows at 390 px", async ({ page }) => {
  await open(page, "try-cart?combos=on&plan=pro");
  const pro = (await page.locator("section#combos > *").first().innerText()).match(/\d+ v pořádku, \d+ upozornění/)?.[0];
  expect(pro).toBeTruthy();
  await open(page, "try-cart?combos=on");
  await expect(page.locator("[data-won-combo]")).toHaveCount(0);
  await expect(page.locator("[data-won-combos-locked]")).toBeVisible();
  await expect(page.locator("section#combos")).toContainText(/\d+ v pořádku, \d+ upozornění/);
  // A sample product (no product stored): the page says so and offers nothing to open.
  await open(page, "try-cart?combos=sample&plan=pro");
  await expect(page.locator("section#combos")).toContainText("ukázkovým");
  await expect(page.locator("[data-won-combo] s-link", { hasText: "Otevřít v košíku" })).toHaveCount(0);
  await open(page, "overview?combos=on&plan=pro");
  await expect(page.locator("s-page")).toContainText(pro ?? "");
  for (const path of ["try-cart?combos=on&plan=pro", "try-cart?combos=on", "try-cart?combos=on&plan=pro&locale=en", "overview?combos=on"]) {
    await open(page, path, 390);
    expect(await sideways(page), path).toBeLessThanOrEqual(0);
  }
});
