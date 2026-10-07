// Amounts per market (7 Oct 2026, docs/won-discounts/navrh-castky-podle-trhu.md): "every market has its own
// amount, even when another one sells in the same currency". Stored and shipped: a key per currency ("EUR") and,
// only where markets of a currency differ, a key per market ("EUR@sk"). A config from before reads as it did.
// Amounts are minor units.

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig } from "../../src/discounts/config.ts";
import { formatMoney } from "../../src/discounts/describe.ts";
import { buildShopFunctionConfig } from "../../src/discounts/function-payload.ts";
import { collapseMarketAmounts, collapseTierAmounts, expandMarketAmounts, hasMarketAmount, marketAmountsView, usesMarketAmounts } from "../../src/discounts/market-amounts.ts";
import { amountKeyCurrency, currencyExponent, moneyFor, sanitizeMoneyByCurrency, splitAmountKey } from "../../src/discounts/money.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { buildStorefrontConfig } from "../../src/discounts/storefront-config.ts";
import { cartOf, configOf, FIXTURE_NOW, FIXTURE_TZ, line, lineOf, orderFixed } from "./engine-fixtures.ts";

const MARKETS = [
  { handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] },
  { handle: "sk", currency: "EUR", enabled: true, countries: ["SK"] },
  { handle: "de", currency: "EUR", enabled: true, countries: ["DE", "AT"] },
  { handle: "pl", currency: "PLN", enabled: false, countries: ["PL"] },
];

test("an amount key is a currency, alone or with a market; the sanitizer keeps both and drops the rest", () => {
  assert.deepEqual(splitAmountKey("EUR"), { currency: "EUR", market: null });
  assert.deepEqual(splitAmountKey("EUR@sk"), { currency: "EUR", market: "sk" });
  for (const junk of ["", "eur", "EURO", "EUR@", "@sk", "EU@sk", `EUR@${"x".repeat(101)}`]) assert.equal(splitAmountKey(junk), null, junk);
  assert.deepEqual(sanitizeMoneyByCurrency({ eur: 100, "eur@sk": 150, "EUR@DE-at": 175.9, "EUR@": 1, "@sk": 2, euro: 3, "CZK@cz": -1 }), { EUR: 100, "EUR@sk": 150, "EUR@DE-at": 175 });
  assert.equal(amountKeyCurrency("JPY@jp"), "JPY");
  assert.equal(currencyExponent("JPY@jp"), 0);
  assert.equal(currencyExponent("KWD@kw"), 3);
  assert.equal(formatMoney(1600, "EUR@sk", "cs"), formatMoney(1600, "EUR", "cs"));
});

test("a market reads its own amount, then its currency's, never another market's", () => {
  const money = { EUR: 1600, "EUR@de": 2000, CZK: 40000 };
  assert.equal(moneyFor(money, "EUR", "sk"), 1600);
  assert.equal(moneyFor(money, "EUR", "de"), 2000);
  assert.equal(moneyFor(money, "EUR"), 1600);
  assert.equal(moneyFor({ "EUR@de": 2000 }, "EUR", "sk"), null, "Slovakia has no amount: not offered there");
  assert.equal(moneyFor({ "EUR@de": 2000 }, "EUR"), null, "a market that is not known gets the currency's amount only");
  assert.equal(moneyFor(money, "CZK", "__proto__"), 40000);
});

test("stored configs from before (currency keys only) expand to every market's amount and collapse back unchanged", () => {
  // Real shapes: the dev shop's settings of 7 Oct 2026 and the E2E seeds.
  const stored = [{ CZK: 100, EUR: 10 }, { CZK: 150000, EUR: 6000 }, { CZK: 10000, EUR: 400 }, { CZK: 300, EUR: 50 }, { CZK: 6000 }, { CZK: 30000, HUF: 500000 }, {}];
  for (const money of stored) {
    const expanded = expandMarketAmounts(money, MARKETS);
    assert.deepEqual(collapseMarketAmounts(expanded, MARKETS), money, JSON.stringify(money));
    assert.deepEqual(collapseMarketAmounts(money, MARKETS), money, "collapsing a stored map changes nothing");
    assert.equal(hasMarketAmount(collapseMarketAmounts(expanded, MARKETS)), false);
  }
  // Every enabled market gets the amount of its currency: lossless.
  assert.deepEqual(expandMarketAmounts({ CZK: 150000, EUR: 6000 }, MARKETS), { "CZK@cz": 150000, "EUR@sk": 6000, "EUR@de": 6000 });
  // A currency no enabled market sells in (PLN is switched off, HUF has no market) is kept as stored.
  assert.deepEqual(expandMarketAmounts({ CZK: 100, PLN: 20, HUF: 5000 }, MARKETS), { "CZK@cz": 100, PLN: 20, HUF: 5000 });
  assert.deepEqual(collapseMarketAmounts({ "CZK@cz": 100, PLN: 20, HUF: 5000 }, MARKETS), { CZK: 100, PLN: 20, HUF: 5000 });
});

