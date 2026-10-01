import type { Page, TestInfo } from "@playwright/test";
import { assertResponsiveSane } from "@won/testing/playwright";

import { appBlockType, TIERS_BLOCK_NAME } from "../../scripts/make-e2e-overlay.mjs";
import {
  TIERS_BREAKS,
  TIERS_CART,
  TIERS_COLLECTION_BREAKS,
  TIERS_COLLECTION_HANDLE,
  TIERS_COLLECTION_SET_ID,
  TIERS_COUNT_ACROSS,
  TIERS_GLOBAL_SET_ID,
  TIERS_HANDLES,
  TIERS_LARGE_OPTION,
  TIERS_MAX_DISCOUNT_PERCENT,
  TIERS_MIN_MARGIN_PERCENT,
  TIERS_PLAIN_HANDLE,
  TIERS_PRO_CART,
  TIERS_PRODUCT_HANDLE,
  TIERS_SMALL_OPTION,
  TIERS_SPARE_HANDLE,
  TIERS_TEMPLATE_BLOCK_ID,
  TIERS_VARIANTS_HANDLE,
} from "../../scripts/e2e/tiers-fixture.mjs";
import { clearCartQuietly, freshCartOfVariants, setStorefrontCountry, storefrontJson, type Cart, type CartItem } from "./support/cart.ts";
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
  SHIPPING,
  SUBTOTAL,
  TAX,
  TOTAL,
  type CheckoutLine,
} from "./support/checkout.ts";
import { saveEvidence, saveScreenshot } from "./support/evidence.ts";
import { E2E_PROFILE, expect, gotoStorefront, test, THEME_LABEL, unlockRealStorefront } from "./support/fixtures.ts";
import { ceilTol, LINES_TARGET, readFunctionRuns, runCart, type FunctionRun } from "./support/margin.ts";
import {
  BLOCK,
  chooseVariant,
  numericId,
  pctText,
  pdpExpectation,
  planFor,
  readBlock,
  readTierInputs,
  recordTierEvents,
  setQuantity,
  syntheticCart,
  tierEvents,
  tiersBlock,
  variantOf,
  workspaceBlock,
  type BlockState,
  type StorefrontConfigRead,
  type TierInputs,
  type TierVariant,
} from "./support/tiers.ts";

// SPEC-DRIVEN (MVP 3, Task 7). Live proof of quantity tiers on BOTH shared
// themes (the matrix runs this file against Horizon and Dawn through
// `shopify theme dev`): the app block on the PDP (table + live price), the
// cart and the checkout give the same tier.
//
// Needs the tiers seed and the full cost pass (the variant pdp maximum, K4):
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile tiers --live
//   node apps/won-discounts/scripts/e2e/margin-costs.mjs --live
//   WON_E2E_PROFILE=tiers npm run test:e2e:local:all -w won-discounts
// The block is put into each theme copy's product template by the runner
// (e2e.app.config.mjs templateOverlays, scripts/make-e2e-overlay.mjs): Horizon
// inside _product-details before the buy buttons, Dawn before the quantity.
//
// Phase A (Free, profile `tiers`; scripts/e2e/tiers-fixture.mjs): a global set
// counted per product (from 3 items −10 %, from 5 items −15 %), margin
// protection on (minimum margin 30 %, maximum discount 30 %).
//   1 PDP won-e2e-simple-a: the table renders from the storefront config (F-T2)
//     and the variant pdp metafield (F-T1: the 5-item row is cut by the pdp floor, K4 v2),
//     the live price follows the quantity (= planCart's line discount per
//     item, floored), the K8 event; the block type of the overlay (F-T3);
//     screenshots 1440 + 390, no horizontal overflow at 390.
//   2 PDP won-e2e-two-variants: switching Small → Large re-prices the table and
//     the live price (Small has a cost, Large has none: the 30 % ceiling).
//   3 cart: simple-a × 5 (the cut tier), Small × 1 + Large × 2 (3 items of one
//     product: the 3-item tier on both lines), simple-b × 1 (none) →
//     /cart.js line_level_discount_allocations = planCart; the cut tier the
//     PDP showed for 5 items = the cart's.
//   4 checkout (Bogus) of that cart: the thank-you page = planCart.
// Phase B (Pro, profile `tiers-pro`): + a set on the collection won-e2e-tiers
// (simple-b + spare) counted across the CART (from 2 items −20 %):
//   5 the PDP of simple-b names the collection set (F-T1: the product
//     metafield's tierRef) and counts the spare already in the cart (K6
//     `cart`); /cart.js and the Bogus checkout of simple-b + spare + simple-a
//     = planCart.
// Expectations are planCart on the live config and metafields read as the app
// (support/tiers.ts), never constants; prices only from /cart.js, the block's
// own markers (K8) and the checkout's tables.

const PRO = E2E_PROFILE === "tiers-pro";
const EMAIL = PRO ? "won-e2e+tiers-pro@example.com" : "won-e2e+tiers@example.com";
const named = (name: string) => (PRO ? `${name}-pro` : name);
const COLLECTIONS = PRO ? [TIERS_COLLECTION_HANDLE] : [];
/** Upper-cased with every whitespace run (NBSP, narrow NBSP) as one space: how the checkout's titles compare. */
const spaced = (text: string) => text.replace(/\s+/gu, " ").trim().toUpperCase();

