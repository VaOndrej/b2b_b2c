import type { Page, TestInfo } from "@playwright/test";
import { assertResponsiveSane } from "@won/testing/playwright";
import { planCart, type CartPlan } from "@won/core/discounts/plan";

import {
  REWARDS_CART_HANDLE,
  REWARDS_CODE,
  REWARDS_GIFT_HANDLE,
  REWARDS_GIFT_TIER_ID,
  REWARDS_HANDLES,
  REWARDS_LADDER_TIER_ID,
} from "../../scripts/e2e/rewards-fixture.mjs";
import { clearCartQuietly, freshCartOfVariants, setStorefrontCountry, storefrontJson, type Cart, type CartItem } from "./support/cart.ts";
import {
  checkoutLines,
  CZECH_ADDRESS,
  expandMobileSummary,
  fillShippingAddress,
  FREE,
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
import { E2E_PROFILE, expect, gotoStorefront, test, THEME_LABEL, unlockRealStorefront } from "./support/fixtures.ts";
import { marginPlanInput } from "./support/margin.ts";
import { numericId, readTierInputs, type TierInputs } from "./support/tiers.ts";

// SPEC-DRIVEN (MVP 4, Task 8). Live proof of cart rewards on BOTH shared themes
// (the matrix runs this file against Horizon and Dawn through `shopify theme dev`):
// the cart panel of the app embed (drawer) and the cart_rewards block (cart page),
// the gift line it adds, and checkout giving the gift and the shipping for free.
//
// Needs the rewards seed (scripts/e2e/rewards-fixture.mjs):
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile rewards --live
//   WON_E2E_PROFILE=rewards npm run test:e2e:local:all -w won-discounts
// The cart block is put into each theme copy's cart template by the runner
// (e2e.app.config.mjs templateOverlays, scripts/make-e2e-overlay.mjs).
//
// Exit criteria of MVP 4 (spec §10), per profile:
//   rewards (Free)
//     1 SF-1: opening the cart writes nothing; the panel's progress = planCart;
//       the embed reads the gift through all_products (F-R2); the cart-plan app
//       proxy answers a POST (F-R4).
//     2 a customer's add on the PDP that reaches the threshold → the panel adds the
//       gift (`_won_gift`, `_gift_progress`), /cart.js = planCart (gift 100 % off);
//       the drawer shows it without a reload (F-R1); "No thanks" removes it and
//       declines the tier, the next add does not bring it back.
//     3 a customer removing items below the threshold → the panel removes the gift.
//     4 checkout (Bogus): the gift is free and the shipping is free = planCart (F-R3).
//     5 slovensko: the thresholds in EUR (the gift reached in EUR = planCart).
//   rewards-other (Free, countOtherDiscounts) 6: the panel's code field — a code
//     that takes the order below the threshold warns; "Remove the code" keeps the
//     gift, "Keep the code" removes it.
//   rewards-pro (Pro) 7: the ladder — the first gift added, the second offered as
//     a choice of 3; the customer's pick is added; both free = planCart.
// Expectations are planCart on the live config and the storefront config read as
// the app, never constants; amounts only from /cart.js and the checkout's tables.

const PRO = E2E_PROFILE === "rewards-pro";
const OTHER = E2E_PROFILE === "rewards-other";
const EMAIL = `won-e2e+${E2E_PROFILE}@example.com`;
const PANEL = "[data-won-discounts-cart]";
const GIFT_ALLOWANCE_MS = 25_000;

interface RewardsSf {
  ship: Record<string, number> | null;
  gifts: {
    id: string;
    t: Record<string, number>;
    c: { v: number; h: string }[];
    f?: { v: number; h: string };
  }[];
  other: boolean;
}

function rewardsOf(inputs: TierInputs): RewardsSf {
  const sf = inputs.storefrontConfig as unknown as {
    rewards?: RewardsSf;
  } | null;
  expect(sf?.rewards, "the storefront config carries the rewards (R7) — run the rewards seed").toBeTruthy();
  return sf!.rewards!;
}

const giftOf = (item: CartItem) => (typeof item.properties?._won_gift === "string" ? item.properties._won_gift : null);
const giftLines = (cart: Cart, tierId?: string) => cart.items.filter((item) => (tierId ? giftOf(item) === tierId : giftOf(item) !== null));
const declinedOf = (cart: Cart) =>
  String(cart.attributes?._won_gift_declined ?? "")
    .split(",")
    .filter(Boolean);

/** planCart for the cart as checkout sees it (gift lines by their `_won_gift` attribute). */
function planOf(cart: Cart, inputs: TierInputs, country: string): CartPlan {
  const plan = planCart(marginPlanInput(cart, inputs, country, cart.currency === inputs.shopCurrency ? 1 : undefined), inputs.config);
  expect(plan.reason, `planCart failed: ${plan.error ?? ""}`).toBeUndefined();
  return plan;
}

/** /cart.js = planCart line by line (a gift line: 1 item free, "Dárek zdarma"), and the cart total. */
function expectCartMatchesPlan(cart: Cart, plan: CartPlan) {
  return cart.items.map((item, index) => {
    const line = plan.lines.find((l) => l.lineId === `gid://shopify/CartLine/${index}`)!;
    const planned = line.product;
    const allocations = item.line_level_discount_allocations.map((a) => [a.discount_application.title, a.amount] as const);
    if (planned) expect(allocations, `line ${index} (variant ${item.variant_id}): = planCart`).toEqual([[planned.message, planned.amount]]);
    else expect(allocations, `line ${index} (variant ${item.variant_id}): no discount`).toEqual([]);
    expect(item.final_line_price, `line ${index}: price after discounts = planCart`).toBe(line.subtotal - (planned?.amount ?? 0));
    return {
      variant: item.variant_id,
      quantity: item.quantity,
      gift: giftOf(item),
      unitPrice: item.original_price,
      plan: planned
        ? {
            ruleIds: planned.components.map((c) => c.ruleId),
            amount: planned.amount,
          }
        : null,
    };
  });
}

/** Cart writes the page sends (the AJAX cart, or a Storefront API cart mutation — what Shopify.actions.updateCart uses). */
function recordCartWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const url = request.url();
    const body = request.postData() ?? "";
    if (/\/cart\/(add|change|update|clear)(\.js)?(\?|$)/u.test(url)) writes.push(`${new URL(url).pathname}`);
    else if (/graphql/u.test(url) && /cart[A-Za-z]*(Add|Update|Remove|Create)|mutation/u.test(body)) writes.push(`graphql ${body.slice(0, 60)}`);
  });
  return writes;
}

