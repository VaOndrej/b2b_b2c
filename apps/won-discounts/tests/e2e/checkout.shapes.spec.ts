import { roundingTiePossible } from "@won/core/discounts/function-output";
import type { PlanConfig, PlanLine } from "@won/core/discounts/plan";

import {
  SHAPES_CAP_AMOUNT_CZK,
  SHAPES_CAP_RULE_ID,
  SHAPES_CAP_RULE_NAME,
  SHAPES_CART,
  SHAPES_HANDLES,
  SHAPES_PRO_B_RULE_ID,
  SHAPES_PRO_C_RULE_ID,
  SHAPES_PRODUCT_A_HANDLE,
  SHAPES_PRODUCT_B_HANDLE,
  SHAPES_RULE_IDS,
} from "../../scripts/e2e/shapes-fixture.mjs";
import { clearCartQuietly, freshCartWith, type Cart, type CartItem } from "./support/cart.ts";
import {
  checkoutLines,
  expandMobileSummary,
  fillCzechShippingAddress,
  minorUnits,
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
  type SummaryRow,
} from "./support/checkout.ts";
import { saveEvidence, saveScreenshot } from "./support/evidence.ts";
import { E2E_PROFILE, expect, test, THEME_LABEL, unlockRealStorefront } from "./support/fixtures.ts";
import { expectedFor, readLiveInputsFor, type Expected, type LiveInputs } from "./support/won-plan.ts";

// SPEC-DRIVEN (MVP 1 gate). Live proof of the function output shapes the MVP 1
// profile never reaches (extensions/won-discounts-engine/src/output.rs, the
// "Product candidates and the output size" mapping of tests/reference-adapter.js):
//   (a) a fixed amount per item above the unit price: planCart caps it at the
//       price (fixedPerItem = unit price) and the function sends it as 100 %, so
//       the line costs 0 in the cart AND in checkout;
//   (b) two automatic percentages on one product that stack through Pro per-rule
//       `combinesWith`: planCart plans ONE stack (fixedTotal T) and the function
//       sends the summed whole percent, because Math.round(S × ΣP / 100) = T.
//
// Needs the shapes seed and the profile switch (see scripts/e2e/shapes-fixture.mjs):
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile shapes --live
//   WON_E2E_PROFILE=shapes npm run test:e2e:local:all -w won-discounts
//
// Expectations are `planCart` on the live function inputs (support/won-plan.ts),
// never hard-coded; the output value each line must carry (100 %, ΣP %, or the
// exact amount when a percent lands on half a haléř — a rounding tie) is
// derived from that plan and the live rules the same way output.rs derives it.
// Prices are only ever read from /cart.js and the checkout's own tables. Every
// discount here is automatic, so the theme-dev session split of codes
// (checkout.mvp1.spec.ts header) plays no part.
//
// Plan mode, WON_E2E_PLAN=pro|free (default pro). The sync gates the stored
// config for the shop's plan before it builds the function payload (BILL-1,
// packages/core/src/discounts/plan-gate.ts gateConfigForPlan): the dev store is
// Free unless the SYNCING process runs with NODE_ENV=development WON_DEV_PLAN=pro
// (app/lib/plan.server.ts). That is the seed AND the running `shopify app dev`,
// whose product webhooks resync the targeting with its own plan. So:
//   pro   seed with the override → the live payload keeps combinesWith → (b) above;
//   free  seed without it → the gate removed combinesWith from the live payload,
//         B and C compete (engine.combination.productWithProduct "best") and
//         simple-a gets ONLY the better single rule (10 %), never the 15 % stack;
//         (a) is not a Pro feature and still gives 100 %.
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile shapes --live
//   WON_E2E_PROFILE=shapes WON_E2E_PLAN=free npm run test:e2e:local:all -w won-discounts
// Either way checkout = planCart on the LIVE (gated) payload.

