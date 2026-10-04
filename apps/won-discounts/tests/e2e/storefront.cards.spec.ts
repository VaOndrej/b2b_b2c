import { assertResponsiveSane } from "@won/testing/playwright";

import { CARDS_ACCENT_RGB, CARDS_HANDLES, CARDS_MIN_QTY, CARDS_PERCENT, CARDS_SET_ID } from "../../scripts/e2e/cards-fixture.mjs";
import { clearCartQuietly, freshCartOfVariants, setStorefrontCountry } from "./support/cart.ts";
import { saveEvidence, saveScreenshot } from "./support/evidence.ts";
import { E2E_PROFILE, expect, gotoStorefront, test, THEME_LABEL } from "./support/fixtures.ts";
import { readBlock } from "./support/tiers.ts";

// SPEC-DRIVEN (MVP 7, plan docs/plans/2026-10-04-won-discounts-mvp7.md, M7 + M8).
//   Cards (BETA, any plan): with card prices on, the product's card on a search page shows the FIRST break of its
//     quantity discount ("Od 2 ks −10 %") — and a cart of that many items gets at least that (the card never
//     promises more than checkout). The line comes from the embed (themes whose card takes no app block), is
//     placed once, and causes no horizontal overflow at 390 px.
//   Custom look (Pro): the storefront gets ONE <style id="won-discounts-custom"> with the look scoped under the
//     Won blocks; the product page's table reads the accent variable. Free: no such style at all (BILL-1).
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile cards --live
//   WON_E2E_PROFILE=cards [WON_E2E_PLAN=pro] npm run test:e2e:local:all -w won-discounts

const PRO = String(process.env.WON_E2E_PLAN ?? "free").trim() === "pro";
const [HANDLE] = CARDS_HANDLES as [string];
const CARD = `[data-won-discounts-card="${HANDLE}"]`;

test.describe(`Won Discounts ceny na kartách (BETA) + vlastní vzhled (MVP 7)${PRO ? " [Pro]" : " [Free]"}${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(E2E_PROFILE !== "cards", `WON_E2E_PROFILE=${E2E_PROFILE}: this spec needs the cards seed (seed-mvp1.mjs --profile cards --live)`);

  test.afterEach(async ({ page, baseURL }) => {
    if (page.url().startsWith(new URL(baseURL!).origin)) await clearCartQuietly(page);
  });

  test("search page: the product's card shows its first break once; the cart gives at least what the card says; no overflow at 390 px", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoStorefront(page, `/products/${HANDLE}`);
    await setStorefrontCountry(page, "CZ");
    await gotoStorefront(page, `/search?q=${HANDLE}&type=product`);
    const line = page.locator(CARD);
    await expect(line, "the card's quantity line (placed by the embed's cards script)").toHaveCount(1);
    const text = (await line.innerText()).replace(/\s+/gu, " ").trim();
    expect(text, "the first break, in the page's language").toMatch(new RegExp(`^(Od|From) ${CARDS_MIN_QTY} (ks|items) −${CARDS_PERCENT}\\s?%$`, "u"));
    // The embed printed the page's map; only listed products get a line.
    const map = await page.locator("#won-discounts-cards").evaluate((el) => JSON.parse(el.textContent ?? "{}") as Record<string, string>);
    expect(Object.keys(map), "the map names the product").toContain(HANDLE);
    await saveScreenshot(page, testInfo, "cards-search-1440");

    // What the card promised, checkout gives (a fresh cart: the function runs).
    const cart = await freshCartOfVariants(page, [{ handle: HANDLE, quantity: CARDS_MIN_QTY }], []);
    const item = cart.items[0]!;
    const off = item.line_level_discount_allocations.reduce((sum, a) => sum + a.amount, 0);
    expect(off, `${CARDS_MIN_QTY} items get at least −${CARDS_PERCENT} %`).toBeGreaterThanOrEqual(Math.floor((item.original_price * item.quantity * CARDS_PERCENT) / 100));

    await page.setViewportSize({ width: 390, height: 844 });
    await gotoStorefront(page, `/search?q=${HANDLE}&type=product`);
    await expect(page.locator(CARD)).toHaveCount(1);
    await assertResponsiveSane(page, { root: CARD });
    await saveScreenshot(page, testInfo, "cards-search-390");
    await saveEvidence(testInfo, `cards-${PRO ? "pro" : "free"}`, { theme: THEME_LABEL || null, text, map, cartOff: off, original: item.original_price * item.quantity });
  });

  test("custom look: Pro gets one scoped stylesheet and the table reads its accent; Free gets none", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoStorefront(page, `/products/${HANDLE}`);
    const block = await readBlock(page);
    expect(block.setId).toBe(CARDS_SET_ID);
    const style = page.locator("style#won-discounts-custom");
    if (!PRO) {
      await expect(style, "Free: the custom look never reaches the storefront (BILL-1)").toHaveCount(0);
      return;
    }
    await expect(style).toHaveCount(1);
    const css = (await style.textContent()) ?? "";
    expect(css, "every rule sits under the Won block roots").toMatch(/^:is\(\.won-tiers,\.won-cart,\.won-cart-slot,\.won-outlet\)\{--won-tiers-accent:#0a7d4f\}/u);
    expect(css).not.toMatch(/<|url\(|@import/u);
    const accent = await page.locator("[data-won-discounts-tiers]").evaluate((el) => getComputedStyle(el).getPropertyValue("--won-tiers-accent").trim());
    expect(accent, "the table's accent variable is the custom look's").toBe("#0a7d4f");
    // Nothing outside the blocks is touched: the rule's selector cannot match the page's body.
    const bodyHas = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--won-tiers-accent").trim());
    expect(bodyHas, "the page itself does not get the variable").toBe("");
    await saveScreenshot(page, testInfo, "custom-look-pdp-1440");
    await saveEvidence(testInfo, "custom-look-pro", { theme: THEME_LABEL || null, css, accent, accentRgb: CARDS_ACCENT_RGB });
  });
});
