import { expect, test, type Page } from "@playwright/test";

import { open } from "./support";

// The state of one thing is said once on a screen (audit 2026-11-03 F2, zásada E1): a tile, a section header, a row
// and a banner never all say the same thing about the same thing.

/** How often `text` is on the page as the merchant reads it. */
const count = (page: Page, text: string) => page.evaluate((needle) => document.body.innerText.split(needle).length - 1, text);

test("Přehled: every thing to resolve is named once — the list says it, the tiles do not count it again; short on a phone", async ({ page }) => {
  for (const plan of ["", "&plan=pro"]) {
    await open(page, `overview?state=live${plan}`);
    for (const name of ["VIP10", "Černý pátek", "Stálí zákazníci 5 %"]) expect(await count(page, name), `${name}${plan}`).toBe(1);
    expect(await count(page, "věci k vyřešení"), plan).toBe(0);
    // A link to each discount still leads to the field that fixes it.
    await expect(page.locator('[data-won-overview-items] s-link[href="/app/discounts/dev-fixture-2#conditions"]')).toHaveCount(1);
  }
  await open(page, "overview?state=live", 390);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThan(2600);
});
