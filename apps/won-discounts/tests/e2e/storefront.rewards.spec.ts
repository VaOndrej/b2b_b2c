import type { Page, TestInfo } from "@playwright/test";
import { assertExtensionAssetsLoaded, assertResponsiveSane } from "@won/testing/playwright";
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
import { E2E_PROFILE, expect, gotoStorefront, STORE_ORIGIN, test, THEME_LABEL, unlockRealStorefront } from "./support/fixtures.ts";
import { marginPlanInput } from "./support/margin.ts";
import { executeAsApp } from "./support/won-plan.ts";
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
// (e2e.app.config.mjs templateOverlays, scripts/make-e2e-overlay.mjs). The pages are
// opened on the real store domain previewing that theme (openThemePreview: the
// theme-dev proxy does not serve the Storefront API that Shopify.actions uses).
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
  /** Milníky: the order-discount steps (core storefront-config.ts StorefrontDiscountStep). */
  disc?: { id: string; t: Record<string, number>; pct?: number; off?: Record<string, number> }[];
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

/**
 * The rewards spec runs on the REAL store domain, previewing the theme `shopify theme dev` syncs (the matrix's
 * remote theme "Horizon" / "Dawn", unpublished: its workspace with the overlays). Why: the cart panel writes through
 * Shopify.actions.updateCart, which posts to the storefront's own /api/<version>/graphql.json — the theme-dev proxy
 * (127.0.0.1) does not serve that path (net::ERR_FAILED, probed 2026-10-01), a live storefront always does.
 */
async function openThemePreview(page: Page): Promise<void> {
  const data = await executeAsApp<{ themes: { nodes: { id: string; name: string; role: string }[] } }>("query WonE2eThemes { themes(first: 50) { nodes { id name role } } }", {});
  const theme = data.themes.nodes.find((t) => t.name === THEME_LABEL);
  expect(theme, `the matrix's remote theme "${THEME_LABEL}" exists`).toBeDefined();
  expect(theme!.role, "previewed, never published").not.toBe("MAIN");
  // The store domain shows Shopify's preview bar and cookie banner over the bottom of the page: hide the bar (screenshots
  // only), decline the banner once (it then stays away for the session). Neither touches the cart.
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent = "#preview-bar-iframe, #PBarNextFrameWrapper { display: none !important; }";
      document.head.append(style);
    });
  });
  await unlockRealStorefront(page);
  await gotoStorefront(page, `${STORE_ORIGIN}/?preview_theme_id=${theme!.id.split("/").pop()}`);
  const decline = page.locator("#shopify-pc__banner__btn-decline");
  if (await decline.isVisible({ timeout: 5_000 }).catch(() => false)) await decline.click();
  const shown = await page.evaluate(() => (window as unknown as { Shopify?: { theme?: { name?: string } } }).Shopify?.theme?.name ?? null);
  expect(shown, "the store renders the previewed theme").toBe(THEME_LABEL);
}

/** A storefront page of the previewed theme (absolute: the page is on the store domain, not the theme-dev base URL). */
const go = (page: Page, path: string) => gotoStorefront(page, `${STORE_ORIGIN}${path}`);

/** The cart's currency and the cart product's price in it — reads only (the store domain rate-limits writes). */
async function priceProbe(page: Page): Promise<{ currency: string; price: number }> {
  const cart = await storefrontJson<Cart>(page, "GET", "/cart.js");
  const product = await storefrontJson<{ variants: { price: number }[] }>(page, "GET", `/products/${REWARDS_CART_HANDLE}.js`);
  return { currency: cart.currency, price: product.variants[0]!.price };
}

/** A cart of `quantity` × the cart product, set up by the test (no customer event). */
async function setupCart(page: Page, quantity: number): Promise<Cart> {
  return freshCartOfVariants(page, [{ handle: REWARDS_CART_HANDLE, quantity }], []);
}

