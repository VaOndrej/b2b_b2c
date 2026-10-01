// Contract K4 v2 (audit MVP 3 P1-1 / P2-4): the variant `pdp` metafield is the
// item's FLOOR, not a percent — `{f, k}`: `f` = exactly the engine's
// `floorUnit` for a cart in the shop currency (minor units of the shop
// currency; independent of the price), `k` = marginKey of the gated margin
// settings + shop currency. The storefront config's `margin` carries the same
// `k` and the shop currency `cur`. The PDP then allows at most `price − floor`
// a item, the floor being `f` in the shop currency, else
// `ceil(f × rate × 10^exp / 10^exp_shop) + 1` minor unit; with `pdp` of another
// `k` it promises nothing (fail closed).

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig, type WonDiscountsConfig } from "../../src/discounts/config.ts";
import { buildShopFunctionConfig } from "../../src/discounts/function-payload.ts";
import { currencyExponent } from "../../src/discounts/money.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { buildStorefrontConfig, marginKey, pdpFloor, type PdpMetafieldValue } from "../../src/discounts/storefront-config.ts";
import { productMetafieldValue, productRuleIndex } from "../../src/discounts/targeting.ts";

const C = (n: number) => `gid://shopify/Collection/${n}`;
const P = (n: number) => `gid://shopify/Product/${n}`;
const OPTS = { now: "2026-10-01T12:00:00", shopTimezone: "Europe/Prague" };

function configOf(input: Record<string, unknown>): WonDiscountsConfig {
  return sanitizeConfig(input).config;
}

const MARGIN = {
  enabled: true,
  global: { minMarginPercent: 20, maxDiscountPercent: 40 },
  perCollection: [
    { collectionId: C(5), maxDiscountPercent: 10 },
    { collectionId: C(6), minMarginPercent: 30 },
  ],
};

test("pdpFloor: f = cost / (1 − minimum margin), rounded up to a minor unit — the engine's floor; k = the margin key", () => {
  const margin = configOf({ modules: { margin: MARGIN } }).modules.margin;
  const pdp: PdpMetafieldValue | null = pdpFloor({ unitCost: 600, costCurrency: "CZK", shopCurrency: "CZK", margin, collectionIds: [] });
  assert.deepEqual(pdp, { f: 750_00, k: marginKey(margin, "CZK") });
  // A collection with a stricter minimum (30 %): 600 / 0.7 = 857.142… → 857.15 Kč.
  assert.equal(pdpFloor({ unitCost: 600, costCurrency: "CZK", shopCurrency: "CZK", margin, collectionIds: [C(6)] })?.f, 857_15);
  assert.equal(pdpFloor({ unitCost: 600, costCurrency: "CZK", shopCurrency: "CZK", margin, collectionIds: ["6"] })?.f, 857_15);
  // JPY (exponent 0) and KWD (3).
  assert.equal(pdpFloor({ unitCost: 700, costCurrency: "JPY", shopCurrency: "JPY", margin, collectionIds: [] })?.f, 875);
  assert.equal(pdpFloor({ unitCost: 7.123, costCurrency: "KWD", shopCurrency: "KWD", margin, collectionIds: [] })?.f, 8904);
});

test("pdpFloor: null when protection is off or the cost is unusable (none, ≤ 0, another currency, wrong case)", () => {
  const margin = configOf({ modules: { margin: MARGIN } }).modules.margin;
  const base = { unitCost: 600, costCurrency: "CZK", shopCurrency: "CZK", margin, collectionIds: [] as string[] };
  assert.equal(pdpFloor({ ...base, margin: { ...margin, enabled: false } }), null);
  for (const unitCost of [undefined, null, 0, -5, Number.NaN]) assert.equal(pdpFloor({ ...base, unitCost }), null, String(unitCost));
  assert.equal(pdpFloor({ ...base, costCurrency: "EUR" }), null);
  assert.equal(pdpFloor({ ...base, costCurrency: "czk" }), null);
});