/** The storefront config the sync must have written for the seed (K5), restated from the fixture. */
function expectStorefrontConfig(inputs: TierInputs) {
  const sf = inputs.storefrontConfig;
  expect(sf, "the app-data metafield won_discounts.storefront_config exists (the sync wrote it)").not.toBeNull();
  expect(sf!.v).toBe(1);
  expect(sf!.tiers.global, "the global set").toBe(TIERS_GLOBAL_SET_ID);
  expect(sf!.tiers.sets[TIERS_GLOBAL_SET_ID], "the global set as the block reads it").toEqual({
    count: TIERS_COUNT_ACROSS,
    breaks: TIERS_BREAKS.map((b) => ({ min: b.minQty, pct: b.percent })),
  });
  // K4 v2: margin carries the key the pdp metafields must match (k) and the shop currency their floors are in (cur).
  expect(sf!.margin, "margin on, the 30 % ceiling for variants without pdp, key + shop currency (K4 v2)").toEqual({
    on: true,
    max: TIERS_MAX_DISCOUNT_PERCENT,
    k: expect.stringMatching(/^[0-9a-f]{8}$/u),
    cur: inputs.shopCurrency,
  });
  if (PRO) {
    expect(sf!.tiers.sets[TIERS_COLLECTION_SET_ID], "Pro: the collection set, counted across the cart").toEqual({
      count: "cart",
      breaks: TIERS_COLLECTION_BREAKS.map((b) => ({ min: b.minQty, pct: b.percent })),
    });
  } else {
    expect(Object.keys(sf!.tiers.sets), "Free: the global set only").toEqual([TIERS_GLOBAL_SET_ID]);
  }
  return sf!;
}

/** K4 v2 restated: the engine's floor per item of a costed variant, minor units of the shop currency (rate 1). */
function restatedPdpFloor(variant: TierVariant): number | null {
  const cost = typeof variant.cost?.cost === "number" ? variant.cost.cost : null;
  if (cost === null || cost <= 0) return null;
  return ceilTol((cost * 100) / (1 - TIERS_MIN_MARGIN_PERCENT / 100));
}

/**
 * The pdp metafield of a costed variant must be there and equal K4 v2 (the full cost pass ran):
 * `f` = the engine floor, `k` = the storefront config's margin key. Returns the floor and the
 * percent the block shows for a tier the margin cuts (⌊(price − f) × 1000 / price⌋ / 10).
 */
function expectPdp(variant: TierVariant, label: string, sf: StorefrontConfigRead): { floor: number; cutPct: number } {
  const floor = restatedPdpFloor(variant);
  expect(floor, `${label}: has a purchase cost (catalog)`).not.toBeNull();
  expect(variant.pdp, `${label}: the pdp metafield exists — run scripts/e2e/margin-costs.mjs --live (the app's full cost pass)`).not.toBeNull();
  expect(variant.pdp!.f, `${label}: pdp.f = the engine floor (cost ${String(variant.cost?.cost)}, minimum margin ${TIERS_MIN_MARGIN_PERCENT} %)`).toBe(floor);
  expect(variant.pdp!.k, `${label}: pdp.k = the storefront config's margin key (else the block promises nothing)`).toBe(sf.margin.on ? sf.margin.k : null);
  return { floor: floor!, cutPct: Math.floor(((variant.price - floor!) * 1000) / variant.price) / 10 };
}

async function emptyCartAndOpen(page: Page, handle: string): Promise<void> {
  await gotoStorefront(page, `/products/${handle}`);
  await storefrontJson(page, "POST", "/cart/clear.js", {});
  await gotoStorefront(page, `/products/${handle}`);
  await expect(tiersBlock(page), "the quantity tiers block rendered (template overlay + live storefront config)").toHaveCount(1);
}

/** The block's offered row with the highest min ≤ count (what K8 marks active). */
const activeMin = (state: BlockState) => state.rows.find((r) => r.active)?.min ?? 0;

