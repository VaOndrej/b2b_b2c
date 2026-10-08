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
import { MS_FIELD, readMilestonesForm } from "../../app/components/model/milestones.ts";
import { withMilestones } from "@won/core/discounts/milestones";
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

test("the Milníky table: a column per market, each starting from the amount stored for the euro", async () => {
  const html = await render("rewards?markets=shared");
  ok(/<s-number-field name="ms\.shipping\.amount\.EUR@sk" label="1\. stupeň, Slovensko \(EUR\)" labelAccessibilityVisibility="exclusive" value="40"[^>]*suffix="EUR"/.test(html), "Slovensko");
  ok(/<s-number-field name="ms\.shipping\.amount\.EUR@de" label="1\. stupeň, Německo \(EUR\)" labelAccessibilityVisibility="exclusive" value="40"[^>]*suffix="EUR"/.test(html), "Německo");
  ok(!/name="ms\.shipping\.amount\.EUR"/.test(html) && !html.includes("EUR@"+"sk)"), "no shared euro field, no key in a label");
  assert.deepEqual([...html.matchAll(/data-won-ms-column="[^"]+"[^>]*>([^<]+)</g)].map((m) => m[1]), ["Česko (CZK)", "Slovensko (EUR)", "Německo (EUR)"]);
  // Without the second euro market the page is what it was.
  ok(/<s-number-field name="ms\.shipping\.amount\.EUR" label="1\. stupeň, Slovensko \(EUR\)" labelAccessibilityVisibility="exclusive" value="40"/.test(await render("rewards")), "one euro market: the plain key");
});

test("a save stores each market's amount: different → a key per market, the same → one key, an empty market → not offered there", () => {
  const F = MS_FIELD;
  const A = (key: string) => F.amount("shipping", key);
  const stored = (fields: Record<string, string>) => {
    const form = new FormData();
    form.set(F.step, "shipping");
    form.set(F.kind("shipping"), "shipping");
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    const read = readMilestonesForm(form, { columns: enabledCurrencies(MARKETS), stored: new Map(), plan: "free" });
    assert.deepEqual(read.errors, []);
    const saved = validateConfigForSave(withMilestones(sanitizeConfig({ markets: MARKETS }).config, read.steps));
    assert.equal(saved.ok, true);
    return saved.ok ? saved.config.modules.rewards.freeShipping?.threshold : null;
  };
  assert.deepEqual(stored({ [A("CZK")]: "1500", [A("EUR@sk")]: "60", [A("EUR@de")]: "80" }), { CZK: 150000, "EUR@sk": 6000, "EUR@de": 8000 });
  assert.deepEqual(stored({ [A("CZK")]: "1500", [A("EUR@sk")]: "60", [A("EUR@de")]: "60" }), { CZK: 150000, EUR: 6000 }, "the same amount: stored as before");
  assert.deepEqual(stored({ [A("CZK")]: "1500", [A("EUR@sk")]: "60", [A("EUR@de")]: "" }), { CZK: 150000, "EUR@sk": 6000 }, "Germany left empty: only Slovakia");
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

test("mezery úkolu 6: a suggestion uses the market's own rate, and a summary names the market where a currency's amounts differ", async () => {
  // Germany has its own manual rate (0,05), Slovakia the euro's 0,04: 60 Kč per item → 2,50 € and 3 €.
  const html = await render("tiers?plan=pro&markets=shared&rates=market&state=exceptions&result=invalid-exception");
  const offers = (html.match(/<div data-won-suggest="offer"[\s\S]*?<\/div>/g) ?? []).map(text);
  ok(offers.some((o) => /Slovensko \(EUR\): navrhujeme 2,50\s€/.test(o)), offers.join(" | "));
  ok(offers.some((o) => /Německo \(EUR\): navrhujeme 3\s€/.test(o)), offers.join(" | "));
  // The rate is read per market handle next to the per-currency one (a currency whose markets disagree has none).
  const { readAmountSuggest } = await import("../../app/lib/integration/themes.server.ts");
  const graphql = async () => ({
    data: {
      markets: {
        nodes: [
          { handle: "sk", status: "ACTIVE", currencySettings: { baseCurrency: { currencyCode: "EUR", manualRate: "0.04" } } },
          { handle: "de", status: "ACTIVE", currencySettings: { baseCurrency: { currencyCode: "EUR", manualRate: "0.05" } } },
          { handle: "pl", status: "ACTIVE", currencySettings: { baseCurrency: { currencyCode: "PLN", manualRate: "0.17" } } },
        ],
      },
    },
  });
  assert.deepEqual(await readAmountSuggest(graphql as never, "market-rates-test.myshopify.com", "read_markets", "CZK"), { base: "CZK", rates: { PLN: 0.17 }, marketRates: { sk: 0.04, de: 0.05, pl: 0.17 } });

  const { describeRuleParts, describeTierSet } = await import("@won/core/discounts/describe");
  const labels = { "EUR@sk": "Slovensko", "EUR@de": "Německo" };
  const keys = ["CZK", "EUR@sk", "EUR@de"];
  const rule = (amount: Record<string, number>) => ({ id: "r", name: "Sleva", enabled: true, method: "automatic" as const, value: { kind: "fixed" as const, amount }, target: { kind: "order" as const } });
  const value = (amount: Record<string, number>) => describeRuleParts(rule(amount) as never, "cs", { currencies: keys, labels }).value.replace(/\s/g, " ");
  assert.equal(value({ CZK: 40000, "EUR@sk": 1600, "EUR@de": 1600 }), "400 Kč / 16 € z objednávky", "the same amount is said once");
  assert.equal(value({ CZK: 40000, "EUR@sk": 1600, "EUR@de": 2000 }), "400 Kč / 16 € (Slovensko) / 20 € (Německo) z objednávky");
  assert.equal(describeRuleParts(rule({ CZK: 40000, "EUR@sk": 1600 }) as never, "cs", { currencies: keys, labels }).notOffered, "pro Německo se nenabízí", "a missing market is named, never shown as a key");
  assert.equal(describeRuleParts(rule({ CZK: 40000 }) as never, "cs", { currencies: ["CZK", "EUR"] }).notOffered, "v EUR se nenabízí", "a plain currency reads as before");
  const set: { breaks: { minQty: number; amountOff: Record<string, number> }[] } = { breaks: [{ minQty: 3, amountOff: { CZK: 3000, "EUR@sk": 120, "EUR@de": 150 } }, { minQty: 5, amountOff: { CZK: 5000, "EUR@sk": 200 } }] };
  assert.equal(
    describeTierSet(set, { locale: "cs", currencies: keys, labels }).replace(/\s/g, " "),
    "Od 3 ks −30 Kč / 1,20 € (Slovensko) / 1,50 € (Německo) za kus, od 5 ks −50 Kč / 2 € za kus (pro Německo se nenabízí)",
  );
});

test("Nastavení: the switch for a customer from a country in no market explains both positions and whom it concerns", async () => {
  const shared = await render("settings?markets=shared");
  const page = text(shared);
  ok(/<s-switch name="unknownMarketLowest" value="on" label="Dát mu částku z trhů se stejnou měnou"(?![^>]*checked)/.test(shared), "off by default");
  ok(page.includes("Zákazník ze země mimo vaše trhy") && page.includes("Slevy a stupně Milníků s částkou nedostane"), "the section and its state");
  ok(page.includes("doprava zdarma je na Slovensku od 60 € a v Německu od 80 €. Zákazník z Francie platí v eurech"), "the example");
  ok(page.includes("Zapnuto: platí pro něj nejnižší, nebo nejvyšší z částek. Kterou, zvolíte níže pro každý druh částky zvlášť.") && page.includes("Vypnuto: nic z toho nedostane."), "both positions in words");
  ok(page.includes("Trh, u kterého necháte pole částky prázdné, nedostane nic ani při zapnutém přepínači."), "an empty market stays empty");
  ok(page.includes("U vás se to týká trhů se stejnou měnou: Slovensko (EUR) a Německo (EUR)."), "whom it concerns");
  ok(text(await render("settings")).includes("Teď se vás to netýká: žádné dva vaše trhy nemají stejnou měnu."), "one market per currency");
  const on = await render("settings?markets=shared&fallback=1");
  ok(/<s-switch name="unknownMarketLowest"[^>]*checked/.test(on) && text(on).includes("Dostane nejnižší částku z trhů se stejnou měnou"), "on");
  // The lowest or the highest, for each of the five kinds of amount; the lowest unless chosen otherwise.
  for (const kind of ["discount", "minimum", "tier", "shipping", "gift"]) ok(new RegExp(`<s-select name="unknownMarketPick\\.${kind}"[^>]*value="lowest"`).test(on), `${kind}: the lowest by default`);
  ok(text(on).includes("Kterou částku dostane") && text(on).includes("Nejnižší znamená dopravu zdarma dřív, v příkladu od 60 €. Nejvyšší později, od 80 €."), "each choice says what it means for the customer");
  const mixed = await render("settings?markets=shared&fallback=1&highest=1");
  ok(/<s-select name="unknownMarketPick\.shipping"[^>]*value="highest"/.test(mixed) && /<s-select name="unknownMarketPick\.minimum"[^>]*value="highest"/.test(mixed), "the stored choice");
  ok(/<s-select name="unknownMarketPick\.discount"[^>]*value="lowest"/.test(mixed) && text(mixed).includes("Dostane částku z trhů se stejnou měnou, někde nejnižší a někde nejvyšší"), "the rest stays the lowest and the summary says both");
  const { readUnknownMarketHighestForm } = await import("../../app/components/model/combination.ts");
  const picks = new FormData();
  assert.equal(readUnknownMarketHighestForm(picks), undefined, "a form without the choices leaves the stored ones");
  picks.set("unknownMarketPick.discount", "lowest");
  picks.set("unknownMarketPick.shipping", "highest");
  picks.set("unknownMarketPick.gift", "anything");
  assert.deepEqual(readUnknownMarketHighestForm(picks), ["shipping"]);
  // Stored only when on; what ships then: the lowest amount for the currency, the stored config untouched.
  const { readUnknownMarketForm } = await import("../../app/components/model/combination.ts");
  const form = new FormData();
  assert.equal(readUnknownMarketForm(form), false);
  form.set("unknownMarketLowest", "on");
  assert.equal(readUnknownMarketForm(form), true);
  const rewards = { freeShipping: { threshold: { CZK: 150000, "EUR@sk": 6000, "EUR@de": 8000 } }, gifts: [] };
  const saved = validateConfigForSave({ markets: MARKETS, engine: { unknownMarketLowest: true }, modules: { rewards } });
  assert.equal(saved.ok && saved.config.engine.unknownMarketLowest, true);
  assert.deepEqual(saved.ok ? saved.config.modules.rewards.freeShipping?.threshold : null, { CZK: 150000, "EUR@sk": 6000, "EUR@de": 8000 });
  const off = validateConfigForSave({ markets: MARKETS, engine: { unknownMarketLowest: false }, modules: { rewards } });
  assert.equal(off.ok && "unknownMarketLowest" in off.config.engine, false);
});