test("marginKey: changes with every floor-relevant setting and the shop currency, never with the order of collections", () => {
  const margin = configOf({ modules: { margin: MARGIN } }).modules.margin;
  const key = marginKey(margin, "CZK");
  assert.match(key, /^[0-9a-f]{8}$/);
  assert.equal(marginKey({ ...margin, perCollection: [...margin.perCollection].reverse() }, "CZK"), key);
  const variants = [
    { ...margin, enabled: false },
    { ...margin, global: { ...margin.global, minMarginPercent: 21 } },
    { ...margin, global: { maxDiscountPercent: 40 } },
    { ...margin, global: { ...margin.global, maxDiscountPercent: 41 } },
    { ...margin, perCollection: [margin.perCollection[0]] },
    { ...margin, perCollection: [{ ...margin.perCollection[0], maxDiscountPercent: 11 }, margin.perCollection[1]] },
    { ...margin, perCollection: [...margin.perCollection, { collectionId: C(7), minMarginPercent: 25 }] },
  ];
  const keys = new Set([key, ...variants.map((m) => marginKey(m, "CZK")), marginKey(margin, "EUR")]);
  assert.equal(keys.size, variants.length + 2, "every change is a new key");
  // Free folds the collections: another key, the one its storefront config carries.
  const free = gateConfigForPlan(configOf({ modules: { margin: MARGIN } }), "free").config;
  assert.notEqual(marginKey(free.modules.margin, "CZK"), key);
});

test("K5 + K4 v2: the storefront config's margin carries k and cur (given the shop currency); without it the fields are left out", () => {
  const config = configOf({ modules: { margin: MARGIN } });
  const built = buildStorefrontConfig(config, { configVersion: "v", shopCurrency: "CZK" });
  assert.deepEqual(built.margin, { on: true, max: 40, col: { "5": 10, "6": 40 }, k: marginKey(config.modules.margin, "CZK"), cur: "CZK" });
  assert.deepEqual(buildStorefrontConfig(config, { configVersion: "v" }).margin, { on: true, max: 40, col: { "5": 10, "6": 40 } });
  const off = configOf({ modules: { margin: { ...MARGIN, enabled: false } } });
  assert.deepEqual(buildStorefrontConfig(off, { configVersion: "v", shopCurrency: "CZK" }).margin, { on: false });
});

// --- properties ---------------------------------------------------------------------------------------

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const chance = (p: number) => next() < p;
  return { next, int, pick, chance };
}
type Rng = ReturnType<typeof rng>;

const CURRENCIES = ["CZK", "EUR", "JPY", "KWD", "HUF"];
const COLLECTIONS = [C(1), C(2), C(3), C(4)];

function randomMargin(r: Rng) {
  return {
    enabled: true,
    global: { ...(r.chance(0.7) ? { minMarginPercent: r.pick([0, 5, 12.5, 20, 33.3, 60, 95]) } : {}), maxDiscountPercent: r.pick([0, 10, 50, 100]) },
    perCollection: COLLECTIONS.filter(() => r.chance(0.4)).map((collectionId) => ({
      collectionId,
      ...(r.chance(0.6) ? { minMarginPercent: r.pick([0, 15, 25, 50, 90]) } : {}),
      ...(r.chance(0.5) ? { maxDiscountPercent: r.pick([5, 30, 90]) } : {}),
    })),
  };
}

/** A cost in MAJOR units of `currency` with its exponent's precision. */
const randomCost = (r: Rng, currency: string) => r.int(1, 2_000_000) / 10 ** currencyExponent(currency);

/** The engine's floorUnit of one item: a 100 % rule on the line, margin protection caps it at the floor. */
function engineFloor(config: WonDiscountsConfig, collectionIds: string[], unitCost: number, currency: string): number {
  const rule = { id: "all", name: "all", method: "automatic", value: { kind: "percentage", percent: 100 }, target: { kind: "collections", ids: COLLECTIONS } };
  const withRule = sanitizeConfig({ ...config, modules: { ...config.modules, codes: { rules: [rule] } } }).config;
  const entry = productMetafieldValue(productRuleIndex(withRule, [{ productId: P(1), variantIds: [], collectionIds }]).get(P(1))!);
  const payload = buildShopFunctionConfig(withRule, { ...OPTS, shopCurrency: currency }).payload;
  const plan = planCart(
    {
      currency,
      enteredCodes: [],
      today: "2026-10-01",
      lines: [
        {
          id: "L1",
          variantId: "gid://shopify/ProductVariant/1",
          productId: P(1),
          quantity: 1,
          unitPrice: 1e11,
          ruleIds: ["all"],
          ...(entry.marginRefs ? { marginRefs: entry.marginRefs } : {}),
          unitCost,
          unitCostCurrency: currency,
        },
      ],
    },
    payload,
  );
  return plan.lines[0].marginCapped?.floorUnit ?? 0;
}

