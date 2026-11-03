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
