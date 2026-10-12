import { expect, test } from "@playwright/test";

import { open, sideways } from "./support";

// Uzavření před první review (12 Oct 2026): what docs/won-discounts/matice-pred-review.md found and only a browser
// can check — a view picked by a click, the pointer, the width of a phone.

test("nález 7: the page's Save is shown only under a view whose fields it saves", async ({ page }) => {
  const save = page.locator("[data-won-page-save]");
  await open(page, "tiers?plan=pro");
  await expect(save).toBeVisible();
  await page.locator('[data-won-view-tile="table"]').click();
  // The table's view: the block is added in the theme and the look has its own button.
  await expect(save).toBeHidden();
  await expect(page.locator("s-button:visible", { hasText: /^Uložit$/ })).toHaveCount(0);
  await expect(page.locator("s-button:visible", { hasText: "Uložit vzhled" })).toHaveCount(1);
  await page.locator('[data-won-view-tile="exceptions"]').click();
  await expect(save).toBeVisible();

  await open(page, "rewards?plan=pro");
  await expect(save).toBeVisible();
  for (const tile of ["web", "look"]) {
    await page.locator(`[data-won-view-tile="${tile}"]`).click();
    await expect(save).toBeHidden();
  }
  await page.locator('[data-won-view-tile="steps"]').click();
  await expect(save).toBeVisible();

  await open(page, "margin?plan=pro");
  await page.locator('[data-won-view-tile="costs"]').click();
  await expect(save).toBeHidden();
  await page.locator('[data-won-view-tile="collections"]').click();
  await expect(save).toBeVisible();
});

test("nález 8: on Free the look's view is short — the locked Pro form is gone, on a phone too", async ({ page }) => {
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