const CHECKOUT_COUNTRY = "CZ"; // market cesko (CZK); the capped fixed amount exists in CZK only
const CHECKOUT_EMAIL = "won-e2e+shapes@example.com";

type PlanMode = "pro" | "free";
function planMode(raw: string | undefined): PlanMode {
  const value = String(raw ?? "").trim().toLowerCase() || "pro";
  if (value !== "pro" && value !== "free") throw new Error(`WON_E2E_PLAN=${raw}: expected "pro" or "free"`);
  return value;
}
/** The plan the live payload was synced for (see the header). */
const E2E_PLAN = planMode(process.env.WON_E2E_PLAN);

type LiveRule = PlanConfig["modules"]["codes"]["rules"][number];

/** A live rule's whole percent (NaN for any other value). */
function percentOf(rules: readonly LiveRule[], ruleId: string): number {
  const value = rules.find((r) => r.id === ruleId)?.value;
  return value?.kind === "percentage" ? value.percent : Number.NaN;
}

/**
 * What simple-a's two percentage rules give on each plan, from the LIVE rules:
 * the Pro stack (ΣP, what Free must NOT apply) and the better single rule
 * (what Free applies: higher percent, then id asc as planCart ranks ties).
 */
function simpleARules(rules: readonly LiveRule[]) {
  const ids = [SHAPES_PRO_B_RULE_ID, SHAPES_PRO_C_RULE_ID];
  const percents = ids.map((id) => percentOf(rules, id));
  const best = [...ids].sort((x, y) => percentOf(rules, y) - percentOf(rules, x) || x.localeCompare(y))[0]!;
  return { ids, percents, summed: percents.reduce((a, b) => a + b, 0), best, bestPercent: percentOf(rules, best), other: ids.find((id) => id !== best)! };
}

/** Evidence / screenshot name per plan mode: "cart-shapes" (Pro, unchanged) or "cart-free-shapes". */
const named = (name: string) => (E2E_PLAN === "free" ? name.replace(/shapes/u, "free-shapes") : name);

/**
 * Free only: what the gate took out of the live payload and what simple-a would
 * get if the Pro stack were applied (the counterfactual the observed values are
 * compared against), for the evidence.
 */
function freeGateEvidence(rules: readonly LiveRule[], stackedLine: LineShape, planTotal: number) {
  if (E2E_PLAN !== "free") return null;
  const simpleA = simpleARules(rules);
  const proStackAmount = Math.round((stackedLine.planLine.subtotal * simpleA.summed) / 100);
  const freeAmount = stackedLine.planLine.product?.amount ?? 0;
  return {
    liveCombinesWith: Object.fromEntries(simpleA.ids.map((id) => [id, rules.find((r) => r.id === id)?.combinesWith ?? null])),
    appliedRule: simpleA.best,
    appliedPercent: simpleA.bestPercent,
    appliedAmount: freeAmount,
    outrankedRule: simpleA.other,
    proStackNotApplied: {
      rules: simpleA.ids,
      summedPercent: simpleA.summed,
      amount: proStackAmount,
      cartTotalIfApplied: planTotal - (proStackAmount - freeAmount),
    },
  };
}

interface LineShape {
  handle: string;
  productTitle: string;
  item: CartItem;
  planLine: PlanLine;
  /** The value the function must send for this line (output.rs mapping of the plan), or null. */
  emitted: Emitted | null;
}

/** A product candidate value as output.rs writes it; amounts in minor units. */
type Emitted = { kind: "percentage"; percent: number } | { kind: "fixed_amount"; amount: number; perItem: boolean };

const percentage = (percent: number): Emitted => ({ kind: "percentage", percent });

/** output.rs exact_amount: the whole line → 100 %, divisible by the quantity → per item, else once on the line. */
function exactAmount(total: number, line: PlanLine): Emitted {
  if (total === line.subtotal) return percentage(100);
  if (line.quantity > 0 && total % line.quantity === 0) return { kind: "fixed_amount", amount: total / line.quantity, perItem: true };
  return { kind: "fixed_amount", amount: total, perItem: false };
}

