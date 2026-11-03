import { expect, test } from "@playwright/test";

import { open, sideways } from "./support";

// Views of a module page (docs/won-discounts/matice-pred-review.md), what only a browser can check: a view picked
// by a click, the pointer, the width of a phone.

test("no view of a page shows a Save of its own: the save bar is the one save", async ({ page }) => {
  const saves = page.locator("s-button:visible", { hasText: /^Uložit$/ });
  const views: [string, string[]][] = [
    ["tiers?plan=pro", ["global", "table", "exceptions"]],
    ["margin?plan=pro", ["collections", "costs", "impact"]],
  ];
  for (const [path, tiles] of views) {
    await open(page, path);
    for (const tile of tiles) {
      const at = page.locator(`[data-won-view-tile="${tile}"]`).first();
      if ((await at.count()) > 0) await at.click();
      await expect(saves, `${path} ${tile}`).toHaveCount(0);
    }
  }
  for (const path of ["rewards?plan=pro", "settings", "translations?plan=pro", "rule-editor", "rule-editor?rule=new&recipe=percent"]) {
    await open(page, path);
    await expect(saves, path).toHaveCount(0);
  }
  // The look keeps its own save, in its own view (Tabulka na webu).
  await open(page, "tiers?plan=pro");
  await page.locator('[data-won-view-tile="table"]').click();
  await expect(page.locator("s-button:visible", { hasText: "Uložit vzhled" })).toHaveCount(1);
});

test("on Free the look's view is short — the locked Pro form is gone, on a phone too", async ({ page }) => {
  await open(page, "tiers");
  await page.locator('[data-won-view-tile="table"]').click();
  const form = page.locator('[data-won-look-form="tiers"]');
  await expect(form).toBeVisible();
  await expect(form.locator('[name="look.css"]')).toHaveCount(0);
  await expect(form).toContainText("Zobrazit tarif Pro");
  // The look and the colour are still picked and saved on Free.
  await expect(form.locator('input[name="preset"]')).toHaveCount(4);
  await expect(form.locator("s-button", { hasText: "Uložit vzhled" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(1700);
  await open(page, "tiers", 390);
  await page.locator('[data-won-view-tile="table"]').click();
  expect(await sideways(page)).toBeLessThanOrEqual(0);
});

test("the rule editor on Free: one Pro note in Kombinace a trhy, no locked control, and the form posts no Pro field (as before)", async ({ page }) => {
  await open(page, "rule-editor?rule=dev-f2-collection");
  const section = page.locator("section#pro");
  await expect(section.locator("[data-won-pro-sell]")).toHaveCount(1);
  await expect(section.locator("[data-won-plan-badge]")).toHaveCount(0);
  const keys = await page.evaluate(() => [...new FormData(document.querySelector<HTMLFormElement>("form[data-save-bar]")!).keys()]);
  expect(keys.filter((key) => key === "markets" || key === "combineRules")).toEqual([]);
  // Pro: exceptions and markets work, nothing is locked.
  await open(page, "rule-editor?rule=dev-f2-collection&plan=pro");
  await expect(page.locator("section#pro [data-won-pro-sell]")).toHaveCount(0);
  expect(await page.locator('section#pro s-checkbox[name="markets"]').evaluateAll((els) => els.filter((el) => el.hasAttribute("disabled")).length)).toBe(0);
});

test("Množstevní slevy, Milníky, Výprodej on Free: at most one Pro mention in a section; the stored-Pro banner keeps its list and plan link", async ({ page }) => {
  for (const path of ["tiers", "rewards", "outlet"]) {
    await open(page, path);
    const perSection = await page.evaluate(() =>
      [...document.querySelectorAll("section")].map((el) => ({ id: el.id, n: el.querySelectorAll("[data-won-plan-badge], [data-won-pro-sell]").length })),
    );
    for (const { id, n } of perSection) expect(n, `${path} #${id}`).toBeLessThanOrEqual(1);
  }
  await open(page, "rewards");
  const banner = page.locator('s-banner[tone="warning"]', { hasText: "Tohle je v tarifu Pro" });
  await expect(banner.locator("s-list-item").first()).toBeAttached();
  await expect(banner.locator('s-button[href="/app/plan"]')).toHaveCount(1);
});
