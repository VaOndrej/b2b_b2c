import type { Page } from "@playwright/test";

import { CAMPAIGN_BASE_PERCENT, CAMPAIGN_HANDLES, CAMPAIGN_PERCENT } from "../../scripts/e2e/campaign-fixture.mjs";
import { removeCampaign, scheduleCampaign, waitUntil } from "./support/campaign.ts";
import { clearCartQuietly, freshCartOfVariants, setStorefrontCountry, type Cart } from "./support/cart.ts";
import { CZECH_ADDRESS, checkoutLines, fillShippingAddress, openCheckout, payWithBogusCard, settledThankYou } from "./support/checkout.ts";
import { saveEvidence, saveScreenshot } from "./support/evidence.ts";
import { E2E_PROFILE, expect, gotoStorefront, test, THEME_LABEL, unlockRealStorefront } from "./support/fixtures.ts";

// SPEC-DRIVEN (MVP 6, contracts K4–K6, K9; C4). A campaign starts and ends by itself, at its minute, in the shop's
// time zone — and afterwards the store is exactly as before:
//   Pro:  before the window /cart.js has the rule's 10 %; inside it 30 % (and checkout charges that); after its end
//         10 % again — nothing ran at the boundaries but the discount function's own clock (C4);
//   Free: the same scheduled campaign never applies (the plan gate strips it, BILL-1): 10 % throughout.
// The spec schedules its own window per theme (scripts/e2e/campaign.mjs: the app's own save + sync).
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile campaign --live
//   WON_E2E_PROFILE=campaign [WON_E2E_PLAN=pro] npm run test:e2e:local:all -w won-discounts
// Polls /cart.js at the store's pace (Cloudflare: ≥ 1.5 s between cart writes; here every 15 s).

const PRO = String(process.env.WON_E2E_PLAN ?? "free").trim() === "pro";
const [HANDLE] = CAMPAIGN_HANDLES as [string];
const EMAIL = "won-e2e-campaign@example.com";

/** The rule's percent on the line now, as /cart.js says (a fresh cart: the function re-runs). */
async function percentNow(page: Page): Promise<{ percent: number; cart: Cart; at: string }> {
  const cart = await freshCartOfVariants(page, [{ handle: HANDLE, quantity: 1 }], []);
  const line = cart.items[0]!;
  const off = line.line_level_discount_allocations.reduce((s, a) => s + a.amount, 0);
  return { percent: Math.round((100 * off) / line.original_price), cart, at: new Date().toISOString() };
}

/** Poll until the percent is `want` or `deadline` passes; every reading is kept for the evidence (F-K1). */
async function waitForPercent(page: Page, want: number, deadline: string, log: { at: string; percent: number }[]): Promise<number> {
  for (;;) {
    const { percent, at } = await percentNow(page);
    log.push({ at, percent });
    if (percent === want || Date.now() > Date.parse(deadline)) return percent;
    await page.waitForTimeout(15_000);
  }
}

test.describe(`Won Discounts Kampaně: start and end by themselves (MVP 6)${PRO ? " [Pro]" : " [Free]"}${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(E2E_PROFILE !== "campaign", `WON_E2E_PROFILE=${E2E_PROFILE}: this spec needs the campaign seed (seed-mvp1.mjs --profile campaign --live)`);

  test.afterEach(async ({ page, baseURL }) => {
    if (page.url().startsWith(new URL(baseURL!).origin)) await clearCartQuietly(page);
  });

  test("the campaign's window: base 10 % before, 30 % inside (Pro; checkout too), 10 % after — Free never", async ({ page }, testInfo) => {
    test.setTimeout(15 * 60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    if (PRO) await unlockRealStorefront(page);
    await gotoStorefront(page, `/products/${HANDLE}`);
    await setStorefrontCountry(page, "CZ");
    const log: { at: string; percent: number }[] = [];
    const window = await scheduleCampaign(2, 5);
    try {
      const before = await percentNow(page);
      log.push({ at: before.at, percent: before.percent });
      expect(Date.now(), "the first reading is before the start").toBeLessThan(Date.parse(window.startUtc));
      expect(before.percent, "before the window: the rule's own 10 %").toBe(CAMPAIGN_BASE_PERCENT);

      await waitUntil(window.startUtc, 5_000);
      const inside = await waitForPercent(page, PRO ? CAMPAIGN_PERCENT : -1, new Date(Date.parse(window.startUtc) + (PRO ? 120_000 : 45_000)).toISOString(), log);
      expect(inside, PRO ? "inside the window: the campaign's 30 % (C4, no job at the boundary)" : "Free: the campaign never applies (BILL-1)").toBe(PRO ? CAMPAIGN_PERCENT : CAMPAIGN_BASE_PERCENT);
      let charged: { lineFinal: number | null; original: number } | null = null;
      if (PRO) {
        // Checkout inside the window charges the campaign price.
        const cart = await freshCartOfVariants(page, [{ handle: HANDLE, quantity: 1 }], []);
        const line = cart.items[0]!;
        await openCheckout(page);
        await fillShippingAddress(page, CZECH_ADDRESS, EMAIL);
        await payWithBogusCard(page);
        await settledThankYou(page);
        const lines = await checkoutLines(page);
        charged = { lineFinal: lines[0]?.finalPrice ?? null, original: line.original_price };
        expect(Date.now(), "the order was placed inside the window").toBeLessThan(Date.parse(window.endUtc));
        expect(lines[0]!.finalPrice, "checkout: the campaign's 30 %").toBe(Math.round((line.original_price * (100 - CAMPAIGN_PERCENT)) / 100));
        await saveScreenshot(page, testInfo, "campaign-thankyou-1440");
        await gotoStorefront(page, `/products/${HANDLE}`);
      }

      await waitUntil(window.endUtc, 5_000);
      const after = await waitForPercent(page, CAMPAIGN_BASE_PERCENT, new Date(Date.parse(window.endUtc) + 120_000).toISOString(), log);
      expect(after, "after the end: the rule's own 10 % again, as before").toBe(CAMPAIGN_BASE_PERCENT);
      await saveEvidence(testInfo, `campaign-${PRO ? "pro" : "free"}`, { theme: THEME_LABEL || null, window, readings: log, charged });
    } finally {
      await removeCampaign();
    }
  });
});
