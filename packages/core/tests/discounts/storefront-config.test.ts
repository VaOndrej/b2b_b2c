// MVP 3 contracts K4 (variant `pdp` = the largest discount % margin protection
// allows) and K5 (the storefront config app-data metafield, built from the
// GATED config). Liquid money units = major unit × 100, whatever the
// currency's exponent (JPY 0, KWD 3).

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig, type WonDiscountsConfig } from "../../src/discounts/config.ts";
import { costMinorUnits, marginFloorUnit } from "../../src/discounts/margin.ts";
import { currencyExponent } from "../../src/discounts/money.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import {
  buildStorefrontConfig,
  pdpMaxDiscountPercent,
  STOREFRONT_CONFIG_VERSION,
  type StorefrontConfigV1,
} from "../../src/discounts/storefront-config.ts";

const P = (n: number) => `gid://shopify/Product/${n}`;
const C = (n: number) => `gid://shopify/Collection/${n}`;

function configOf(input: Record<string, unknown>): WonDiscountsConfig {
  const { config, issues } = sanitizeConfig(input);
  assert.deepEqual(issues, []);
  return config;
}

const MARGIN = {
  enabled: true,
  global: { minMarginPercent: 20, maxDiscountPercent: 40 },
  perCollection: [
    { collectionId: C(5), maxDiscountPercent: 10 },
    { collectionId: C(6), minMarginPercent: 30 },
    { collectionId: C(7), maxDiscountPercent: 80 },
  ],
};

const PRO = {
  modules: {
    tiers: {
      sets: [
        { id: "global", scope: "global", countAcross: "cart", breaks: [{ minQty: 3, percent: 10 }, { minQty: 5, percent: 15 }] },
        {
          id: "vip",
          scope: { collectionIds: [C(1)] },
          countAcross: "cart",
          breaks: [{ minQty: 2, amountOff: { CZK: 50_00, EUR: 2_50, JPY: 300, KWD: 1_234 } }],
        },
        { id: "global-2", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 50 }] },
        { id: "nobody", scope: { productIds: [] }, countAcross: "line", breaks: [{ minQty: 2, percent: 50 }] },
      ],
    },
    margin: MARGIN,
  },
  storefront: { appearancePreset: "chips" },
  locales: { cs: { "tiers.heading": "Množstevní sleva", "tiers.empty": "" }, sk: {}, en: { "tiers.heading": "Buy more" } },
};

test("K5: the storefront config of a Pro shop — reachable sets by id, amounts in Liquid money units, margin caps, preset, merchant texts", () => {
  const built: StorefrontConfigV1 = buildStorefrontConfig(configOf(PRO), { configVersion: "cv-42" });
  assert.equal(STOREFRONT_CONFIG_VERSION, 1);
  assert.deepEqual(built, {
    v: 1,
    cv: "cv-42",
    tiers: {
      global: "global",
      sets: {
        global: { count: "cart", breaks: [{ min: 3, pct: 10 }, { min: 5, pct: 15 }] },
        // CZK/EUR (exp 2) as they are; JPY (exp 0) × 100; KWD (exp 3) ÷ 10, rounded DOWN (never shows more than checkout gives).
        vip: { count: "cart", breaks: [{ min: 2, off: { CZK: 5000, EUR: 250, JPY: 30000, KWD: 123 } }] },
      },
    },
    // Collections by numeric id → their maximum discount % (an empty one = the global value).
    margin: { on: true, max: 40, col: { "5": 10, "6": 40, "7": 80 } },
    appearance: { preset: "chips" },
    texts: { cs: { "tiers.heading": "Množstevní sleva" }, en: { "tiers.heading": "Buy more" } },
  });
});

test("K5 on Free: built from the gated config — one global set counted per product, scoped sets inert, no per-collection margin", () => {
  const free = gateConfigForPlan(configOf(PRO), "free").config;
  const built = buildStorefrontConfig(free, { configVersion: "cv-1" });
  assert.deepEqual(built.tiers, {
    global: "global",
    sets: {
      global: { count: "product", breaks: [{ min: 3, pct: 10 }, { min: 5, pct: 15 }] },
      vip: { count: "cart", breaks: [] },
    },
  });
  assert.deepEqual(built.margin, { on: true, max: 10 }, "Free folds the collections: the strictest maximum");
});

test("K5: margin off, no sets, unknown preset in a hand-made config; nothing about costs ever ships", () => {
  const config = configOf({ modules: { margin: { ...MARGIN, enabled: false } } });
  (config.storefront as { appearancePreset: string }).appearancePreset = "neon";
  const built = buildStorefrontConfig(config, { configVersion: "v" });
  assert.deepEqual(built, { v: 1, cv: "v", tiers: { global: null, sets: {} }, margin: { on: false }, appearance: { preset: "default" }, texts: {} });
  const json = JSON.stringify(buildStorefrontConfig(configOf(PRO), { configVersion: "v" }));
  for (const needle of ["gid://", "minMargin", "cost", "perCollection"]) assert.ok(!json.includes(needle), needle);
});