async function pdpShots(page: Page, testInfo: TestInfo, name: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await tiersBlock(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  await saveScreenshot(page, testInfo, `${name}-1440`, { fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await tiersBlock(page).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  await assertResponsiveSane(page, { root: BLOCK });
  await saveScreenshot(page, testInfo, `${name}-390`, { fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** /cart.js = the plan, per line: the tier's allocation (title = the plan's message) and the line price; totals. */
function expectCartMatchesPlan(cart: Cart, plan: ReturnType<typeof planFor>) {
  const rows = cart.items.map((item, index) => {
    const line = plan.lines.find((l) => l.lineId === `gid://shopify/CartLine/${index}`)!;
    const planned = line.product;
    const allocations = item.line_level_discount_allocations.map((a) => [a.discount_application.title, a.amount] as const);
    if (planned) expect(allocations, `line ${index} (variant ${item.variant_id}): the tier = planCart`).toEqual([[planned.message, planned.amount]]);
    else expect(allocations, `line ${index} (variant ${item.variant_id}): no discount`).toEqual([]);
    expect(item.final_line_price, `line ${index}: price after the tier = planCart`).toBe(line.subtotal - (planned?.amount ?? 0));
    return {
      variant: item.variant_id,
      quantity: item.quantity,
      unitPrice: item.original_price,
      plan: { components: planned?.components.map((c) => c.ruleId) ?? [], amount: planned?.amount ?? 0, message: planned?.message ?? null, value: planned?.value ?? null, marginCapped: line.marginCapped ?? null },
      cart: { allocations, final_line_price: item.final_line_price },
    };
  });
  expect(cart.cart_level_discount_applications, "no order discount").toEqual([]);
  expect(cart.items_subtotal_price, "subtotal after the tiers = planCart").toBe(plan.totals.subtotal - plan.totals.productDiscount);
  expect(cart.total_price, "cart total = planCart").toBe(plan.totals.total);
  return rows;
}

function checkoutLineFor(lines: readonly CheckoutLine[], title: string, item: CartItem): CheckoutLine {
  const same = lines.filter((l) => l.title.trim() === title.trim() || (title !== "" && l.title.includes(title)));
  const line = same.length <= 1 ? same[0] : same.find((l) => (l.originalPrice ?? l.finalPrice) === item.original_price * item.quantity);
  expect(line, `checkout line "${title}" (${item.quantity} × ${item.original_price}) among ${JSON.stringify(lines.map((l) => [l.title, l.originalPrice, l.finalPrice]))}`).toBeDefined();
  return line!;
}

/** Bogus checkout of the theme-dev cart (no code), then the thank-you page = the plan line by line. */
async function checkoutEqualsPlan(page: Page, testInfo: TestInfo, inputs: TierInputs, cart: Cart, plan: ReturnType<typeof planFor>, shot: string) {
  const titleOf = (item: CartItem) => inputs.titleByHandle[Object.entries(inputs.productIdByHandle).find(([, id]) => numericId(id) === item.product_id)?.[0] ?? ""] ?? item.product_title ?? "";
  const lineOf = (index: number) => plan.lines.find((l) => l.lineId === `gid://shopify/CartLine/${index}`)!;
  await test.step("open checkout: its lines and summary equal the cart", async () => {
    await openCheckout(page);
    const rows = await priceSummary(page);
    const lines = await checkoutLines(page);
    cart.items.forEach((item, index) => {
      const line = checkoutLineFor(lines, titleOf(item), item);
      expect(line.allocations.map((a) => a.amount), `checkout ${titleOf(item)}: the tier = cart`).toEqual(item.line_level_discount_allocations.map((a) => -a.amount));
      expect(lineOf(index).product?.amount ?? 0).toBe(item.line_level_discount_allocations.reduce((s, a) => s + a.amount, 0));
    });
    expect(rowAmount(rows, SUBTOTAL), "checkout subtotal = cart items_subtotal_price").toBe(cart.items_subtotal_price);
    expect(rowAmount(rows, TOTAL), "checkout total before shipping = cart total").toBe(cart.total_price);
  });
  await test.step("contact, CZ address, first shipping rate", () => fillShippingAddress(page, CZECH_ADDRESS, EMAIL));
  await test.step("pay with the Bogus gateway (card 1)", () => payWithBogusCard(page));
  return test.step("thank-you page = planCart: per line the tier, subtotal, total, charged", async () => {
    const settled = await settledThankYou(page);
    expect(settled.payFormGone, "the payment form is gone before the thank-you page is read").toBe(true);
    const rows = await priceSummary(page);
    const lines = await checkoutLines(page);
    expect(lines, "one order line per cart line").toHaveLength(cart.items.length);
    const perLine = cart.items.map((item, index) => {
      const planned = lineOf(index).product;
      const line = checkoutLineFor(lines, titleOf(item), item);
      if (planned) {
        // The checkout's text is read with whitespace collapsed (support/checkout.ts): the plan's message has
        // non-breaking spaces ("Od 3 ks −10 %"), /cart.js keeps them (compared exactly in expectCartMatchesPlan).
        expect(line.allocations.map((a) => [spaced(a.title), a.amount]), `thank-you ${titleOf(item)}: the tier = planCart`).toEqual([[spaced(planned.message), -planned.amount]]);
        expect(line.originalPrice, `thank-you ${titleOf(item)}: original price`).toBe(lineOf(index).subtotal);
      } else {
        expect(line.allocations, `thank-you ${titleOf(item)}: no discount`).toEqual([]);
      }
      expect(line.finalPrice, `thank-you ${titleOf(item)}: price after the tier = planCart`).toBe(lineOf(index).subtotal - (planned?.amount ?? 0));
      return { title: titleOf(item), quantity: item.quantity, allocations: line.allocations, originalPrice: line.originalPrice, finalPrice: line.finalPrice };
    });
    const shipping = rowAmount(rows, SHIPPING);
    const taxRows = rows.filter((r) => TAX.test(r.label));
    const includedTaxRows = taxRows.filter((r) => /(včetně|vrátane|including|incl\.?)/iu.test(r.label));
    const tax = taxRows.filter((r) => !includedTaxRows.includes(r)).reduce((sum, r) => sum + (r.amount ?? 0), 0);
    const subtotal = rowAmount(rows, SUBTOTAL);
    const total = rowAmount(rows, TOTAL);
    expect(subtotal, "thank-you subtotal = planCart (after the tiers)").toBe(plan.totals.subtotal - plan.totals.productDiscount);
    expect(shipping, "shipping amount").not.toBeNull();
    expect(total, "thank-you total = planCart + shipping + tax").toBe(plan.totals.total + (shipping ?? 0) + tax);
    expect(settled.charged, "the card was charged the thank-you total").toBe(total);
    await saveScreenshot(page, testInfo, `${shot}-1440`);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1_000);
    await expandMobileSummary(page);
    await saveScreenshot(page, testInfo, `${shot}-390`);
    return { perLine, rows, subtotal, shipping, tax, includedTaxRows, total, charged: settled.charged, checkoutPath: new URL(page.url()).pathname.replace(/\/cn\/[^/]+/u, "/cn/<token>") };
  });
}

test.describe(`Won Discounts quantity tiers: PDP, cart and checkout (MVP 3)${PRO ? " [Pro: collection set, cart counting]" : ""}${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(
    E2E_PROFILE !== "tiers" && E2E_PROFILE !== "tiers-pro",
    `WON_E2E_PROFILE=${E2E_PROFILE}: this spec needs the tiers seed (seed-mvp1.mjs --profile tiers|tiers-pro --live + margin-costs.mjs --live) and WON_E2E_PROFILE=tiers|tiers-pro`,
  );

  test.afterEach(async ({ page, baseURL }) => {
    if (page.url().startsWith(new URL(baseURL!).origin)) await clearCartQuietly(page);
  });

  test("PDP simple-a: the table from the storefront config + variant pdp (F-T1, F-T2, F-T3), the live price follows the quantity incl. the margin-cut tier", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    const inputs = await readTierInputs(TIERS_HANDLES, COLLECTIONS);
    const sf = expectStorefrontConfig(inputs);
    const variant = variantOf(inputs, TIERS_PRODUCT_HANDLE);
    const { floor: pdpFloor, cutPct: pdpMax } = expectPdp(variant, TIERS_PRODUCT_HANDLE, sf);
    const [low, high] = TIERS_BREAKS;
    expect(pdpMax, "the case under test: margin cuts the 5-item tier").toBeLessThan(high!.percent);
    expect(pdpMax, "…and leaves the 3-item tier alone").toBeGreaterThanOrEqual(low!.percent);

    await page.setViewportSize({ width: 1440, height: 900 });
    await recordTierEvents(page);
    await emptyCartAndOpen(page, TIERS_PRODUCT_HANDLE);

    const initial = await test.step("(a) Liquid render: K8 markers, set and rows from the storefront config, pdp floor from the variant metafield", async () => {
      const state = await readBlock(page);
      expect(state.state, "ready").toBe("ready");
      expect(state.hidden).toBe(false);
      expect(state.setId, "F-T2: the set Liquid read from app.metafields.won_discounts.storefront_config").toBe(sf.tiers.global);
      expect(state.countMode).toBe(sf.tiers.sets[sf.tiers.global!]!.count);
      expect(state.preset).toBe(sf.appearance.preset);
      expect(state.data, "the block's JSON").not.toBeNull();
      expect(state.data!.set).toBe(sf.tiers.global);
      expect(state.data!.breaks, "F-T2: the breaks = the storefront config's").toEqual(sf.tiers.sets[sf.tiers.global!]!.breaks);
      expect(state.data!.cur).toBe("CZK");
      expect(state.data!.cart, "empty cart: nothing counted from the cart").toEqual({ p: 0, s: 0 });
      const own = state.data!.variants.find((v) => v.id === variant.numericId);
      expect(own?.p, "the variant price (Liquid units)").toBe(variant.price);
      expect(own?.f, "F-T1: the variant's floor = its $app:won_discounts/pdp metafield (K4 v2)").toBe(pdpFloor);
      expect(state.rows.map((r) => r.min)).toEqual(TIERS_BREAKS.map((b) => b.minQty));
      expect(state.rows[0]!.save, `3 items: −${low!.percent} % (not cut)`).toContain(pctText(low!.percent));
      expect(state.rows[1]!.save, `5 items: cut by the pdp floor to ${pdpMax} % on the page`).toContain(pctText(Math.min(high!.percent, pdpMax)));
      expect(state.rows.every((r) => !r.hidden)).toBe(true);
      expect(activeMin(state), "1 item: no tier reached").toBe(0);
      expect(state.liveUnitCents, "1 item: the full price").toBe(variant.price);
      expect(state.next.hidden, "the next-tier hint shows").toBe(false);
      return state;
    });

    const steps = await test.step("(b) the live price follows the quantity = planCart's line discount per item (floored)", async () => {
      const out = [];
      for (const quantity of [2, 3, 4, 5, 7]) {
        const exp = pdpExpectation(inputs, TIERS_PRODUCT_HANDLE, variant, quantity);
        await setQuantity(page, quantity, exp.unitCents);
        const state = await readBlock(page);
        const reached = [...TIERS_BREAKS].reverse().find((b) => b.minQty <= quantity)?.minQty ?? 0;
        expect(activeMin(state), `${quantity} items: active row`).toBe(reached);
        expect(exp.line.product?.components.map((c) => c.ruleId) ?? [], `${quantity} items: planCart's discount is the tier`).toEqual(reached ? [`tier:${TIERS_GLOBAL_SET_ID}`] : []);
        if (quantity >= high!.minQty) {
          expect(exp.line.marginCapped, `${quantity} items: planCart cuts the tier by margin (the case under test)`).toBeDefined();
          expect(state.rows.find((r) => r.active)?.save, "the active row shows the cut percent").toContain(pctText(pdpMax));
        }
        // Never more than checkout gives (K6): the page's discount ≤ planCart's.
        expect((variant.price - state.liveUnitCents!) * quantity, `${quantity} items: page discount ≤ planCart`).toBeLessThanOrEqual(exp.discount);
        out.push({ quantity, unitCents: state.liveUnitCents, liveText: state.liveText, activeMin: activeMin(state), plan: { discount: exp.discount, value: exp.line.product?.value ?? null, marginCapped: exp.line.marginCapped ?? null, message: exp.line.product?.message ?? null } });
      }
      return out;
    });

    const events = await test.step("(c) K8: won-discounts:tiers:update carries {variantId, quantity, count, min, unitCents}", async () => {
      const all = await tierEvents(page);
      const last = all.at(-1);
      const exp = pdpExpectation(inputs, TIERS_PRODUCT_HANDLE, variant, 7);
      expect(last, "an event after the last change").toBeDefined();
      expect(Number(last!.variantId)).toBe(variant.numericId);
      expect(last).toMatchObject({ quantity: 7, count: 7, min: high!.minQty, unitCents: exp.unitCents });
      return all;
    });

    const exp5 = pdpExpectation(inputs, TIERS_PRODUCT_HANDLE, variant, 5);
    await setQuantity(page, 5, exp5.unitCents);
    const facts = await test.step("(d) F-T3: the block type the overlay put into the theme copy renders as the app's block", async () => {
      const state = await readBlock(page);
      const placed = workspaceBlock(TIERS_TEMPLATE_BLOCK_ID);
      const expectedType = appBlockType(TIERS_BLOCK_NAME);
      if (placed) expect(placed.type, `F-T3: ${placed.file}`).toBe(expectedType);
      const scripts = await page.locator('script[src*="won-discounts-tiers"]').evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).src.replace(/\?.*$/u, "")));
      expect(scripts.some((src) => /won-discounts-tiers\.js$/u.test(src)), "Shopify injected the block's schema javascript").toBe(true);
      return {
        fT1: {
          statement: "Liquid in the app block reads $app product/variant metafields",
          variant: { id: variant.id, pdpMetafield: variant.pdp, blockMaxPercent: state.data!.variants.find((v) => v.id === variant.numericId)?.m, row5: state.rows[1]?.save },
          product: { metafield: inputs.refsByProductId[inputs.productIdByHandle[TIERS_PRODUCT_HANDLE]!] ?? null, note: PRO ? "tierRef proven in test 5 (collection set)" : "Free: no tierRef on any product (global set); the product read is proven in phase B (tierRef)" },
        },
        fT2: { statement: "app.metafields.won_discounts.storefront_config.value in the block", adminRead: { cv: sf.cv, tiers: sf.tiers, margin: sf.margin, updatedAt: inputs.storefrontConfigUpdatedAt }, block: { setId: state.setId, count: state.countMode, breaks: state.data!.breaks } },
        fT3: { statement: "the template block type", expectedType, workspace: placed, wrapper: { id: state.wrapperId, class: state.wrapperClass }, scripts },
      };
    });

    await pdpShots(page, testInfo, `pdp-tiers-${TIERS_PRODUCT_HANDLE}-q5`);
    await saveEvidence(testInfo, named("pdp-tiers"), {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      profile: E2E_PROFILE,
      variant: { id: variant.id, price: variant.price, cost: variant.cost, pdp: variant.pdp },
      initial: { ...initial, data: initial.data },
      steps,
      events,
      facts,
    });
  });

  test("PDP two-variants: switching Small → Large re-prices the table and the live price (= planCart)", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const inputs = await readTierInputs(TIERS_HANDLES, COLLECTIONS);
    const sf = expectStorefrontConfig(inputs);
    const small = variantOf(inputs, TIERS_VARIANTS_HANDLE, TIERS_SMALL_OPTION);
    const large = variantOf(inputs, TIERS_VARIANTS_HANDLE, TIERS_LARGE_OPTION);
    const { floor: smallFloor } = expectPdp(small, "two-variants Small", sf);
    expect(large.pdp, "Large has no cost → no pdp metafield (K4)").toBeNull();

    await page.setViewportSize({ width: 1440, height: 900 });
    await recordTierEvents(page);
    await emptyCartAndOpen(page, TIERS_VARIANTS_HANDLE);

    const before = await readBlock(page);
    expect(before.state).toBe("ready");
    expect(before.data!.sel, "the selected variant is Small").toBe(small.numericId);
    expect(before.data!.variants.find((v) => v.id === small.numericId)?.f, "Small: its pdp floor").toBe(smallFloor);
    expect(before.data!.variants.find((v) => v.id === large.numericId)?.m, "Large: the storefront config's ceiling (no cost)").toBe(sf.margin.on ? sf.margin.max : 100);

    const smallAt3 = pdpExpectation(inputs, TIERS_VARIANTS_HANDLE, small, 3);
    await setQuantity(page, 3, smallAt3.unitCents);
    const small3 = await readBlock(page);

    const switched = await test.step("switch to Large in the theme's variant picker", async () => {
      await chooseVariant(page, TIERS_LARGE_OPTION);
      await expect
        .poll(async () => (await tierEvents(page)).filter((e) => Number(e.variantId) === large.numericId).length, { message: "a K8 event for Large", timeout: 15_000 })
        .toBeGreaterThan(0);
      const event = (await tierEvents(page)).filter((e) => Number(e.variantId) === large.numericId).at(-1)!;
      const exp = pdpExpectation(inputs, TIERS_VARIANTS_HANDLE, large, event.quantity);
      await expect.poll(async () => (await readBlock(page)).liveUnitCents, { message: `Large × ${event.quantity}: live price`, timeout: 10_000 }).toBe(exp.unitCents);
      expect(event.unitCents).toBe(exp.unitCents);
      return { event, exp: { unitCents: exp.unitCents, discount: exp.discount } };
    });

    const largeAt5 = pdpExpectation(inputs, TIERS_VARIANTS_HANDLE, large, 5);
    await setQuantity(page, 5, largeAt5.unitCents);
    const large5 = await readBlock(page);
    expect(activeMin(large5)).toBe(5);
    expect(large5.rows.find((r) => r.min === 5)?.save, "Large: the uncut 15 % (30 % ceiling)").toContain(pctText(15));

    await pdpShots(page, testInfo, `pdp-tiers-${TIERS_VARIANTS_HANDLE}-large-q5`);
    await saveEvidence(testInfo, named("pdp-tiers-variants"), {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      small: { id: small.id, price: small.price, pdp: small.pdp, at3: { unitCents: small3.liveUnitCents, rows: small3.rows, plan: smallAt3.discount } },
      large: { id: large.id, price: large.price, pdp: large.pdp, switched, at5: { unitCents: large5.liveUnitCents, rows: large5.rows, plan: largeAt5.discount } },
      events: await tierEvents(page),
    });
  });

  test("cart: tiers per product (simple-a × 5 cut by margin, Small × 1 + Large × 2 counted together, simple-b none) = planCart; the cut tier on the PDP = in the cart", async ({ page }, testInfo) => {
    test.skip(PRO, "phase A cart (the Pro cart is test 5)");
    test.setTimeout(240_000);
    const inputs = await readTierInputs(TIERS_HANDLES, COLLECTIONS);
    const sf = expectStorefrontConfig(inputs);
    const a = variantOf(inputs, TIERS_PRODUCT_HANDLE);
    const { cutPct: pdpMax } = expectPdp(a, TIERS_PRODUCT_HANDLE, sf);

    // What the PDP shows for 5 items (empty cart), observed before the cart is built.
    await emptyCartAndOpen(page, TIERS_PRODUCT_HANDLE);
    const exp5 = pdpExpectation(inputs, TIERS_PRODUCT_HANDLE, a, 5);
    await setQuantity(page, 5, exp5.unitCents);
    const onPdp = await readBlock(page);

    const cart = await freshCartOfVariants(page, TIERS_CART, []);
    expect(cart.currency).toBe("CZK");
    expect(cart.items).toHaveLength(TIERS_CART.length);
    const plan = planFor(cart, inputs);

    await test.step("(a) planCart: the case under test", async () => {
      const lineOf = (variantGid: string) => plan.lines.find((l) => l.variantId === variantGid)!;
      const A = lineOf(a.id);
      expect(A.product?.components.map((c) => c.ruleId), "simple-a: the 5-item tier").toEqual([`tier:${TIERS_GLOBAL_SET_ID}`]);
      expect(A.marginCapped, "simple-a: cut by margin").toBeDefined();
      expect(A.product?.amount).toBeLessThan(Math.round((A.subtotal * 15) / 100));
      for (const option of [TIERS_SMALL_OPTION, TIERS_LARGE_OPTION]) {
        const L = lineOf(variantOf(inputs, TIERS_VARIANTS_HANDLE, option).id);
        expect(L.quantity, `${option}: fewer than 3 items on its own line`).toBeLessThan(3);
        expect(L.product?.components.map((c) => c.ruleId), `${option}: the 3-item tier (counted per product)`).toEqual([`tier:${TIERS_GLOBAL_SET_ID}`]);
        expect(L.product?.amount, `${option}: 10 % of the line`).toBe(Math.round((L.subtotal * 10) / 100));
      }
      expect(lineOf(variantOf(inputs, TIERS_PLAIN_HANDLE).id).product, "simple-b: 1 item, no tier").toBeNull();
    });
    const rows = await test.step("(b) /cart.js line_level_discount_allocations = planCart", () => expectCartMatchesPlan(cart, plan));
    await test.step("(c) the cut tier the PDP showed for 5 items = the cart's", async () => {
      const item = cart.items.find((i) => i.variant_id === a.numericId)!;
      expect(item.quantity).toBe(5);
      expect(onPdp.liveUnitCents, "PDP live price per item (5 items) = cart line price ÷ 5").toBe(item.final_line_price / item.quantity);
      expect(onPdp.rows.find((r) => r.active)?.save).toContain(pctText(pdpMax));
    });

    await saveEvidence(testInfo, named("cart-tiers"), {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      profile: E2E_PROFILE,
      pdp: { quantity: 5, unitCents: onPdp.liveUnitCents, liveText: onPdp.liveText, activeRow: onPdp.rows.find((r) => r.active) ?? null },
      lines: rows,
      items_subtotal_price: cart.items_subtotal_price,
      total_price: cart.total_price,
      planTotals: plan.totals,
      planTiers: plan.tiers,
    });
  });

  test("checkout (Bogus): the tiers cart's thank-you page = planCart", async ({ page }, testInfo) => {
    test.skip(PRO, "phase A checkout (the Pro checkout is test 5)");
    test.setTimeout(420_000);
    const inputs = await readTierInputs(TIERS_HANDLES, COLLECTIONS);
    expectStorefrontConfig(inputs);
    await page.setViewportSize({ width: 1440, height: 900 });
    await unlockRealStorefront(page);
    await gotoStorefront(page, `/products/${TIERS_PRODUCT_HANDLE}`);
    const cart = await freshCartOfVariants(page, TIERS_CART, []);
    const plan = planFor(cart, inputs);
    expectCartMatchesPlan(cart, plan);
    const thankYou = await checkoutEqualsPlan(page, testInfo, inputs, cart, plan, named("thankyou-tiers"));
    await saveEvidence(testInfo, named("checkout-tiers"), {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      profile: E2E_PROFILE,
      cart: { currency: cart.currency, original_total_price: cart.original_total_price, items_subtotal_price: cart.items_subtotal_price, total_price: cart.total_price },
      plan: { totals: plan.totals, lines: plan.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, subtotal: l.subtotal, product: l.product, marginCapped: l.marginCapped ?? null })) },
      thankYou,
    });
  });

  test("slovensko (EUR, K4 v2 live): Shopify.currency.rate on the PDP = the function's presentmentCurrencyRate; the table is in EUR and the margin-cut tier never promises more than /cart.js", async ({ page }, testInfo) => {
    test.skip(PRO, "phase A (the market check needs the Free tiers seed with margin)");
    test.setTimeout(300_000);
    const inputs = await readTierInputs(TIERS_HANDLES, COLLECTIONS);
    const sf = expectStorefrontConfig(inputs);
    const variant = variantOf(inputs, TIERS_PRODUCT_HANDLE);
    const { floor } = expectPdp(variant, TIERS_PRODUCT_HANDLE, sf);
    const high = TIERS_BREAKS[1]!;
    const quantity = high.minQty;
    await page.setViewportSize({ width: 1440, height: 900 });
    await emptyCartAndOpen(page, TIERS_PRODUCT_HANDLE);
    try {
      const localization = await test.step("switch the storefront to Slovakia (?country=SK)", () => setStorefrontCountry(page, "SK"));
      expect(localization.country, "the storefront session is in Slovakia").toBe("SK");
      expect(localization.currency, "…and shows EUR").toBe("EUR");
      const pageCurrency = await page.evaluate(() => {
        const shopify = (window as unknown as { Shopify?: { currency?: { active?: string; rate?: string | number } } }).Shopify;
        return { active: shopify?.currency?.active ?? null, rate: shopify?.currency?.rate ?? null };
      });
      const pageRate = Number(pageCurrency.rate);
      expect(pageRate, `Shopify.currency.rate on the PDP (${String(pageCurrency.rate)})`).toBeGreaterThan(0);

      const state = await test.step("(a) the block in EUR: K4 v2 floor from the pdp metafield, prices with €", async () => {
        const st = await readBlock(page);
        expect(st.state, "ready").toBe("ready");
        expect(st.data!.cur, "the block counts in the cart currency").toBe("EUR");
        const own = st.data!.variants.find((v) => v.id === variant.numericId);
        expect(own?.f, "F-T1 in EUR: the variant's floor (shop currency) = its pdp metafield").toBe(floor);
        const shown = st.rows.filter((r) => !r.hidden);
        expect(shown.length, "the table shows its rows in SK").toBeGreaterThan(0);
        for (const row of shown) expect(row.unit, `row from ${row.min}: per-item price in EUR`).toMatch(/€|EUR/u);
        return st;
      });

      // K4 v2 restated: the floor in EUR = ⌈f × rate⌉ + 1 minor unit (CZK and EUR both have 2 decimals).
      const own = state.data!.variants.find((v) => v.id === variant.numericId)!;
      const floorEur = Math.ceil(floor * pageRate) + 1;
      const cap = Math.max(0, own.p - floorEur);
      const pdpLine = Math.max(0, Math.min(Math.round((own.p * quantity * high.percent) / 100), cap * quantity, own.p * quantity));
      const pdpUnit = own.p - Math.floor(pdpLine / quantity);
      await test.step(`(b) ${quantity} items: the live price uses the page's rate (K4 v2)`, () => setQuantity(page, quantity, pdpUnit));
      const live = await readBlock(page);
      expect(live.liveText, "the live price is formatted in EUR (shop.money_format re-render, audit OQ1)").toMatch(/€|EUR/u);
      await pdpShots(page, testInfo, `pdp-tiers-${TIERS_PRODUCT_HANDLE}-sk-q${quantity}`);

      const cartAt = Date.now();
      const cart = await freshCartOfVariants(page, [{ handle: TIERS_PRODUCT_HANDLE, quantity }], []);
      expect(cart.currency, "the cart is in EUR").toBe("EUR");
      const item = cart.items[0]!;
      expect(item.original_price, "the PDP price = the cart price in EUR").toBe(own.p);
      const cartLine = item.line_level_discount_allocations.reduce((sum, a) => sum + a.amount, 0);
      await test.step("(c) the PDP never promises more than checkout gives, and at most 2 minor units per item less", () => {
        expect(cartLine, "the function cut the tier in EUR (the case under test)").toBeLessThan(Math.round((own.p * quantity * high.percent) / 100));
        expect(pdpLine, `PDP line ${pdpLine} ≤ /cart.js line ${cartLine}`).toBeLessThanOrEqual(cartLine);
        expect(cartLine - pdpLine, "the +1 minor unit safety margin of K4 v2 costs at most 2 per item").toBeLessThanOrEqual(2 * quantity);
      });

      const runs = await test.step("(d) the function run of this EUR cart: presentmentCurrencyRate = Shopify.currency.rate", async () => {
        const want = `gid://shopify/ProductVariant/${item.variant_id}`;
        let found: FunctionRun[] = [];
        for (let i = 0; i < 40 && found.length === 0; i += 1) {
          found = (await readFunctionRuns(cartAt - 1_000)).filter((run) => {
            if (run.target !== LINES_TARGET || run.status !== "success" || run.role !== "automatic") return false;
            const c = runCart(run);
            return c.currency === "EUR" && c.variantIds.join(",") === want;
          });
          if (found.length === 0) await page.waitForTimeout(2_000);
        }
        expect(found.length, "a logged automatic-node run of this EUR cart (is `shopify app dev` running?)").toBeGreaterThan(0);
        const rates = [...new Set(found.map((r) => r.rate?.raw ?? "<none>"))];
        expect(rates, "one presentmentCurrencyRate for this cart").toHaveLength(1);
        const functionRate = found[0]!.rate?.value ?? Number.NaN;
        expect(Math.abs(functionRate - pageRate), `function rate ${rates[0]} = Shopify.currency.rate ${String(pageCurrency.rate)}`).toBeLessThanOrEqual(1e-12);
        return { rate: rates[0], count: found.length };
      });

      await saveEvidence(testInfo, named("pdp-tiers-sk"), {
        at: new Date().toISOString(),
        theme: THEME_LABEL || null,
        localization,
        pageCurrency,
        functionRate: runs,
        variant: { id: variant.id, floorShopCurrency: floor, pricePage: own.p, floorEur, capPerItem: cap },
        pdp: { quantity, unitCents: live.liveUnitCents, liveText: live.liveText, line: pdpLine, rows: live.rows },
        cart: { currency: cart.currency, line: cartLine, allocations: item.line_level_discount_allocations },
      });
    } finally {
      await setStorefrontCountry(page, "CZ").catch(() => undefined);
    }
  });

  test("Pro: a set on the collection, counted across the cart — the PDP names it and counts the cart (F-T1 tierRef), /cart.js and the Bogus checkout = planCart", async ({ page }, testInfo) => {
    test.skip(!PRO, "phase B (WON_E2E_PROFILE=tiers-pro, app on Pro)");
    test.setTimeout(480_000);
    const inputs = await readTierInputs(TIERS_HANDLES, COLLECTIONS);
    const sf = expectStorefrontConfig(inputs);
    const refsOf = (handle: string) => inputs.refsByProductId[inputs.productIdByHandle[handle]!] ?? {};
    for (const handle of [TIERS_PLAIN_HANDLE, TIERS_SPARE_HANDLE]) expect(refsOf(handle).tierRef, `${handle}: tierRef = the collection set (K3)`).toBe(TIERS_COLLECTION_SET_ID);
    expect(refsOf(TIERS_PRODUCT_HANDLE).tierRef, "simple-a: no tierRef (the global set)").toBeUndefined();
    const b = variantOf(inputs, TIERS_PLAIN_HANDLE);
    const spare = variantOf(inputs, TIERS_SPARE_HANDLE);

    await page.setViewportSize({ width: 1440, height: 900 });
    await recordTierEvents(page);
    await emptyCartAndOpen(page, TIERS_PLAIN_HANDLE);
    const alone = await test.step("(a) PDP simple-b, empty cart: the collection set (F-T1: the product metafield's tierRef), counted across the cart", async () => {
      const state = await readBlock(page);
      expect(state.setId, "F-T1: Liquid read product.metafields['$app:won_discounts'].product.value.tierRef").toBe(TIERS_COLLECTION_SET_ID);
      expect(state.countMode).toBe("cart");
      expect(state.data!.breaks).toEqual(sf.tiers.sets[TIERS_COLLECTION_SET_ID]!.breaks);
      expect(activeMin(state), "1 item: nothing").toBe(0);
      const exp2 = pdpExpectation(inputs, TIERS_PLAIN_HANDLE, b, 2);
      await setQuantity(page, 2, exp2.unitCents);
      return { initial: state, at2: await readBlock(page) };
    });

    const withSpare = await test.step("(b) one spare in the cart: the PDP counts it (K6 cart) — 1 item of simple-b already reaches the 2-item tier", async () => {
      const spareCart = await freshCartOfVariants(page, [{ handle: TIERS_SPARE_HANDLE, quantity: 1 }], []);
      const sparePrice = spareCart.items[0]!.original_price; // cesko: the price list's fixed price
      await page.goto(`/products/${TIERS_PLAIN_HANDLE}`, { waitUntil: "load" });
      const state = await readBlock(page);
      expect(state.data!.cart.s, "the spare counted from the cart (same set)").toBe(1);
      const plan = planFor(
        syntheticCart(inputs, [
          { handle: TIERS_PLAIN_HANDLE, variant: b, quantity: 1 },
          { handle: TIERS_SPARE_HANDLE, variant: spare, quantity: 1, price: sparePrice },
        ]),
        inputs,
      );
      const bLine = plan.lines[0]!;
      expect(bLine.product?.components.map((c) => c.ruleId), "planCart: simple-b gets the collection tier with the spare").toEqual([`tier:${TIERS_COLLECTION_SET_ID}`]);
      const unit = b.price - (bLine.product?.amount ?? 0);
      await expect.poll(async () => (await readBlock(page)).liveUnitCents, { message: "simple-b × 1 with the spare in the cart", timeout: 10_000 }).toBe(unit);
      const after = await readBlock(page);
      expect(activeMin(after), "the 2-item row is active at 1 item").toBe(TIERS_COLLECTION_BREAKS[0]!.minQty);
      await pdpShots(page, testInfo, `pdp-tiers-pro-${TIERS_PLAIN_HANDLE}-cart-count`);
      return { state: after, plan: bLine.product };
    });

    const cart = await freshCartOfVariants(page, TIERS_PRO_CART, []);
    const plan = planFor(cart, inputs);
    await test.step("(c) planCart: simple-b + spare share the collection tier (cart count 2), simple-a none (global, 1 item)", async () => {
      for (const handle of [TIERS_PLAIN_HANDLE, TIERS_SPARE_HANDLE]) {
        const line = plan.lines.find((l) => l.variantId === variantOf(inputs, handle).id)!;
        expect(line.product?.components.map((c) => c.ruleId), handle).toEqual([`tier:${TIERS_COLLECTION_SET_ID}`]);
        expect(line.product?.amount, `${handle}: 20 % of its line`).toBe(Math.round((line.subtotal * 20) / 100));
      }
      expect(plan.lines.find((l) => l.variantId === variantOf(inputs, TIERS_PRODUCT_HANDLE).id)!.product, "simple-a: no tier").toBeNull();
    });
    const rows = await test.step("(d) /cart.js = planCart", () => expectCartMatchesPlan(cart, plan));

    await unlockRealStorefront(page);
    await page.goto(`/products/${TIERS_PLAIN_HANDLE}`, { waitUntil: "load" });
    const checkoutCart = await freshCartOfVariants(page, TIERS_PRO_CART, []);
    const checkoutPlan = planFor(checkoutCart, inputs);
    expectCartMatchesPlan(checkoutCart, checkoutPlan);
    const thankYou = await checkoutEqualsPlan(page, testInfo, inputs, checkoutCart, checkoutPlan, "thankyou-tiers-pro");

    await saveEvidence(testInfo, "tiers-pro", {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      profile: E2E_PROFILE,
      storefrontConfig: sf,
      refs: Object.fromEntries([TIERS_PRODUCT_HANDLE, TIERS_PLAIN_HANDLE, TIERS_SPARE_HANDLE].map((h) => [h, refsOf(h)])),
      pdp: { alone, withSpare },
      cart: { lines: rows, total_price: cart.total_price, planTotals: plan.totals, planTiers: plan.tiers },
      checkout: { plan: checkoutPlan.totals, thankYou },
    });
  });
});
