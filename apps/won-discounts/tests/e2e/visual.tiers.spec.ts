import { assertResponsiveSane } from "@won/testing/playwright";

import { clearCartQuietly, storefrontJson } from "./support/cart.ts";
import { saveScreenshot } from "./support/evidence.ts";
import { expect, gotoStorefront, test, THEME_LABEL } from "./support/fixtures.ts";
import { BLOCK, quantityInput, readBlock, tiersBlock } from "./support/tiers.ts";

// VISUAL QA (MVP 3), not part of the gate: screenshots of the quantity tiers block
// on the live PDP at 390 and 1440 px for ONE appearance preset, on both themes.
// Runs only with WON_E2E_VISUAL=1 (skipped in every other run):
//   seed-mvp1.mjs --profile tiers --preset <p> --live, margin-costs.mjs --live, then
//   WON_E2E_VISUAL=1 WON_E2E_PRESET=<p> WON_E2E_PROFILE=tiers \
//   WON_DISCOUNTS_E2E_SCREENSHOT_DIR=<dir> npm run test:e2e:local:all -w won-discounts
// It checks only what a screenshot needs: the block rendered with that preset,
// no horizontal overflow at 390 px. The behaviour is storefront.tiers.spec.ts.

const VISUAL = String(process.env.WON_E2E_VISUAL ?? "") === "1";
const PRESET = String(process.env.WON_E2E_PRESET ?? "").trim() || "default";
const PAGES = [
  { handle: "won-e2e-simple-a", quantity: 5 },
  { handle: "won-e2e-two-variants", quantity: 3 },
] as const;

test.describe(`Quantity tiers block — visual QA, preset ${PRESET}${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(!VISUAL, "visual QA only (WON_E2E_VISUAL=1)");

  test.afterEach(async ({ page, baseURL }) => {
    if (page.url().startsWith(new URL(baseURL!).origin)) await clearCartQuietly(page);
  });

  for (const { handle, quantity } of PAGES) {
    test(`${handle}: the block at ${quantity} items, 1440 + 390 px`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      const theme = (THEME_LABEL || "theme").toLowerCase();
      await page.setViewportSize({ width: 1440, height: 900 });
      await gotoStorefront(page, `/products/${handle}`);
      await storefrontJson(page, "POST", "/cart/clear.js", {});
      await gotoStorefront(page, `/products/${handle}`);
      await expect(tiersBlock(page)).toHaveCount(1);
      const before = await readBlock(page);
      expect(before.preset, "the block renders the seeded preset").toBe(PRESET);
      const input = quantityInput(page);
      await input.fill(String(quantity));
      await input.dispatchEvent("change");
      await expect.poll(async () => (await readBlock(page)).rows.find((r) => r.active)?.min ?? 0).toBeGreaterThan(0);
      for (const [width, height] of [
        [1440, 900],
        [390, 844],
      ] as const) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(800);
        await tiersBlock(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.waitForTimeout(500);
        if (width === 390) await assertResponsiveSane(page, { root: BLOCK });
        await saveScreenshot(page, testInfo, `pdp-${PRESET}-${theme}-${handle.replace("won-e2e-", "")}-${width}`, { fullPage: false });
      }
    });
  }
});
