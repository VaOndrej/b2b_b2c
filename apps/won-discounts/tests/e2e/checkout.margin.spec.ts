import { checkoutPreview } from "@won/core/discounts/function-output";
import { WON_E2E_PRODUCT_LIST } from "@won/testing/e2e-products";
import { toMinorUnits } from "@won/core/discounts/money";
import { planCart, type CartPlan, type PlanConfig, type PlanLine } from "@won/core/discounts/plan";

import {
  MARGIN_AUTO_PERCENT,
  MARGIN_AUTO_RULE_ID,
  MARGIN_AUTO_RULE_NAME,
  MARGIN_CART,
  MARGIN_CART_HANDLES,
  MARGIN_CODE,
  MARGIN_CODE_PERCENT,
  MARGIN_CODE_RULE_ID,
  MARGIN_CODE_RULE_NAME,
  MARGIN_MAX_DISCOUNT_PERCENT,
  MARGIN_MIN_MARGIN_PERCENT,
  MARGIN_PRODUCT_A_HANDLE,
  MARGIN_PRODUCT_B_HANDLE,
  MARGIN_SMALL_HANDLE,
} from "../../scripts/e2e/margin-fixture.mjs";
import { clearCartQuietly, freshCartOfVariants, type Cart, type CartItem } from "./support/cart.ts";
import {
  applyCodeInCheckout,
  checkoutLines,
  expandMobileSummary,
  fillCzechShippingAddress,
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
import { E2E_PROFILE, expect, test, THEME_LABEL, unlockRealStorefront } from "./support/fixtures.ts";
import {
  ceilTol,
  marginPlanInput,
  oracleFor,
  readMarginInputs,
  runSummary,
  waitForRuns,
  type FunctionRun,
  type MarginInputs,
} from "./support/margin.ts";

// SPEC-DRIVEN (MVP 2, Task 5b). Live proof of margin protection in the cart AND
// in checkout on both shared themes (the matrix runs this file against Horizon
// and Dawn through `shopify theme dev`).
//
// Needs the margin seed and the cost mirror (scripts/e2e/margin-fixture.mjs):
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile margin --live
//   node apps/won-discounts/scripts/e2e/margin-costs.mjs --live
//   WON_E2E_PROFILE=margin npm run test:e2e:local:all -w won-discounts
//
// The cart (market cesko, CZK): won-e2e-simple-a (cost 6 USD), won-e2e-simple-b
// (no cost), won-e2e-two-variants Small (cost 5 USD) + code WONE2EM20.
//   - simple-a: the automatic 50 % is cut to the line's floor from its cost,
//     floorUnit = ceilTol(cost × rate × 100 / (1 − 25 %));
//   - simple-b: no cost → cut to the 30 % ceiling, floorUnit = ceilTol(price × 70 %);
//   - Small: no product rule; it carries the whole order discount — the code's
//     20 % is sent as an EXACT fixed amount (margin on) that leaves the two
//     lines at their floor out (excludedCartLineIds).
// Margin protection never blocks: checkout must complete.
//
// The cost converts with the checkout's presentmentCurrencyRate (shop USD →
// cart CZK), which Shopify only hands the function. The spec reads it from the
// function runs `shopify app dev` logs (support/margin.ts) — the runs of THIS
// cart — and plans with it (planCart on the live config, costs and refs read as
// the app). The same runs prove F-M1 (the rate: value, direction, digits) and
// F-M2 (the input carries wonVariant {cost, cur} for costed variants, null for
// the others), and the logged output is re-derived by the function's oracle
// (tests/reference-adapter.js) from the logged input.
//
// Invariant, asserted on its own arithmetic (not the plan's): no line's price
// after ALL discounts (its product discount + its share of the order discount,
// per the function's actual excludedCartLineIds) is below its floor.

const CHECKOUT_COUNTRY = "CZ"; // market cesko (CZK)
const CHECKOUT_EMAIL = "won-e2e+margin@example.com";

interface Line {
  handle: string;
  item: CartItem;
  index: number;
  variantId: string;
  planLine: PlanLine;
  /** Floor of one item, minor units: from the cost (costed) or the 30 % ceiling — restated, not the engine's. */
  floorUnit: number;
  basis: "cost" | "max_percent";
  cost: number | null;
}

interface Analysis {
  rate: number;
  plan: CartPlan;
  lines: Line[];
  byHandle: (handle: string) => Line;
  preview: ReturnType<typeof checkoutPreview>;
}

/** One rate for every run (asserted), its literal and value. */
function rateOf(runs: readonly FunctionRun[]) {
  const literals = [...new Set(runs.map((r) => r.rate?.raw ?? "<none>"))];
  expect(literals, "every run of this cart saw the same presentmentCurrencyRate").toHaveLength(1);
  const rate = runs[0]!.rate;
  expect(rate, "the run input has presentmentCurrencyRate").not.toBeNull();
  expect(rate!.value, `presentmentCurrencyRate "${rate!.raw}" is a number the function reads`).toBeGreaterThan(0);
  return rate!;
}

/** planCart with the live inputs and the logged rate, the floors restated, and the output mapping. */
function analyse(cart: Cart, inputs: MarginInputs, rate: number): Analysis {
  const plan = planCart(marginPlanInput(cart, inputs, CHECKOUT_COUNTRY, rate), inputs.config);
  expect(plan.reason, `planCart failed: ${plan.error ?? ""}`).toBeUndefined();
  const handleOf = new Map(Object.entries(inputs.productIdByHandle).map(([handle, id]) => [id, handle]));
  const lines = cart.items.map((item, index): Line => {
    const variantId = `gid://shopify/ProductVariant/${item.variant_id}`;
    const planLine = plan.lines.find((l) => l.lineId === `gid://shopify/CartLine/${index}`)!;
    const meta = inputs.costByVariantId[variantId];
    const cost = meta && typeof meta.cost === "number" && meta.cost > 0 && meta.cur === inputs.shopCurrency ? meta.cost : null;
    const floorUnit =
      cost !== null
        ? ceilTol((cost * rate * 100) / (1 - MARGIN_MIN_MARGIN_PERCENT / 100))
        : ceilTol(item.original_price * (1 - MARGIN_MAX_DISCOUNT_PERCENT / 100));
    return {
      handle: handleOf.get(`gid://shopify/Product/${item.product_id}`) ?? `product ${item.product_id}`,
      item,
      index,
      variantId,
      planLine,
      floorUnit,
      basis: cost !== null ? "cost" : "max_percent",
      cost,
    };
  });
  const byHandle = (handle: string) => {
    const line = lines.find((l) => l.handle === handle);
    expect(line, `${handle} is in the cart`).toBeDefined();
    return line!;
  };
  return { rate, plan, lines, byHandle, preview: checkoutPreview(plan, { lineCount: cart.items.length }) };
}

/** What the plan must say for this cart (the brief's expectations, from the restated floors). */
function expectMarginPlan(a: Analysis): void {
  const A = a.byHandle(MARGIN_PRODUCT_A_HANDLE);
  const B = a.byHandle(MARGIN_PRODUCT_B_HANDLE);
  const S = a.byHandle(MARGIN_SMALL_HANDLE);
  expect(A.basis, "simple-a has a cost").toBe("cost");
  expect(B.basis, "simple-b has no cost").toBe("max_percent");
  expect(S.basis, "Small has a cost").toBe("cost");
  for (const L of [A, B]) {
    const wanted = Math.round((L.planLine.subtotal * MARGIN_AUTO_PERCENT) / 100);
    const headroom = L.planLine.subtotal - L.floorUnit * L.planLine.quantity;
    expect(wanted, `${L.handle}: the 50 % would go below the floor (the case under test)`).toBeGreaterThan(headroom);
    expect(L.planLine.product?.components.map((c) => c.ruleId), `${L.handle}: the automatic rule`).toEqual([MARGIN_AUTO_RULE_ID]);
    expect(L.planLine.product?.amount, `${L.handle}: lowered exactly to its floor`).toBe(headroom);
    expect(L.planLine.product?.value, `${L.handle}: an exact total`).toEqual({ fixedTotal: headroom });
    expect(L.planLine.marginCapped, `${L.handle}: margin cap recorded`).toMatchObject({ before: wanted, after: headroom, floorUnit: L.floorUnit, basis: L.basis });
  }
  expect(A.planLine.marginCapped?.minMarginPercent).toBe(MARGIN_MIN_MARGIN_PERCENT);
  expect(B.planLine.marginCapped?.maxDiscountPercent).toBe(MARGIN_MAX_DISCOUNT_PERCENT);
  expect(Math.round((B.planLine.product?.amount ?? 0) * 100) / B.planLine.subtotal, "simple-b: ≈ 30 %").toBeCloseTo(MARGIN_MAX_DISCOUNT_PERCENT, 0);
  expect(S.planLine.product, "Small: no product discount").toBeNull();

  const order = a.plan.order;
  expect(order, "planCart: an order discount").not.toBeNull();
  expect(order!.ownerRuleId).toBe(MARGIN_CODE_RULE_ID);
  expect(order!.message).toBe(MARGIN_CODE_RULE_NAME);
  expect(order!.marginProtected, "margin on: the order discount is sized to the floors").toBe(true);
  // In cart order (Shopify decides the line order: never assume A before B).
  expect([...order!.marginExcludedLineIds].sort(), "the two lines at their floor are left out").toEqual([A.planLine.lineId, B.planLine.lineId].sort());
  expect(order!.excludedLineIds, "nothing else is excluded (no outlet, no gift)").toEqual(order!.marginExcludedLineIds);
  expect(order!.base, "the order base is Small alone").toBe(S.planLine.subtotal);
  const wantedOrder = Math.round((S.planLine.subtotal * MARGIN_CODE_PERCENT) / 100);
  const smallHeadroom = S.planLine.subtotal - S.floorUnit * S.planLine.quantity - 1;
  if (wantedOrder <= smallHeadroom) expect(order!.amount, "20 % of Small (within its headroom)").toBe(wantedOrder);
  else expect(order!.amount, "cut to Small's headroom").toBe(smallHeadroom);
}

/** The output mapping (function-output.ts) of the plan: per line the automatic node's candidate, and the code node's order candidate. */
function emitted(a: Analysis) {
  const auto = a.preview.nodes.find((n) => n.role.kind === "automatic")!;
  const code = a.preview.nodes.find((n) => n.role.kind === "code" && n.role.ruleId === MARGIN_CODE_RULE_ID);
  expect(code, "the code node runs for WONE2EM20").toBeDefined();
  const productCandidates = auto.output.lines.operations.flatMap((op) => ("productDiscountsAdd" in op ? op.productDiscountsAdd.candidates : []));
  const orderCandidates = code!.output.lines.operations.flatMap((op) => ("orderDiscountsAdd" in op ? op.orderDiscountsAdd.candidates : []));
  expect(orderCandidates, "one order candidate from the code node").toHaveLength(1);
  const order = orderCandidates[0]!;
  expect("fixedAmount" in order.value, "margin on: the order discount is an exact fixed amount").toBe(true);
  return {
    productFor: (lineId: string) => productCandidates.find((c) => c.targets.some((t) => t.cartLine.id === lineId)) ?? null,
    order,
    orderMinor: "fixedAmount" in order.value ? toMinorUnits(order.value.fixedAmount.amount, a.plan.currency) : null,
    excluded: order.targets[0]!.orderSubtotal.excludedCartLineIds,
  };
}

/**
 * The function's ACTUAL order candidate (the code node's logged output), by
 * variant: amount (minor units) and the variants it leaves out.
 */
function loggedOrder(runs: readonly FunctionRun[], currency: string) {
  const codeRun = [...runs].reverse().find((r) => r.role === "code")!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ops = (codeRun.output?.operations ?? []) as any[];
  const candidate = ops.flatMap((op) => op.orderDiscountsAdd?.candidates ?? [])[0] ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const variantOfLine = new Map(((codeRun.input?.cart?.lines ?? []) as any[]).map((l) => [l.id, l.merchandise?.id]));
  const excludedIds: string[] = candidate?.targets?.[0]?.orderSubtotal?.excludedCartLineIds ?? [];
  return {
    file: codeRun.file,
    candidate,
    amount: candidate?.value?.fixedAmount ? toMinorUnits(candidate.value.fixedAmount.amount, currency) : null,
    excludedVariants: excludedIds.map((id) => variantOfLine.get(id) ?? id).sort(),
  };
}

/**
 * The invariant: per line, price after its product discount minus the most of
 * the order discount it can carry ≥ floorUnit × quantity. A line the function's
 * order candidate excludes carries none; with one base line it carries all of
 * it; with several, Shopify's proportional share rounded up.
 */
function invariant(lines: readonly Line[], afterProduct: (l: Line) => number, orderAmount: number, excludedVariants: readonly string[]) {
  const base = lines.filter((l) => !excludedVariants.includes(l.variantId));
  const baseTotal = base.reduce((s, l) => s + afterProduct(l), 0);
  return lines.map((l) => {
    const after = afterProduct(l);
    const inBase = base.includes(l);
    const orderShare = !inBase ? 0 : base.length === 1 ? orderAmount : Math.ceil((orderAmount * after) / baseTotal);
    const final = after - orderShare;
    const floor = l.floorUnit * l.item.quantity;
    return { handle: l.handle, basis: l.basis, cost: l.cost, afterProduct: after, orderShare, final, floor, margin: final - floor, holds: final >= floor };
  });
}

/** F-M1 / F-M2 / parity checks on the logged runs of this cart; returns their evidence. */
function checkRuns(runs: readonly FunctionRun[], cart: Cart, inputs: MarginInputs, a: Analysis, usdPriceA: number) {
  const A = a.byHandle(MARGIN_PRODUCT_A_HANDLE);
  const rate = rateOf(runs);
  // F-M1: direction shop USD → cart CZK: about the CZK/USD price ratio of simple-a (the market rounds CZK prices).
  const priceRatio = A.item.original_price / Math.round(usdPriceA * 100);
  expect(rate.value!, "F-M1: rate > 1 (USD → CZK, not CZK → USD)").toBeGreaterThan(1);
  expect(Math.abs(rate.value! / priceRatio - 1), `F-M1: rate ${rate.raw} ≈ simple-a CZK/USD price ratio ${priceRatio}`).toBeLessThan(0.05);
  // F-M2: wonVariant per line = the variant metafield (null where the mirror wrote none).
  for (const run of runs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const line of (run.input?.cart?.lines ?? []) as any[]) {
      const variant = String(line.merchandise?.id ?? "");
      const want = inputs.costByVariantId[variant] ?? null;
      expect(line.merchandise?.wonVariant === undefined, `${run.file}: the input query selects wonVariant`).toBe(false);
      expect(line.merchandise?.wonVariant?.jsonValue ?? null, `F-M2 ${inputs.variantLabel[variant]}: wonVariant in the function input`).toEqual(want);
    }
    // The logged output is exactly what the function's oracle computes from the logged input.
    expect(run.output, `${run.file}: logged output = reference-adapter runCartLines(logged input)`).toEqual(oracleFor(run).output);
  }
  // The plan from the logged input (adaptInput, as the function reads it) = the plan from /cart.js + the live metafields.
  const logged = runs[runs.length - 1]!;
  const { adapted } = oracleFor(logged);
  const fromLog = planCart(adapted.cart, adapted.config as PlanConfig);
  const byVariant = (plan: CartPlan) =>
    Object.fromEntries(plan.lines.map((l) => [l.variantId, l.product?.amount ?? 0]));
  expect(byVariant(fromLog), "per-line product discounts: plan from the logged input = plan from /cart.js").toEqual(byVariant(a.plan));
  expect(fromLog.totals, "totals: plan from the logged input = plan from /cart.js").toEqual(a.plan.totals);
  expect(adapted.cart.shopToCartRate, "the rate the plan used is the logged one").toBe(a.rate);
  return {
    rate,
    priceRatioCzkPerUsd: priceRatio,
    rateToPriceRatio: rate.value! / priceRatio,
    wonVariantByLine: runSummary(logged).lines.map((l) => ({ variant: l.variant, label: inputs.variantLabel[l.variant ?? ""] ?? null, wonVariant: l.wonVariant })),
    oracleParityRuns: runs.length,
    cartCurrency: cart.currency,
  };
}

