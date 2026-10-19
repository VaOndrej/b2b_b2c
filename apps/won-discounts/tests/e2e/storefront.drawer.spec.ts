import { assertExtensionAssetsLoaded } from "@won/testing/playwright";

import { REWARDS_CART_HANDLE } from "../../scripts/e2e/rewards-fixture.mjs";
import { clearCartQuietly } from "./support/cart.ts";
import { saveEvidence, saveScreenshot } from "./support/evidence.ts";
import { E2E_PROFILE, expect, test, THEME_LABEL } from "./support/fixtures.ts";
import { go, openThemePreview } from "./support/theme-preview.ts";

// Zásuvka košíku, varianta 1 (15 Oct 2026), live: the customer adds the product on the product page, the theme opens
// its cart drawer, and the Milestones panel is in it ABOVE the main checkout button — in Horizon's
// .cart-drawer__summary, in Dawn's .drawer__footer — at 1440 and 390 px. The Won embed's drawer setting is its
// default (the overlays: drawer_position "summary").
//
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile rewards --out $O [--live]
//   WON_E2E_PROFILE=rewards WON_E2E_DAWN_CART=drawer WON_E2E_SPECS=tests/e2e/storefront.drawer.spec.ts \
//     npm run test:e2e:local:all -w won-discounts

const SPOT: Record<string, string> = { Horizon: "cart-drawer__summary", Dawn: "drawer__footer" };

test.describe(`Won Discounts cart drawer: the Milestones panel above the checkout button${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(!["rewards", "rewards-other", "rewards-pro"].includes(E2E_PROFILE), `WON_E2E_PROFILE=${E2E_PROFILE}: needs the rewards seed (seed-mvp1.mjs --profile rewards --live)`);

  for (const width of [1440, 390]) {
    test(`${width}px: add to cart opens the drawer, the panel is in it right above the checkout button`, async ({ page }, testInfo) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await openThemePreview(page);
      await go(page, `/products/${REWARDS_CART_HANDLE}`);
      await clearCartQuietly(page);
      await go(page, `/products/${REWARDS_CART_HANDLE}`);
      await assertExtensionAssetsLoaded(page, { match: "won-discounts" });
      await page.locator('button[name="add"]:visible').first().click();

      // The theme's own drawer, open, with its checkout button. Horizon opens it after the add only with
      // "auto_open_cart_drawer" (off by default): there the customer opens it with the header's cart icon.
      const drawer = page.locator("cart-drawer-component, #CartDrawer").first();
      const cta = drawer.locator('button[name="checkout"]').first();
      const opened = await cta.waitFor({ state: "visible", timeout: 8_000 }).then(() => true, () => false);
      if (!opened) {
        await expect.poll(() => page.evaluate(async () => ((await (await fetch("/cart.js", { cache: "no-store" })).json()) as { item_count: number }).item_count), { message: "the product is in the cart", timeout: 15_000 }).toBeGreaterThan(0);
        await page.locator('[on\\:click="#cart-drawer/toggle"]:visible').first().click();
      }
      await expect(cta, "the theme's cart drawer is open with the checkout button").toBeVisible({ timeout: 20_000 });
      const panel = drawer.locator("[data-won-discounts-cart]").first();
      await expect(panel, "the Milestones panel is in the drawer").toBeVisible({ timeout: 20_000 });
      await expect(panel.locator(".won-ms").first(), "with the ladder").toBeVisible();
      await page.waitForTimeout(1_500);

      const at = await page.evaluate(() => {
        const box = document.querySelector("cart-drawer-component, #CartDrawer")!;
        const p = box.querySelector("[data-won-discounts-cart]")!;
        const b = box.querySelector('button[name="checkout"]')!;
        const pr = p.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return {
          spot: (p.parentElement!.className || p.parentElement!.tagName).toString(),
          before: Boolean(p.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING),
          panel: { top: Math.round(pr.top), bottom: Math.round(pr.bottom), left: Math.round(pr.left), right: Math.round(pr.right) },
          button: { top: Math.round(br.top), bottom: Math.round(br.bottom), left: Math.round(br.left), right: Math.round(br.right) },
          size: p.className,
          viewport: { width: innerWidth, height: innerHeight },
        };
      });
      await saveEvidence(testInfo, `drawer-position-${width}`, { theme: THEME_LABEL, ...at });
      await saveScreenshot(page, testInfo, `drawer-${width}`, { fullPage: false });

      expect(at.spot.split(" "), `the panel sits in ${THEME_LABEL}'s spot`).toContain(SPOT[THEME_LABEL] ?? "");
      expect(at.size, "the drawer's compact panel").toContain("won-cart--drawer");
      expect(at.before, "before the checkout button in the page").toBe(true);
      expect(at.panel.bottom, "on screen: the panel ends above the checkout button").toBeLessThanOrEqual(at.button.top + 1);
      expect(at.panel.right - at.panel.left, "the panel is as wide as the drawer allows, never wider than the screen").toBeLessThanOrEqual(at.viewport.width);
    });
  }
});
