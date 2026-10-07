// Úkol 6 (7 Oct 2026): "every market has its own amount, even when another one sells in the same currency"
// (docs/won-discounts/navrh-castky-podle-trhu.md). The admin works with one amount field per market; a save
// stores the shortest map that says the same. Screens are rendered in the dev harness (?markets=shared: Germany
// sells in euros next to Slovakia).
import "./support/raw-import.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

import { sanitizeConfig } from "@won/core/discounts/config";
import { expandConfigAmounts } from "@won/core/discounts/market-amounts";

import { translator } from "../../app/i18n/index.ts";
import { currencyLabel, currencyViews, enabledCurrencies } from "../../app/components/model/markets.ts";
import { marketRows } from "../../app/components/model/markets-overview.ts";
import { readRewardsForm, REWARDS_FIELD } from "../../app/components/model/rewards.ts";
import { validateConfigForSave } from "../../app/lib/config.server.ts";

let prevEnv: string | undefined;
before(() => {
  prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
});
after(() => {
  if (prevEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevEnv;
});

async function render(path: string): Promise<string> {
  const mod = await import("../../app/routes/dev.preview.$.tsx");
  const handler = createStaticHandler([{ path: "/dev/preview/*", loader: mod.loader, action: mod.action, Component: mod.default }]);
  const context = await handler.query(new Request(`http://localhost/dev/preview/${path}`));
  assert.ok(!(context instanceof Response), `${path}: a redirect`);
  return renderToString(createElement(StaticRouterProvider, { router: createStaticRouter(handler.dataRoutes, context), context })).replace(/<script[\s\S]*?<\/script>/g, "");
}
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ok = (cond: boolean, message: string) => assert.ok(cond, message);

const MARKETS = [
  { handle: "cz", currency: "CZK", enabled: true, countries: ["CZ"] },
  { handle: "sk", currency: "EUR", enabled: true, countries: ["SK"] },
  { handle: "de", currency: "EUR", enabled: true, countries: ["DE"] },
];
const NAMES = { cz: "Česko", sk: "Slovensko", de: "Německo" };

test("one amount column per market: a currency of one market keeps its key, a shared one gets a key per market", () => {
  assert.deepEqual(currencyViews(MARKETS, { marketNames: NAMES }), [
    { code: "CZK", markets: [{ handle: "cz", name: "Česko" }] },
    { code: "EUR@sk", markets: [{ handle: "sk", name: "Slovensko" }] },
    { code: "EUR@de", markets: [{ handle: "de", name: "Německo" }] },
  ]);
  assert.deepEqual(enabledCurrencies(MARKETS), ["CZK", "EUR@sk", "EUR@de"]);
  // No shared currency: exactly the keys a shop always had.
  assert.deepEqual(enabledCurrencies(MARKETS.slice(0, 2)), ["CZK", "EUR"]);
  assert.equal(currencyLabel(currencyViews(MARKETS, { marketNames: NAMES })[2]!), "EUR · Německo");
  // A text never shows the key: "{currency}" is the currency, the market is named next to it.
  assert.equal(translator("cs").t("tiers.break.amountMarket", { currency: "EUR@de", markets: "Německo" }), "Za kus: Německo (EUR)");
});

test("the rewards form: a field per market, each starting from the amount stored for the euro", async () => {
  const html = await render("rewards?markets=shared");
  ok(/<s-number-field name="rw\.ship\.EUR@sk" label="Od částky: Slovensko \(EUR\)" value="40"[^>]*suffix="EUR"/.test(html), "Slovensko");
  ok(/<s-number-field name="rw\.ship\.EUR@de" label="Od částky: Německo \(EUR\)" value="40"[^>]*suffix="EUR"/.test(html), "Německo");
  ok(!/name="rw\.ship\.EUR"/.test(html) && !html.includes("EUR@"+"sk)"), "no shared euro field, no key in a label");
  // Without the second euro market the page is what it was.
  ok(/<s-number-field name="rw\.ship\.EUR" label="Od částky: Slovensko \(EUR\)" value="40"/.test(await render("rewards")), "one euro market: the plain key");
});

test("a save stores each market's amount: different → a key per market, the same → one key, an empty market → not offered there", () => {
  const F = REWARDS_FIELD;
  const stored = (fields: Record<string, string>) => {
    const form = new FormData();
    form.set(F.shipOn, "1");
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    const read = readRewardsForm(form, { currencies: enabledCurrencies(MARKETS), kept: { shipping: {}, tiers: new Map() }, keep: () => undefined });
    assert.deepEqual(read.errors, []);
    const saved = validateConfigForSave({ markets: MARKETS, modules: { rewards: read.rewards } });
    assert.equal(saved.ok, true);
    return saved.ok ? saved.config.modules.rewards.freeShipping?.threshold : null;
  };
  assert.deepEqual(stored({ [F.shipAmount("CZK")]: "1500", [F.shipAmount("EUR@sk")]: "60", [F.shipAmount("EUR@de")]: "80" }), { CZK: 150000, "EUR@sk": 6000, "EUR@de": 8000 });
  assert.deepEqual(stored({ [F.shipAmount("CZK")]: "1500", [F.shipAmount("EUR@sk")]: "60", [F.shipAmount("EUR@de")]: "60" }), { CZK: 150000, EUR: 6000 }, "the same amount: stored as before");
  assert.deepEqual(stored({ [F.shipAmount("CZK")]: "1500", [F.shipAmount("EUR@sk")]: "60", [F.shipAmount("EUR@de")]: "" }), { CZK: 150000, "EUR@sk": 6000 }, "Germany left empty: only Slovakia");
});

test("a config stored before reads into the columns and is saved back byte for byte", () => {
  const before = sanitizeConfig({
    markets: MARKETS,
    modules: {
      codes: { rules: [{ id: "r", name: "Sleva", enabled: true, method: "automatic", value: { kind: "fixed", amount: { CZK: 100, EUR: 10 } }, target: { kind: "order" }, minimum: { subtotal: { CZK: 150000, EUR: 6000 } } }] },
      tiers: { sets: [{ id: "global", scope: "global", countAcross: "product", breaks: [{ minQty: 3, amountOff: { CZK: 300, EUR: 50 } }, { minQty: 5, amountOff: { CZK: 400, EUR: 50 } }] }] },
      rewards: { freeShipping: { threshold: { CZK: 10000, EUR: 400 } }, gifts: [] },
    },
  }).config;
  const first = validateConfigForSave(before);
  assert.equal(first.ok, true);
  const again = validateConfigForSave(expandConfigAmounts(before));
  assert.equal(again.ok && first.ok && again.data === first.data, true, "what the admin loads and saves untouched is the stored config");
  ok(first.ok && !first.data.includes("@"), "no market key appears while the markets agree");
});

test("Nastavení: every market is its own row with its own amount, and nothing says markets share one", async () => {
  const html = await render("settings?markets=shared");
  const page = text(html);
  ok(!/společnou částku/.test(page), "the sentence is gone");
  ok(/Slovensko[\s\S]*Německo/.test(page), "both euro markets are listed");
  const own = sanitizeConfig({ markets: MARKETS, modules: { rewards: { freeShipping: { threshold: { CZK: 100000, "EUR@sk": 4000, "EUR@de": 6000 } }, gifts: [] } } }).config;
  assert.deepEqual(
    marketRows(own, { plan: "free", names: NAMES, locale: "cs" }).map((r) => [r.name, r.currency, r.shipping.kind === "amount" ? r.shipping.text.replace(/\s/g, " ") : r.shipping.kind]),
    [
      ["Česko", "CZK", "1 000 Kč"],
      ["Slovensko", "EUR", "40 €"],
      ["Německo", "EUR", "60 €"],
    ],
  );
});

test("the quantity levels of an exception: a field per market, the suggestion for each market of its own", async () => {
  const html = await render("tiers?plan=pro&markets=shared&state=exceptions&result=invalid-exception");
  ok(html.includes('label="Za kus: Slovensko (EUR)"') && html.includes('label="Za kus: Německo (EUR)"'), "a field per market");
  ok(/name="set\.t_devautumn\.r0\.amount\.EUR@sk"[^>]*value="1\.2"/.test(html) && /name="set\.t_devautumn\.r0\.amount\.EUR@de"[^>]*value="1\.2"/.test(html), "both start from the euro amount");
  // The second level has an amount for Česko only: each euro market is offered its own.
  const offers = (html.match(/<div data-won-suggest="offer"[\s\S]*?<\/div>/g) ?? []).map(text);
  ok(offers.some((o) => /Slovensko \(EUR\): navrhujeme/.test(o)) && offers.some((o) => /Německo \(EUR\): navrhujeme/.test(o)), offers.join(" | "));
});