/**
 * output.rs percent_on_line: a percent as is, unless its amount on the line is
 * a rounding tie (half a haléř: Shopify rounds S × P / 100 itself and may round
 * it the other way than the plan) → its exact amount. Whether a line hits a
 * tie depends on its CZK price: converted at a live rate while the shop was in
 * USD (checkout.mvp1.spec.ts hit one on 2026-09-29), the catalog's own Kč price
 * since the shop currency became CZK (2026-09-30).
 */
function percentOnLine(percent: number, amount: number, line: PlanLine): Emitted {
  return roundingTiePossible(line.subtotal, percent) ? exactAmount(amount, line) : percentage(percent);
}

/**
 * What output.rs (exact_value) sends for a planned product stack. The output
 * budget steps never apply to this two-line cart, so this is the exact form:
 *   a single percent → percentOnLine; a fixed amount per item equal to the unit
 *   price → 100 %, else per item; a stack whose total is the line → 100 %; a
 *   stack of whole-percent rules whose Math.round(S × ΣP / 100) equals its total
 *   → percentOnLine(ΣP); any other total → exactAmount.
 */
function emittedValue(line: PlanLine, inputs: LiveInputs): Emitted | null {
  const stack = line.product;
  if (!stack) return null;
  const value = stack.value;
  if (value.percent !== undefined) return percentOnLine(value.percent, stack.amount, line);
  if (value.fixedPerItem !== undefined) {
    return value.fixedPerItem === line.unitPrice ? percentage(100) : { kind: "fixed_amount", amount: value.fixedPerItem, perItem: true };
  }
  const total = value.fixedTotal;
  if (total === line.subtotal) return percentage(100);
  let sum = 0;
  for (const component of stack.components) {
    const rule = inputs.config.modules.codes.rules.find((r) => r.id === component.ruleId);
    if (rule?.value.kind !== "percentage" || !Number.isInteger(rule.value.percent)) return exactAmount(total, line);
    sum += rule.value.percent;
  }
  return Math.round((line.subtotal * sum) / 100) === total ? percentOnLine(sum, total, line) : exactAmount(total, line);
}

/** "15 %" · "32,85 Kč per item" — for step and assertion labels. */
function describeEmitted(emitted: Emitted | null): string {
  if (!emitted) return "nothing";
  if (emitted.kind === "percentage") return `${emitted.percent} %`;
  return `the exact amount ${emitted.amount} (${emitted.perItem ? "per item" : "once on the line"}, rounding tie)`;
}

/** The /cart.js allocation carries exactly the value the function sent. */
function expectSentAs(allocation: CartItem["line_level_discount_allocations"][number], emitted: Emitted | null, what: string): void {
  expect(emitted, `${what}: output mapping`).not.toBeNull();
  const application = allocation.discount_application;
  if (emitted!.kind === "percentage") {
    expect(application.value_type, `${what}: sent as a percentage`).toBe("percentage");
    expect(Number(application.value), `${what}: sent as ${emitted!.percent} %`).toBe(emitted!.percent);
  } else {
    expect(application.value_type, `${what}: sent as ${describeEmitted(emitted)}`).toBe("fixed_amount");
    expect(Math.round(Number(application.value) * 100), `${what}: the exact amount (CZK, 2 decimals)`).toBe(emitted!.amount);
  }
}

/** Each cart line with its plan line (planInputFromCart ids lines by cart index) and its handle. */
function lineShapes(cart: Cart, expected: Expected, inputs: LiveInputs): LineShape[] {
  const handleByProduct = new Map(Object.entries(inputs.productIdByHandle ?? {}).map(([handle, id]) => [id, handle]));
  return cart.items.map((item, index) => {
    const planLine = expected.plan.lines.find((l) => l.lineId === `gid://shopify/CartLine/${index}`);
    expect(planLine, `plan line for cart line ${index}`).toBeDefined();
    const handle = handleByProduct.get(`gid://shopify/Product/${item.product_id}`) ?? `product ${item.product_id}`;
    return { handle, productTitle: item.product_title ?? "", item, planLine: planLine!, emitted: emittedValue(planLine!, inputs) };
  });
}