test("K5: a set id that is an object key of Object.prototype is still an own entry (\"__proto__\", \"constructor\")", () => {
  const config = configOf({
    modules: {
      tiers: {
        sets: [
          { id: "__proto__", scope: { productIds: [P(1)] }, countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] },
          { id: "constructor", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 6 }] },
        ],
      },
    },
  });
  const built = JSON.parse(JSON.stringify(buildStorefrontConfig(config, { configVersion: "v" })));
  assert.deepEqual(Object.keys(built.tiers.sets), ["__proto__", "constructor"]);
  assert.deepEqual(built.tiers.sets.__proto__, { count: "line", breaks: [{ min: 2, pct: 5 }] });
  assert.equal(built.tiers.global, "constructor");
});

test("K5: amounts convert with money.ts currencyExponent — the same table checkout uses (an unknown code: 2 digits)", () => {
  const config = configOf({
    modules: { tiers: { sets: [{ id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 2, amountOff: { CZK: 1_234, JPY: 5, BHD: 12_345, XYZ: 77 } }] }] } },
  });
  assert.deepEqual(buildStorefrontConfig(config, { configVersion: "v" }).tiers.sets.g.breaks, [
    { min: 2, off: { BHD: 1_234, CZK: 1_234, JPY: 500, XYZ: 77 } },
  ]);
});

// --- K4: pdpMaxDiscountPercent ---------------------------------------------------------------------

test("K4: the largest discount % the floor allows at the variant's price — 1 decimal, rounded DOWN", () => {
  const margin = configOf({ modules: { margin: MARGIN } }).modules.margin;
  // cost 600 Kč, min. margin 20 %: floor = 600 / 0.8 = 750 Kč → 250 of 1 000 Kč = 25 %.
  assert.equal(pdpMaxDiscountPercent({ unitPrice: 1000_00, unitCost: 600, costCurrency: "CZK", shopCurrency: "CZK", margin, collectionIds: [] }), 25);
  // cost 700 Kč: floor 875 → 12.5 %.
  assert.equal(pdpMaxDiscountPercent({ unitPrice: 1000_00, unitCost: 700, costCurrency: "CZK", shopCurrency: "CZK", margin, collectionIds: [] }), 12.5);
  // 999 Kč, cost 700: floor 875 → 124 / 999 = 12.41… % → 12.4.
  assert.equal(pdpMaxDiscountPercent({ unitPrice: 999_00, unitCost: 700, costCurrency: "CZK", shopCurrency: "CZK", margin, collectionIds: [] }), 12.4);
  // A collection with a stricter minimum (30 %): floor = 700 / 0.7 = 1 000 → nothing left.
  assert.equal(pdpMaxDiscountPercent({ unitPrice: 1000_00, unitCost: 700, costCurrency: "CZK", shopCurrency: "CZK", margin, collectionIds: [C(6)] }), 0);
  // Priced below the floor: 0, never negative.
  assert.equal(pdpMaxDiscountPercent({ unitPrice: 500_00, unitCost: 700, costCurrency: "CZK", shopCurrency: "CZK", margin, collectionIds: [] }), 0);
  // Numeric collection ids are understood too.
  assert.equal(pdpMaxDiscountPercent({ unitPrice: 1000_00, unitCost: 700, costCurrency: "CZK", shopCurrency: "CZK", margin, collectionIds: ["6"] }), 0);
});

test("K4: null when margin protection is off or the cost is unknown (no cost, ≤ 0, another currency)", () => {
  const margin = configOf({ modules: { margin: MARGIN } }).modules.margin;
  const base = { unitPrice: 1000_00, unitCost: 600, costCurrency: "CZK", shopCurrency: "CZK", margin, collectionIds: [] };
  assert.equal(pdpMaxDiscountPercent({ ...base, margin: { ...margin, enabled: false } }), null);
  assert.equal(pdpMaxDiscountPercent({ ...base, unitCost: undefined }), null);
  assert.equal(pdpMaxDiscountPercent({ ...base, unitCost: 0 }), null);
  assert.equal(pdpMaxDiscountPercent({ ...base, costCurrency: "EUR" }), null);
  assert.equal(pdpMaxDiscountPercent({ ...base, costCurrency: "czk" }), null);
});

test("K4: JPY (exponent 0) and KWD (exponent 3) use the same floor as checkout", () => {
  const margin = configOf({ modules: { margin: { enabled: true, global: { minMarginPercent: 10, maxDiscountPercent: 50 }, perCollection: [] } } }).modules.margin;
  // ¥1 000, cost ¥700 → floor ceil(777.78) = 778 → 222 / 1 000 = 22.2 %.
  assert.equal(pdpMaxDiscountPercent({ unitPrice: 1000, unitCost: 700, costCurrency: "JPY", shopCurrency: "JPY", margin, collectionIds: [] }), 22.2);
  // 10.000 KWD, cost 7.123 → floor ceil(7 914.44) = 7 915 fils → 2 085 / 10 000 = 20.85 % → 20.8.
  assert.equal(pdpMaxDiscountPercent({ unitPrice: 10_000, unitCost: 7.123, costCurrency: "KWD", shopCurrency: "KWD", margin, collectionIds: [] }), 20.8);
});

