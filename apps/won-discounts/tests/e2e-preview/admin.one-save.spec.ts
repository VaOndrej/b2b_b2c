import { expect, test, type Page, type Request } from "@playwright/test";

import { open, typeInto } from "./support";

// One save per page, like Shopify's own (audit 2026-11-03 F3, shell/one-save.tsx): the page has one form with the App
// Bridge save bar and no Save of its own. The bar is Shopify's and is not in the harness, so a test saves the way the
// bar does: it submits the page's form. `?save=ok` makes the harness answer "saved" (nothing is stored), so the chain
// goes on: the page's fields to the page, then Sčítá se s to its own action with the fields of its old form.

const PAGE_FORM = "form[data-save-bar]";

/** Every POST the page sends while `act` runs, as the fields each one carried. */
async function posts(page: Page, act: () => Promise<void>, settle: () => Promise<void>): Promise<URLSearchParams[]> {
  const sent: Request[] = [];
  const listen = (request: Request) => {
    if (request.method() === "POST") sent.push(request);
  };
  page.on("request", listen);
  await act();
  await settle();
  page.off("request", listen);
  return sent.map((request) => new URLSearchParams(request.postData() ?? ""));
}

/** The name of the first level field of the whole-store discount (a closed editor still posts it). */
const levelField = (page: Page) =>
  page.evaluate(() => document.querySelector("[data-won-tiers-editor] s-number-field")?.getAttribute("name") ?? "");

/** Ticks "Slevové kódy" in Sčítá se s the way a merchant does (the Polaris checkbox's own input). */
const tickCode = (page: Page) => page.locator('[data-won-module-combine="tiers"] s-checkbox[value="code"] input[type="checkbox"]').click();

const saveBarSave = (page: Page) => page.evaluate((sel) => document.querySelector<HTMLFormElement>(sel)!.requestSubmit(), PAGE_FORM);

test("Množstevní slevy: no Save button on the page — the save bar is the one save, on Free and on Pro, in every view", async ({ page }) => {
  for (const path of ["tiers", "tiers?plan=pro"]) {
    await open(page, path);
    for (const view of ["global", "exceptions"]) {
      await page.locator(`[data-won-view-tile="${view}"]`).click();
      await expect(page.locator(`${PAGE_FORM} s-button[type="submit"]:visible`), `${path} ${view}`).toHaveCount(0);
      await expect(page.locator('[data-won-module-combine="tiers"] s-button:visible'), `${path} ${view}`).toHaveCount(0);
    }
    // Sčítá se s is a part of the page's form: the save bar sees its changes and Discard resets it.
    await page.locator('[data-won-view-tile="global"]').click();
    expect(await page.locator(`${PAGE_FORM} [data-won-module-combine="tiers"]`).count(), path).toBe(1);
  }
});

test("Množstevní slevy: a level and Sčítá se s changed go out on ONE save — the page's fields to the page, the list to /app/combine", async ({ page }) => {
  await open(page, "tiers?plan=pro&save=ok");
  const field = await levelField(page);
  expect(field).not.toBe("");
  await typeInto(page, field, "12");
  const before = await page.locator('[data-won-module-combine="tiers"] s-checkbox[value="code"]').evaluate((el) => (el as HTMLElement & { checked: boolean }).checked);
  await tickCode(page);
  const sent = await posts(
    page,
    () => saveBarSave(page),
    () => expect.poll(async () => page.evaluate(() => document.querySelectorAll("[data-won-part-refusal]").length)).toBe(0),
  );
  await expect.poll(() => sent.length).toBe(2);
  const [tiers, combine] = sent;
  // The page's own form, as before: its fields, no list.
  expect(tiers!.get("intent")).toBe("save");
  expect(tiers!.get(field)).toBe("12");
  expect([...tiers!.keys()].some((name) => name.startsWith("part:") || name.startsWith("combine"))).toBe(false);
  // Sčítá se s, as its own form posted it: intent, module, version, the marker and the ticked types; nothing of the page.
  expect(combine!.get("intent")).toBe("save");
  expect(combine!.get("combineModule")).toBe("tiers");
  expect(combine!.get("combinePosted")).toBe("1");
  expect(combine!.getAll("combineTypes").includes("code")).toBe(!before);
  expect(combine!.has(field)).toBe(false);
  await expect(page.locator("s-page")).toContainText("Uloženo");
});

test("Množstevní slevy: Sčítá se s alone changed posts only the list; the levels are not saved again", async ({ page }) => {
  await open(page, "tiers?plan=pro&save=ok");
  await tickCode(page);
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(new URLSearchParams(request.postData() ?? "").get("combineModule") ?? "page");
  });
  await saveBarSave(page);
  await expect.poll(() => sent).toEqual(["tiers"]);
});

test("Množstevní slevy: a refused part says so and claims nothing; a refused page posts no part at all", async ({ page }) => {
  // The page saves, Sčítá se s is refused: the page says which part was not saved and why.
  await open(page, "tiers?plan=pro&save=combine-fails");
  await typeInto(page, await levelField(page), "12");
  await tickCode(page);
  await saveBarSave(page);
  const refusal = page.locator("[data-won-part-refusal]");
  await expect(refusal).toBeVisible();
  await expect(refusal).toContainText("Neuloženo: Sčítá se s");
  await expect(refusal).not.toContainText("Uloženo");

  // The page is refused (the harness's usual answer): nothing else goes out, the ticked box stays ticked, unsaved.
  await open(page, "tiers?plan=pro");
  await typeInto(page, await levelField(page), "12");
  const box = page.locator('[data-won-module-combine="tiers"] s-checkbox[value="code"]');
  await tickCode(page);
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") sent.push(new URLSearchParams(request.postData() ?? "").get("combineModule") ?? "page");
  });
  await saveBarSave(page);
  await expect(page.locator("s-page")).toContainText("Tohle je náhled obrazovky");
  await page.waitForTimeout(500);
  expect(sent).toEqual(["page"]);
  expect(await box.evaluate((el) => (el as HTMLElement & { checked: boolean }).checked)).toBe(true);
});

test("Množstevní slevy: Discard puts the levels and Sčítá se s back as stored", async ({ page }) => {
  await open(page, "tiers?plan=pro");
  const box = page.locator('[data-won-module-combine="tiers"] s-checkbox[value="code"]');
  const before = await box.evaluate((el) => (el as HTMLElement & { checked: boolean }).checked);
  await tickCode(page);
  expect(await box.evaluate((el) => (el as HTMLElement & { checked: boolean }).checked)).toBe(!before);
  await page.evaluate((sel) => document.querySelector<HTMLFormElement>(sel)!.reset(), PAGE_FORM);
  await expect.poll(() => page.locator('[data-won-module-combine="tiers"] s-checkbox[value="code"]').evaluate((el) => (el as HTMLElement & { checked: boolean }).checked)).toBe(before);
});
