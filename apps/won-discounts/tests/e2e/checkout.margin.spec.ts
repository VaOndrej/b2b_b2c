import { checkoutPreview } from "@won/core/discounts/function-output";
import { toMinorUnits } from "@won/core/discounts/money";
import { planCart, type CartPlan, type PlanConfig, type PlanLine } from "@won/core/discounts/plan";
import { WON_E2E_PRODUCT_LIST } from "@won/testing/e2e-products";

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
  MARGIN_COLLECTION_HANDLE,
  MARGIN_COLLECTION_MAX_DISCOUNT_PERCENT,
  MARGIN_COLLECTION_MEMBER_HANDLE,
  MARGIN_HANDLES,
  MARGIN_MAX_DISCOUNT_PERCENT,
  MARGIN_MIN_MARGIN_PERCENT,
  MARGIN_MULTIAXIS_HANDLE,
  MARGIN_ORDER_CAP_CART,
  MARGIN_ORDER_CAP_CODE,
  MARGIN_ORDER_CAP_PERCENT,
  MARGIN_ORDER_CAP_RULE_ID,
  MARGIN_ORDER_CAP_RULE_NAME,
  MARGIN_PRODUCT_A_HANDLE,
  MARGIN_PRODUCT_B_HANDLE,
  MARGIN_RULE_IDS,
  MARGIN_SMALL_HANDLE,
  MARGIN_SPARE_HANDLE,
} from "../../scripts/e2e/margin-fixture.mjs";
import { clearCartQuietly, freshCartOfVariants, setStorefrontCountry, storefrontJson, type Cart, type CartItem } from "./support/cart.ts";
import {
  applyCodeInCheckout,
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
  SLOVAK_ADDRESS,
  SUBTOTAL,
  TAX,
  TOTAL,
  type CheckoutLine,
  type ShippingAddress,
  type SummaryRow,
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

// SPEC-DRIVEN (MVP 2, Task 5b + fix round 1). Live proof of margin protection in
// the cart AND in checkout on both shared themes (the matrix runs this file
// against Horizon and Dawn through `shopify theme dev`).
//
// Needs the margin seed and the cost mirror (scripts/e2e/margin-fixture.mjs):
//   node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile margin --live
//   node apps/won-discounts/scripts/e2e/margin-costs.mjs --live
//   WON_E2E_PROFILE=margin npm run test:e2e:local:all -w won-discounts
//
// Scenarios (every one: planCart on the live config, costs and refs read as the
// app, with the presentmentCurrencyRate the function logged for THIS cart):
//   1+2 main cart, market cesko (CZK = the shop currency since 2026-09-30, rate
//       1): simple-a (10 Kč, cost 6 Kč), simple-b (12 Kč, no cost),
//       won-e2e-spare (no cost, the price list's fixed 199 Kč), two-variants
//       Small (15 Kč, cost 5 Kč) + code WONE2EM20:
//       - simple-a: the automatic 50 % cut to its cost floor
//         floorUnit = ceilTol(cost × rate × 100 / (1 − 25 %));
//       - simple-b and spare: no cost → cut to the 30 % ceiling
//         floorUnit = ceilTol(price × 70 %) (Pro: simple-b's collection 10 %);
//       - Small: no product rule; it carries the whole order discount — the
//         code's 20 % sent as an EXACT fixed amount (margin on) that leaves the
//         lines at their floor out (excludedCartLineIds).
//       Test 1 checks /cart.js, test 2 pays with Bogus and checks the thank-you page.
//   3   order discount LOWERED by margin (audit OQ1): Small + multiaxis S / Red
//       (both costed, no product rule) + code WONE2EM60: 60 % of the order is
//       more than their floors allow, so the order discount becomes the exact
//       amount D_max over BOTH lines. Shopify spreads it over the lines without
//       telling how (no read_orders): the invariant per line is asserted for a
//       proportional split rounded up (what the engine sizes D for), the totals
//       exactly.
//   4   the main cart in market slovensko (EUR, audit OQ6): `?country=SK` on a
//       page render switches the buyer country to SK (support/cart.ts
//       setStorefrontCountry: the localization form answers 401 through theme
//       dev). The SK price list has NO fixed price: every line is the shop's
//       CZK price converted at the market rate (simple-a ≈ 0,42 €), the costs
//       too (CZK → EUR, presentmentCurrencyRate ≈ 0.04). PRECONDITION: every
//       product of the cart is for sale in SK — the store ships there since
//       2026-09-30, so an unavailable product now FAILS the test (it was
//       skipped as "blocked by store setup" in MVP 2); the Bogus checkout ships
//       to Bratislava. F-M1 for EUR (rate, direction, digits) + thank-you =
//       planCart + invariant.
// Margin protection never blocks: every checkout must complete.
//
// The rate converts the costs (shop CZK → cart currency: 1 in cesko, ≈ 0.04 in
// slovensko); Shopify only hands it the function. The spec reads it from the function runs `shopify app dev` logs
// (support/margin.ts). The same runs prove F-M1 (the rate: value, direction,
// digits) and F-M2 (wonVariant {cost, cur} for costed variants, null for the
// others), and the logged output is re-derived by the function's oracle
// (tests/reference-adapter.js) from the logged input.
//
// Invariant, on its own arithmetic (not the plan's): no line's price after ALL
// discounts (its product discount + its share of the order discount, per the
// function's actual excludedCartLineIds) is below its floor.
//
// Pro (phase B), WON_E2E_PROFILE=margin-pro — the same scenarios plus a
// per-collection override: the manual collection won-e2e-margin (simple-b only)
// has a maximum discount of 10 %:
//   node apps/won-discounts/scripts/e2e/margin-collection.mjs --live
//   NODE_ENV=development WON_DEV_PLAN=pro node apps/won-discounts/scripts/e2e/seed-mvp1.mjs --profile margin-pro --live
//   node apps/won-discounts/scripts/e2e/margin-costs.mjs --live
//   WON_E2E_PROFILE=margin-pro npm run test:e2e:local:all -w won-discounts
// (`shopify app dev` with NODE_ENV=development WON_DEV_PLAN=pro as well.) The
// live payload keeps the GLOBAL maximum at 30 % and ships the override as `col`;
// only simple-b's product metafield carries the collection's id (`marginRefs`).
// The control line won-e2e-spare (no cost, outside the collection) separates
// Pro from Free by OUTCOME: Pro keeps it at the global 30 %, while a Free fold
// of the 10 % into the global value would cut it to 10 %.

const PRO = E2E_PROFILE === "margin-pro";
const EMAIL = PRO ? "won-e2e+margin-pro@example.com" : "won-e2e+margin@example.com";
/** Evidence / screenshot names: "cart-margin" (phase A) or "cart-margin-pro". */
const named = (name: string) => (PRO ? name.replace(/margin/u, "margin-pro") : name);

type Country = "CZ" | "SK";
const CURRENCY_OF: Record<Country, string> = { CZ: "CZK", SK: "EUR" };
/**
 * F-M1: how far the rate may be from the cart ÷ shop (CZK) price ratio of a
 * product. In cesko the cart IS the shop currency: the rate must be exactly 1
 * (checked on its own). In slovensko the CZK prices are converted and rounded
 * to whole cents: at ~0,42–0,62 € a cent is 1.6–2.4 %, and a rounding rule of
 * the EUR market could move more.
 */
const RATE_TOLERANCE: Record<Country, number> = { CZ: 0.05, SK: 0.12 };

interface Settings {
  minMarginPercent: number;
  maxDiscountPercent: number;
  source: "global" | "collection";
}

/** The settings that must apply to a product, from the fixture (restated, not read from the payload). */
function settingsFor(handle: string): Settings {
  if (PRO && handle === MARGIN_COLLECTION_MEMBER_HANDLE) {
    // The override leaves the minimum margin to the global value.
    return { minMarginPercent: MARGIN_MIN_MARGIN_PERCENT, maxDiscountPercent: MARGIN_COLLECTION_MAX_DISCOUNT_PERCENT, source: "collection" };
  }
  return { minMarginPercent: MARGIN_MIN_MARGIN_PERCENT, maxDiscountPercent: MARGIN_MAX_DISCOUNT_PERCENT, source: "global" };
}

interface Line {
  handle: string;
  item: CartItem;
  index: number;
  variantId: string;
  planLine: PlanLine;
  /** Floor of one item, minor units: from the cost (costed) or the maximum-discount ceiling — restated, not the engine's. */
  floorUnit: number;
  settings: Settings;
  basis: "cost" | "max_percent";
  cost: number | null;
}

interface Analysis {
  country: Country;
  currency: string;
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
function analyse(cart: Cart, inputs: MarginInputs, rate: number, country: Country): Analysis {
  const plan = planCart(marginPlanInput(cart, inputs, country, rate), inputs.config);
  expect(plan.reason, `planCart failed: ${plan.error ?? ""}`).toBeUndefined();
  const scale = 100; // CZK and EUR: 2 decimals
  const handleOf = new Map(Object.entries(inputs.productIdByHandle).map(([handle, id]) => [id, handle]));
  const lines = cart.items.map((item, index): Line => {
    const variantId = `gid://shopify/ProductVariant/${item.variant_id}`;
    const planLine = plan.lines.find((l) => l.lineId === `gid://shopify/CartLine/${index}`)!;
    const meta = inputs.costByVariantId[variantId];
    const cost = meta && typeof meta.cost === "number" && meta.cost > 0 && meta.cur === inputs.shopCurrency ? meta.cost : null;
    const handle = handleOf.get(`gid://shopify/Product/${item.product_id}`) ?? `product ${item.product_id}`;
    const settings = settingsFor(handle);
    const floorUnit =
      cost !== null
        ? ceilTol((cost * rate * scale) / (1 - settings.minMarginPercent / 100))
        : ceilTol(item.original_price * (1 - settings.maxDiscountPercent / 100));
    return { handle, settings, item, index, variantId, planLine, floorUnit, basis: cost !== null ? "cost" : "max_percent", cost };
  });
  const byHandle = (handle: string) => {
    const line = lines.find((l) => l.handle === handle);
    expect(line, `${handle} is in the cart`).toBeDefined();
    return line!;
  };
  return { country, currency: cart.currency, rate, plan, lines, byHandle, preview: checkoutPreview(plan, { lineCount: cart.items.length }) };
}

/** The main cart's plan: the automatic 50 % cut to each targeted line's floor, the code's 20 % on Small alone. */
function expectMainPlan(a: Analysis): void {
  const A = a.byHandle(MARGIN_PRODUCT_A_HANDLE);
  const B = a.byHandle(MARGIN_PRODUCT_B_HANDLE);
  const X = a.byHandle(MARGIN_SPARE_HANDLE);
  const S = a.byHandle(MARGIN_SMALL_HANDLE);
  expect(A.basis, "simple-a has a cost").toBe("cost");
  expect(B.basis, "simple-b has no cost").toBe("max_percent");
  expect(X.basis, "spare has no cost").toBe("max_percent");
  expect(S.basis, "Small has a cost").toBe("cost");
  for (const L of [A, B, X]) {
    const wanted = Math.round((L.planLine.subtotal * MARGIN_AUTO_PERCENT) / 100);
    const headroom = L.planLine.subtotal - L.floorUnit * L.planLine.quantity;
    expect(wanted, `${L.handle}: the 50 % would go below the floor (the case under test)`).toBeGreaterThan(headroom);
    expect(L.planLine.product?.components.map((c) => c.ruleId), `${L.handle}: the automatic rule`).toEqual([MARGIN_AUTO_RULE_ID]);
    expect(L.planLine.product?.amount, `${L.handle}: lowered exactly to its floor`).toBe(headroom);
    expect(L.planLine.product?.value, `${L.handle}: an exact total`).toEqual({ fixedTotal: headroom });
    expect(L.planLine.marginCapped, `${L.handle}: margin cap recorded`).toMatchObject({
      before: wanted,
      after: headroom,
      floorUnit: L.floorUnit,
      basis: L.basis,
      source: L.settings.source,
    });
  }
  expect(A.settings.source, "simple-a: the global settings (not in the collection)").toBe("global");
  expect(A.planLine.marginCapped?.minMarginPercent).toBe(A.settings.minMarginPercent);
  expect(B.settings.source, `simple-b: ${PRO ? "its collection's setting" : "the global settings"}`).toBe(PRO ? "collection" : "global");
  for (const L of [B, X]) {
    expect(L.planLine.marginCapped?.maxDiscountPercent, `${L.handle}: the ${L.settings.source} maximum discount`).toBe(L.settings.maxDiscountPercent);
    expect(((L.planLine.product?.amount ?? 0) * 100) / L.planLine.subtotal, `${L.handle}: ≈ ${L.settings.maxDiscountPercent} %`).toBeCloseTo(L.settings.maxDiscountPercent, 0);
  }
  // The control line: outside the collection, the global 30 % on Free and Pro alike.
  expect(X.settings, "spare: the global settings").toEqual({ minMarginPercent: MARGIN_MIN_MARGIN_PERCENT, maxDiscountPercent: MARGIN_MAX_DISCOUNT_PERCENT, source: "global" });
  if (PRO) {
    const folded = X.planLine.subtotal - ceilTol(X.item.original_price * (1 - MARGIN_COLLECTION_MAX_DISCOUNT_PERCENT / 100)) * X.planLine.quantity;
    expect(X.planLine.product?.amount, `spare: NOT the ${MARGIN_COLLECTION_MAX_DISCOUNT_PERCENT} % a Free fold of the collection override would give (${folded})`).not.toBe(folded);
  }
  expect(S.planLine.product, "Small: no product discount").toBeNull();

  const order = a.plan.order;
  expect(order, "planCart: an order discount").not.toBeNull();
  expect(order!.ownerRuleId).toBe(MARGIN_CODE_RULE_ID);
  expect(order!.message).toBe(MARGIN_CODE_RULE_NAME);
  expect(order!.marginProtected, "margin on: the order discount is sized to the floors").toBe(true);
  // In cart order (Shopify decides the line order: never assume one).
  expect([...order!.marginExcludedLineIds].sort(), "the lines at their floor are left out").toEqual([A, B, X].map((l) => l.planLine.lineId).sort());
  expect(order!.excludedLineIds, "nothing else is excluded (no outlet, no gift)").toEqual(order!.marginExcludedLineIds);
  expect(order!.base, "the order base is Small alone").toBe(S.planLine.subtotal);
  const wantedOrder = Math.round((S.planLine.subtotal * MARGIN_CODE_PERCENT) / 100);
  const smallHeadroom = S.planLine.subtotal - S.floorUnit * S.planLine.quantity - 1;
  if (wantedOrder <= smallHeadroom) expect(order!.amount, "20 % of Small (within its headroom)").toBe(wantedOrder);
  else expect(order!.amount, "cut to Small's headroom").toBe(smallHeadroom);
}

/**
 * The order-cap cart's plan: no product discount; the 60 % is more than the two
 * floors allow, so the order discount is D_max over BOTH lines (restated:
 * h_i = s_i − floor_i × q_i − 1, D_max = min_i floor(h_i × S / s_i) — with no
 * product discount a_i = s_i and both bases coincide), an exact total.
 */
function expectOrderCapPlan(a: Analysis): { wanted: number; dMax: number } {
  for (const l of a.lines) {
    expect(l.basis, `${l.handle}: has a cost`).toBe("cost");
    expect(l.planLine.product, `${l.handle}: no product discount`).toBeNull();
  }
  const S = a.lines.reduce((sum, l) => sum + l.planLine.subtotal, 0);
  const wanted = Math.round((S * MARGIN_ORDER_CAP_PERCENT) / 100);
  const dMax = Math.min(
    ...a.lines.map((l) => {
      const h = Math.max(0, l.planLine.subtotal - l.floorUnit * l.planLine.quantity - 1);
      return Math.floor((h * S) / l.planLine.subtotal);
    }),
  );
  expect(dMax, "the case under test: the floors allow less than the 60 %").toBeLessThan(wanted);
  expect(dMax, "…but more than 0").toBeGreaterThan(0);
  const order = a.plan.order;
  expect(order, "planCart: an order discount").not.toBeNull();
  expect(order!.ownerRuleId).toBe(MARGIN_ORDER_CAP_RULE_ID);
  expect(order!.message).toBe(MARGIN_ORDER_CAP_RULE_NAME);
  expect(order!.marginProtected).toBe(true);
  expect(order!.marginExcludedLineIds, "no line is left out: the discount is spread over both").toEqual([]);
  expect(order!.base, "the base is the whole cart").toBe(S);
  expect(order!.amount, `lowered to D_max = ${dMax} (wanted ${wanted})`).toBe(dMax);
  expect(order!.value, "an exact total").toEqual({ fixedTotal: dMax });
  expect(order!.marginCapped, "the order cap is recorded").toEqual({ before: wanted, after: dMax });
  return { wanted, dMax };
}

/** The output mapping (function-output.ts) of the plan: per line the automatic node's candidate, and `codeRuleId`'s order candidate. */
function emitted(a: Analysis, codeRuleId: string) {
  const auto = a.preview.nodes.find((n) => n.role.kind === "automatic")!;
  const code = a.preview.nodes.find((n) => n.role.kind === "code" && n.role.ruleId === codeRuleId);
  expect(code, `the code node of ${codeRuleId} runs`).toBeDefined();
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
 * it; with several, Shopify's proportional share rounded up (Shopify does not
 * say how it splits an order discount, and without read_orders the split is not
 * observable — the engine sizes D so that this bound holds on both bases). The
 * totals are exact: Σ (price after all discounts) = subtotal − D ≥ Σ floors.
 */
function invariant(lines: readonly Line[], afterProduct: (l: Line) => number, orderAmount: number, excludedVariants: readonly string[]) {
  const base = lines.filter((l) => !excludedVariants.includes(l.variantId));
  const baseTotal = base.reduce((s, l) => s + afterProduct(l), 0);
  const rows = lines.map((l) => {
    const after = afterProduct(l);
    const inBase = base.includes(l);
    const orderShare = !inBase ? 0 : base.length === 1 ? orderAmount : Math.ceil((orderAmount * after) / baseTotal);
    const final = after - orderShare;
    const floor = l.floorUnit * l.item.quantity;
    return {
      handle: l.handle,
      basis: l.basis,
      settings: l.settings,
      cost: l.cost,
      afterProduct: after,
      orderShare,
      shareRule: !inBase ? "excluded" : base.length === 1 ? "whole (only base line)" : "proportional, rounded up (assumed)",
      final,
      floor,
      margin: final - floor,
      holds: final >= floor,
    };
  });
  const totals = {
    afterAllDiscounts: lines.reduce((s, l) => s + afterProduct(l), 0) - orderAmount,
    floors: rows.reduce((s, r) => s + r.floor, 0),
  };
  for (const row of rows) expect(row.final, `${row.handle}: ${row.final} ≥ floor ${row.floor} (${row.basis}, order share ${row.shareRule})`).toBeGreaterThanOrEqual(row.floor);
  expect(totals.afterAllDiscounts, "totals: the cart after all discounts ≥ Σ floors").toBeGreaterThanOrEqual(totals.floors);
  return { rows, totals };
}

const numericId = (gid: string) => gid.slice(gid.lastIndexOf("/") + 1);

/**
 * The live function payload and product refs as the app reads them: margin on
 * (m 25, global p 30, costs in the shop currency), the automatic rule on
 * simple-a, simple-b and spare, both codes; Pro: the collection override as
 * `col` {<numeric id>: [null, 10]} and simple-b's `marginRefs` = that id — the
 * only product that carries it.
 */
function expectLivePayload(inputs: MarginInputs): { collectionId: string | null } {
  const rules = inputs.config.modules.codes.rules;
  expect(rules.map((r) => r.id), "the live shop config carries the margin seed").toEqual(expect.arrayContaining(MARGIN_RULE_IDS));
  for (const handle of MARGIN_HANDLES) {
    expect(inputs.refsByProductId[inputs.productIdByHandle[handle]!]?.ruleIds ?? [], `${handle} is targeted by the automatic rule`).toContain(MARGIN_AUTO_RULE_ID);
  }
  const collectionGid = inputs.collectionIdByHandle[MARGIN_COLLECTION_HANDLE] ?? null;
  const refsOf = (handle: string) => (inputs.refsByProductId[inputs.productIdByHandle[handle]!] as { marginRefs?: string[] } | undefined)?.marginRefs;
  if (!PRO) {
    expect(inputs.config.modules.margin, "live payload: margin on, m 25, p 30, costs in the shop currency").toEqual({
      enabled: true,
      min: MARGIN_MIN_MARGIN_PERCENT,
      max: MARGIN_MAX_DISCOUNT_PERCENT,
      cur: inputs.shopCurrency,
    });
    for (const handle of MARGIN_CART_HANDLES) expect(refsOf(handle), `${handle}: no marginRefs (no collection setting)`).toBeUndefined();
    return { collectionId: null };
  }
  expect(collectionGid, `the test collection ${MARGIN_COLLECTION_HANDLE} exists (margin-collection.mjs --live)`).not.toBeNull();
  const key = numericId(collectionGid!);
  expect(inputs.config.modules.margin, "live payload (Pro): global m 25 / p 30 unchanged, the collection override as col").toEqual({
    enabled: true,
    min: MARGIN_MIN_MARGIN_PERCENT,
    max: MARGIN_MAX_DISCOUNT_PERCENT,
    cur: inputs.shopCurrency,
    col: { [key]: [null, MARGIN_COLLECTION_MAX_DISCOUNT_PERCENT] },
  });
  for (const handle of MARGIN_CART_HANDLES) {
    const want = handle === MARGIN_COLLECTION_MEMBER_HANDLE ? [key] : undefined;
    expect(refsOf(handle), `${handle}: marginRefs ${want ? `= [${key}] (in ${MARGIN_COLLECTION_HANDLE})` : "absent"}`).toEqual(want);
  }
  return { collectionId: collectionGid };
}

/** The catalog's shop-currency (CZK since 2026-09-30) price of a cart line's variant (the seeds never change prices). */
function shopPriceOf(handle: string, item: CartItem): number | null {
  const product = (WON_E2E_PRODUCT_LIST as readonly { handle: string; variants: { price: string; options?: Record<string, string> }[] }[]).find(
    (p) => p.handle === handle,
  );
  if (!product) return null;
  const variant =
    product.variants.length === 1 ? product.variants[0] : product.variants.find((v) => Object.values(v.options ?? {}).join(" / ") === (item.variant_title ?? ""));
  return variant ? Number(variant.price) : null;
}

/**
 * F-M1 / F-M2 / parity checks on the logged runs of this cart; returns their
 * evidence. F-M1 compares the rate with the cart / shop-currency price ratio
 * of a line that is converted, not priced by a price list (won-e2e-spare has a
 * fixed 199 Kč in cesko); of those the dearest (the least rounding error). In
 * the shop currency (cesko) the rate is exactly 1 and has no direction to check.
 */
function checkRuns(runs: readonly FunctionRun[], cart: Cart, inputs: MarginInputs, a: Analysis) {
  const rate = rateOf(runs);
  expect(inputs.shopCurrency, "the dev store's base currency (since 2026-09-30)").toBe("CZK");
  const reference = a.lines
    .filter((l) => l.handle !== MARGIN_SPARE_HANDLE && shopPriceOf(l.handle, l.item) !== null)
    .sort((x, y) => shopPriceOf(y.handle, y.item)! - shopPriceOf(x.handle, x.item)!)[0]!;
  const shopPrice = shopPriceOf(reference.handle, reference.item)!;
  const priceRatio = reference.item.original_price / Math.round(shopPrice * 100);
  const tolerance = RATE_TOLERANCE[a.country];
  if (a.currency === inputs.shopCurrency) {
    expect(rate.value, `F-M1: the cart is in the shop currency (${a.currency}): rate ${rate.raw} = 1`).toBe(1);
    expect(priceRatio, `${reference.handle}: the cart price is the shop price`).toBe(1);
  } else {
    expect(Math.abs(rate.value! / priceRatio - 1), `F-M1: rate ${rate.raw} ≈ ${reference.handle} ${a.currency}/${inputs.shopCurrency} price ratio ${priceRatio}`).toBeLessThan(tolerance);
    expect(Math.abs(1 / rate.value! / priceRatio - 1), `F-M1 direction: shop ${inputs.shopCurrency} → ${a.currency}, not the inverse`).toBeGreaterThan(tolerance);
  }
  for (const run of runs) {
    // F-M2: wonVariant per line = the variant metafield (null where the mirror wrote none).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const line of (run.input?.cart?.lines ?? []) as any[]) {
      const variant = String(line.merchandise?.id ?? "");
      const want = inputs.costByVariantId[variant] ?? null;
      expect(line.merchandise?.wonVariant === undefined, `${run.file}: the input query selects wonVariant`).toBe(false);
      expect(line.merchandise?.wonVariant?.jsonValue ?? null, `F-M2 ${inputs.variantLabel[variant]}: wonVariant in the function input`).toEqual(want);
      const handle = (inputs.variantLabel[variant] ?? "").split(" · ")[0]!;
      const refs = inputs.refsByProductId[inputs.productIdByHandle[handle] ?? ""] as { marginRefs?: string[] } | undefined;
      expect(line.merchandise?.product?.wonProduct?.jsonValue?.marginRefs, `${run.file} ${handle}: marginRefs in the function input`).toEqual(refs?.marginRefs);
    }
    // The function read the payload the app wrote (margin with col on Pro).
    expect(run.input?.shop?.config?.jsonValue?.modules?.margin, `${run.file}: the function read the live margin payload`).toEqual(inputs.config.modules.margin);
    // The logged output is exactly what the function's oracle computes from the logged input.
    expect(run.output, `${run.file}: logged output = reference-adapter runCartLines(logged input)`).toEqual(oracleFor(run).output);
  }
  // The plan from the logged input (adaptInput, as the function reads it) = the plan from /cart.js + the live metafields.
  const logged = runs[runs.length - 1]!;
  const { adapted } = oracleFor(logged);
  const fromLog = planCart(adapted.cart, adapted.config as PlanConfig);
  const byVariant = (plan: CartPlan) => Object.fromEntries(plan.lines.map((l) => [l.variantId, l.product?.amount ?? 0]));
  expect(byVariant(fromLog), "per-line product discounts: plan from the logged input = plan from /cart.js").toEqual(byVariant(a.plan));
  expect(fromLog.totals, "totals: plan from the logged input = plan from /cart.js").toEqual(a.plan.totals);
  expect(fromLog.order?.amount ?? 0, "order discount: plan from the logged input = plan from /cart.js").toBe(a.plan.order?.amount ?? 0);
  expect(adapted.cart.shopToCartRate, "the rate the plan used is the logged one").toBe(a.rate);
  return {
    rate,
    currency: a.currency,
    priceRatio: { handle: reference.handle, shopCurrency: inputs.shopCurrency, shopPrice, cartPrice: reference.item.original_price, ratio: priceRatio },
    rateToPriceRatio: rate.value! / priceRatio,
    wonVariantByLine: runSummary(logged).lines.map((l) => ({ variant: l.variant, label: inputs.variantLabel[l.variant ?? ""] ?? null, wonVariant: l.wonVariant })),
    oracleParityRuns: runs.length,
  };
}

function checkoutLineFor(lines: readonly CheckoutLine[], item: CartItem): CheckoutLine {
  const title = (item.product_title ?? "").trim();
  const line = lines.find((l) => l.title.trim() === title) ?? lines.find((l) => title !== "" && l.title.includes(title));
  expect(line, `checkout line "${title}" among ${JSON.stringify(lines.map((l) => l.title))}`).toBeDefined();
  return line!;
}

function lineEvidence(a: Analysis, codeRuleId: string) {
  const out = emitted(a, codeRuleId);
  return a.lines.map((l) => ({
    handle: l.handle,
    variantId: l.variantId,
    quantity: l.item.quantity,
    unitPrice: l.item.original_price,
    cost: l.cost,
    floorUnit: l.floorUnit,
    basis: l.basis,
    settings: l.settings,
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

/** /cart.js = the plan: product allocations (margin-capped lines as exact amounts), the code as an exact order amount, totals. */
function expectCartMatchesPlan(cart: Cart, a: Analysis, code: string, codeRuleId: string): void {
  const out = emitted(a, codeRuleId);
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
      expect(Math.round(Number(allocation.discount_application.value) * 100), `${l.handle}: the exact amount`).toBe(toMinorUnits(candidate.value.fixedAmount.amount, a.currency));
    }
    expect(l.item.final_line_price, `${l.handle}: at its floor`).toBe(l.floorUnit * l.item.quantity);
  }
  expect(cart.discount_codes).toEqual([{ code, applicable: true }]);
  expect(a.plan.codes[0]?.state, "planCart: the code applies").toBe("applied");
  expect(cart.cart_level_discount_applications).toHaveLength(1);
  const order = cart.cart_level_discount_applications[0]!;
  expect(order.value_type, "margin on: never a percent").toBe("fixed_amount");
  expect(Math.round(Number(order.value) * 100), "the exact amount = planCart").toBe(a.plan.order?.amount);
  expect(order.total_allocated_amount, "order discount = planCart").toBe(a.plan.order?.amount);
  expect(out.orderMinor).toBe(a.plan.order?.amount);
  expect(cart.items_subtotal_price, "subtotal after the product discounts = planCart").toBe(a.plan.totals.subtotal - a.plan.totals.productDiscount);
  expect(cart.total_price, "cart total = planCart").toBe(a.plan.totals.total);
}

/** How the checkout prints each cart currency ("1 279,35 Kč" / "8,60 €" / "€8.60" / "CZK …"). */
const CURRENCY_MARK: Record<string, RegExp> = { CZK: /(Kč|CZK)/u, EUR: /(€|EUR)/u };

/** A tax row the total already includes ("Včetně/Vrátane/Including … DPH"), vs one added on top. */
const INCLUDED_TAX = /(včetně|vrátane|including|incl\.?)/iu;

interface ThankYou {
  rows: SummaryRow[];
  lines: CheckoutLine[];
  shipping: number | null;
  /** Tax rows added on top of the total (included-tax rows are listed, not added). */
  tax: number;
  includedTaxRows: SummaryRow[];
  settled: { charged: number | null; payFormGone: boolean };
}

/**
 * Checkout from the theme-dev cart: open it (the cart's code is re-entered when
 * the theme-dev session split did not carry it), compare it with the cart,
 * ship to `address`, pay with Bogus, read the settled thank-you page.
 */
async function checkoutWithBogus(page: import("@playwright/test").Page, cart: Cart, code: string, address: ShippingAddress, lines: readonly Line[]) {
  let codeCarriedIntoCheckout = true;
  let openedInCartCurrency = true;
  const checkoutAt = Date.now();
  await test.step("open checkout; its lines and summary equal the cart", async () => {
    await openCheckout(page);
    if (rowAmount(await priceSummary(page), code) === null) {
      codeCarriedIntoCheckout = false; // the theme-dev session split (checkout.mvp1.spec.ts header)
      await applyCodeInCheckout(page, code);
    }
    console.log(`[checkout.margin] ${THEME_LABEL || "theme"}: ${code} ${codeCarriedIntoCheckout ? "carried from the cart" : "re-entered in checkout"}`);
    const rows = await priceSummary(page);
    const totalText = rows.find((r) => TOTAL.test(r.label))?.value ?? "";
    if (!CURRENCY_MARK[cart.currency]!.test(totalText)) {
      // The buyer session opened the checkout in another market (the cart's
      // localization did not travel from the theme-dev session); the shipping
      // address below moves it to the right one. Compared on the thank-you page.
      console.log(`[checkout.margin] ${THEME_LABEL || "theme"}: checkout opened in another currency than the ${cart.currency} cart ("${totalText}"); compared after the address`);
      openedInCartCurrency = false;
      return;
    }
    const checkout = await checkoutLines(page);
    for (const l of lines) {
      const line = checkoutLineFor(checkout, l.item);
      expect(line.allocations.map((al) => al.amount), `checkout ${l.handle}: line discount = cart`).toEqual(l.item.line_level_discount_allocations.map((al) => -al.amount));
    }
    expect(rowAmount(rows, SUBTOTAL), "checkout subtotal = cart items_subtotal_price").toBe(cart.items_subtotal_price);
    expect(rowAmount(rows, code), "checkout order discount = cart").toBe(-(cart.cart_level_discount_applications[0]?.total_allocated_amount ?? 0));
    expect(rowAmount(rows, TOTAL), "checkout total before shipping = cart total").toBe(cart.total_price);
  });
  await test.step(`contact, ${address.countryCode} address, first shipping rate`, () => fillShippingAddress(page, address, EMAIL));
  await test.step("pay with the Bogus gateway (card 1): margin protection never blocks", () => payWithBogusCard(page));
  const thankYou = await test.step("thank-you page: read the order", async (): Promise<ThankYou> => {
    const settled = await settledThankYou(page);
    expect(settled.payFormGone, "the payment form is gone before the thank-you page is read").toBe(true);
    const rows = await priceSummary(page);
    const checkout = await checkoutLines(page);
    const taxRows = rows.filter((r) => TAX.test(r.label));
    const includedTaxRows = taxRows.filter((r) => INCLUDED_TAX.test(r.label));
    const tax = taxRows.filter((r) => !includedTaxRows.includes(r)).reduce((sum, r) => sum + (r.amount ?? 0), 0);
    return { rows, lines: checkout, shipping: rowAmount(rows, SHIPPING), tax, includedTaxRows, settled };
  });
  return { codeCarriedIntoCheckout, openedInCartCurrency, checkoutAt, thankYou };
}

/**
 * The runs of THIS checkout. Observed 2026-09-29 (Horizon, 16:18:50–16:19:40Z):
 * a checkout that applied the function's discounts (thank-you page = plan) left
 * NO run in the app dev log stream, while the checkouts before and after it
 * did. Then the rate comes from this cart's own runs seconds earlier (same
 * lines, same code, same live rate) and the evidence says so.
 */
async function checkoutRuns(filter: Parameters<typeof waitForRuns>[0], cartRuns: FunctionRun[]) {
  try {
    return { runs: await waitForRuns(filter, { timeoutMs: 90_000, settleMs: 8_000 }), logged: true };
  } catch (error) {
    console.log(`[checkout.margin] ${THEME_LABEL || "theme"}: no function run of this checkout was logged (${(error as Error).message}); using this cart's ${cartRuns.length} run(s)`);
    return { runs: cartRuns, logged: false };
  }
}

/** Thank-you page = plan: per line (allocations, prices), order discount, total, the charged card. */
function expectThankYouMatchesPlan(t: ThankYou, a: Analysis, code: string, codeRuleId: string, lineCount: number) {
  const out = emitted(a, codeRuleId);
  const perLine = a.lines.map((l) => {
    const line = checkoutLineFor(t.lines, l.item);
    return { handle: l.handle, allocations: line.allocations, originalPrice: line.originalPrice, finalPrice: line.finalPrice };
  });
  expect(t.lines, "one order line per cart line").toHaveLength(lineCount);
  for (const l of a.lines) {
    const o = perLine.find((p) => p.handle === l.handle)!;
    const planned = l.planLine.product?.amount ?? 0;
    if (planned > 0) {
      expect(o.allocations.map((al) => [al.title.toUpperCase(), al.amount]), `thank-you ${l.handle}: line discount = planCart`).toEqual([[MARGIN_AUTO_RULE_NAME.toUpperCase(), -planned]]);
      expect(o.originalPrice, `thank-you ${l.handle}: original price = cart`).toBe(l.planLine.subtotal);
    } else {
      expect(o.allocations, `thank-you ${l.handle}: no line discount`).toEqual([]);
    }
    expect(o.finalPrice, `thank-you ${l.handle}: price after the line discount = planCart`).toBe(l.planLine.subtotal - planned);
  }
  const subtotal = rowAmount(t.rows, SUBTOTAL);
  const orderDiscount = rowAmount(t.rows, code);
  const total = rowAmount(t.rows, TOTAL);
  expect(subtotal, "thank-you subtotal = planCart (after product discounts)").toBe(a.plan.totals.subtotal - a.plan.totals.productDiscount);
  expect(orderDiscount, `thank-you order discount (${code}) = planCart`).toBe(-(a.plan.order?.amount ?? 0));
  expect(out.orderMinor, "sent as that exact amount").toBe(a.plan.order?.amount);
  expect(t.shipping, "shipping amount").not.toBeNull();
  expect(total, "thank-you total = planCart + shipping + tax").toBe(a.plan.totals.total + (t.shipping ?? 0) + t.tax);
  expect(t.settled.charged, "the card was charged the thank-you total").toBe(total);
  return { perLine, subtotal, orderDiscount, shipping: t.shipping, tax: t.tax, includedTaxRows: t.includedTaxRows, total, charged: t.settled.charged };
}

async function screenshots(page: import("@playwright/test").Page, testInfo: import("@playwright/test").TestInfo, name: string) {
  await saveScreenshot(page, testInfo, named(`${name}-1440`));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1_000);
  await expandMobileSummary(page);
  await saveScreenshot(page, testInfo, named(`${name}-390`));
}

const variantIdsOf = (cart: Cart) => cart.items.map((i) => `gid://shopify/ProductVariant/${i.variant_id}`);

test.describe(`Won Discounts margin protection in cart and checkout (MVP 2)${PRO ? " [Pro: collection override]" : ""}${THEME_LABEL ? ` — ${THEME_LABEL}` : ""}`, () => {
  test.skip(
    E2E_PROFILE !== "margin" && E2E_PROFILE !== "margin-pro",
    `WON_E2E_PROFILE=${E2E_PROFILE}: this spec needs the margin seed (seed-mvp1.mjs --profile margin|margin-pro --live + margin-costs.mjs --live) and WON_E2E_PROFILE=margin|margin-pro`,
  );

  test.afterEach(async ({ page, baseURL }) => {
    if (page.url().startsWith(new URL(baseURL!).origin)) await clearCartQuietly(page);
  });

  const bLabel = PRO ? `simple-b to its collection's ${MARGIN_COLLECTION_MAX_DISCOUNT_PERCENT} %` : `simple-b to ${MARGIN_MAX_DISCOUNT_PERCENT} %`;
  test(`cart: simple-a to its cost floor, ${bLabel}, spare to ${MARGIN_MAX_DISCOUNT_PERCENT} %, Small none, WONE2EM20 applicable as an exact amount = planCart with the logged rate`, async ({ page }, testInfo) => {
    test.setTimeout(300_000);
    const inputs = await readMarginInputs(MARGIN_CART_HANDLES, [MARGIN_COLLECTION_HANDLE]);
    const payload = expectLivePayload(inputs);

    const response = await page.goto(`/products/${MARGIN_PRODUCT_A_HANDLE}`, { waitUntil: "load" });
    expect(response?.status()).toBeLessThan(400);

    const cartAt = Date.now();
    const cart = await freshCartOfVariants(page, MARGIN_CART, [MARGIN_CODE]);
    expect(cart.currency).toBe("CZK");
    expect(cart.items).toHaveLength(MARGIN_CART.length);
    const runs = await test.step("the function runs of this cart (shopify app dev logs): presentmentCurrencyRate", () =>
      waitForRuns({ sinceMs: cartAt - 1_000, variantIds: variantIdsOf(cart), currency: "CZK", code: MARGIN_CODE }),
    );
    const rate = rateOf(runs);
    const a = analyse(cart, inputs, rate.value!, "CZ");

    await test.step(`(a) planCart with rate ${rate.raw}: floors, caps (spare = the control line) and the order discount`, () => expectMainPlan(a));
    const runEvidence = await test.step("(b) F-M1 rate, F-M2 wonVariant, logged output = oracle", () => checkRuns(runs, cart, inputs, a));
    await test.step("(c) /cart.js = planCart: product allocations as exact amounts, WONE2EM20 an exact order amount", () =>
      expectCartMatchesPlan(cart, a, MARGIN_CODE, MARGIN_CODE_RULE_ID),
    );
    const logged = loggedOrder(runs, "CZK");
    const inv = await test.step("(d) invariant: no line below its floor after all discounts (the function's actual exclusions)", async () => {
      expect(logged.amount, "logged order candidate = planCart").toBe(a.plan.order?.amount);
      expect(logged.excludedVariants, "logged order candidate leaves out simple-a, simple-b and spare").toEqual(
        [MARGIN_PRODUCT_A_HANDLE, MARGIN_PRODUCT_B_HANDLE, MARGIN_SPARE_HANDLE].map((h) => a.byHandle(h).variantId).sort(),
      );
      return invariant(a.lines, (l) => l.item.final_line_price, cart.cart_level_discount_applications[0]!.total_allocated_amount, logged.excludedVariants);
    });

    await saveEvidence(testInfo, named("cart-margin"), {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      profile: E2E_PROFILE,
      collection: payload.collectionId,
      livePayloadMargin: inputs.config.modules.margin,
      currency: cart.currency,
      presentmentCurrencyRate: rate,
      fM1: runEvidence,
      lines: lineEvidence(a, MARGIN_CODE_RULE_ID),
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
    await saveEvidence(testInfo, named("function-runs-cart-margin"), runs.map(runSummary));
  });

  test("checkout (Bogus): margin never blocks; the thank-you page charges planCart with the checkout's logged rate, no line below its floor", async ({ page }, testInfo) => {
    test.setTimeout(480_000);
    const inputs = await readMarginInputs(MARGIN_CART_HANDLES, [MARGIN_COLLECTION_HANDLE]);
    const payload = expectLivePayload(inputs);
    await page.setViewportSize({ width: 1440, height: 900 });

    await unlockRealStorefront(page);
    const response = await page.goto(`/products/${MARGIN_PRODUCT_A_HANDLE}`, { waitUntil: "load" });
    expect(response?.status()).toBeLessThan(400);

    const cartAt = Date.now();
    const cart = await freshCartOfVariants(page, MARGIN_CART, [MARGIN_CODE]);
    const variantIds = variantIdsOf(cart);
    const cartRuns = await waitForRuns({ sinceMs: cartAt - 1_000, variantIds, currency: "CZK", code: MARGIN_CODE });
    const before = analyse(cart, inputs, rateOf(cartRuns).value!, "CZ");
    expect(cart.discount_codes[0]).toEqual({ code: MARGIN_CODE, applicable: true });
    expect(cart.total_price, "cart total = planCart").toBe(before.plan.totals.total);

    const { codeCarriedIntoCheckout, checkoutAt, thankYou } = await checkoutWithBogus(page, cart, MARGIN_CODE, CZECH_ADDRESS, before.lines);

    const { runs, logged: checkoutRunsLogged } = await test.step("the function runs of THIS checkout (shopify app dev logs): presentmentCurrencyRate", () =>
      checkoutRuns({ sinceMs: checkoutAt, variantIds, currency: "CZK", code: MARGIN_CODE }, cartRuns),
    );
    const rate = rateOf(runs);
    const a = analyse(cart, inputs, rate.value!, "CZ");
    await test.step(`planCart with the checkout's rate ${rate.raw}`, () => expectMainPlan(a));
    const runEvidence = await test.step("F-M1 rate, F-M2 wonVariant, logged output = oracle (checkout runs)", () => checkRuns(runs, cart, inputs, a));
    const observed = await test.step("thank-you page = planCart: line discounts, order discount, total, charged", () =>
      expectThankYouMatchesPlan(thankYou, a, MARGIN_CODE, MARGIN_CODE_RULE_ID, cart.items.length),
    );
    const logged = loggedOrder(runs, "CZK");
    const inv = await test.step("invariant on the thank-you page: no line below its floor after all discounts", async () => {
      expect(logged.amount, "logged order candidate = planCart").toBe(a.plan.order?.amount);
      expect(logged.excludedVariants, "logged order candidate leaves out simple-a, simple-b and spare").toEqual(
        [MARGIN_PRODUCT_A_HANDLE, MARGIN_PRODUCT_B_HANDLE, MARGIN_SPARE_HANDLE].map((h) => a.byHandle(h).variantId).sort(),
      );
      const finalOf = (l: Line) => observed.perLine.find((p) => p.handle === l.handle)!.finalPrice ?? Number.NaN;
      return invariant(a.lines, finalOf, -(observed.orderDiscount ?? 0), logged.excludedVariants);
    });

    await screenshots(page, testInfo, "thankyou-margin");
    await saveEvidence(testInfo, named("checkout-margin"), {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      profile: E2E_PROFILE,
      collection: payload.collectionId,
      livePayloadMargin: inputs.config.modules.margin,
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
      lines: lineEvidence(a, MARGIN_CODE_RULE_ID),
      plan: { totals: a.plan.totals, order: a.plan.order, rules: a.plan.rules.map((r) => ({ ruleId: r.ruleId, state: r.state, amount: r.amount })) },
      thankYou: { ...observed, expectedTotal: a.plan.totals.total + (observed.shipping ?? 0) + observed.tax },
      thankYouSummaryRows: thankYou.rows,
      loggedOrder: logged,
      invariant: inv,
    });
    await saveEvidence(testInfo, named("function-runs-checkout-margin"), { checkoutRunsLogged, sinceCheckoutOpened: new Date(checkoutAt).toISOString(), runs: runs.map(runSummary) });
  });

  test(`order discount lowered by margin (${MARGIN_ORDER_CAP_CODE}): Small + multiaxis, the exact D_max over both lines; cart and Bogus checkout = planCart, no line below its floor`, async ({ page }, testInfo) => {
    test.setTimeout(480_000);
    const inputs = await readMarginInputs(MARGIN_CART_HANDLES, [MARGIN_COLLECTION_HANDLE]);
    const payload = expectLivePayload(inputs);
    await page.setViewportSize({ width: 1440, height: 900 });

    await unlockRealStorefront(page);
    const response = await page.goto(`/products/${MARGIN_MULTIAXIS_HANDLE}`, { waitUntil: "load" });
    expect(response?.status()).toBeLessThan(400);

    const cartAt = Date.now();
    const cart = await freshCartOfVariants(page, MARGIN_ORDER_CAP_CART, [MARGIN_ORDER_CAP_CODE]);
    expect(cart.currency).toBe("CZK");
    expect(cart.items).toHaveLength(MARGIN_ORDER_CAP_CART.length);
    const variantIds = variantIdsOf(cart);
    const cartRuns = await test.step("the function runs of this cart: presentmentCurrencyRate", () =>
      waitForRuns({ sinceMs: cartAt - 1_000, variantIds, currency: "CZK", code: MARGIN_ORDER_CAP_CODE }),
    );
    const before = analyse(cart, inputs, rateOf(cartRuns).value!, "CZ");
    const cap = await test.step("(a) planCart: 60 % is more than the floors allow → D_max over both lines", () => expectOrderCapPlan(before));
    await test.step("(b) F-M1, F-M2, logged output = oracle (cart runs)", () => checkRuns(cartRuns, cart, inputs, before));
    await test.step(`(c) /cart.js = planCart: ${MARGIN_ORDER_CAP_CODE} applicable as the exact lowered amount`, () =>
      expectCartMatchesPlan(cart, before, MARGIN_ORDER_CAP_CODE, MARGIN_ORDER_CAP_RULE_ID),
    );
    const cartLogged = loggedOrder(cartRuns, "CZK");
    expect(cartLogged.excludedVariants, "logged order candidate leaves out no line").toEqual([]);
    expect(cartLogged.amount, "logged order candidate = D_max").toBe(cap.dMax);

    const { codeCarriedIntoCheckout, checkoutAt, thankYou } = await checkoutWithBogus(page, cart, MARGIN_ORDER_CAP_CODE, CZECH_ADDRESS, before.lines);
    const { runs, logged: checkoutRunsLogged } = await test.step("the function runs of THIS checkout: presentmentCurrencyRate", () =>
      checkoutRuns({ sinceMs: checkoutAt, variantIds, currency: "CZK", code: MARGIN_ORDER_CAP_CODE }, cartRuns),
    );
    const rate = rateOf(runs);
    const a = analyse(cart, inputs, rate.value!, "CZ");
    const checkoutCap = await test.step(`planCart with the checkout's rate ${rate.raw}`, () => expectOrderCapPlan(a));
    const runEvidence = await test.step("F-M1, F-M2, logged output = oracle (checkout runs)", () => checkRuns(runs, cart, inputs, a));
    const observed = await test.step("thank-you page = planCart", () => expectThankYouMatchesPlan(thankYou, a, MARGIN_ORDER_CAP_CODE, MARGIN_ORDER_CAP_RULE_ID, cart.items.length));
    const logged = loggedOrder(runs, "CZK");
    const inv = await test.step("invariant: totals exact, each line above its floor under a proportional split rounded up", async () => {
      expect(logged.amount, "logged order candidate = planCart").toBe(a.plan.order?.amount);
      expect(logged.excludedVariants, "logged order candidate leaves out no line").toEqual([]);
      const finalOf = (l: Line) => observed.perLine.find((p) => p.handle === l.handle)!.finalPrice ?? Number.NaN;
      return invariant(a.lines, finalOf, -(observed.orderDiscount ?? 0), logged.excludedVariants);
    });

    await screenshots(page, testInfo, "thankyou-order-cap-margin");
    await saveEvidence(testInfo, named("order-cap-margin"), {
      at: new Date().toISOString(),
      theme: THEME_LABEL || null,
      profile: E2E_PROFILE,
      collection: payload.collectionId,
      code: MARGIN_ORDER_CAP_CODE,
      codeCarriedIntoCheckout,
      checkoutRunsLogged,
      presentmentCurrencyRate: { checkout: rate, cartBeforeCheckout: rateOf(cartRuns) },
      orderCap: { cart: cap, checkout: checkoutCap },
      fM1: runEvidence,
      cart: {
        currency: cart.currency,
        items_subtotal_price: cart.items_subtotal_price,
        total_price: cart.total_price,
        discount_codes: cart.discount_codes,
        cart_level: cart.cart_level_discount_applications,
        // As /cart.js returns them: whether Shopify exposes a per-line share of the order discount anywhere.
        rawItems: cart.items,
      },
      lines: lineEvidence(a, MARGIN_ORDER_CAP_RULE_ID),
      plan: { totals: a.plan.totals, order: a.plan.order },
      thankYou: { ...observed, expectedTotal: a.plan.totals.total + (observed.shipping ?? 0) + observed.tax },
      thankYouSummaryRows: thankYou.rows,
      loggedOrder: logged,
      invariant: inv,
      perLineAllocation:
        "not observable: the checkout shows an order discount only as a summary row, and orders need read_orders (the app has none); the per-line invariant assumes Shopify's proportional split rounded up",
    });
    await saveEvidence(testInfo, named("function-runs-order-cap-margin"), { checkoutRunsLogged, cartRuns: cartRuns.map(runSummary), checkoutRuns: runs.map(runSummary) });
  });

  test("slovensko (EUR): the main cart with WONE2EM20 — F-M1 for EUR, cart and Bogus checkout to Bratislava = planCart, no line below its floor", async ({ page, baseURL }, testInfo) => {
    test.setTimeout(480_000);
    const inputs = await readMarginInputs(MARGIN_CART_HANDLES, [MARGIN_COLLECTION_HANDLE]);
    const payload = expectLivePayload(inputs);
    await page.setViewportSize({ width: 1440, height: 900 });

    await unlockRealStorefront(page);
    const response = await page.goto(`/products/${MARGIN_PRODUCT_A_HANDLE}`, { waitUntil: "load" });
    expect(response?.status()).toBeLessThan(400);
    try {
      const localization = await test.step("switch the storefront to Slovakia (?country=SK)", () => setStorefrontCountry(page, "SK"));
      console.log(`[checkout.margin] ${THEME_LABEL || "theme"}: after ?country=SK: country ${localization.country}, currency ${localization.currency}`);
      expect(localization.country, "the storefront session is in Slovakia after ?country=SK").toBe("SK");
      // PRECONDITION (store setup, not the app): every product of the cart is
      // for sale in the slovensko market. Observed 2026-09-30 (MVP 2 final
      // gate): the market sold NOTHING (evidence/mvp2/e2e-final-A/sk-probe) and
      // the scenario was skipped as blocked. Ondřej added shipping to SK the
      // same day (MVP 3), so the scenario MUST run: an unavailable product now
      // fails the test with this reason (never a skip, never a pass).
      const unavailable = await test.step("precondition: every product of the cart is for sale in the slovensko market", async () => {
        const out: string[] = [];
        for (const { handle, option } of MARGIN_CART) {
          const product = await storefrontJson<{ available: boolean; variants: { title: string; available: boolean; options?: string[] }[] }>(page, "GET", `/products/${handle}.js`);
          const variant = option ? product.variants.find((v) => (v.options ?? []).includes(option) || v.title === option) : product.variants[0];
          if (!(variant?.available ?? false)) out.push(`${handle}${option ? ` (${option})` : ""}`);
        }
        return out;
      });
      if (unavailable.length > 0) {
        const reason = `store setup: the slovensko market does not sell ${unavailable.join(", ")} (available: false with country SK; /cart/add.js would answer 422 "vyprodán"). Enable selling in SK (shipping zone / market) and rerun.`;
        await saveEvidence(testInfo, named("sk-margin-blocked"), {
          at: new Date().toISOString(),
          theme: THEME_LABEL || null,
          profile: E2E_PROFILE,
          localization,
          unavailableInSk: unavailable,
          status: "failed (store setup)",
          reason,
        });
      }
      expect(unavailable, "every product of the cart is for sale in the slovensko market (store setup, not the app)").toEqual([]);

      const cartAt = Date.now();
      const cart = await freshCartOfVariants(page, MARGIN_CART, [MARGIN_CODE]);
      expect(cart.currency, `the cart is in the slovensko market's currency (window.Shopify: ${JSON.stringify(localization)})`).toBe(CURRENCY_OF.SK);
      expect(cart.items).toHaveLength(MARGIN_CART.length);
      const variantIds = variantIdsOf(cart);
      const cartRuns = await test.step("the function runs of this EUR cart: presentmentCurrencyRate", () =>
        waitForRuns({ sinceMs: cartAt - 1_000, variantIds, currency: CURRENCY_OF.SK, code: MARGIN_CODE }),
      );
      const before = analyse(cart, inputs, rateOf(cartRuns).value!, "SK");
      await test.step("(a) planCart in EUR: the same floors and caps", () => expectMainPlan(before));
      const cartEvidence = await test.step("(b) F-M1 for EUR, F-M2, logged output = oracle", () => checkRuns(cartRuns, cart, inputs, before));
      await test.step("(c) /cart.js = planCart", () => expectCartMatchesPlan(cart, before, MARGIN_CODE, MARGIN_CODE_RULE_ID));

      const { codeCarriedIntoCheckout, openedInCartCurrency, checkoutAt, thankYou } = await checkoutWithBogus(page, cart, MARGIN_CODE, SLOVAK_ADDRESS, before.lines);
      const { runs, logged: checkoutRunsLogged } = await test.step("the function runs of THIS checkout (EUR): presentmentCurrencyRate", () =>
        checkoutRuns({ sinceMs: checkoutAt, variantIds, currency: CURRENCY_OF.SK, code: MARGIN_CODE }, cartRuns),
      );
      const rate = rateOf(runs);
      const a = analyse(cart, inputs, rate.value!, "SK");
      await test.step(`planCart with the checkout's EUR rate ${rate.raw}`, () => expectMainPlan(a));
      const runEvidence = await test.step("F-M1 for EUR, F-M2, logged output = oracle (checkout runs)", () => checkRuns(runs, cart, inputs, a));
      const observed = await test.step("thank-you page (EUR) = planCart", () => expectThankYouMatchesPlan(thankYou, a, MARGIN_CODE, MARGIN_CODE_RULE_ID, cart.items.length));
      const logged = loggedOrder(runs, CURRENCY_OF.SK);
      const inv = await test.step("invariant on the thank-you page (EUR)", async () => {
        expect(logged.amount, "logged order candidate = planCart").toBe(a.plan.order?.amount);
        const finalOf = (l: Line) => observed.perLine.find((p) => p.handle === l.handle)!.finalPrice ?? Number.NaN;
        return invariant(a.lines, finalOf, -(observed.orderDiscount ?? 0), logged.excludedVariants);
      });

      await screenshots(page, testInfo, "thankyou-sk-margin");
      await saveEvidence(testInfo, named("sk-margin"), {
        at: new Date().toISOString(),
        theme: THEME_LABEL || null,
        profile: E2E_PROFILE,
        collection: payload.collectionId,
        localization,
        codeCarriedIntoCheckout,
        checkoutOpenedInCartCurrency: openedInCartCurrency,
        checkoutRunsLogged,
        presentmentCurrencyRate: { checkout: rate, cartBeforeCheckout: rateOf(cartRuns) },
        fM1: { cart: cartEvidence, checkout: runEvidence },
        cart: {
          currency: cart.currency,
          items_subtotal_price: cart.items_subtotal_price,
          total_price: cart.total_price,
          discount_codes: cart.discount_codes,
          cart_level: cart.cart_level_discount_applications,
        },
        lines: lineEvidence(a, MARGIN_CODE_RULE_ID),
        plan: { totals: a.plan.totals, order: a.plan.order },
        thankYou: { ...observed, expectedTotal: a.plan.totals.total + (observed.shipping ?? 0) + observed.tax },
        thankYouSummaryRows: thankYou.rows,
        loggedOrder: logged,
        invariant: inv,
      });
      await saveEvidence(testInfo, named("function-runs-sk-margin"), { checkoutRunsLogged, cartRuns: cartRuns.map(runSummary), checkoutRuns: runs.map(runSummary) });
    } finally {
      // Back to Czechia for whatever runs next on this theme-dev origin (best effort).
      await page
        .goto(new URL(baseURL!).origin, { waitUntil: "load" })
        .then(() => setStorefrontCountry(page, "CZ"))
        .catch(() => undefined);
    }
  });
});