function byHandle(shapes: readonly LineShape[], handle: string): LineShape {
  const shape = shapes.find((s) => s.handle === handle);
  expect(shape, `${handle} is in the cart`).toBeDefined();
  return shape!;
}

/** The checkout line of a cart line, by product title (the checkout keeps its own line order). */
function checkoutLineFor(lines: readonly CheckoutLine[], shape: LineShape): CheckoutLine {
  const line = lines.find((l) => l.title.trim() === shape.productTitle.trim());
  expect(line, `checkout line "${shape.productTitle}" among ${JSON.stringify(lines.map((l) => l.title))}`).toBeDefined();
  return line!;
}

/** The single allocation of a checkout line whose title is the plan's message (the checkout upper-cases titles). */
function allocationOf(line: CheckoutLine, message: string): number | null {
  return line.allocations.find((a) => a.title.toUpperCase() === message.toUpperCase())?.amount ?? null;
}

/** "CELKOVÁ ÚSPORA51,23 Kč" (the amount sits in the label) → minor units, when the summary shows it. */
function totalSavings(rows: readonly SummaryRow[]): number | null {
  const row = rows.find((r) => /^(CELKOVÁ ÚSPORA|TOTAL SAVINGS)/iu.test(r.label));
  return row ? minorUnits(row.label) : null;
}