test("two markets of one currency with different amounts get a key each; a market without an amount gets none", () => {
  assert.deepEqual(collapseMarketAmounts({ "CZK@cz": 40000, "EUR@sk": 1600, "EUR@de": 2000 }, MARKETS), { CZK: 40000, "EUR@sk": 1600, "EUR@de": 2000 });
  // Germany left empty: only Slovakia has the amount — a plain "EUR" would give it to Germany too.
  assert.deepEqual(collapseMarketAmounts({ "CZK@cz": 40000, "EUR@sk": 1600 }, MARKETS), { CZK: 40000, "EUR@sk": 1600 });
  // Made the same again: back to one key.
  assert.deepEqual(collapseMarketAmounts({ "CZK@cz": 40000, "EUR@sk": 1600, "EUR@de": 1600 }, MARKETS), { CZK: 40000, EUR: 1600 });
  // The own amount of a market that is switched off stays stored.
  assert.deepEqual(collapseMarketAmounts({ "CZK@cz": 1, "PLN@pl": 9 }, MARKETS), { CZK: 1, "PLN@pl": 9 });
  // A tier set is collapsed as a whole: EUR is split in every break once one break differs.
  const breaks = collapseTierAmounts(
    [
      { minQty: 3, amountOff: { "CZK@cz": 3000, "EUR@sk": 120, "EUR@de": 120 } },
      { minQty: 5, amountOff: { "CZK@cz": 5000, "EUR@sk": 200, "EUR@de": 250 } },
    ],
    MARKETS,
  );
  assert.deepEqual(breaks.map((b) => b.amountOff), [{ CZK: 3000, "EUR@sk": 120, "EUR@de": 120 }, { CZK: 5000, "EUR@sk": 200, "EUR@de": 250 }]);
  assert.deepEqual(collapseTierAmounts([{ minQty: 3, amountOff: { CZK: 3000, EUR: 120 } }], MARKETS).map((b) => b.amountOff), [{ CZK: 3000, EUR: 120 }]);
});

const payloadFor = (config: ReturnType<typeof configOf>) => buildShopFunctionConfig(config, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ });
const L = (unitPrice: number, quantity = 1) => line("L1", unitPrice, quantity);

test("the checkout config: `am` and the market's countries ship only when an amount is a market's own", () => {
  const before = payloadFor(configOf([orderFixed("r", { CZK: 40000, EUR: 1600 })], { markets: MARKETS }));
  assert.equal("am" in before.payload, false);
  assert.deepEqual(before.payload.marketCountries, {}, "a config from before ships as before");
  const after = payloadFor(configOf([orderFixed("r", { CZK: 40000, "EUR@sk": 1600, "EUR@de": 2000 })], { markets: MARKETS }));
  assert.equal(after.payload.am, true);
  assert.deepEqual(after.payload.marketCountries, { sk: ["SK"], de: ["DE", "AT"] });
  assert.equal(usesMarketAmounts(after.payload.modules), true);
  assert.equal(after.fits, true);
});

test("a cart gets the discount of its own market: Slovakia 16 €, Germany and Austria 20 €, the same currency", () => {
  const { payload } = payloadFor(configOf([orderFixed("r", { CZK: 40000, "EUR@sk": 1600, "EUR@de": 2000 })], { markets: MARKETS }));
  const off = (currency: string, countryCode?: string) => planCart(cartOf([L(100_00, 5)], { currency, ...(countryCode ? { countryCode } : {}) }), payload).totals.orderDiscount;
  assert.equal(off("EUR", "SK"), 1600);
  assert.equal(off("EUR", "DE"), 2000);
  assert.equal(off("EUR", "AT"), 2000);
  assert.equal(off("CZK", "CZ"), 40000);
  // A country in no market, or no country at all: only a currency's amount could apply, and there is none.
  assert.equal(off("EUR", "FR"), 0);
  assert.equal(off("EUR"), 0);
});

