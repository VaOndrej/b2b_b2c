import type { Page } from "@playwright/test";

import {
  CAMPAIGN_TIERS_BASE_PERCENT,
  CAMPAIGN_TIERS_HANDLES,
  CAMPAIGN_TIERS_MIN_QTY,
  CAMPAIGN_TIERS_PERCENT,
  CAMPAIGN_TIERS_SET_ID,
} from "../../scripts/e2e/campaign-tiers-fixture.mjs";
import { removeCampaign, scheduleCampaign, waitUntil } from "./support/campaign.ts";
import { clearCartQuietly, freshCartOfVariants, setStorefrontCountry, type Cart } from "./support/cart.ts";
import { CZECH_ADDRESS, checkoutLines, fillShippingAddress, openCheckout, payWithBogusCard, settledThankYou } from "./support/checkout.ts";
import { saveEvidence, saveScreenshot } from "./support/evidence.ts";
import { E2E_PROFILE, expect, gotoStorefront, test, THEME_LABEL, unlockRealStorefront } from "./support/fixtures.ts";
import { readBlock } from "./support/tiers.ts";

// SPEC-DRIVEN (MVP 6.1, plan docs/plans/2026-10-04-won-discounts-mvp6-1.md, L7, L10). A campaign changes a quantity
// tier set (2 items: 10 % → 20 %). The product page never promises more than checkout gives:
//   Pro:  before the window the table and /cart.js say 10 %; inside it /cart.js says 20 % at once (the function's
//         own clock, C4) and the table follows a minute after the start (the scheduler writes the storefront
//         config); 7 minutes before the end the table is back at 10 % while /cart.js still gives 20 %; after the
//         end both say 10 %. At every reading: table percent ≤ /cart.js percent;
//   Free: the same scheduled campaign never applies (BILL-1): 10 % on the table and in the cart throughout.
// The spec schedules its own window per theme (scripts/e2e/campaign.mjs --fixture tiers: the app's save + sync).
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile campaign-tiers --live
//   WON_E2E_PROFILE=campaign-tiers [WON_E2E_PLAN=pro] npm run test:e2e:local:all -w won-discounts

const PRO = String(process.env.WON_E2E_PLAN ?? "free").trim() === "pro";
const [HANDLE] = CAMPAIGN_TIERS_HANDLES as [string];
const EMAIL = "won-e2e-campaign-tiers@example.com";
/** Window: starts 3 minutes ahead, lasts 12 — the table is the campaign's from start + 1 to start + 5 min. */
const IN_MINUTES = 3;
const FOR_MINUTES = 12;

type Reading = { at: string; where: string; table: number | null; cart: number | null };

/** The tier's percent on a line of MIN_QTY items now, as /cart.js says (a fresh cart: the function re-runs). */
async function cartPercent(page: Page): Promise<{ percent: number; cart: Cart }> {
  const cart = await freshCartOfVariants(page, [{ handle: HANDLE, quantity: CAMPAIGN_TIERS_MIN_QTY }], []);
  const line = cart.items[0]!;
  const off = line.line_level_discount_allocations.reduce((s, a) => s + a.amount, 0);
  return { percent: Math.round((100 * off) / (line.original_price * line.quantity)), cart };
}

/** The percent of the table's break for MIN_QTY items on a freshly loaded product page. */
async function tablePercent(page: Page): Promise<number | null> {
  await gotoStorefront(page, `/products/${HANDLE}`);
  const block = await readBlock(page);
  if (block.setId !== CAMPAIGN_TIERS_SET_ID) return null;
  const b = block.data?.breaks.find((x) => x.min === CAMPAIGN_TIERS_MIN_QTY);
  return b && "pct" in b ? b.pct : null;
}