/** The customer adds `quantity` on the product page with the theme's own buy button (the theme fires its cart event). */
async function addOnProductPage(page: Page, handle: string, quantity: number): Promise<void> {
  await go(page, `/products/${handle}`);
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

/** Scrolls the visible panel into view; the theme may re-render it meanwhile (the panel goes back in): try again. */
async function scrollToPanel(page: Page): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await page.locator(`${PANEL}:visible`).first().scrollIntoViewIfNeeded({ timeout: 5_000 });
      return;
    } catch (error) {
      if (attempt >= 3) throw error;
      await page.waitForTimeout(1_000);
    }
  }
}

async function panelShots(page: Page, testInfo: TestInfo, name: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await scrollToPanel(page);
  await page.waitForTimeout(400);
  await saveScreenshot(page, testInfo, `${name}-1440`, { fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await scrollToPanel(page);
  // The controls' boxes and the CSS deciding them, kept with the evidence (the theme's styles meet ours here).
  const controls = await page
    .locator(`${PANEL}:visible`)
    .first()
    .locator("button, input")
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return { tag: el.tagName, text: (el.textContent || (el as HTMLInputElement).name || "").trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), minHeight: cs.minHeight, display: cs.display, padding: cs.padding };
      }),
    );
  await saveEvidence(testInfo, `${name}-controls`, controls);
  await assertResponsiveSane(page, { root: PANEL });
  await saveScreenshot(page, testInfo, `${name}-390`, { fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** One rendered Milníky ladder (feedback 6 Oct 2026, bod 10): its size, the track's value, the marks and — size "full" — the rows. */
interface LadderSeen {
  size: string | null;
  now: number;
  text: string;
  marks: number;
  marksDone: number;
  rows: { kind: string | null; done: boolean; text: string }[];
}

/** The ladder inside `root` (the first one), or null when there is none. */
async function ladderIn(page: Page, root: string): Promise<LadderSeen | null> {
  return page.evaluate((selector) => {
    const ms = document.querySelector(`${selector} .won-ms`);
    if (!ms) return null;
    return {
      size: ms.getAttribute("data-won-ms"),
      now: Number(ms.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")),
      text: ms.querySelector(".won-ms__text")?.textContent ?? "",
      marks: ms.querySelectorAll(".won-ms__track i").length,
      marksDone: ms.querySelectorAll(".won-ms__track i[data-done]").length,
      rows: [...ms.querySelectorAll(".won-ms__list li")].map((li) => ({ kind: li.getAttribute("data-won-ms-step"), done: li.hasAttribute("data-done"), text: li.textContent ?? "" })),
    };
  }, root);
}

/** The ladder the visible cart panel shows. */
async function progressOf(page: Page): Promise<LadderSeen | null> {
  const panel = page.locator(`${PANEL}:visible`).first();
  await panel.evaluate((el) => el.setAttribute("data-won-e2e-panel", ""));
  return ladderIn(page, "[data-won-e2e-panel]");
}

/** The ladder planCart expects for a cart: every step offered in the cart's currency, lowest cart value first, and which are reached. */
function expectedLadder(plan: CartPlan, rw: RewardsSf, currency: string): { kind: string; at: number; done: boolean }[] {
  const steps: { kind: string; at: number; done: boolean }[] = [];
  const ship = plan.progress.freeShipping;
  if (ship) steps.push({ kind: "s", at: ship.threshold, done: ship.reached });
  for (const g of plan.progress.gifts ?? []) steps.push({ kind: "g", at: g.threshold, done: g.afterDiscounts ? g.afterDiscounts.reached : g.reached });
  for (const d of rw.disc ?? []) {
    const at = d.t[currency];
    const state = plan.rules.find((r) => r.ruleId === d.id)?.state;
    if (typeof at === "number" && state !== "currency_missing") steps.push({ kind: "d", at, done: state === "applied" || state === "outranked" || state === "combined" });
  }
  return steps.sort((a, b) => a.at - b.at);
}
/** Records the cart events the page sees (the theme's and ours) — read back with panelDiagnostics on a failure. */
async function recordCartEvents(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __wonEvents: string[] };
    w.__wonEvents = [];
    for (const name of ["shopify:cart:lines-update", "shopify:cart:discount-update", "cart:update", "won-discounts:cart:update"]) {
      document.addEventListener(name, (e) => w.__wonEvents.push(`${name}${(e as CustomEvent).detail?.won ? " (won)" : ""}`), true);
    }
  });
}