test("a market without its own amount keeps its currency's; the minimum spend is per market too", () => {
  const rule = orderFixed("r", { EUR: 1000, "EUR@de": 2000 }, { minimum: { subtotal: { EUR: 5000, "EUR@de": 20000 } } });
  const { payload } = payloadFor(configOf([rule], { markets: MARKETS }));
  const off = (countryCode: string, quantity: number) => planCart(cartOf([L(10_00, quantity)], { currency: "EUR", countryCode }), payload).totals.orderDiscount;
  assert.equal(off("SK", 5), 1000, "Slovakia: the currency's 10 € from 50 €");
  assert.equal(off("SK", 4), 0);
  assert.equal(off("DE", 5), 0, "Germany needs 200 €");
  assert.equal(off("DE", 20), 2000);
  assert.equal(off("FR", 5), 1000, "a country in no market: the currency's amount");
});

test("quantity tiers and reward thresholds follow the market as well", () => {
  const config = sanitizeConfig({
    markets: MARKETS,
    modules: {
      tiers: {
        sets: [
          {
            id: "g",
            scope: "global",
            countAcross: "product",
            breaks: [
              { minQty: 3, amountOff: { CZK: 3000, EUR: 120 } },
              { minQty: 5, amountOff: { CZK: 5000, "EUR@sk": 200, "EUR@de": 250 } },
            ],
          },
        ],
      },
      rewards: { freeShipping: { threshold: { CZK: 150000, "EUR@sk": 6000, "EUR@de": 8000 } }, gifts: [] },
    },
  }).config;
  const { payload } = payloadFor(config);
  assert.equal(payload.am, true);
  // The set's columns: a break written with "EUR" alone still has Slovakia's and Germany's amount.
  assert.deepEqual(payload.modules.tiers.sets[0], ["g", "product", ["CZK", "EUR", "EUR@de", "EUR@sk"], [[3, [3000, 120, 120, 120]], [5, [5000, null, 250, 200]]]]);
  const plan = (countryCode: string, quantity: number, unitPrice = 10_00) => planCart(cartOf([L(unitPrice, quantity)], { currency: "EUR", countryCode }), payload);
  assert.equal(lineOf(plan("SK", 3), "L1").product?.amount, 360, "3 × 1,20 €");
  assert.equal(lineOf(plan("SK", 5), "L1").product?.amount, 1000, "5 × 2,00 €");
  assert.equal(lineOf(plan("DE", 5), "L1").product?.amount, 1250, "5 × 2,50 €");
  assert.equal(lineOf(plan("FR", 5), "L1").product?.amount, 600, "no market: the last level with a currency amount, 5 × 1,20 €");
  const shipping = (countryCode: string, quantity: number) => plan(countryCode, quantity).progress.freeShipping?.reached;
  assert.equal(shipping("SK", 6), true, "60 € in Slovakia");
  assert.equal(shipping("DE", 6), false, "Germany needs 80 €");
  assert.equal(shipping("DE", 8), true);
  // The storefront config carries the same keys (Liquid picks the market's, then the currency's).
  const sf = buildStorefrontConfig(config, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ, configVersion: "t" } as never);
  assert.deepEqual((sf as { tiers: { sets: Record<string, { breaks: { off?: Record<string, number> }[] }> } }).tiers.sets.g.breaks.map((b) => Object.keys(b.off ?? {})), [["CZK", "EUR"], ["CZK", "EUR@de", "EUR@sk"]]);
});

test("marketAmountsView: nothing changes without the flag, a country, or a market holding it", () => {
  const config = { am: true, marketCountries: { sk: ["SK"] }, modules: { x: { amount: { EUR: 1, "EUR@sk": 2 } }, t: [["s", "product", ["EUR", "EUR@sk"], [[3, [10, 20]]]]] } };
  assert.equal(marketAmountsView(config, { currency: "EUR", countryCode: "FR" }), config);
  assert.equal(marketAmountsView(config, { currency: "EUR", countryCode: null }), config);
  assert.equal(marketAmountsView({ ...config, am: undefined }, { currency: "EUR", countryCode: "SK" }).modules.x.amount.EUR, 1);
  const view = marketAmountsView(config, { currency: "EUR", countryCode: "SK" });
  assert.equal(view.modules.x.amount.EUR, 2);
  assert.equal((view.modules.t[0]![2] as string[]).indexOf("EUR"), 1, "the market's column is the one read");
  assert.equal(config.modules.x.amount.EUR, 1, "the shipped config is not changed");
});
