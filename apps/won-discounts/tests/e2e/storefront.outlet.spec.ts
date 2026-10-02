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

// SPEC-DRIVEN (MVP 5, contracts O2, O3, O6, O9). Live proof of Výprodej on BOTH shared themes:
//   - PDP: the sale variant's price is the sale price and the theme strikes the price before (compare_at), the
//     "Sale badge" block names the sale variant; a variant without a sale shows nothing of it;
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

const PRO = String(process.env.WON_E2E_PLAN ?? "free").trim() === "pro";
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

  test("PDP: the sale variant shows its sale price struck against the price before, and the badge names it; nothing for the other variant", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await gotoStorefront(page, `/products/${LARGE.handle}`);
    const p = await product(page, LARGE.handle);
    const large = p.variants.find((v) => v.title === LARGE.variant)!;
    const small = p.variants.find((v) => v.title !== LARGE.variant)!;
    const badge = page.locator("[data-won-discounts-outlet]");
    if (PRO) {
      expect(large.compare_at_price, "compare_at = the price before the sale").not.toBeNull();
      expect(large.price, "the sale price").toBe(sale(large.compare_at_price!, LARGE.percent));
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

    // A product with one variant: one badge, no variant name.
    await gotoStorefront(page, `/products/${SPARE.handle}`);
    const spare = (await product(page, SPARE.handle)).variants[0]!;
    if (PRO) {
      const row = page.locator(`[data-won-discounts-outlet-variant="${spare.id}"]`);
      await expect(row.locator("[data-won-discounts-outlet-badge]")).toHaveText(BADGE);
      await expect(row.locator(".won-outlet__variant")).toHaveCount(0);
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
});

function summary(cart: Cart) {
  return {
    currency: cart.currency,
    total_price: cart.total_price,
    items: cart.items.map((i) => ({ variant: i.variant_title, price: i.original_price, allocations: i.line_level_discount_allocations.map((a) => a.amount) })),
    order: cart.cart_level_discount_applications.map((a) => ({ title: a.title, amount: a.total_allocated_amount })),
  };
}