/** Reads /cart.js (paced) until `done` holds or the time is up; returns the last cart. */
async function waitForCart(page: Page, done: (cart: Cart) => boolean, timeoutMs = GIFT_ALLOWANCE_MS): Promise<Cart> {
  const until = Date.now() + timeoutMs;
  let cart = await storefrontJson<Cart>(page, "GET", "/cart.js");
  while (!done(cart) && Date.now() < until) cart = await storefrontJson<Cart>(page, "GET", "/cart.js");
  return cart;
}

/** A cart of `quantity` × the cart product, set up by the test (no customer event). */
async function setupCart(page: Page, quantity: number): Promise<Cart> {
  return freshCartOfVariants(page, [{ handle: REWARDS_CART_HANDLE, quantity }], []);
}

/** The customer adds `quantity` on the product page with the theme's own buy button (the theme fires its cart event). */
async function addOnProductPage(page: Page, handle: string, quantity: number): Promise<void> {
  await gotoStorefront(page, `/products/${handle}`);
  const input = page.locator('input[name="quantity"]:visible').first();
  if (quantity !== 1) await input.fill(String(quantity));
  await page.locator('button[name="add"]:visible').first().click();
}

/** The fewest items of the cart product (at `unitPrice`) that reach `threshold`. */
const itemsFor = (threshold: number, unitPrice: number) => Math.ceil(threshold / unitPrice);

/** The threshold of a gift tier in the cart's currency, minor units (the storefront config's Liquid units, 2-digit currencies). */
function giftThreshold(rw: RewardsSf, tierId: string, currency: string): number {
  const value = rw.gifts.find((g) => g.id === tierId)?.t[currency];
  expect(typeof value, `gift ${tierId} has a threshold in ${currency}`).toBe("number");
  return value!;
}

