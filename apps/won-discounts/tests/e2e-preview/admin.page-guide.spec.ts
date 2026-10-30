import { expect, test } from "@playwright/test";

import { open, sideways } from "./support";

// The explanation at the top of a page: the merchant hides it, the page remembers, and it comes back on request.

test("the explanation hides per page, stays hidden after a reload and comes back", async ({ page }) => {
  await open(page, "tiers");
  await expect(page.locator('[data-won-guide="tiers"]')).toBeVisible();
  await page.getByRole("button", { name: "Skrýt vysvětlení" }).click();
  await expect(page.locator('[data-won-guide="tiers"]')).toHaveCount(0);

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator('[data-won-guide="tiers"]')).toHaveCount(0);
  await open(page, "rewards");
  await expect(page.locator('[data-won-guide="rewards"]')).toBeVisible();

  await open(page, "tiers");
  await page.getByRole("button", { name: "Zobrazit vysvětlení" }).click();
  await expect(page.locator('[data-won-guide="tiers"]')).toBeVisible();
});

test("the explanation fits a phone", async ({ page }) => {
  for (const path of ["discounts", "tiers", "rewards", "outlet", "campaigns", "placements", "margin", "try-cart", "analytics", "translations", "settings"]) {
    await open(page, path, 390);
    expect(await sideways(page), path).toBeLessThanOrEqual(0);
  }
});