test.describe(`Won Discounts output shapes in cart and checkout (MVP 1 gate)${E2E_PLAN === "free" ? " [Free plan]" : ""}${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(E2E_PROFILE !== "shapes", `WON_E2E_PROFILE=${E2E_PROFILE}: this spec needs the shapes seed (seed-mvp1.mjs --profile shapes --live) and WON_E2E_PROFILE=shapes`);

  test.afterEach(async ({ page, baseURL }) => {
    if (page.url().startsWith(new URL(baseURL!).origin)) await clearCartQuietly(page);
  });

  const cartTitle =
    E2E_PLAN === "free"
      ? "cart (Free): a capped fixed per-item amount arrives as 100 %, the Pro stack is NOT summed (best single rule only), both = planCart"
      : "cart: a capped fixed per-item amount arrives as 100 %, a Pro stack as one summed percent, both = planCart";
  test(cartTitle, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const inputs = await readLiveInputsFor(SHAPES_HANDLES);
    const rules = inputs.config.modules.codes.rules;
    expect(rules.map((r) => r.id), "the live shop config carries exactly the shapes seed").toEqual(expect.arrayContaining(SHAPES_RULE_IDS));
    const cap = rules.find((r) => r.id === SHAPES_CAP_RULE_ID)!;
    expect(cap.value, "rule A: fixed amount per item, CZK").toEqual({ kind: "fixed", amount: { CZK: SHAPES_CAP_AMOUNT_CZK } });
    if (E2E_PLAN === "pro") {
      expect(rules.find((r) => r.id === SHAPES_PRO_B_RULE_ID)?.combinesWith?.ruleIds, "rule B combines with C (Pro)").toContain(SHAPES_PRO_C_RULE_ID);
      expect(rules.find((r) => r.id === SHAPES_PRO_C_RULE_ID)?.combinesWith?.ruleIds, "rule C combines with B (Pro)").toContain(SHAPES_PRO_B_RULE_ID);
    } else {
      // BILL-1: the stored config still has combinesWith (the seed writes it), the gated live payload must not.
      for (const id of [SHAPES_PRO_B_RULE_ID, SHAPES_PRO_C_RULE_ID]) {
        const rule = rules.find((r) => r.id === id);
        expect(rule?.enabled, `Free: rule ${id} stays on (the gate never switches off a rule for combinesWith)`).toBe(true);
        expect(rule?.combinesWith, `Free: the plan gate removed ${id}'s combinesWith from the live payload`).toBeUndefined();
      }
    }

    const response = await page.goto(`/products/${SHAPES_PRODUCT_A_HANDLE}`, { waitUntil: "load" });
    expect(response?.status()).toBeLessThan(400);

    const cart = await freshCartWith(page, SHAPES_CART, []);
    const expected = expectedFor(cart, inputs, CHECKOUT_COUNTRY);
    const shapes = lineShapes(cart, expected, inputs);
    expect(cart.currency).toBe("CZK");
    expect(cart.items).toHaveLength(SHAPES_CART.length);
    expect(cart.discount_codes).toEqual([]);
    const capped = byHandle(shapes, SHAPES_PRODUCT_B_HANDLE);
    const stacked = byHandle(shapes, SHAPES_PRODUCT_A_HANDLE);

    await test.step("(a) won-e2e-simple-b: fixed per item above the price → capped → 100 %, the line is 0", async () => {
      const { item, planLine } = capped;
      expect(SHAPES_CAP_AMOUNT_CZK, "the fixed amount is larger than the item's CZK price").toBeGreaterThan(item.original_price);
      expect(item.quantity).toBe(SHAPES_CART.find((l) => l.handle === SHAPES_PRODUCT_B_HANDLE)!.quantity);
      expect(planLine.product?.components.map((c) => c.ruleId), "planCart: rule A alone on the line").toEqual([SHAPES_CAP_RULE_ID]);
      expect(planLine.product?.value, "planCart: capped at the unit price").toEqual({ fixedPerItem: item.original_price });
      expect(planLine.product?.amount, "planCart: the whole line").toBe(planLine.subtotal);
      expect(capped.emitted, "output mapping: 100 %").toEqual(percentage(100));
      expect(item.line_level_discount_allocations).toHaveLength(1);
      const allocation = item.line_level_discount_allocations[0]!;
      expect(allocation.discount_application.title).toBe(SHAPES_CAP_RULE_NAME);
      expectSentAs(allocation, capped.emitted, "the capped line");
      expect(allocation.amount, "line discount = planCart").toBe(planLine.product?.amount);
      expect(item.final_line_price, "the line costs 0").toBe(0);
    });

    const simpleA = simpleARules(rules);
    if (E2E_PLAN === "free") {
      await test.step(`(b) won-e2e-simple-a on Free: no Pro stack → only the better single rule (${simpleA.bestPercent} %, not ${simpleA.summed} %) = planCart`, async () => {
        const { item, planLine } = stacked;
        const single = planLine.product;
        const proStackAmount = Math.round((planLine.subtotal * simpleA.summed) / 100);
        expect(single?.components.map((c) => c.ruleId), "planCart on the gated payload: the better rule alone, no stack").toEqual([simpleA.best]);
        expect(single?.value, "planCart: a single percentage, not a stack total").toEqual({ percent: simpleA.bestPercent });
        expect(single?.message, "planCart: the single rule's own message").toBe(rules.find((r) => r.id === simpleA.best)?.name);
        const other = expected.plan.rules.find((r) => r.ruleId === simpleA.other);
        expect(other?.state, `planCart: ${simpleA.other} competed and lost (outranked), it is not combined`).toBe("outranked");
        expect(other?.amount, `planCart: ${simpleA.other} contributes nothing`).toBe(0);
        expect(stacked.emitted, `output mapping: the single rule's ${simpleA.bestPercent} % (its exact amount on a rounding tie)`).toEqual(
          percentOnLine(simpleA.bestPercent, single!.amount, planLine),
        );
        expect(single?.amount, `Free gives less than the Pro stack (${simpleA.percents.join(" + ")} % = ${proStackAmount})`).toBeLessThan(proStackAmount);
        expect(item.line_level_discount_allocations, "one discount on the line").toHaveLength(1);
        const allocation = item.line_level_discount_allocations[0]!;
        expect(allocation.discount_application.title, "title = the single rule, not the stack message").toBe(single?.message);
        expectSentAs(allocation, stacked.emitted, "simple-a (Free)");
        if (allocation.discount_application.value_type === "percentage") {
          expect(Number(allocation.discount_application.value), `NOT the summed Pro stack (${simpleA.summed} %)`).not.toBe(simpleA.summed);
        }
        expect(allocation.amount, "line discount = planCart").toBe(single?.amount);
        expect(allocation.amount, "line discount is not the Pro stack amount").not.toBe(proStackAmount);
        expect(item.final_line_price).toBe(planLine.subtotal - single!.amount);
      });
    } else {
      await test.step(`(b) won-e2e-simple-a: Pro stack B + C → one summed percent = planCart (sent as ${describeEmitted(stacked.emitted)})`, async () => {
        const { item, planLine } = stacked;
        const stack = planLine.product;
        expect(stack?.components.map((c) => c.ruleId), "planCart: B and C stack").toEqual([SHAPES_PRO_B_RULE_ID, SHAPES_PRO_C_RULE_ID]);
        expect(stack?.value.fixedTotal, "planCart: a stack is a fixed total").toBe(stack?.amount);
        const percents = stack!.components.map((c) => {
          const value = rules.find((r) => r.id === c.ruleId)!.value;
          return value.kind === "percentage" ? value.percent : Number.NaN;
        });
        const summed = percents.reduce((a, b) => a + b, 0);
        expect(Math.round((planLine.subtotal * summed) / 100), "Math.round(S × ΣP / 100) = the stack total").toBe(stack?.amount);
        expect(stacked.emitted, `output mapping: ΣP = ${percents.join(" + ")} % (its exact amount on a rounding tie)`).toEqual(
          percentOnLine(summed, stack!.amount, planLine),
        );
        expect(item.line_level_discount_allocations).toHaveLength(1);
        const allocation = item.line_level_discount_allocations[0]!;
        expect(allocation.discount_application.title, "title = the stack message").toBe(stack?.message);
        expectSentAs(allocation, stacked.emitted, "simple-a (Pro stack)");
        expect(allocation.amount, "line discount = planCart").toBe(stack?.amount);
        expect(item.final_line_price).toBe(planLine.subtotal - stack!.amount);
      });
    }

    expect(cart.cart_level_discount_applications).toEqual([]);
    expect(cart.items_subtotal_price, "subtotal after line discounts = planCart").toBe(expected.subtotalAfterLines);
    expect(cart.total_price, "cart total = planCart").toBe(expected.total);

    await saveEvidence(testInfo, named("cart-shapes"), {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      planMode: E2E_PLAN,
      ...(E2E_PLAN === "free" ? { freeGate: freeGateEvidence(rules, stacked, expected.total) } : {}),
      currency: cart.currency,
      lines: shapes.map((s) => ({
        handle: s.handle,
        quantity: s.item.quantity,
        unitPrice: s.item.original_price,
        cart: {
          allocations: s.item.line_level_discount_allocations.map((a) => ({
            title: a.discount_application.title,
            value_type: a.discount_application.value_type,
            value: a.discount_application.value,
            amount: a.amount,
          })),
          final_line_price: s.item.final_line_price,
        },
        plan: {
          components: s.planLine.product?.components ?? [],
          value: s.planLine.product?.value ?? null,
          amount: s.planLine.product?.amount ?? 0,
          message: s.planLine.product?.message ?? null,
          emitted: s.emitted,
        },
      })),
      items_subtotal_price: cart.items_subtotal_price,
      total_price: cart.total_price,
      planTotals: expected.plan.totals,
    });
  });

  test("checkout (Bogus): the thank-you page charges what planCart predicts for both shapes", async ({ page }, testInfo) => {
    test.setTimeout(360_000);
    const inputs = await readLiveInputsFor(SHAPES_HANDLES);
    await page.setViewportSize({ width: 1440, height: 900 });

    await unlockRealStorefront(page);
    const response = await page.goto(`/products/${SHAPES_PRODUCT_A_HANDLE}`, { waitUntil: "load" });
    expect(response?.status()).toBeLessThan(400);

    const cart = await freshCartWith(page, SHAPES_CART, []);
    const expected = expectedFor(cart, inputs, CHECKOUT_COUNTRY);
    const shapes = lineShapes(cart, expected, inputs);
    expect(cart.total_price, "cart total = planCart").toBe(expected.total);
    for (const shape of shapes) {
      expect(shape.item.line_level_discount_allocations.map((a) => a.amount), `${shape.handle}: cart line discount = planCart`).toEqual([
        shape.planLine.product?.amount,
      ]);
    }

    /** Per cart line: what the checkout table shows next to what planCart predicts. */
    const observeLines = (lines: readonly CheckoutLine[]) =>
      shapes.map((shape) => {
        const line = checkoutLineFor(lines, shape);
        const planAmount = shape.planLine.product?.amount ?? 0;
        return {
          handle: shape.handle,
          quantity: shape.item.quantity,
          message: shape.planLine.product?.message ?? null,
          observed: {
            allocations: line.allocations,
            discount: allocationOf(line, shape.planLine.product?.message ?? ""),
            originalPrice: line.originalPrice,
            finalPrice: line.finalPrice,
          },
          plan: {
            discount: -planAmount,
            originalPrice: shape.item.original_price * shape.item.quantity,
            finalPrice: shape.planLine.subtotal - planAmount,
            emitted: shape.emitted,
          },
        };
      });
    const expectLines = (observed: ReturnType<typeof observeLines>, where: string) => {
      for (const line of observed) {
        expect(line.observed.allocations, `${where} ${line.handle}: one discount on the line`).toHaveLength(1);
        expect(line.observed.discount, `${where} ${line.handle}: line discount = planCart`).toBe(line.plan.discount);
        expect(line.observed.originalPrice, `${where} ${line.handle}: original line price = cart`).toBe(line.plan.originalPrice);
        expect(line.observed.finalPrice, `${where} ${line.handle}: reduced line price = planCart`).toBe(line.plan.finalPrice);
      }
    };

    await test.step("open checkout; its lines and summary equal the cart (= planCart)", async () => {
      await openCheckout(page);
      const rows = await priceSummary(page);
      expectLines(observeLines(await checkoutLines(page)), "checkout");
      expect(rowAmount(rows, SUBTOTAL), "checkout subtotal = cart items_subtotal_price").toBe(cart.items_subtotal_price);
      expect(rowAmount(rows, TOTAL), "checkout total before shipping = cart total").toBe(cart.total_price);
    });

    await test.step("contact, CZ address, first shipping rate", () => fillCzechShippingAddress(page, CHECKOUT_EMAIL));
    await test.step("pay with the Bogus gateway (card 1)", () => payWithBogusCard(page));

    const thankYou = await test.step("thank-you page: line discounts, the free line, the total and the charged amount = planCart", async () => {
      const settled = await settledThankYou(page);
      const rows = await priceSummary(page);
      const lines = await checkoutLines(page);
      const shipping = rowAmount(rows, SHIPPING);
      const tax = rows.filter((r) => TAX.test(r.label)).reduce((sum, r) => sum + (r.amount ?? 0), 0);
      const observedLines = observeLines(lines);
      const observed = {
        subtotal: rowAmount(rows, SUBTOTAL),
        orderDiscountRows: rows.filter((r) => (r.amount ?? 0) < 0).map((r) => r.label),
        totalSavings: totalSavings(rows),
        shipping,
        tax,
        total: rowAmount(rows, TOTAL),
        charged: settled.charged,
        payFormGone: settled.payFormGone,
      };
      expect(lines, "one order line per cart line").toHaveLength(cart.items.length);
      expectLines(observedLines, "thank-you");
      expect(observedLines.find((l) => l.handle === SHAPES_PRODUCT_B_HANDLE)?.observed.finalPrice, "the capped line is free").toBe(0);
      expect(observed.subtotal, "thank-you subtotal = cart items_subtotal_price = planCart").toBe(expected.subtotalAfterLines);
      expect(observed.orderDiscountRows, "no order-level discount").toEqual([]);
      if (observed.totalSavings !== null) expect(observed.totalSavings, "total savings = planCart product discounts").toBe(expected.plan.totals.productDiscount);
      expect(shipping, "shipping amount").not.toBeNull();
      expect(observed.total, "thank-you total = cart total (= planCart) + shipping + tax").toBe(expected.total + (shipping ?? 0) + tax);
      expect(observed.charged, "the card was charged the thank-you total").toBe(observed.total);
      if (E2E_PLAN === "free") {
        const simpleA = simpleARules(inputs.config.modules.codes.rules);
        const stackedLine = observedLines.find((l) => l.handle === SHAPES_PRODUCT_A_HANDLE)!;
        const proStackAmount = Math.round((byHandle(shapes, SHAPES_PRODUCT_A_HANDLE).planLine.subtotal * simpleA.summed) / 100);
        expect(stackedLine.message, "Free: simple-a's discount is the single better rule").toBe(inputs.config.modules.codes.rules.find((r) => r.id === simpleA.best)?.name);
        expect(stackedLine.observed.discount, `Free: thank-you simple-a is NOT the Pro stack (${simpleA.summed} % = −${proStackAmount})`).not.toBe(-proStackAmount);
        expect(-(stackedLine.observed.discount ?? 0), "Free: thank-you simple-a discount is below the Pro stack").toBeLessThan(proStackAmount);
      }
      return { rows, lines, observedLines, observed };
    });

    await saveScreenshot(page, testInfo, named("thankyou-shapes-1440"));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1_000);
    await expandMobileSummary(page);
    await saveScreenshot(page, testInfo, named("thankyou-shapes-390"));

    await saveEvidence(testInfo, named("checkout-shapes"), {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      planMode: E2E_PLAN,
      ...(E2E_PLAN === "free"
        ? { freeGate: freeGateEvidence(inputs.config.modules.codes.rules, byHandle(shapes, SHAPES_PRODUCT_A_HANDLE), expected.total) }
        : {}),
      checkoutPath: new URL(page.url()).pathname.replace(/\/cn\/[^/]+/u, "/cn/<token>"),
      cart: {
        currency: cart.currency,
        original_total_price: cart.original_total_price,
        items_subtotal_price: cart.items_subtotal_price,
        total_price: cart.total_price,
        lines: shapes.map((s) => ({
          handle: s.handle,
          quantity: s.item.quantity,
          unitPrice: s.item.original_price,
          allocations: s.item.line_level_discount_allocations.map((a) => ({
            title: a.discount_application.title,
            value_type: a.discount_application.value_type,
            value: a.discount_application.value,
            amount: a.amount,
          })),
          final_line_price: s.item.final_line_price,
        })),
      },
      plan: {
        totals: expected.plan.totals,
        lines: shapes.map((s) => ({ handle: s.handle, product: s.planLine.product, emitted: s.emitted })),
        rules: expected.plan.rules.map((r) => ({ ruleId: r.ruleId, state: r.state, amount: r.amount, combinedInto: r.combinedInto ?? null })),
      },
      thankYou: { lines: thankYou.observedLines, ...thankYou.observed, expectedTotal: expected.total + (thankYou.observed.shipping ?? 0) + thankYou.observed.tax },
      thankYouSummaryRows: thankYou.rows,
    });
  });
});