/** The shop-currency price of the product's first variant, as the E2E catalog has it (the seeds never change prices). */
function usdPrice(inputs: MarginInputs, handle: string): number {
  const product = (WON_E2E_PRODUCT_LIST as readonly { handle: string; variants: { price: string }[] }[]).find((p) => p.handle === handle);
  expect(product, `${handle} in the E2E catalog`).toBeDefined();
  expect(inputs.shopCurrency).toBe("USD");
  return Number(product!.variants[0]!.price);
}

function checkoutLineFor(lines: readonly CheckoutLine[], item: CartItem): CheckoutLine {
  const title = (item.product_title ?? "").trim();
  const line = lines.find((l) => l.title.trim() === title) ?? lines.find((l) => title !== "" && l.title.includes(title));
  expect(line, `checkout line "${title}" among ${JSON.stringify(lines.map((l) => l.title))}`).toBeDefined();
  return line!;
}

function lineEvidence(a: Analysis) {
  const out = emitted(a);
  return a.lines.map((l) => ({
    handle: l.handle,
    variantId: l.variantId,
    quantity: l.item.quantity,
    unitPrice: l.item.original_price,
    cost: l.cost,
    floorUnit: l.floorUnit,
    basis: l.basis,
    plan: { product: l.planLine.product, marginCapped: l.planLine.marginCapped ?? null, marginTight: l.planLine.marginTight ?? false },
    emitted: out.productFor(l.planLine.lineId)?.value ?? null,
    cart: {
      allocations: l.item.line_level_discount_allocations.map((al) => ({
        title: al.discount_application.title,
        value_type: al.discount_application.value_type,
        value: al.discount_application.value,
        amount: al.amount,
      })),
      final_line_price: l.item.final_line_price,
    },
  }));
}

