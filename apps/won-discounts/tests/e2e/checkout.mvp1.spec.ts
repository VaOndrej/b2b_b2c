import { roundingTiePossible } from "@won/core/discounts/function-output";

import {
  E2E_AUTO_PERCENT,
  E2E_AUTO_RULE_ID,
  E2E_AUTO_RULE_NAME,
  E2E_CODE,
  E2E_CODE_PERCENT,
  E2E_CODE_RULE_ID,
  E2E_CODE_RULE_NAME,
  E2E_PRODUCT_HANDLE,
} from "../../scripts/e2e/mvp1-fixture.mjs";
import { clearCartQuietly, freshCart, storefrontJson, type Cart } from "./support/cart.ts";
import {
  applyCodeInCheckout,
  checkoutLines,
  expandMobileSummary,
  fillCzechShippingAddress,
  lineAllocation,
  openCheckout,
  payWithBogusCard,
  priceSummary,
  rowAmount,
  settledThankYou,
  SHIPPING,
  SUBTOTAL,
  TAX,
  TOTAL,
} from "./support/checkout.ts";
import { saveEvidence, saveScreenshot } from "./support/evidence.ts";
import { E2E_PROFILE, expect, gotoStorefront, STORE_ORIGIN, test, THEME_LABEL, unlockRealStorefront } from "./support/fixtures.ts";
import { expectedFor, readLiveInputs } from "./support/won-plan.ts";

// SPEC-DRIVEN (MVP 1, Task 6). Live proof that Won discounts really apply in
// the cart AND in checkout on both shared themes (the matrix runs this file
// against Horizon and Dawn through `shopify theme dev`).
//
// Needs the seed: `node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --live`
// ("E2E auto 10 %" on won-e2e-simple-a, code WONE2E15 = 15 % on the order).
//
// Expectations are `planCart` on the live function inputs (support/won-plan.ts).
// Prices are only ever read from `/cart.js` (support/cart.ts) and from the
// checkout's own tables (support/checkout.ts), never from theme DOM. The
// theme-dev session guard lives in the shared fixture (support/fixtures.ts).
//
// /checkout on the theme-dev origin redirects to the real
// `*.myshopify.com/checkouts/cn/<token>` in the BROWSER's own session: the
// storefront password is unlocked there, and a code applied to the cart in the
// theme-dev session does not travel — codes are bound to the buyer session, not
// to the cart token (checked: the same checkout URL in a second session shows
// the automatic discount but not the code). The Bogus test therefore enters the
// code in the checkout's own discount field, as a buyer would; the last test
// covers the production path the theme-dev split hides: cart + checkout in ONE
// real-storefront session, where the cart's code arrives in checkout by itself.

const CHECKOUT_COUNTRY = "CZ"; // market cesko (CZK)

