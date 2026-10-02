import type { Page } from "@playwright/test";
import { assertResponsiveSane } from "@won/testing/playwright";

import {
  OUTLET_AUTO_PERCENT,
  OUTLET_CODE,
  OUTLET_CODE_PERCENT,
  OUTLET_SALES,
} from "../../scripts/e2e/outlet-fixture.mjs";
import { clearCartQuietly, freshCartOfVariants, setStorefrontCountry, storefrontJson, type Cart } from "./support/cart.ts";
import {
  checkoutLines,
  CZECH_ADDRESS,
  expandMobileSummary,
  fillShippingAddress,
  openCheckout,
  payWithBogusCard,
  priceSummary,
  rowAmount,
  settledThankYou,
  SUBTOTAL,
} from "./support/checkout.ts";
import { saveEvidence, saveScreenshot } from "./support/evidence.ts";
import { E2E_PROFILE, expect, gotoStorefront, test, THEME_LABEL, unlockRealStorefront } from "./support/fixtures.ts";
import { cancelLatestOrder, latestRun, restartSale, waitForRun } from "./support/outlet-orders.ts";

// SPEC-DRIVEN (MVP 5, contracts O2, O3, O6, O9). Live proof of Výprodej on BOTH shared themes:
//   - PDP: the sale variant's price is the sale price; the theme strikes the price before where the market's
//     price list carries a compare-at (a fixed price: the sale writes it; live fact F-O3: a variant priced by the
//     list's adjustment gets none); the "Sale badge" block names the sale variant; a variant without a sale shows
//     nothing of it;
//   - cart (/cart.js, the real discount function): the sale line takes no other Won discount (A1: no product
//     discount, out of the order subtotal), the variant next to it does;
//   - checkout (Bogus) in Czechia: the price list's fixed price is the sale one (199 → 99,50 Kč) and the line
//     takes no discount.
// Phase A (Free): the profile `outlet` seeded, NO sale (a Free shop cannot start one): every variant is a normal
// item. Phase B (Pro): the sales started by scripts/e2e/outlet.mjs --start --live (WON_E2E_PLAN=pro).
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile outlet --live
//   NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/outlet.mjs --start --live
//   WON_E2E_PROFILE=outlet WON_E2E_PLAN=pro npm run test:e2e:local:all -w won-discounts
//   node apps/won-discounts/scripts/e2e/outlet.mjs --end --live && … --verify-restored
// Orders do not reach the app yet (protected customer data, live fact F-O1): the quota is not counted live.
// 5b (prepared, OFF): with WON_E2E_ORDERS=1 two more Pro tests run — Bogus orders sell the quota out (order
// webhook → the sale ends → prices back) and a cancelled order (orderCancel with restock through
// scripts/e2e/outlet-orders.mjs, F-O4b) gives its piece back. Activation: docs/plans/2026-10-02-won-discounts-mvp5.md
// „Aktivace 5b“.

const PRO = String(process.env.WON_E2E_PLAN ?? "free").trim() === "pro";
const ORDERS = String(process.env.WON_E2E_ORDERS ?? "").trim() === "1";
const ORDERS_OFF = "F-O1: Shopify does not let the app read orders yet (protected customer data); run with WON_E2E_ORDERS=1 once approved";
const [LARGE, SPARE] = OUTLET_SALES as unknown as [(typeof OUTLET_SALES)[number], (typeof OUTLET_SALES)[number]];
const EMAIL = "won-e2e-outlet@example.com";
const BADGE = /^(Výprodej|Výpredaj|Sale)$/u;

type ProductJs = { variants: { id: number; title: string; price: number; compare_at_price: number | null }[] };

async function product(page: Page, handle: string): Promise<ProductJs> {
  return storefrontJson<ProductJs>(page, "GET", `/products/${handle}.js`);
}

const sale = (price: number, percent: number) => Math.floor((price * (100 - percent) + 50) / 100);