test.describe(`Won Discounts margin protection in cart and checkout (MVP 2)${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(E2E_PROFILE !== "margin", `WON_E2E_PROFILE=${E2E_PROFILE}: this spec needs the margin seed (seed-mvp1.mjs --profile margin --live + margin-costs.mjs --live) and WON_E2E_PROFILE=margin`);

  test.afterEach(async ({ page, baseURL }) => {
    if (page.url().startsWith(new URL(baseURL!).origin)) await clearCartQuietly(page);
  });

  test("cart: simple-a to its cost floor, simple-b to 30 %, Small none, WONE2EM20 applicable as an exact amount = planCart with the logged rate", async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const inputs = await readMarginInputs(MARGIN_CART_HANDLES);
    const rules = inputs.config.modules.codes.rules;
    expect(rules.map((r) => r.id), "the live shop config carries the margin seed").toEqual(expect.arrayContaining([MARGIN_AUTO_RULE_ID, MARGIN_CODE_RULE_ID]));
    expect((inputs.config.modules as Record<string, unknown>).margin, "live payload: margin on, m 25, p 30, costs in the shop currency").toEqual({
      enabled: true,
      min: MARGIN_MIN_MARGIN_PERCENT,
      max: MARGIN_MAX_DISCOUNT_PERCENT,
      cur: inputs.shopCurrency,
    });
    for (const handle of [MARGIN_PRODUCT_A_HANDLE, MARGIN_PRODUCT_B_HANDLE]) {
      expect(inputs.refsByProductId[inputs.productIdByHandle[handle]!]?.ruleIds ?? [], `${handle} is targeted by the automatic rule`).toContain(MARGIN_AUTO_RULE_ID);
    }
    const usdA = usdPrice(inputs, MARGIN_PRODUCT_A_HANDLE);

    const response = await page.goto(`/products/${MARGIN_PRODUCT_A_HANDLE}`, { waitUntil: "load" });
    expect(response?.status()).toBeLessThan(400);

    const cartAt = Date.now();
    const cart = await freshCartOfVariants(page, MARGIN_CART, [MARGIN_CODE]);
    expect(cart.currency).toBe("CZK");
    expect(cart.items).toHaveLength(MARGIN_CART.length);
    const variantIds = cart.items.map((i) => `gid://shopify/ProductVariant/${i.variant_id}`);
    const runs = await test.step("the function runs of this cart (shopify app dev logs): presentmentCurrencyRate", () =>
      waitForRuns({ sinceMs: cartAt - 1_000, variantIds, currency: "CZK", code: MARGIN_CODE }),
    );
    const rate = rateOf(runs);
    const a = analyse(cart, inputs, rate.value!);
    const out = emitted(a);

    await test.step(`(a) planCart with rate ${rate.raw}: floors, caps and the order discount`, () => expectMarginPlan(a));

    const runEvidence = await test.step("(b) F-M1 rate, F-M2 wonVariant, logged output = oracle", () => checkRuns(runs, cart, inputs, a, usdA));

    await test.step("(c) /cart.js product allocations = plan, sent as exact amounts", async () => {
      for (const l of a.lines) {
        const allocations = l.item.line_level_discount_allocations;
        const planned = l.planLine.product;
        if (!planned) {
          expect(allocations, `${l.handle}: no product discount`).toEqual([]);
          expect(l.item.final_line_price).toBe(l.planLine.subtotal);
          continue;
        }
        expect(allocations, `${l.handle}: one product discount`).toHaveLength(1);
        const allocation = allocations[0]!;
        expect(allocation.discount_application.title).toBe(MARGIN_AUTO_RULE_NAME);
        expect(allocation.amount, `${l.handle}: line discount = planCart`).toBe(planned.amount);
        const candidate = out.productFor(l.planLine.lineId);
        expect(candidate && "fixedAmount" in candidate.value, `${l.handle}: a margin-capped line is sent as its exact amount`).toBe(true);
        expect(allocation.discount_application.value_type).toBe("fixed_amount");
        if (candidate && "fixedAmount" in candidate.value) {
          expect(Math.round(Number(allocation.discount_application.value) * 100), `${l.handle}: the exact amount`).toBe(toMinorUnits(candidate.value.fixedAmount.amount, "CZK"));
        }
        expect(l.item.final_line_price, `${l.handle}: at its floor`).toBe(l.floorUnit * l.item.quantity);
      }
    });

    await test.step("(d) the code WONE2EM20: applicable, an exact fixed amount = planCart", async () => {
      expect(cart.discount_codes).toEqual([{ code: MARGIN_CODE, applicable: true }]);
      expect(a.plan.codes[0]?.state, "planCart: the code applies").toBe("applied");
      expect(cart.cart_level_discount_applications).toHaveLength(1);
      const order = cart.cart_level_discount_applications[0]!;
      expect(order.value_type, "margin on: never a percent").toBe("fixed_amount");
      expect(Math.round(Number(order.value) * 100), "the exact amount = planCart").toBe(a.plan.order?.amount);
      expect(order.total_allocated_amount, "order discount = planCart").toBe(a.plan.order?.amount);
      expect(out.orderMinor).toBe(a.plan.order?.amount);
      expect(cart.items_subtotal_price, "subtotal after the product discounts = planCart").toBe(a.plan.totals.subtotal - a.plan.totals.productDiscount);
      expect(cart.total_price, "cart total = planCart").toBe(a.plan.totals.total);
    });

    const logged = loggedOrder(runs, "CZK");
    const inv = await test.step("(e) invariant: no line below its floor after all discounts (the function's actual exclusions)", async () => {
      const A = a.byHandle(MARGIN_PRODUCT_A_HANDLE);
      const B = a.byHandle(MARGIN_PRODUCT_B_HANDLE);
      expect(logged.amount, "logged order candidate = planCart").toBe(a.plan.order?.amount);
      expect(logged.excludedVariants, "logged order candidate leaves out simple-a and simple-b").toEqual([A.variantId, B.variantId].sort());
      const rows = invariant(a.lines, (l) => l.item.final_line_price, cart.cart_level_discount_applications[0]!.total_allocated_amount, logged.excludedVariants);
      for (const row of rows) expect(row.final, `${row.handle}: ${row.final} ≥ floor ${row.floor} (${row.basis})`).toBeGreaterThanOrEqual(row.floor);
      return rows;
    });

    await saveEvidence(testInfo, "cart-margin", {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      currency: cart.currency,
      presentmentCurrencyRate: rate,
      fM1: runEvidence,
      lines: lineEvidence(a),
      discount_codes: cart.discount_codes,
      cart_level: cart.cart_level_discount_applications,
      items_subtotal_price: cart.items_subtotal_price,
      total_price: cart.total_price,
      planOrder: a.plan.order,
      planTotals: a.plan.totals,
      planRules: a.plan.rules.map((r) => ({ ruleId: r.ruleId, state: r.state, amount: r.amount })),
      loggedOrder: logged,
      invariant: inv,
    });
    await saveEvidence(testInfo, "function-runs-cart-margin", runs.map(runSummary));
  });

  test("checkout (Bogus): margin never blocks; the thank-you page charges planCart with the checkout's logged rate, no line below its floor", async ({ page }, testInfo) => {
    test.setTimeout(480_000);
    const inputs = await readMarginInputs(MARGIN_CART_HANDLES);
    const usdA = usdPrice(inputs, MARGIN_PRODUCT_A_HANDLE);
    await page.setViewportSize({ width: 1440, height: 900 });

    await unlockRealStorefront(page);
    const response = await page.goto(`/products/${MARGIN_PRODUCT_A_HANDLE}`, { waitUntil: "load" });
    expect(response?.status()).toBeLessThan(400);

    const cartAt = Date.now();
    const cart = await freshCartOfVariants(page, MARGIN_CART, [MARGIN_CODE]);
    const variantIds = cart.items.map((i) => `gid://shopify/ProductVariant/${i.variant_id}`);
    const cartRuns = await waitForRuns({ sinceMs: cartAt - 1_000, variantIds, currency: "CZK", code: MARGIN_CODE });
    const before = analyse(cart, inputs, rateOf(cartRuns).value!);
    expect(cart.discount_codes[0]).toEqual({ code: MARGIN_CODE, applicable: true });
    expect(cart.total_price, "cart total = planCart").toBe(before.plan.totals.total);

    let codeCarriedIntoCheckout = true;
    const checkoutAt = Date.now();
    await test.step("open checkout; its lines and summary equal the cart", async () => {
      await openCheckout(page);
      if (rowAmount(await priceSummary(page), MARGIN_CODE) === null) {
        codeCarriedIntoCheckout = false; // the theme-dev session split (checkout.mvp1.spec.ts header)
        await applyCodeInCheckout(page, MARGIN_CODE);
      }
      console.log(`[checkout.margin] ${THEME_LABEL || "theme"}: code ${codeCarriedIntoCheckout ? "carried from the cart" : "re-entered in checkout"}`);
      const rows = await priceSummary(page);
      const lines = await checkoutLines(page);
      for (const l of before.lines) {
        const line = checkoutLineFor(lines, l.item);
        expect(line.allocations.map((al) => al.amount), `checkout ${l.handle}: line discount = cart`).toEqual(
          l.item.line_level_discount_allocations.map((al) => -al.amount),
        );
      }
      expect(rowAmount(rows, SUBTOTAL), "checkout subtotal = cart items_subtotal_price").toBe(cart.items_subtotal_price);
      expect(rowAmount(rows, MARGIN_CODE), "checkout order discount = cart").toBe(-(cart.cart_level_discount_applications[0]?.total_allocated_amount ?? 0));
      expect(rowAmount(rows, TOTAL), "checkout total before shipping = cart total").toBe(cart.total_price);
    });

    await test.step("contact, CZ address, first shipping rate", () => fillCzechShippingAddress(page, CHECKOUT_EMAIL));
    await test.step("pay with the Bogus gateway (card 1): margin protection never blocks", () => payWithBogusCard(page));

    const thankYou = await test.step("thank-you page: read the order", async () => {
      const settled = await settledThankYou(page);
      expect(settled.payFormGone, "the payment form is gone before the thank-you page is read").toBe(true);
      const rows = await priceSummary(page);
      const lines = await checkoutLines(page);
      const shipping = rowAmount(rows, SHIPPING);
      const tax = rows.filter((r) => TAX.test(r.label)).reduce((sum, r) => sum + (r.amount ?? 0), 0);
      return { rows, lines, shipping, tax, settled };
    });

    // The runs of THIS checkout. Observed 2026-09-29 (Horizon, 16:18:50–16:19:40Z): a checkout that
    // applied the function's discounts (thank-you page = plan) left NO run in the app dev log stream
    // (neither .shopify/logs nor app-dev.log), while the checkouts before and after it did. When
    // that happens the rate comes from this cart's own runs seconds earlier (same lines, same code,
    // same live rate) and the evidence says so (checkoutRunsLogged: false).
    let checkoutRunsLogged = true;
    const runs = await test.step("the function runs of THIS checkout (shopify app dev logs): presentmentCurrencyRate", async () => {
      try {
        return await waitForRuns({ sinceMs: checkoutAt, variantIds, currency: "CZK", code: MARGIN_CODE }, { timeoutMs: 90_000, settleMs: 8_000 });
      } catch (error) {
        checkoutRunsLogged = false;
        console.log(`[checkout.margin] ${THEME_LABEL || "theme"}: no function run of this checkout was logged (${(error as Error).message}); using this cart's ${cartRuns.length} run(s) from ${cartRuns[0]?.logTimestamp}`);
        return cartRuns;
      }
    });
    const rate = rateOf(runs);
    const a = analyse(cart, inputs, rate.value!);
    const out = emitted(a);
    await test.step(`planCart with the checkout's rate ${rate.raw}`, () => expectMarginPlan(a));
    const runEvidence = await test.step("F-M1 rate, F-M2 wonVariant, logged output = oracle (checkout runs)", () => checkRuns(runs, cart, inputs, a, usdA));

    const observed = await test.step("thank-you page = planCart: line discounts, order discount, total, charged", async () => {
      const { rows, lines, shipping, tax, settled } = thankYou;
      const perLine = a.lines.map((l) => {
        const line = checkoutLineFor(lines, l.item);
        return { handle: l.handle, allocations: line.allocations, originalPrice: line.originalPrice, finalPrice: line.finalPrice };
      });
      expect(lines, "one order line per cart line").toHaveLength(cart.items.length);
      for (const l of a.lines) {
        const o = perLine.find((p) => p.handle === l.handle)!;
        const planned = l.planLine.product?.amount ?? 0;
        if (planned > 0) {
          expect(o.allocations.map((al) => [al.title.toUpperCase(), al.amount]), `thank-you ${l.handle}: line discount = planCart`).toEqual([
            [MARGIN_AUTO_RULE_NAME.toUpperCase(), -planned],
          ]);
          expect(o.originalPrice, `thank-you ${l.handle}: original price = cart`).toBe(l.planLine.subtotal);
        } else {
          expect(o.allocations, `thank-you ${l.handle}: no line discount`).toEqual([]);
        }
        expect(o.finalPrice, `thank-you ${l.handle}: price after the line discount = planCart`).toBe(l.planLine.subtotal - planned);
      }
      const subtotal = rowAmount(rows, SUBTOTAL);
      const orderDiscount = rowAmount(rows, MARGIN_CODE);
      const total = rowAmount(rows, TOTAL);
      expect(subtotal, "thank-you subtotal = planCart (after product discounts)").toBe(a.plan.totals.subtotal - a.plan.totals.productDiscount);
      expect(orderDiscount, "thank-you order discount (WONE2EM20) = planCart").toBe(-(a.plan.order?.amount ?? 0));
      expect(out.orderMinor, "sent as that exact amount").toBe(a.plan.order?.amount);
      expect(shipping, "shipping amount").not.toBeNull();
      expect(total, "thank-you total = planCart + shipping + tax").toBe(a.plan.totals.total + (shipping ?? 0) + tax);
      expect(settled.charged, "the card was charged the thank-you total").toBe(total);
      return { perLine, subtotal, orderDiscount, shipping, tax, total, charged: settled.charged };
    });

    const logged = loggedOrder(runs, "CZK");
    const inv = await test.step("invariant on the thank-you page: no line below its floor after all discounts", async () => {
      const A = a.byHandle(MARGIN_PRODUCT_A_HANDLE);
      const B = a.byHandle(MARGIN_PRODUCT_B_HANDLE);
      expect(logged.amount, "logged order candidate = planCart").toBe(a.plan.order?.amount);
      expect(logged.excludedVariants, "logged order candidate leaves out simple-a and simple-b").toEqual([A.variantId, B.variantId].sort());
      const finalOf = (l: Line) => observed.perLine.find((p) => p.handle === l.handle)!.finalPrice ?? Number.NaN;
      const rows = invariant(a.lines, finalOf, -(observed.orderDiscount ?? 0), logged.excludedVariants);
      for (const row of rows) expect(row.final, `${row.handle}: ${row.final} ≥ floor ${row.floor} (${row.basis})`).toBeGreaterThanOrEqual(row.floor);
      return rows;
    });

    await saveScreenshot(page, testInfo, "thankyou-margin-1440");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1_000);
    await expandMobileSummary(page);
    await saveScreenshot(page, testInfo, "thankyou-margin-390");

    await saveEvidence(testInfo, "checkout-margin", {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      checkoutPath: new URL(page.url()).pathname.replace(/\/cn\/[^/]+/u, "/cn/<token>"),
      codeCarriedIntoCheckout,
      checkoutRunsLogged,
      presentmentCurrencyRate: { checkout: rate, cartBeforeCheckout: rateOf(cartRuns) },
      fM1: runEvidence,
      cart: {
        currency: cart.currency,
        original_total_price: cart.original_total_price,
        items_subtotal_price: cart.items_subtotal_price,
        total_price: cart.total_price,
        discount_codes: cart.discount_codes,
        cart_level: cart.cart_level_discount_applications,
      },
      lines: lineEvidence(a),
      plan: { totals: a.plan.totals, order: a.plan.order, rules: a.plan.rules.map((r) => ({ ruleId: r.ruleId, state: r.state, amount: r.amount })) },
      thankYou: { ...observed, expectedTotal: a.plan.totals.total + (observed.shipping ?? 0) + observed.tax },
      thankYouSummaryRows: thankYou.rows,
      loggedOrder: logged,
      invariant: inv,
    });
    await saveEvidence(testInfo, "function-runs-checkout-margin", { checkoutRunsLogged, sinceCheckoutOpened: new Date(checkoutAt).toISOString(), runs: runs.map(runSummary) });
  });
});