test("property: f is EXACTLY the engine's floor in the shop currency — random costs, margins, collections, currencies, Pro and Free", () => {
  const r = rng(20261001);
  for (let n = 0; n < 1500; n++) {
    const currency = r.pick(CURRENCIES);
    const pro = configOf({ modules: { margin: randomMargin(r) } });
    const config = r.chance(0.3) ? gateConfigForPlan(pro, "free").config : pro;
    const collectionIds = COLLECTIONS.filter(() => r.chance(0.4));
    const unitCost = randomCost(r, currency);
    const pdp = pdpFloor({ unitCost, costCurrency: currency, shopCurrency: currency, margin: config.modules.margin, collectionIds });
    assert.ok(pdp, `case ${n}`);
    assert.equal(pdp.f, engineFloor(config, collectionIds, unitCost, currency), `case ${n}: ${currency} cost ${unitCost}`);
  }
});

/** K4 v2's PDP rule for one item, the floor converted to the cart currency (the storefront's JS). */
function pdpFloorInCart(f: number, shopCurrency: string, cartCurrency: string, rate: number): number {
  if (cartCurrency === shopCurrency) return f;
  return Math.ceil((f * rate * 10 ** currencyExponent(cartCurrency)) / 10 ** currencyExponent(shopCurrency)) + 1;
}

test("property: the K4 v2 PDP promise never exceeds checkout's margin-capped tier, in any market currency, rate and own price list", () => {
  const r = rng(20261003);
  let capped = 0;
  let foreign = 0;
  for (let n = 0; n < 2000; n++) {
    const shop = r.pick(CURRENCIES);
    const cart = r.chance(0.25) ? shop : r.pick(CURRENCIES);
    // Shop → cart rate across 6 orders of magnitude (HUF ↔ KWD), any digits.
    const rate = cart === shop ? 1 : Math.exp((r.next() - 0.5) * 14) * (1 + r.next());
    const quantity = r.int(1, 7);
    const percent = r.chance(0.6);
    const breaks = percent ? [{ minQty: 1, percent: r.pick([5, 10, 12.5, 20, 33, 50, 90]) }] : [{ minQty: 1, amountOff: { [cart]: r.int(1, 500_000) } }];
    const margin = randomMargin(r);
    const config = configOf({ modules: { margin, tiers: { sets: [{ id: "g", scope: "global", countAcross: "line", breaks }] } } });
    const collectionIds = COLLECTIONS.filter(() => r.chance(0.4));
    const unitCost = randomCost(r, shop);
    // The market's own price (a price list): unrelated to the shop price × rate.
    const price = r.int(1, 3_000_000);
    const entry = productMetafieldValue(productRuleIndex(config, [{ productId: P(1), variantIds: [], collectionIds }]).get(P(1))!);
    const plan = planCart(
      {
        currency: cart,
        shopToCartRate: rate,
        enteredCodes: [],
        today: "2026-10-01",
        lines: [
          {
            id: "L1",
            variantId: "gid://shopify/ProductVariant/1",
            productId: P(1),
            quantity,
            unitPrice: price,
            ruleIds: [],
            ...(entry.marginRefs ? { marginRefs: entry.marginRefs } : {}),
            unitCost,
            unitCostCurrency: shop,
          },
        ],
      },
      buildShopFunctionConfig(config, { ...OPTS, shopCurrency: shop }).payload,
    );
    const checkout = plan.lines[0].product?.amount ?? 0;
    if (plan.lines[0].marginCapped) capped++;

    // The PDP: the storefront config's margin k and cur, the variant's pdp {f, k}.
    const storefront = buildStorefrontConfig(config, { configVersion: "v", shopCurrency: shop });
    const pdp = pdpFloor({ unitCost, costCurrency: shop, shopCurrency: shop, margin: config.modules.margin, collectionIds })!;
    assert.ok(storefront.margin.on && storefront.margin.k === pdp.k && storefront.margin.cur === shop, `case ${n}: keys`);
    const floor = pdpFloorInCart(pdp.f, storefront.margin.cur!, cart, rate);
    if (cart !== shop) foreign++;
    const b = breaks[0] as { percent?: number; amountOff?: Record<string, number> };
    const tierPerItem = b.percent !== undefined ? Math.floor((price * b.percent) / 100) : Math.min(b.amountOff![cart], price);
    const promised = quantity * Math.min(tierPerItem, Math.max(0, price - floor));
    assert.ok(promised <= checkout, `case ${n}: PDP ${promised} > checkout ${checkout} (${shop}→${cart} ×${rate}, price ${price}, cost ${unitCost}, f ${pdp.f})`);
  }
  assert.ok(capped > 500 && foreign > 1000, `capped ${capped}, foreign ${foreign}`);
});