test.describe(`Won Discounts in cart and checkout (MVP 1)${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  // Runs under the MVP 1 seed only (the default); the shapes seed replaces these rules (checkout.shapes.spec.ts).
  test.skip(E2E_PROFILE !== "mvp1", `WON_E2E_PROFILE=${E2E_PROFILE}: this spec needs the MVP 1 seed (seed-mvp1.mjs --live)`);

  test.afterEach(async ({ page, baseURL }) => {
    // Theme-dev cart only (a completed checkout consumed its cart; every test starts from freshCart anyway).
    if (page.url().startsWith(new URL(baseURL!).origin)) await clearCartQuietly(page);
  });

  test("cart: the automatic 10 % and the code WONE2E15 apply exactly as planCart plans", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const inputs = await readLiveInputs(E2E_PRODUCT_HANDLE);
    expect(inputs.config.modules.codes.rules.map((r) => r.id), "the live shop config carries the seeded rules").toEqual(
      expect.arrayContaining([E2E_AUTO_RULE_ID, E2E_CODE_RULE_ID]),
    );
    expect(inputs.productRefs.ruleIds ?? [], `${E2E_PRODUCT_HANDLE} is targeted by the automatic rule`).toContain(E2E_AUTO_RULE_ID);

    await gotoStorefront(page, `/products/${E2E_PRODUCT_HANDLE}`);

    // (a) automatic rule: one line-level allocation, 10 %, titled with the rule name.
    const autoCart = await test.step("(a) add won-e2e-simple-a → /cart.js line allocation", async () => {
      const cart = await freshCart(page, E2E_PRODUCT_HANDLE, []);
      const expected = expectedFor(cart, inputs, CHECKOUT_COUNTRY);
      const item = cart.items[0]!;
      expect(cart.items).toHaveLength(1);
      expect(cart.discount_codes).toEqual([]);
      expect(item.line_level_discount_allocations).toHaveLength(1);
      const allocation = item.line_level_discount_allocations[0]!;
      expect(allocation.discount_application.title).toBe(E2E_AUTO_RULE_NAME);
      expect(allocation.discount_application.value_type).toBe("percentage");
      expect(Number(allocation.discount_application.value)).toBe(E2E_AUTO_PERCENT);
      expect(allocation.amount, "line discount = planCart").toBe(expected.lineDiscount);
      expect(allocation.amount, "10 % of the line").toBe(Math.round((item.original_price * item.quantity * E2E_AUTO_PERCENT) / 100));
      expect(cart.cart_level_discount_applications).toEqual([]);
      expect(cart.total_price, "cart total = planCart").toBe(expected.total);
      return { cart, expected };
    });

    // (b) code: applicable, order-level 15 % on the subtotal after the line discount.
    const codeCart = await test.step("(b) /cart/update.js {discount: WONE2E15} → applicable, order-level 15 %", async () => {
      await storefrontJson(page, "POST", "/cart/update.js", { discount: E2E_CODE });
      const cart = await storefrontJson<Cart>(page, "GET", "/cart.js");
      const expected = expectedFor(cart, inputs, CHECKOUT_COUNTRY);
      expect(cart.discount_codes[0]?.code.toUpperCase()).toBe(E2E_CODE);
      expect(cart.discount_codes[0]?.applicable).toBe(true);
      expect(expected.plan.codes[0]?.state, "planCart: the code applies").toBe("applied");
      expect(cart.items[0]!.line_level_discount_allocations.map((a) => [a.discount_application.title, a.amount])).toEqual([
        [E2E_AUTO_RULE_NAME, expected.lineDiscount],
      ]);
      expect(cart.cart_level_discount_applications).toHaveLength(1);
      const order = cart.cart_level_discount_applications[0]!;
      // The value the function sends follows output.rs: 15 % as a percentage, unless
      // 15 % of the base lands on half a haléř (a rounding tie) — then its exact
      // amount, because Shopify may round the tie the other way than the plan. A
      // tie depends on the base: while the shop was in USD the CZK price was
      // converted at a live rate (won-e2e-simple-a 219,00 Kč on 2026-09-29, where
      // 15 % of 197,10 Kč = 29,565 Kč is a tie); since 2026-09-30 the shop
      // currency is CZK and the price is the catalog's 10 Kč (15 % of 9,00 Kč =
      // 1,35 Kč, no tie). Either way the branch follows the plan's base.
      const orderBase = expected.plan.order?.base ?? expected.subtotalAfterLines;
      if (roundingTiePossible(orderBase, E2E_CODE_PERCENT)) {
        expect(order.value_type, `rounding tie (${orderBase} × ${E2E_CODE_PERCENT} % = ${(orderBase * E2E_CODE_PERCENT) / 100}): sent as its exact amount`).toBe("fixed_amount");
        expect(Math.round(Number(order.value) * 100), "the exact amount = planCart (CZK, 2 decimals)").toBe(expected.orderDiscount);
      } else {
        expect(order.value_type).toBe("percentage");
        expect(Number(order.value)).toBe(E2E_CODE_PERCENT);
      }
      expect(cart.items_subtotal_price, "subtotal after the line discount = planCart").toBe(expected.subtotalAfterLines);
      expect(order.total_allocated_amount, "order discount = planCart (15 % of the discounted subtotal)").toBe(expected.orderDiscount);
      expect(order.total_allocated_amount).toBe(Math.round((expected.subtotalAfterLines * E2E_CODE_PERCENT) / 100));
      expect(expected.plan.order?.message).toBe(E2E_CODE_RULE_NAME);
      expect(cart.total_price, "cart total = planCart").toBe(expected.total);
      return { cart, expected };
    });

    await saveEvidence(testInfo, "cart-mvp1", {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      currency: codeCart.cart.currency,
      auto: {
        total_price: autoCart.cart.total_price,
        allocations: autoCart.cart.items[0]!.line_level_discount_allocations.map((a) => ({ title: a.discount_application.title, amount: a.amount })),
        planTotals: autoCart.expected.plan.totals,
      },
      code: {
        discount_codes: codeCart.cart.discount_codes,
        items_subtotal_price: codeCart.cart.items_subtotal_price,
        cart_level: codeCart.cart.cart_level_discount_applications.map((a) => ({ title: a.title, amount: a.total_allocated_amount, value: a.value })),
        total_price: codeCart.cart.total_price,
        planTotals: codeCart.expected.plan.totals,
        planOrder: codeCart.expected.plan.order
          ? { amount: codeCart.expected.plan.order.amount, base: codeCart.expected.plan.order.base, message: codeCart.expected.plan.order.message }
          : null,
      },
    });
  });

  test("checkout (Bogus): the thank-you page shows the discounts and the total planCart predicts", async ({ page }, testInfo) => {
    test.setTimeout(360_000);
    const inputs = await readLiveInputs(E2E_PRODUCT_HANDLE);
    await page.setViewportSize({ width: 1440, height: 900 });

    await unlockRealStorefront(page);
    await gotoStorefront(page, `/products/${E2E_PRODUCT_HANDLE}`);

    // The cart right before checkout (theme-dev session) and its plan.
    const cart = await freshCart(page, E2E_PRODUCT_HANDLE, [E2E_CODE]);
    const expected = expectedFor(cart, inputs, CHECKOUT_COUNTRY);
    expect(cart.discount_codes[0]).toEqual({ code: E2E_CODE, applicable: true });
    expect(cart.total_price, "cart total = planCart").toBe(expected.total);
    expect(expected.lineDiscount).toBeGreaterThan(0);
    expect(expected.orderDiscount).toBeGreaterThan(0);

    let codeCarriedIntoCheckout = true;
    await test.step("open checkout; its summary equals the cart", async () => {
      await openCheckout(page);
      if (rowAmount(await priceSummary(page), E2E_CODE) === null) {
        codeCarriedIntoCheckout = false; // the theme-dev session split (header comment)
        await applyCodeInCheckout(page, E2E_CODE);
      }
      console.log(`[checkout.mvp1] ${THEME_LABEL || "theme"}: code ${codeCarriedIntoCheckout ? "carried from the cart" : "re-entered in checkout"}`);
      const rows = await priceSummary(page);
      const lines = await checkoutLines(page);
      expect(lineAllocation(lines, E2E_AUTO_RULE_NAME), "line discount in checkout = planCart").toBe(-expected.lineDiscount);
      expect(rowAmount(rows, SUBTOTAL), "checkout subtotal = cart items_subtotal_price").toBe(cart.items_subtotal_price);
      expect(rowAmount(rows, E2E_CODE), "checkout order discount = planCart").toBe(-expected.orderDiscount);
      expect(rowAmount(rows, TOTAL), "checkout total before shipping = cart total").toBe(cart.total_price);
    });

    await test.step("contact, CZ address, first shipping rate", () => fillCzechShippingAddress(page));
    await test.step("pay with the Bogus gateway (card 1)", () => payWithBogusCard(page));

    const thankYou = await test.step("thank-you page: discounts and total = planCart / cart", async () => {
      // The page fades in over the payment form: read and screenshot only once it settled (audit P3-8).
      const settled = await settledThankYou(page);
      expect(settled.payFormGone, "the payment form is gone before the thank-you page is read").toBe(true);
      const rows = await priceSummary(page);
      const lines = await checkoutLines(page);
      const shipping = rowAmount(rows, SHIPPING);
      const tax = rows.filter((r) => TAX.test(r.label)).reduce((sum, r) => sum + (r.amount ?? 0), 0);
      const observed = {
        lineDiscount: lineAllocation(lines, E2E_AUTO_RULE_NAME),
        lineOriginal: lines[0]?.originalPrice ?? null,
        lineFinal: lines[0]?.finalPrice ?? null,
        subtotal: rowAmount(rows, SUBTOTAL),
        orderDiscount: rowAmount(rows, E2E_CODE),
        shipping,
        tax,
        total: rowAmount(rows, TOTAL),
        charged: settled.charged,
      };
      expect(lines, "one line on the order").toHaveLength(1);
      expect(observed.lineDiscount, "thank-you line discount = planCart").toBe(-expected.lineDiscount);
      expect(observed.lineOriginal, "line original price = cart").toBe(cart.items[0]!.original_price * cart.items[0]!.quantity);
      expect(observed.lineFinal, "line reduced price = original − planCart line discount").toBe(expected.subtotalAfterLines);
      expect(observed.subtotal, "thank-you subtotal = cart items_subtotal_price = planCart").toBe(expected.subtotalAfterLines);
      expect(observed.orderDiscount, "thank-you order discount (WONE2E15) = planCart").toBe(-expected.orderDiscount);
      expect(shipping, "shipping amount").not.toBeNull();
      expect(observed.total, "thank-you total = cart total (= planCart) + shipping + tax").toBe(expected.total + (shipping ?? 0) + tax);
      expect(observed.charged, "the card was charged the thank-you total").toBe(observed.total);
      return { rows, lines, observed };
    });

    await saveScreenshot(page, testInfo, "thankyou-mvp1-1440");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1_000);
    await expandMobileSummary(page);
    await saveScreenshot(page, testInfo, "thankyou-mvp1-390");

    await saveEvidence(testInfo, "checkout-mvp1", {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      checkoutPath: new URL(page.url()).pathname.replace(/\/cn\/[^/]+/u, "/cn/<token>"),
      codeCarriedIntoCheckout,
      cart: {
        currency: cart.currency,
        original_total_price: cart.original_total_price,
        items_subtotal_price: cart.items_subtotal_price,
        total_price: cart.total_price,
        discount_codes: cart.discount_codes,
      },
      expected: {
        lineDiscount: expected.lineDiscount,
        orderDiscount: expected.orderDiscount,
        subtotalAfterLines: expected.subtotalAfterLines,
        total: expected.total,
        planTotals: expected.plan.totals,
        rules: expected.plan.rules.map((r) => ({ ruleId: r.ruleId, state: r.state, amount: r.amount })),
      },
      thankYou: thankYou.observed,
      thankYouLines: thankYou.lines,
      thankYouSummaryRows: thankYou.rows,
    });
  });

  test("one buyer session on the real storefront: the code applied in the cart is carried into checkout", async ({ page }, testInfo) => {
    // No payment here (the Bogus order is the test above).
    test.setTimeout(240_000);
    const inputs = await readLiveInputs(E2E_PRODUCT_HANDLE);
    await page.setViewportSize({ width: 1440, height: 900 });
    await unlockRealStorefront(page);
    expect(new URL(page.url()).origin).toBe(STORE_ORIGIN);

    const cart = await freshCart(page, E2E_PRODUCT_HANDLE, [E2E_CODE]);
    const expected = expectedFor(cart, inputs, CHECKOUT_COUNTRY);
    try {
      expect(cart.discount_codes[0]).toEqual({ code: E2E_CODE, applicable: true });
      expect(cart.total_price, "cart total = planCart").toBe(expected.total);

      await openCheckout(page, `${STORE_ORIGIN}/checkout`);
      const rows = await priceSummary(page);
      const lines = await checkoutLines(page);
      const observed = {
        lineDiscount: lineAllocation(lines, E2E_AUTO_RULE_NAME),
        subtotal: rowAmount(rows, SUBTOTAL),
        orderDiscount: rowAmount(rows, E2E_CODE),
        total: rowAmount(rows, TOTAL),
      };
      expect(observed.orderDiscount, "the cart's code is in checkout without re-entering it (= planCart)").toBe(-expected.orderDiscount);
      expect(observed.lineDiscount, "line discount in checkout = planCart").toBe(-expected.lineDiscount);
      expect(observed.subtotal, "checkout subtotal = cart items_subtotal_price").toBe(cart.items_subtotal_price);
      expect(observed.total, "checkout total before shipping = cart total = planCart").toBe(expected.total);
      await saveEvidence(testInfo, "checkout-carry-mvp1", {
        at: new Date().toISOString(),
        theme: THEME_LABEL || null,
        cartTotal: cart.total_price,
        expected: { lineDiscount: expected.lineDiscount, orderDiscount: expected.orderDiscount, total: expected.total },
        observed,
        rows,
      });
      await saveScreenshot(page, testInfo, "checkout-carry-mvp1-1440");
    } finally {
      // The real-domain cart: no code, no line (best effort).
      await page.goto(`${STORE_ORIGIN}/`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      await clearCartQuietly(page);
    }
  });
});