async function panelShots(page: Page, testInfo: TestInfo, name: string) {
  const panel = page.locator(`${PANEL}:visible`).first();
  await page.setViewportSize({ width: 1440, height: 900 });
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await saveScreenshot(page, testInfo, `${name}-1440`, { fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.locator(`${PANEL}:visible`).first().scrollIntoViewIfNeeded();
  await assertResponsiveSane(page, { root: PANEL });
  await saveScreenshot(page, testInfo, `${name}-390`, { fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** The progress bars the panel shows: aria-valuenow per kind. */
async function progressOf(page: Page): Promise<Record<string, number>> {
  return page
    .locator(`${PANEL}:visible`)
    .first()
    .locator("[data-won-discounts-progress]")
    .evaluateAll((rows) =>
      Object.fromEntries(
        rows.map((row) => [row.getAttribute("data-won-discounts-progress"), Number(row.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"))]),
      ),
    );
}
const pct = (left: number, threshold: number) => (threshold > 0 ? Math.min(100, Math.round(((threshold - left) * 100) / threshold)) : 100);

test.describe(`Won Discounts cart rewards: cart panel, gift and checkout (MVP 4)${PRO ? " [Pro: ladder, choice of 3]" : OTHER ? " [counting other discounts]" : ""}${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(
    !["rewards", "rewards-other", "rewards-pro"].includes(E2E_PROFILE),
    `WON_E2E_PROFILE=${E2E_PROFILE}: this spec needs the rewards seed (seed-mvp1.mjs --profile rewards|rewards-other|rewards-pro --live) and WON_E2E_PROFILE=rewards|rewards-other|rewards-pro`,
  );

  test.afterEach(async ({ page, baseURL }) => {
    if (page.url().startsWith(new URL(baseURL!).origin)) await clearCartQuietly(page);
  });

  test("SF-1: opening the cart writes nothing; the panel's progress = planCart; the gift facts come from all_products (F-R2); the app proxy answers a POST (F-R4)", async ({
    page,
  }, testInfo) => {
    test.skip(PRO || OTHER, "phase A, profile rewards");
    test.setTimeout(240_000);
    const inputs = await readTierInputs(REWARDS_HANDLES);
    const rw = rewardsOf(inputs);
    await page.setViewportSize({ width: 1440, height: 900 });
    await unlockRealStorefront(page);
    await gotoStorefront(page, `/products/${REWARDS_CART_HANDLE}`);
    const probe = await setupCart(page, 1);
    const below = itemsFor(giftThreshold(rw, REWARDS_GIFT_TIER_ID, probe.currency), probe.items[0]!.original_price) - 1;
    expect(below, "the gift threshold needs more than one item").toBeGreaterThan(0);
    const cart = await setupCart(page, below);
    const writes = recordCartWrites(page);
    const proxy = page.waitForResponse((r) => r.url().includes("/apps/won-discounts/cart-plan") && r.request().method() === "POST", { timeout: 30_000 });
    // N2 (R8 "no layout shift"): the page's layout shifts while the panel fills, Core Web Vitals' way (no recent input).
    await page.addInitScript(() => {
      const w = window as unknown as { __wonCls: number };
      w.__wonCls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!entry.hadRecentInput) w.__wonCls += entry.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    await gotoStorefront(page, "/cart");
    await expect(page.locator(`${PANEL}:visible`).first(), "the cart panel renders on the cart page (block or summary)").toBeVisible({ timeout: 20_000 });
    const answer = await proxy;
    const answerBody = (await answer.json().catch(() => null)) as {
      ok?: boolean;
    } | null;
    expect(answer.status(), "F-R4: the app proxy accepts the POST").toBe(200);
    expect(answerBody?.ok, "F-R4: the cart plan answers ok").toBe(true);
    await page.waitForTimeout(5_000);
    expect(writes, "SF-1: no cart write after opening the cart (the tier is not reached; nothing to do without the customer)").toEqual([]);

    const plan = planOf(cart, inputs, "CZ");
    const ship = plan.progress.freeShipping!;
    const gift = plan.progress.gifts!.find((g) => g.tierId === REWARDS_GIFT_TIER_ID)!;
    const shown = await progressOf(page);
    expect(gift.reached, "precondition: the gift is not reached yet").toBe(false);
    expect(shown, "the panel's bars = planCart's progress (free shipping, the next gift)").toEqual({
      shipping: pct(ship.remaining, ship.threshold),
      gift: pct(gift.remaining, gift.threshold),
    });
    const facts = await page.locator("#won-discounts-cart-data").evaluate(
      (el) =>
        JSON.parse(el.textContent ?? "{}") as {
          g?: Record<string, { t: string; a: boolean }>;
        },
    );
    const giftVariant = inputs.variantsByHandle[REWARDS_GIFT_HANDLE]![0]!;
    expect(facts.g?.[String(giftVariant.numericId)], "F-R2: the embed read the gift's title and availability through all_products").toEqual({
      t: expect.stringContaining(inputs.titleByHandle[REWARDS_GIFT_HANDLE]!),
      a: true,
    });
    const cls = await page.evaluate(() => (window as unknown as { __wonCls: number }).__wonCls);
    expect(cls, "the cart page's layout shift while the panel fills (CLS, 'good' ≤ 0.1)").toBeLessThanOrEqual(0.1);
    await panelShots(page, testInfo, "rewards-cart-progress");
    await saveEvidence(testInfo, "rewards-sf1", {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      cart: {
        currency: cart.currency,
        items: cart.items.map((i) => [i.variant_id, i.quantity, i.original_price]),
      },
      plan: { progress: plan.progress },
      panel: shown,
      writes,
      proxy: { status: answer.status(), ok: answerBody?.ok ?? null },
      giftFacts: facts.g,
      cls,
    });
  });

  test("the customer's add reaches the threshold → the gift is added (attributes), /cart.js = planCart, the drawer shows it (F-R1); No thanks declines it for good", async ({
    page,
  }, testInfo) => {
    test.skip(PRO || OTHER, "phase A, profile rewards");
    test.setTimeout(300_000);
    const inputs = await readTierInputs(REWARDS_HANDLES);
    const rw = rewardsOf(inputs);
    await page.setViewportSize({ width: 1440, height: 900 });
    await unlockRealStorefront(page);
    await gotoStorefront(page, `/products/${REWARDS_CART_HANDLE}`);
    const probe = await setupCart(page, 1);
    const needed = itemsFor(giftThreshold(rw, REWARDS_GIFT_TIER_ID, probe.currency), probe.items[0]!.original_price);
    await setupCart(page, needed - 1);

    const writes = recordCartWrites(page);
    await test.step("the customer adds 1 on the product page", () => addOnProductPage(page, REWARDS_CART_HANDLE, 1));
    const withGift = await waitForCart(page, (c) => giftLines(c, REWARDS_GIFT_TIER_ID).length === 1);
    const giftLine = giftLines(withGift, REWARDS_GIFT_TIER_ID)[0];
    expect(giftLine, `the panel added the gift within ${GIFT_ALLOWANCE_MS / 1000} s of the customer's add`).toBeDefined();
    expect(giftLine!.properties, "the gift line's attributes (R7, A11)").toMatchObject({ _won_gift: REWARDS_GIFT_TIER_ID, _gift_progress: "1" });
    expect(giftLine!.quantity).toBe(1);
    expect(giftLine!.variant_id, "the gift is the offered variant").toBe(rw.gifts[0]!.c[0]!.v);
    const plan = planOf(withGift, inputs, "CZ");
    const rows = expectCartMatchesPlan(withGift, plan);
    expect(giftLine!.final_line_price, "the gift is free in the cart").toBe(0);

    // F-R1: where the theme has a drawer open (Horizon), the panel in it shows the gift without a reload.
    const drawerPanel = page.locator(`cart-drawer-component ${PANEL}:visible, #CartDrawer ${PANEL}:visible`).first();
    const drawerShown = await drawerPanel.isVisible().catch(() => false);
    let drawerState: string | null = null;
    if (drawerShown) {
      await expect(
        drawerPanel.locator(`[data-won-discounts-gift="${REWARDS_GIFT_TIER_ID}"]`),
        "F-R1: the drawer re-rendered with the gift in it",
      ).toHaveAttribute("data-state", "in", { timeout: 15_000 });
      drawerState = "in";
      await saveScreenshot(page, testInfo, "rewards-drawer-gift-1440", {
        fullPage: false,
      });
    }

    await gotoStorefront(page, "/cart");
    const panel = page.locator(`${PANEL}:visible`).first();
    await expect(panel.locator(`[data-won-discounts-gift="${REWARDS_GIFT_TIER_ID}"]`), "the cart page panel: the gift is in").toHaveAttribute(
      "data-state",
      "in",
      { timeout: 20_000 },
    );
    await panelShots(page, testInfo, "rewards-cart-gift");

    await test.step("No thanks", () => panel.locator(`[data-won-decline="${REWARDS_GIFT_TIER_ID}"]`).click());
    const declined = await waitForCart(page, (c) => giftLines(c).length === 0 && declinedOf(c).includes(REWARDS_GIFT_TIER_ID));
    expect(giftLines(declined), "No thanks removes the gift").toEqual([]);
    expect(declinedOf(declined), "the tier is declined (cart attribute)").toContain(REWARDS_GIFT_TIER_ID);
    await expect(page.locator(`${PANEL}:visible [data-won-discounts-gift="${REWARDS_GIFT_TIER_ID}"]`).first()).toHaveAttribute("data-state", "declined", {
      timeout: 15_000,
    });

    await test.step("the customer adds 1 more: the declined gift does not come back", () => addOnProductPage(page, REWARDS_CART_HANDLE, 1));
    await page.waitForTimeout(8_000);
    const after = await storefrontJson<Cart>(page, "GET", "/cart.js");
    expect(giftLines(after), "a declined gift is never added again in this cart").toEqual([]);
    await saveEvidence(testInfo, "rewards-gift", {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      withGift: rows,
      plan: {
        totals: plan.totals,
        gifts: plan.gifts,
        shipping: plan.shipping ?? null,
      },
      drawer: { shown: drawerShown, state: drawerState },
      declined: declinedOf(declined),
      afterAdd: after.items.map((i) => [i.variant_id, i.quantity, giftOf(i)]),
      writes,
    });
  });

  test("the customer removes items below the threshold → the panel removes the gift", async ({ page }, testInfo) => {
    test.skip(PRO || OTHER, "phase A, profile rewards");
    test.setTimeout(240_000);
    const inputs = await readTierInputs(REWARDS_HANDLES);
    const rw = rewardsOf(inputs);
    await page.setViewportSize({ width: 1440, height: 900 });
    await unlockRealStorefront(page);
    await gotoStorefront(page, `/products/${REWARDS_CART_HANDLE}`);
    const probe = await setupCart(page, 1);
    const needed = itemsFor(giftThreshold(rw, REWARDS_GIFT_TIER_ID, probe.currency), probe.items[0]!.original_price);
    await setupCart(page, needed - 1);
    await addOnProductPage(page, REWARDS_CART_HANDLE, 1);
    const withGift = await waitForCart(page, (c) => giftLines(c).length === 1);
    expect(giftLines(withGift), "precondition: the panel added the gift").toHaveLength(1);

    await gotoStorefront(page, "/cart");
    const title = inputs.titleByHandle[REWARDS_CART_HANDLE]!;
    const remove = page
      .locator(`cart-remove-button a[aria-label*="${title}"], button.cart-items__remove[aria-label*="${title}"]`)
      .filter({ visible: true })
      .first();
    await test.step("the customer removes the product line with the theme's remove button", () => remove.click());
    const after = await waitForCart(page, (c) => giftLines(c).length === 0);
    expect(
      after.items.filter((i) => giftOf(i) === null),
      "the product line is gone",
    ).toEqual([]);
    expect(giftLines(after), "below the threshold the panel removed the gift").toEqual([]);
    await saveEvidence(testInfo, "rewards-below", {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      before: withGift.items.map((i) => [i.variant_id, i.quantity, giftOf(i)]),
      after: after.items.map((i) => [i.variant_id, i.quantity, giftOf(i)]),
    });
  });

  test("checkout (Bogus): the gift line is free and the shipping is free = planCart (F-R3)", async ({ page }, testInfo) => {
    test.skip(PRO || OTHER, "phase A, profile rewards");
    test.setTimeout(420_000);
    const inputs = await readTierInputs(REWARDS_HANDLES);
    const rw = rewardsOf(inputs);
    await page.setViewportSize({ width: 1440, height: 900 });
    await unlockRealStorefront(page);
    await gotoStorefront(page, `/products/${REWARDS_CART_HANDLE}`);
    const probe = await setupCart(page, 1);
    const needed = itemsFor(giftThreshold(rw, REWARDS_GIFT_TIER_ID, probe.currency), probe.items[0]!.original_price);
    await setupCart(page, needed - 1);
    await addOnProductPage(page, REWARDS_CART_HANDLE, 1);
    const cart = await waitForCart(page, (c) => giftLines(c).length === 1);
    expect(giftLines(cart), "precondition: the panel added the gift").toHaveLength(1);
    const plan = planOf(cart, inputs, "CZ");
    expectCartMatchesPlan(cart, plan);
    expect(plan.shipping?.ruleId, "planCart: free shipping (reward:shipping)").toBe("reward:shipping");
    const giftTitle = inputs.titleByHandle[REWARDS_GIFT_HANDLE]!;
    const productTitle = inputs.titleByHandle[REWARDS_CART_HANDLE]!;

    await openCheckout(page);
    await test.step("contact, CZ address, first shipping rate", () => fillShippingAddress(page, CZECH_ADDRESS, EMAIL));
    const before = await priceSummary(page);
    const shippingRow = before.find((r) => SHIPPING.test(r.label));
    expect(shippingRow, "checkout has a shipping row").toBeDefined();
    expect(FREE.test(shippingRow!.value) || shippingRow!.amount === 0, `free shipping at checkout (${shippingRow!.value})`).toBe(true);
    await test.step("pay with the Bogus gateway (card 1)", () => payWithBogusCard(page));
    const settled = await settledThankYou(page);
    expect(settled.payFormGone).toBe(true);
    const rows = await priceSummary(page);
    const lines = await checkoutLines(page);
    const giftLine = lines.find((l) => l.title.includes(giftTitle));
    const productLine = lines.find((l) => l.title.includes(productTitle));
    expect(giftLine, `thank-you: the gift line among ${JSON.stringify(lines.map((l) => l.title))}`).toBeDefined();
    expect(productLine).toBeDefined();
    const giftItem = giftLines(cart)[0]!;
    expect(giftLine!.finalPrice === 0 || giftLine!.finalPrice === null, `thank-you: the gift costs 0 (${JSON.stringify(giftLine)})`).toBe(true);
    expect(
      giftLine!.allocations.map((a) => a.amount),
      "thank-you: the gift's discount = its price (planCart)",
    ).toEqual([-giftItem.original_price]);
    const shipping = rows.find((r) => SHIPPING.test(r.label));
    expect(FREE.test(shipping?.value ?? "") || shipping?.amount === 0, `thank-you: free shipping (${shipping?.value})`).toBe(true);
    const taxRows = rows.filter((r) => TAX.test(r.label) && !/(včetně|vrátane|including|incl\.?)/iu.test(r.label));
    const tax = taxRows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
    expect(rowAmount(rows, SUBTOTAL), "thank-you subtotal = planCart").toBe(plan.totals.subtotal - plan.totals.productDiscount);
    expect(rowAmount(rows, TOTAL), "thank-you total = planCart + free shipping + tax").toBe(plan.totals.total + tax);
    expect(settled.charged).toBe(rowAmount(rows, TOTAL));
    await saveScreenshot(page, testInfo, "rewards-thankyou-1440");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1_000);
    await expandMobileSummary(page);
    await saveScreenshot(page, testInfo, "rewards-thankyou-390");
    await saveEvidence(testInfo, "rewards-checkout", {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      cart: {
        currency: cart.currency,
        items: cart.items.map((i) => [i.variant_id, i.quantity, giftOf(i), i.final_line_price]),
        total_price: cart.total_price,
      },
      plan: {
        totals: plan.totals,
        gifts: plan.gifts,
        shipping: plan.shipping ?? null,
      },
      thankYou: {
        rows,
        lines,
        charged: settled.charged,
        shippingBeforePay: shippingRow,
      },
    });
  });

  test("slovensko: the thresholds in EUR — the customer's add reaches the gift in EUR, /cart.js = planCart", async ({ page }, testInfo) => {
    test.skip(PRO || OTHER, "phase A, profile rewards");
    test.setTimeout(300_000);
    const inputs = await readTierInputs(REWARDS_HANDLES);
    const rw = rewardsOf(inputs);
    await page.setViewportSize({ width: 1440, height: 900 });
    await unlockRealStorefront(page);
    await gotoStorefront(page, `/products/${REWARDS_CART_HANDLE}`);
    try {
      const market = await setStorefrontCountry(page, "SK");
      expect(market.status).toBe(200);
      const probe = await setupCart(page, 1);
      expect(probe.currency, "the SK cart is in EUR").toBe("EUR");
      const needed = itemsFor(giftThreshold(rw, REWARDS_GIFT_TIER_ID, "EUR"), probe.items[0]!.original_price);
      await setupCart(page, needed - 1);
      await addOnProductPage(page, REWARDS_CART_HANDLE, 1);
      const cart = await waitForCart(page, (c) => giftLines(c).length === 1);
      expect(giftLines(cart), "the panel added the gift at the EUR threshold").toHaveLength(1);
      const plan = planOf(cart, inputs, "SK");
      const rows = expectCartMatchesPlan(cart, plan);
      expect(plan.progress.freeShipping?.reached, "free shipping reached in EUR").toBe(true);
      await gotoStorefront(page, "/cart");
      await expect(page.locator(`${PANEL}:visible [data-won-discounts-gift="${REWARDS_GIFT_TIER_ID}"]`).first()).toHaveAttribute("data-state", "in", {
        timeout: 20_000,
      });
      await panelShots(page, testInfo, "rewards-cart-sk");
      await saveEvidence(testInfo, "rewards-sk", {
        at: new Date().toISOString(),
        theme: THEME_LABEL || null,
        currency: cart.currency,
        rows,
        plan: { totals: plan.totals, progress: plan.progress },
      });
    } finally {
      await clearCartQuietly(page);
      await setStorefrontCountry(page, "CZ").catch(() => null);
    }
  });

  test("countOtherDiscounts: a code in the panel that takes the order below the threshold warns; Remove the code keeps the gift, Keep the code removes it", async ({
    page,
  }, testInfo) => {
    test.skip(!OTHER, "profile rewards-other");
    test.setTimeout(300_000);
    const inputs = await readTierInputs(REWARDS_HANDLES);
    const rw = rewardsOf(inputs);
    expect(rw.other, "the storefront config counts other discounts").toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await unlockRealStorefront(page);
    await gotoStorefront(page, `/products/${REWARDS_CART_HANDLE}`);
    const probe = await setupCart(page, 1);
    const needed = itemsFor(giftThreshold(rw, REWARDS_GIFT_TIER_ID, probe.currency), probe.items[0]!.original_price);
    await setupCart(page, needed - 1);
    await addOnProductPage(page, REWARDS_CART_HANDLE, 1);
    expect(giftLines(await waitForCart(page, (c) => giftLines(c).length === 1)), "precondition: the gift").toHaveLength(1);

    await gotoStorefront(page, "/cart");
    const panel = page.locator(`${PANEL}:visible`).first();
    const enterCode = async () => {
      await panel.locator('input[name="won-code"]').fill(REWARDS_CODE);
      await panel.locator("[data-won-discounts-code] button[type=submit]").click();
      await expect(panel.locator("[data-won-discounts-code-warning]"), "the panel warns: the code loses the gift").toBeVisible({ timeout: 20_000 });
    };
    await test.step("enter the code in the panel", enterCode);
    await panelShots(page, testInfo, "rewards-code-warning");
    await test.step("Remove the code", () => panel.locator(`[data-won-discounts-code-warning] [data-won-drop="${REWARDS_CODE}"]`).click());
    const dropped = await waitForCart(page, (c) => c.discount_codes.length === 0);
    expect(dropped.discount_codes, "the code is gone").toEqual([]);
    expect(giftLines(dropped), "the gift stays").toHaveLength(1);

    await page.waitForTimeout(2_000);
    await test.step("enter the code again", enterCode);
    await test.step("Keep the code (no gift)", () => panel.locator("[data-won-keep]").click());
    const kept = await waitForCart(page, (c) => giftLines(c).length === 0);
    expect(
      kept.discount_codes.map((c) => [c.code.toUpperCase(), c.applicable]),
      "the code stays",
    ).toEqual([[REWARDS_CODE, true]]);
    expect(giftLines(kept), "Keep the code: the gift goes").toEqual([]);
    const plan = planOf(kept, inputs, "CZ");
    expect(kept.total_price, "the cart total = planCart (the code, no gift)").toBe(plan.totals.total);
    await saveEvidence(testInfo, "rewards-other", {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      dropped: {
        codes: dropped.discount_codes,
        gifts: giftLines(dropped).length,
      },
      kept: {
        codes: kept.discount_codes,
        gifts: giftLines(kept).length,
        total: kept.total_price,
      },
      plan: { totals: plan.totals, warnings: plan.warnings },
    });
  });

  test("Pro ladder: the first gift is added, the second offered as a choice of 3; the customer's pick is added; both free = planCart", async ({
    page,
  }, testInfo) => {
    test.skip(!PRO, "profile rewards-pro (app on Pro)");
    test.setTimeout(300_000);
    const inputs = await readTierInputs(REWARDS_HANDLES);
    const rw = rewardsOf(inputs);
    const ladder = rw.gifts.find((g) => g.id === REWARDS_LADDER_TIER_ID);
    expect(ladder?.c, "Pro: the second threshold offers 3 gifts").toHaveLength(3);
    await page.setViewportSize({ width: 1440, height: 900 });
    await unlockRealStorefront(page);
    await gotoStorefront(page, `/products/${REWARDS_CART_HANDLE}`);
    const probe = await setupCart(page, 1);
    const needed = itemsFor(giftThreshold(rw, REWARDS_LADDER_TIER_ID, probe.currency), probe.items[0]!.original_price);
    await setupCart(page, needed - 1);
    await addOnProductPage(page, REWARDS_CART_HANDLE, 1);
    const first = await waitForCart(page, (c) => giftLines(c, REWARDS_GIFT_TIER_ID).length === 1);
    expect(giftLines(first, REWARDS_GIFT_TIER_ID), "the single-option tier is added").toHaveLength(1);
    expect(giftLines(first, REWARDS_LADDER_TIER_ID), "the choice waits for the customer").toEqual([]);

    await gotoStorefront(page, "/cart");
    const pick = page.locator(`${PANEL}:visible [data-won-discounts-gift="${REWARDS_LADDER_TIER_ID}"]`).first();
    await expect(pick, "the panel offers the choice").toHaveAttribute("data-state", "pick", { timeout: 20_000 });
    await expect(pick.locator("[data-won-add]")).toHaveCount(3);
    await panelShots(page, testInfo, "rewards-pro-choice");
    const chosen = Number(await pick.locator("[data-won-add]").nth(1).getAttribute("data-variant"));
    await test.step("the customer picks the second gift", () => pick.locator("[data-won-add]").nth(1).click());
    const both = await waitForCart(page, (c) => giftLines(c, REWARDS_LADDER_TIER_ID).length === 1);
    const ladderLine = giftLines(both, REWARDS_LADDER_TIER_ID)[0];
    expect(ladderLine?.variant_id, "the picked gift is in the cart").toBe(chosen);
    const plan = planOf(both, inputs, "CZ");
    const rows = expectCartMatchesPlan(both, plan);
    expect(
      giftLines(both).map((i) => i.final_line_price),
      "both gifts free",
    ).toEqual([0, 0]);
    expect(
      plan.gifts.map((g) => [g.tierId, g.state]),
      "planCart: both tiers earned",
    ).toEqual([
      [REWARDS_GIFT_TIER_ID, "earned"],
      [REWARDS_LADDER_TIER_ID, "earned"],
    ]);
    await saveEvidence(testInfo, "rewards-pro", {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      rows,
      plan: { totals: plan.totals, gifts: plan.gifts },
      chosen,
      numericGift: numericId(inputs.variantsByHandle[REWARDS_GIFT_HANDLE]![0]!.id),
    });
  });
});