test.describe(`Won Discounts kampaně mění úrovně: the table never promises more than checkout (MVP 6.1)${PRO ? " [Pro]" : " [Free]"}${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(E2E_PROFILE !== "campaign-tiers", `WON_E2E_PROFILE=${E2E_PROFILE}: this spec needs the campaign-tiers seed (seed-mvp1.mjs --profile campaign-tiers --live)`);

  test.afterEach(async ({ page, baseURL }) => {
    if (page.url().startsWith(new URL(baseURL!).origin)) await clearCartQuietly(page);
  });

  test("table and cart: 10 % before, cart 20 % from the start and the table a minute later (Pro), table back 7 minutes before the end, 10 % after — Free never", async ({ page }, testInfo) => {
    test.setTimeout(25 * 60_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    if (PRO) await unlockRealStorefront(page);
    await gotoStorefront(page, `/products/${HANDLE}`);
    await setStorefrontCountry(page, "CZ");
    const log: Reading[] = [];
    const read = async (where: string): Promise<Reading> => {
      const table = await tablePercent(page);
      const { percent } = await cartPercent(page);
      const reading = { at: new Date().toISOString(), where, table, cart: percent };
      log.push(reading);
      // The invariant of the whole feature, at every reading.
      expect(reading.table ?? 0, `${where}: the table (${reading.table} %) never says more than the cart gives (${reading.cart} %)`).toBeLessThanOrEqual(reading.cart);
      return reading;
    };
    /** Poll (every 20 s) until `done` or the deadline; the last reading. */
    const until = async (where: string, done: (r: Reading) => boolean, deadlineMs: number): Promise<Reading> => {
      for (;;) {
        const reading = await read(where);
        if (done(reading) || Date.now() > deadlineMs) return reading;
        await page.waitForTimeout(20_000);
      }
    };
    const window = await scheduleCampaign(IN_MINUTES, FOR_MINUTES, "tiers");
    const start = Date.parse(window.startUtc);
    const end = Date.parse(window.endUtc);
    const BASE = CAMPAIGN_TIERS_BASE_PERCENT;
    const WANT = PRO ? CAMPAIGN_TIERS_PERCENT : BASE;
    try {
      const before = await read("before");
      expect(Date.now(), "the first reading is before the start").toBeLessThan(start);
      expect(before, "before the window: the base 10 % on the table and in the cart").toMatchObject({ table: BASE, cart: BASE });

      // From the start: checkout has the campaign's break at once; the table a minute later (scheduler + sync).
      await waitUntil(window.startUtc, 5_000);
      const first = await read("first minute");
      expect(first.cart, PRO ? "inside the window: the campaign's 20 % in the cart" : "Free: the campaign never applies").toBe(WANT);
      const shown = await until("shown", (r) => r.table === WANT, start + 4 * 60_000);
      expect(shown, PRO ? "a minute after the start the table shows the campaign's 20 %" : "Free: the table stays at 10 %").toMatchObject({ table: WANT, cart: WANT });
      if (PRO) await saveScreenshot(page, testInfo, "campaign-tiers-table-1440");

      let charged: { lineFinal: number | null; original: number } | null = null;
      if (PRO) {
        const { cart } = await cartPercent(page);
        const line = cart.items[0]!;
        await openCheckout(page);
        await fillShippingAddress(page, CZECH_ADDRESS, EMAIL);
        await payWithBogusCard(page);
        await settledThankYou(page);
        const lines = await checkoutLines(page);
        charged = { lineFinal: lines[0]?.finalPrice ?? null, original: line.original_price * line.quantity };
        expect(Date.now(), "the order was placed inside the window").toBeLessThan(end);
        expect(lines[0]!.finalPrice, "checkout: the campaign's 20 % off 2 items").toBe(Math.round((line.original_price * line.quantity * (100 - CAMPAIGN_TIERS_PERCENT)) / 100));
        await saveScreenshot(page, testInfo, "campaign-tiers-thankyou-1440");
      }

      // 7 minutes before the end the table goes back; checkout keeps the campaign until its end.
      await waitUntil(new Date(end - 7 * 60_000).toISOString(), 5_000);
      const back = await until("table back", (r) => r.table === BASE, end - 3 * 60_000);
      expect(back.table, "the table is back at the base 10 % well before the end").toBe(BASE);
      expect(Date.now(), "… read before the campaign's end").toBeLessThan(end);
      expect(back.cart, PRO ? "… while the cart still gets the campaign's 20 %" : "Free: 10 %").toBe(WANT);

      await waitUntil(window.endUtc, 5_000);
      const after = await until("after", (r) => r.cart === BASE, end + 2 * 60_000);
      expect(after, "after the end: 10 % on the table and in the cart, as before").toMatchObject({ table: BASE, cart: BASE });
      await saveEvidence(testInfo, `campaign-tiers-${PRO ? "pro" : "free"}`, { theme: THEME_LABEL || null, window, readings: log, charged });
    } finally {
      await removeCampaign();
    }
  });
});