test.describe(`Won Discounts Výprodej: PDP, cart and checkout (MVP 5)${PRO ? " [Pro: sales running]" : " [Free: no sale]"}${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(E2E_PROFILE !== "outlet", `WON_E2E_PROFILE=${E2E_PROFILE}: this spec needs the outlet seed (seed-mvp1.mjs --profile outlet --live)`);

  test.afterEach(async ({ page, baseURL }) => {
    if (page.url().startsWith(new URL(baseURL!).origin)) await clearCartQuietly(page);
  });

  test("PDP: the sale price on the storefront, the struck price where the market's price list carries it (the fixed price), and the badge naming the sale variant", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await gotoStorefront(page, `/products/${LARGE.handle}`);
    await setStorefrontCountry(page, "CZ");
    const p = await product(page, LARGE.handle);
    const large = p.variants.find((v) => v.title === LARGE.variant)!;
    const small = p.variants.find((v) => v.title !== LARGE.variant)!;
    const badge = page.locator("[data-won-discounts-outlet]");
    if (PRO) {
      // Live fact F-O3 (2026-10-02): in a market with a price list Shopify prices a variant without a fixed price by
      // the list's adjustment and gives it NO compare-at, although the variant has one (contextualPricing
      // compareAtPrice null, the list's compareAtMode ADJUSTED). The sale price is there; the strike is not.
      expect(large.price, "the sale price").toBe(sale(LARGE.before, LARGE.percent));
      expect(small.compare_at_price, "the other variant is untouched").toBeNull();
      const row = page.locator(`[data-won-discounts-outlet-variant="${large.id}"]`);
      await expect(row).toBeVisible();
      await expect(row.locator("[data-won-discounts-outlet-badge]")).toHaveText(BADGE);
      await expect(row, "a product with several variants names the sale one").toContainText(LARGE.variant!);
      await expect(page.locator(`[data-won-discounts-outlet-variant="${small.id}"]`)).toHaveCount(0);
      await expect(page.locator("[data-won-discounts-outlet-left]"), "the default display: no 'X left'").toHaveCount(0);
      await assertResponsiveSane(page, { root: "[data-won-discounts-outlet]" });
    } else {
      expect(large.compare_at_price, "Free: no sale").toBeNull();
      await expect(badge).toHaveCount(0);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await saveScreenshot(page, testInfo, `outlet-pdp-${PRO ? "pro" : "free"}-1440`, { fullPage: false });
    await page.setViewportSize({ width: 390, height: 844 });
    if (PRO) await badge.scrollIntoViewIfNeeded();
    await saveScreenshot(page, testInfo, `outlet-pdp-${PRO ? "pro" : "free"}-390`, { fullPage: false });

    // A product with one variant and a fixed price in the česko list: the list's sale price struck against its
    // price before (the compare-at the sale wrote on the fixed price), one badge, no variant name.
    await gotoStorefront(page, `/products/${SPARE.handle}`);
    const spare = (await product(page, SPARE.handle)).variants[0]!;
    if (PRO) {
      expect(spare.price, "the fixed price's sale price").toBe(sale(SPARE.before, SPARE.percent));
      expect(spare.compare_at_price, "the fixed price before the sale, struck by the theme").toBe(SPARE.before);
      const row = page.locator(`[data-won-discounts-outlet-variant="${spare.id}"]`);
      await expect(row.locator("[data-won-discounts-outlet-badge]")).toHaveText(BADGE);
      await expect(row.locator(".won-outlet__variant")).toHaveCount(0);
      await page.setViewportSize({ width: 1440, height: 900 });
      await saveScreenshot(page, testInfo, "outlet-pdp-spare-1440", { fullPage: false });
      await page.setViewportSize({ width: 390, height: 844 });
      await saveScreenshot(page, testInfo, "outlet-pdp-spare-390", { fullPage: false });
    } else {
      await expect(page.locator("[data-won-discounts-outlet]")).toHaveCount(0);
    }
    await saveEvidence(testInfo, `outlet-pdp-${PRO ? "pro" : "free"}`, { theme: THEME_LABEL || null, large, small, spare });
  });

  test("cart (/cart.js, the function): the sale line takes no other discount; the variant next to it gets the automatic 10 %; the code's 20 % leaves the sale line out", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await gotoStorefront(page, `/products/${LARGE.handle}`);
    await setStorefrontCountry(page, "CZ");
    const cart = await freshCartOfVariants(
      page,
      [
        { handle: LARGE.handle, quantity: 1, option: LARGE.variant! },
        { handle: LARGE.handle, quantity: 1, option: "Small" },
      ],
      [OUTLET_CODE],
    );
    const large = cart.items.find((i) => i.variant_title === LARGE.variant)!;
    const small = cart.items.find((i) => i.variant_title !== LARGE.variant)!;
    const smallOff = Math.round((small.original_price * OUTLET_AUTO_PERCENT) / 100);
    expect(small.line_level_discount_allocations.map((a) => a.amount), "the normal variant: the automatic 10 %").toEqual([smallOff]);
    if (PRO) {
      expect(large.line_level_discount_allocations, "the sale line: no product discount (A1)").toEqual([]);
      const base = small.original_price - smallOff; // the sale line is out of the order subtotal
      expect(cart.discount_codes[0]?.applicable).toBe(true);
      expect(cart.cart_level_discount_applications[0]?.total_allocated_amount, "20 % of the subtotal without the sale line").toBe(Math.round((base * OUTLET_CODE_PERCENT) / 100));
    } else {
      expect(large.line_level_discount_allocations.map((a) => a.amount), "Free: no sale, the automatic 10 % on it too").toEqual([Math.round((large.original_price * OUTLET_AUTO_PERCENT) / 100)]);
    }
    await saveEvidence(testInfo, `outlet-cart-${PRO ? "pro" : "free"}`, { theme: THEME_LABEL || null, cart: summary(cart) });
  });

  test("checkout (Bogus, Czechia): the price list's fixed price is the sale one and the line takes no discount", async ({ page }, testInfo) => {
    test.skip(!PRO, "phase B (Pro): a sale runs");
    test.setTimeout(360_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await unlockRealStorefront(page);
    await gotoStorefront(page, `/products/${SPARE.handle}`);
    await setStorefrontCountry(page, "CZ");
    const cart = await freshCartOfVariants(page, [{ handle: SPARE.handle, quantity: 1 }], []);
    const line = cart.items[0]!;
    expect(cart.currency).toBe("CZK");
    expect(line.original_price, "the česko price list's fixed sale price (199 Kč −50 %)").toBe(sale(199_00, SPARE.percent));
    expect(line.line_level_discount_allocations, "no other discount on the sale line").toEqual([]);
    await openCheckout(page);
    const before = await priceSummary(page);
    expect(rowAmount(before, SUBTOTAL), "checkout subtotal = the sale price").toBe(line.original_price);
    await test.step("contact, CZ address, first shipping rate", () => fillShippingAddress(page, CZECH_ADDRESS, EMAIL));
    await test.step("pay with the Bogus gateway (card 1)", () => payWithBogusCard(page));
    const settled = await settledThankYou(page);
    const rows = await priceSummary(page);
    const lines = await checkoutLines(page);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.finalPrice, "the order line: the sale price, no discount").toBe(line.original_price);
    expect(rowAmount(rows, SUBTOTAL)).toBe(line.original_price);
    await saveScreenshot(page, testInfo, "outlet-thankyou-1440");
    await page.setViewportSize({ width: 390, height: 844 });
    await expandMobileSummary(page);
    await saveScreenshot(page, testInfo, "outlet-thankyou-390");
    await saveEvidence(testInfo, "outlet-checkout", { theme: THEME_LABEL || null, charged: settled.charged, rows, lines });
  });

  test("5b: Bogus orders until the quota is used up → order webhook → the sale ends and the prices come back", async ({ page }, testInfo) => {
    test.skip(!PRO, "phase B (Pro): a sale runs");
    test.skip(!ORDERS, ORDERS_OFF);
    test.setTimeout(900_000);
    const start = await latestRun(LARGE.handle);
    expect(start.status, "the Large sale runs (outlet.mjs --start --live)").toBe("active");
    const left = start.quota - start.sold + start.returned;
    expect(left, "pieces left to sell out").toBeGreaterThan(1);
    // Two orders: the first one is counted and the sale goes on; the second sells the rest out.
    await test.step("order 1: one piece", () => placeOrder(page, { handle: LARGE.handle, quantity: 1, option: LARGE.variant! }));
    const counted = await waitForRun(LARGE.handle, (r) => r.sold === start.sold + 1);
    expect(counted.status, "one piece sold: the sale goes on").toBe("active");
    await test.step(`order 2: the last ${left - 1} piece(s)`, () => placeOrder(page, { handle: LARGE.handle, quantity: left - 1, option: LARGE.variant! }));
    const ended = await waitForRun(LARGE.handle, (r) => r.status === "ended");
    expect(ended.endReason, "ended by selling the quota out").toBe("quota");
    expect(ended.events.map((e) => e.kind)).toEqual(expect.arrayContaining(["sale", "quota_reached", "ended", "price_restored"]));
    await gotoStorefront(page, `/products/${LARGE.handle}`);
    await setStorefrontCountry(page, "CZ");
    const large = (await product(page, LARGE.handle)).variants.find((v) => v.title === LARGE.variant)!;
    expect(large.price, "the price before the sale is back").toBe(LARGE.before);
    expect(large.compare_at_price, "no struck price after the end").toBeNull();
    await expect(page.locator(`[data-won-discounts-outlet-variant="${large.id}"]`), "no badge after the end").toHaveCount(0);
    await saveScreenshot(page, testInfo, "outlet-quota-ended-1440", { fullPage: false });
    await saveEvidence(testInfo, "outlet-quota-ended", { theme: THEME_LABEL || null, start, counted, ended, large });
    // The matrix runs the next theme on the same sales: start this one again (its own backup = the restored prices).
    await test.step("start the Large sale again for the next theme", () => restartSale(LARGE.handle));
    expect((await latestRun(LARGE.handle)).status).toBe("active");
  });

  test("5b: a cancelled order (orderCancel with restock) gives its piece back to the quota, the history says so", async ({ page }, testInfo) => {
    test.skip(!PRO, "phase B (Pro): a sale runs");
    test.skip(!ORDERS, ORDERS_OFF);
    test.setTimeout(600_000);
    const since = new Date().toISOString();
    const start = await latestRun(SPARE.handle);
    expect(start.status, "the spare sale runs").toBe("active");
    expect(start.quota - start.sold + start.returned, "one order must not sell it out (fixture quota 5)").toBeGreaterThan(1);
    await test.step("order: one piece", () => placeOrder(page, { handle: SPARE.handle, quantity: 1 }));
    const sold = await waitForRun(SPARE.handle, (r) => r.sold === start.sold + 1);
    const cancelled = await test.step("cancel it with restock (shopify store execute --allow-mutations)", () => cancelLatestOrder(since));
    const back = await waitForRun(SPARE.handle, (r) => r.returned === start.returned + 1);
    expect(back.status, "still running").toBe("active");
    expect(back.quota - back.sold + back.returned, "the piece is back in the quota").toBe(start.quota - start.sold + start.returned);
    expect(back.events.map((e) => e.kind), "the history names the cancellation").toContain("cancel");
    await saveEvidence(testInfo, "outlet-cancel", { theme: THEME_LABEL || null, start, sold, back, cancelled: cancelled.split("\n").filter(Boolean) });
  });
});

/** One Bogus order in Czechia of `quantity` pieces of the variant; the thank-you page settled. */
async function placeOrder(page: Page, line: { handle: string; quantity: number; option?: string }): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await unlockRealStorefront(page);
  await gotoStorefront(page, `/products/${line.handle}`);
  await setStorefrontCountry(page, "CZ");
  await freshCartOfVariants(page, [line], []);
  await openCheckout(page);
  await fillShippingAddress(page, CZECH_ADDRESS, EMAIL);
  await payWithBogusCard(page);
  await settledThankYou(page);
}

function summary(cart: Cart) {
  return {
    currency: cart.currency,
    total_price: cart.total_price,
    items: cart.items.map((i) => ({ variant: i.variant_title, price: i.original_price, allocations: i.line_level_discount_allocations.map((a) => a.amount) })),
    order: cart.cart_level_discount_applications.map((a) => ({ title: a.title, amount: a.total_allocated_amount })),
  };
}