/** What the page knows when the panel did not act: events seen, Storefront actions, the panel's boot and view. */
async function panelDiagnostics(page: Page) {
  return page
    .evaluate(() => {
      const w = window as unknown as {
        __wonEvents?: string[];
        __wonCartStarted?: boolean;
        subscribe?: unknown;
        Shopify?: { actions?: Record<string, unknown> };
        WonDiscounts?: { ready?: boolean; cart?: { on?: boolean } };
      };
      return {
        url: location.pathname,
        events: w.__wonEvents ?? null,
        actions: Object.keys(w.Shopify?.actions ?? {}),
        cartStarted: w.__wonCartStarted ?? false,
        dawnSubscribe: typeof w.subscribe,
        ready: w.WonDiscounts?.ready ?? false,
        cartDataOn: w.WonDiscounts?.cart?.on ?? null,
        panel: document.querySelector("[data-won-discounts-cart]")?.outerHTML.slice(0, 400) ?? null,
      };
    })
    .catch((error: unknown) => ({ error: String(error) }));
}


test.describe(`Won Discounts cart rewards: cart panel, gift and checkout (MVP 4)${PRO ? " [Pro: ladder, choice of 3]" : OTHER ? " [counting other discounts]" : ""}${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(
    !["rewards", "rewards-other", "rewards-pro"].includes(E2E_PROFILE),
    `WON_E2E_PROFILE=${E2E_PROFILE}: this spec needs the rewards seed (seed-mvp1.mjs --profile rewards|rewards-other|rewards-pro --live) and WON_E2E_PROFILE=rewards|rewards-other|rewards-pro`,
  );

  // The store domain sits behind Cloudflare's rate limit (HTTP 429 "Verifying your connection…" after a few
  // tests in a row, MVP 4 E2E): each test starts after a pause so the limit has room again.
  test.beforeEach(async ({ page }) => {
    await page.waitForTimeout(20_000);
  });

  test.afterEach(async ({ page }) => {
    if (page.url().startsWith(STORE_ORIGIN)) await clearCartQuietly(page);
  });

  test("SF-1: opening the cart writes nothing; the panel's progress = planCart; the gift facts come from all_products (F-R2); the app proxy answers a POST (F-R4)", async ({
    page,
  }, testInfo) => {
    test.skip(PRO || OTHER, "phase A, profile rewards");
    test.setTimeout(240_000);
    const inputs = await readTierInputs(REWARDS_HANDLES);
    const rw = rewardsOf(inputs);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openThemePreview(page);
    await go(page, `/products/${REWARDS_CART_HANDLE}`);
    const probe = await priceProbe(page);
    const below = itemsFor(giftThreshold(rw, REWARDS_GIFT_TIER_ID, probe.currency), probe.price) - 1;
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
    await go(page, "/cart");
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
    // Milníky: the cart page shows the FULL ladder — every step planCart offers, the reached ones ticked.
    const ladder = expectedLadder(plan, rw, cart.currency);
    expect(shown?.size, "the cart page shows the full ladder").toBe("full");
    expect(shown?.rows.map((r) => [r.kind, r.done]), "the ladder's steps and which are reached = planCart").toEqual(ladder.map((s) => [s.kind, s.done]));
    expect(shown?.marks, "a mark per step on the track").toBe(ladder.length);
    expect(ship.threshold > 0 && gift.threshold > 0, "both thresholds are set").toBe(true);
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
    await openThemePreview(page);
    await go(page, `/products/${REWARDS_CART_HANDLE}`);
    const probe = await priceProbe(page);
    const needed = itemsFor(giftThreshold(rw, REWARDS_GIFT_TIER_ID, probe.currency), probe.price);
    await setupCart(page, needed - 1);

    const writes = recordCartWrites(page);
    await recordCartEvents(page);
    await test.step("the customer adds 1 on the product page", () => addOnProductPage(page, REWARDS_CART_HANDLE, 1));
    const withGift = await waitForCart(page, (c) => giftLines(c, REWARDS_GIFT_TIER_ID).length === 1);
    const giftLine = giftLines(withGift, REWARDS_GIFT_TIER_ID)[0];
    if (!giftLine) await saveEvidence(testInfo, "rewards-gift-diagnostics", { writes, diagnostics: await panelDiagnostics(page), cart: withGift.items.map((i) => [i.variant_id, i.quantity, i.properties]) });
    expect(giftLine, `the panel added the gift within ${GIFT_ALLOWANCE_MS / 1000} s of the customer's add`).toBeDefined();
    expect(giftLine!.properties, "the gift line's attributes (R7, A11)").toMatchObject({ _won_gift: REWARDS_GIFT_TIER_ID, _gift_progress: "1" });
    expect(giftLine!.quantity).toBe(1);
    expect(giftLine!.variant_id, "the gift is the offered variant").toBe(rw.gifts[0]!.c[0]!.v);
    const plan = planOf(withGift, inputs, "CZ");
    const rows = expectCartMatchesPlan(withGift, plan);
    expect(giftLine!.final_line_price, "the gift is free in the cart").toBe(0);

    // F-R1: Horizon's cart is a drawer (Dawn's dev-store setting is the notification popup, no drawer): opened
    // through Shopify.actions.openCart, the panel in it shows the gift without a reload.
    const drawerPanel = page.locator(`cart-drawer-component ${PANEL}:visible, #CartDrawer ${PANEL}:visible`).first();
    if (THEME_LABEL === "Horizon") {
      await page.evaluate(() => (window as unknown as { Shopify: { actions: { openCart: () => Promise<void> } } }).Shopify.actions.openCart());
      await expect(drawerPanel, "F-R1: Horizon's drawer shows the cart panel").toBeVisible({ timeout: 15_000 });
    }
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

    await go(page, "/cart");
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
    await openThemePreview(page);
    await go(page, `/products/${REWARDS_CART_HANDLE}`);
    const probe = await priceProbe(page);
    const needed = itemsFor(giftThreshold(rw, REWARDS_GIFT_TIER_ID, probe.currency), probe.price);
    await setupCart(page, needed - 1);
    await addOnProductPage(page, REWARDS_CART_HANDLE, 1);
    const withGift = await waitForCart(page, (c) => giftLines(c).length === 1);
    expect(giftLines(withGift), "precondition: the panel added the gift").toHaveLength(1);

    await go(page, "/cart");
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
    await openThemePreview(page);
    await go(page, `/products/${REWARDS_CART_HANDLE}`);
    const probe = await priceProbe(page);
    const needed = itemsFor(giftThreshold(rw, REWARDS_GIFT_TIER_ID, probe.currency), probe.price);
    await setupCart(page, needed - 1);
    await addOnProductPage(page, REWARDS_CART_HANDLE, 1);
    const cart = await waitForCart(page, (c) => giftLines(c).length === 1);
    expect(giftLines(cart), "precondition: the panel added the gift").toHaveLength(1);
    const plan = planOf(cart, inputs, "CZ");
    expectCartMatchesPlan(cart, plan);
    expect(plan.shipping?.ruleId, "planCart: free shipping (reward:shipping)").toBe("reward:shipping");
    const giftTitle = inputs.titleByHandle[REWARDS_GIFT_HANDLE]!;
    const productTitle = inputs.titleByHandle[REWARDS_CART_HANDLE]!;

    await openCheckout(page, `${STORE_ORIGIN}/checkout`);
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
    await openThemePreview(page);
    await go(page, `/products/${REWARDS_CART_HANDLE}`);
    try {
      const market = await setStorefrontCountry(page, "SK");
      expect(market.status).toBe(200);
      const probe = await priceProbe(page);
      expect(probe.currency, "the SK cart is in EUR").toBe("EUR");
      const needed = itemsFor(giftThreshold(rw, REWARDS_GIFT_TIER_ID, "EUR"), probe.price);
      await setupCart(page, needed - 1);
      await addOnProductPage(page, REWARDS_CART_HANDLE, 1);
      const cart = await waitForCart(page, (c) => giftLines(c).length === 1);
      expect(giftLines(cart), "the panel added the gift at the EUR threshold").toHaveLength(1);
      const plan = planOf(cart, inputs, "SK");
      const rows = expectCartMatchesPlan(cart, plan);
      expect(plan.progress.freeShipping?.reached, "free shipping reached in EUR").toBe(true);
      await go(page, "/cart");
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
    await openThemePreview(page);
    await go(page, `/products/${REWARDS_CART_HANDLE}`);
    const probe = await priceProbe(page);
    const needed = itemsFor(giftThreshold(rw, REWARDS_GIFT_TIER_ID, probe.currency), probe.price);
    await setupCart(page, needed - 1);
    await addOnProductPage(page, REWARDS_CART_HANDLE, 1);
    expect(giftLines(await waitForCart(page, (c) => giftLines(c).length === 1)), "precondition: the gift").toHaveLength(1);

    await go(page, "/cart");
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
    await openThemePreview(page);
    await go(page, `/products/${REWARDS_CART_HANDLE}`);
    const probe = await priceProbe(page);
    const needed = itemsFor(giftThreshold(rw, REWARDS_LADDER_TIER_ID, probe.currency), probe.price);
    await setupCart(page, needed - 1);
    await addOnProductPage(page, REWARDS_CART_HANDLE, 1);
    const first = await waitForCart(page, (c) => giftLines(c, REWARDS_GIFT_TIER_ID).length === 1);
    expect(giftLines(first, REWARDS_GIFT_TIER_ID), "the single-option tier is added").toHaveLength(1);
    expect(giftLines(first, REWARDS_LADDER_TIER_ID), "the choice waits for the customer").toEqual([]);

    await go(page, "/cart");
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
  test("Milníky: the ladder walks the steps in all four places — the top strip, the product page, the cart drawer and the cart page — without a page load", async ({
    page,
  }, testInfo) => {
    test.skip(OTHER, "profiles rewards (Free: two steps) and rewards-pro (Pro: the ladder with a discount step)");
    test.setTimeout(420_000);
    const inputs = await readTierInputs(REWARDS_HANDLES);
    const rw = rewardsOf(inputs);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openThemePreview(page);
    await go(page, `/products/${REWARDS_CART_HANDLE}`);
    await storefrontJson(page, "POST", "/cart/clear.js", {});
    await go(page, `/products/${REWARDS_CART_HANDLE}`);
    // 7 Oct 2026: markup without the extension's files is a bare page — the ladder needs its stylesheet and scripts.
    await assertExtensionAssetsLoaded(page, { match: "won-discounts" });
    const probe = await priceProbe(page);
    const TOP = "[data-won-discounts-topbar]";
    const PRODUCT = '[data-won-discounts-progress][data-size="compact"]';
    const DRAWER = "cart-drawer-component .cart-drawer__summary, #CartDrawer .drawer__footer";
    await expect(page.locator(`${PRODUCT} .won-ms`).first(), "the Milestones block renders on the product page (template overlay)").toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`${TOP} .won-ms`), "the top strip shows the ladder (the embed's setting in the overlay)").toBeVisible({ timeout: 20_000 });
    expect(await page.locator(`${PRODUCT} .won-ms`).first().evaluate((el) => getComputedStyle(el.querySelector(".won-ms__track")!).position), "the ladder's stylesheet applies").toBe("relative");
    let loads = 0;
    page.on("load", () => (loads += 1));

    // Every amount of the ladder in the cart's currency, and one cart just below the first.
    const empty = planOf(await storefrontJson<Cart>(page, "GET", "/cart.js"), inputs, "CZ");
    const amounts = [...new Set(expectedLadder(empty, rw, probe.currency).map((s) => s.at))];
    expect(amounts.length, PRO ? "Pro: free shipping, two gifts and the discount step" : "Free: free shipping and the gift").toBe(PRO ? 4 : 2);
    const walk = [Math.max(1, itemsFor(amounts[0]!, probe.price) - 1), ...amounts.map((at) => itemsFor(at, probe.price))];
    const seen: unknown[] = [];
    for (const [index, quantity] of walk.entries()) {
      await test.step(`${quantity} × the cart product`, async () => {
        // The cart changes as a theme changes it: the AJAX cart, then the theme's cart event (no navigation).
        await page.evaluate(async (qty) => {
          const product = (await (await fetch(`${location.pathname}.js`)).json()) as { variants: { id: number }[] };
          const cart = (await (await fetch("/cart.js", { cache: "no-store" })).json()) as { items: { key: string; variant_id: number; properties?: Record<string, string> }[] };
          const line = cart.items.find((i) => i.variant_id === product.variants[0]!.id && !i.properties?._won_gift);
          const init = { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" } };
          if (line) await fetch("/cart/change.js", { ...init, body: JSON.stringify({ id: line.key, quantity: qty }) });
          else await fetch("/cart/add.js", { ...init, body: JSON.stringify({ items: [{ id: product.variants[0]!.id, quantity: qty }] }) });
          document.dispatchEvent(new CustomEvent("cart:update"));
        }, quantity);
        // The panel reads the cart 300 ms after the event and keeps its own writes (a gift line) 1.5 s apart.
        const goods = (c: Cart) => c.items.filter((i) => !giftOf(i)).reduce((sum, i) => sum + i.quantity, 0);
        const cart = await waitForCart(page, (c) => goods(c) === quantity);
        await page.waitForTimeout(6_000);
        const plan = planOf(await storefrontJson<Cart>(page, "GET", "/cart.js"), inputs, "CZ");
        const ladder = expectedLadder(plan, rw, cart.currency);
        const done = ladder.filter((s) => s.done).length;
        const top = await ladderIn(page, TOP);
        const product = await ladderIn(page, PRODUCT);
        expect(top?.size, "the top strip: the strip size").toBe("bar");
        expect(top?.marks, "the strip has no marks").toBe(0);
        expect(product?.size, "the product page: the compact size").toBe("compact");
        expect([product?.marks, product?.marksDone], `product page: ${done} of ${ladder.length} steps reached = planCart`).toEqual([ladder.length, done]);
        expect(top?.text, "the strip and the block say the same sentence").toBe(product?.text);
        // The cart drawer (a theme with a drawer has its summary in the page): the compact ladder, the same steps.
        const drawer = (await page.locator(DRAWER).count()) > 0 ? await ladderIn(page, `:is(${DRAWER})`) : null;
        if (drawer) expect([drawer.size, drawer.marks, drawer.marksDone], "the cart drawer: the compact ladder = planCart").toEqual(["compact", ladder.length, done]);
        else if (index === 0) testInfo.annotations.push({ type: "note", description: "this theme copy has no cart drawer in the page: the drawer placement is not checked" });
        seen.push({ quantity, ladder, top, product, drawer });
        if (index === 1) {
          await saveScreenshot(page, testInfo, "milestones-product-1440", { fullPage: false });
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForTimeout(800);
          await assertResponsiveSane(page, { root: PRODUCT });
          await saveScreenshot(page, testInfo, "milestones-product-390", { fullPage: false });
          await page.setViewportSize({ width: 1440, height: 900 });
        }
      });
    }
    expect(loads, "the ladder followed the cart without a page load").toBe(0);

    // The cart page: the full ladder, every step with its reward, the reached ones ticked.
    await go(page, "/cart");
    await expect(page.locator(`${PANEL}:visible`).first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(4_000);
    const plan = planOf(await storefrontJson<Cart>(page, "GET", "/cart.js"), inputs, "CZ");
    const ladder = expectedLadder(plan, rw, probe.currency);
    const full = await progressOf(page);
    expect(full?.size, "the cart page: the full size").toBe("full");
    expect(full?.rows.map((r) => [r.kind, r.done]), "the cart page lists every step, reached = planCart").toEqual(ladder.map((s) => [s.kind, s.done]));
    expect(ladder.every((s) => s.done), "the walk reached every step").toBe(true);
    if (PRO) expect(plan.order?.components.map((c) => c.ruleId), "checkout gives the discount step").toEqual([rw.disc![0]!.id]);
    await panelShots(page, testInfo, "milestones-cart");
    await saveEvidence(testInfo, "milestones-ladder", { at: new Date().toISOString(), theme: THEME_LABEL || null, walk, seen, cartPage: full, plan: { totals: plan.totals, order: plan.order } });
  });
});