test("K4 property: pdp.max never lets a percent below the checkout floor (same margin.ts math)", () => {
  const margin = configOf({ modules: { margin: MARGIN } }).modules.margin;
  let seed = 7;
  const next = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < 2000; i++) {
    const currency = ["CZK", "JPY", "KWD"][i % 3];
    const unitPrice = 1 + Math.floor(next() * 5_000_000);
    const unitCost = Math.round(next() * (unitPrice / 10 ** currencyExponent(currency)) * 1.2 * 1000) / 1000;
    const collectionIds = next() < 0.5 ? [C(5)] : next() < 0.5 ? [C(6), C(7)] : [];
    const max = pdpMaxDiscountPercent({ unitPrice, unitCost, costCurrency: currency, shopCurrency: currency, margin, collectionIds });
    const costMinor = costMinorUnits(unitCost, currency, 1, currency, currency);
    if (costMinor === null) {
      assert.equal(max, null);
      continue;
    }
    assert.ok(max !== null && max >= 0 && max <= 100 && Math.round(max * 10) === max * 10, String(max));
    const minMargin = collectionIds.includes(C(6)) ? 30 : 20;
    const { floorUnit } = marginFloorUnit({ unitPrice, costMinor, minMarginPercent: minMargin, maxDiscountPercent: 40 });
    if (floorUnit >= unitPrice) {
      assert.equal(max, 0, "priced at or below its floor: no discount");
      continue;
    }
    // max % off the price never goes under the floor, and 0.1 % more would.
    assert.ok(unitPrice - (unitPrice * max) / 100 >= floorUnit - 1e-6, `${unitPrice} ${unitCost} ${max} ${floorUnit}`);
    if (max < 100) assert.ok(unitPrice - (unitPrice * (max + 0.1)) / 100 < floorUnit + 1e-6, `${unitPrice} ${unitCost} ${max} ${floorUnit}`);
  }
});

test("MVP 5 (contract O9): `ow: 1` only when outlet combines with anything — the PDP then keeps the tier table for a sale variant", () => {
  const off = buildStorefrontConfig(gateConfigForPlan(configOf({}), "pro").config, { configVersion: "v1" });
  assert.equal(off.ow, undefined, "default A1: outlet with nothing");
  const on = buildStorefrontConfig(gateConfigForPlan(configOf({ engine: { combination: { outletWithAnything: true } } }), "free").config, { configVersion: "v1" });
  assert.equal(on.ow, 1);
});

test("feedback 2, bod 7: `camps` lists the campaigns that are not killed as UTC instants of their shop-local window; none without the shop's time zone; on Free only what the gate leaves", () => {
  const config = configOf({
    campaigns: [
      { id: "bf", name: "  Black Friday  ", window: { start: "2026-11-27T00:00:00", end: "2026-11-30T00:00:00" }, overrides: [], killed: false },
      { id: "x", name: "Zrušená", window: { start: "2026-12-01T00:00:00", end: "2026-12-02T00:00:00" }, overrides: [], killed: true },
      { id: "s", name: "Léto", window: { start: "2026-07-01T08:00:00", end: "2026-07-02T08:00:00" }, overrides: [], killed: false },
    ],
  });
  const built = buildStorefrontConfig(config, { configVersion: "v", shopTimezone: "Europe/Prague" });
  assert.deepEqual(built.camps, [
    // Summer time: 08:00 in Prague is 06:00 UTC.
    { n: "Léto", s: Date.UTC(2026, 6, 1, 6) / 1000, e: Date.UTC(2026, 6, 2, 6) / 1000 },
    // Winter time: midnight in Prague is 23:00 UTC the day before.
    { n: "Black Friday", s: Date.UTC(2026, 10, 26, 23) / 1000, e: Date.UTC(2026, 10, 29, 23) / 1000 },
  ]);
  assert.equal(buildStorefrontConfig(config, { configVersion: "v" }).camps, undefined, "no time zone: nothing is announced");
  assert.equal(buildStorefrontConfig(config, { configVersion: "v", shopTimezone: "Not/AZone" }).camps, undefined);
  assert.equal(buildStorefrontConfig(configOf({}), { configVersion: "v", shopTimezone: "Europe/Prague" }).camps, undefined);
  // Campaigns are Pro: the Free gate removes them, so the storefront of a Free shop announces none.
  const free = gateConfigForPlan(config, "free", { now: "2026-01-01T00:00:00" }).config;
  assert.equal(buildStorefrontConfig(free, { configVersion: "v", shopTimezone: "Europe/Prague" }).camps, undefined);
});
