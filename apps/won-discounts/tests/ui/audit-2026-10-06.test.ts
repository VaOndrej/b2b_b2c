// The admin preview imports the storefront CSS / locales with Vite `?raw`: node needs the hook first.
import "./support/raw-import.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

import { sanitizeConfig } from "@won/core/discounts/config";
import { expandConfigAmounts } from "@won/core/discounts/market-amounts";

import { codesStatus, tiersStatus } from "../../app/components/model/module-status.ts";
import { suggestedAmount } from "../../app/components/model/markets.ts";
import { marketRows } from "../../app/components/model/markets-overview.ts";
import type { RuleStatus } from "../../app/components/model/rule-status.ts";
import type { SyncView } from "../../app/components/model/types.ts";
import { campaignRuleChoices } from "../../app/lib/integration/campaigns-admin.server.ts";
import { readMarketRates } from "../../app/lib/integration/themes.server.ts";
import { tiersOverviewOf } from "../../app/lib/integration/tiers.server.ts";

// Audit of 6 Oct 2026 (docs/won-discounts/audit-dlazdice-trhy-2026-10-06.md): the findings N1–N21 and the
// proposals for markets. Screens are rendered in the dev harness (the same loader → component path as a request).

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
  const routes = [{ path: "/dev/preview/*", loader: mod.loader, action: mod.action, Component: mod.default }];
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(`http://localhost/dev/preview/${path}`));
  assert.ok(!(context instanceof Response), `${path}: a redirect`);
  assert.equal(context.statusCode, 200, path);
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(createElement(StaticRouterProvider, { router, context })).replace(/<script[\s\S]*?<\/script>/g, "");
}

function tile(html: string, key: string, attr = "data-won-tile"): string {
  const start = html.indexOf(`${attr}="${key}"`);
  assert.ok(start >= 0, `tile ${key}`);
  const next = html.indexOf(`${attr}=`, start + 10);
  return html.slice(start, next < 0 ? undefined : next);
}

const OK: SyncView = { state: "ok", at: "2026-09-28T16:20:00" };
const MARKETS = [
  { handle: "cz", currency: "CZK", enabled: true },
  { handle: "sk", currency: "EUR", enabled: true },
  { handle: "de", currency: "EUR", enabled: true },
  { handle: "hu", currency: "HUF", enabled: false },
];

test("N2 + N4: the home page lists a gift a market does not get, and the tile counts what the list shows", async () => {
  const html = await render("overview?state=modules");
  assert.match(html, /Dárek Ponožky Won — M nemá částku pro Slovensko\. Zákazníci ho tam nedostanou\./);
  assert.match(html, /href="\/app\/rewards#amounts"/);
  const rewards = tile(html, "rewards");
  assert.match(rewards, /data-won-state="active"/, "it still runs in Czechia");
  assert.match(rewards, /Slovensko: dárek se nenabízí · /);
  assert.match(rewards, /data-won-tile-issues[^>]*>1 věc k vyřešení/);
  // Three warnings about discounts on the page → three things on the Slevy a kódy tile (it said one).
  assert.match(tile(html, "codes"), /data-won-tile-issues[^>]*>3 věci k vyřešení/);
  assert.match(html, /4 upozornění/, "three discounts and the gift");
  assert.match(tile(html, "settings"), /2 trhy · tarif Free · chybí částky: Slovensko/);
});

test("N4: a discount that runs but has warnings counts them; a stopped one without a warning counts once", () => {
  const live = { kind: "live" } as RuleStatus;
  const failed = { kind: "sync_failed" } as RuleStatus;
  assert.deepEqual(codesStatus([live, live]), { state: "active", issues: 0 });
  assert.deepEqual(codesStatus([live, live, failed], [2, 0, 0]), { state: "active", issues: 3 });
});

test("N5 + N3: a new shop is 'ready', not 'active'; a narrow tile has its short sentence", async () => {
  const off = await render("overview?state=modules-off");
  assert.match(off, /Připraveno\. Zatím není co ukazovat\./);
  assert.doesNotMatch(off.slice(off.indexOf('id="status"'), off.indexOf("data-won-tiles")), /data-won-state="active"/);
  const codes = tile(off, "codes");
  assert.match(codes, /won-tile__about--long/);
  assert.match(codes, /won-tile__about-short[^>]*>Slevy v procentech i částkou a kódy\./);
  const on = await render("overview?state=modules");
  assert.match(tile(on, "codes"), /data-won-tile-active[^>]*>3 aktivní z 6 · /, "what runs comes first");
});

test("N13: a failed write names its one cause on the tiles that wait for it; no English detail, no informal address", async () => {
  const html = await render("overview?state=modules-failed");
  for (const key of ["tiers", "rewards", "margin"]) assert.match(tile(html, key), /data-won-tile-issues[^>]*>Čeká na opravu slevy „VIP10“/, key);
  assert.doesNotMatch(html, /could not create|Code must be unique|přesuň do Won/);
  assert.match(html, /nebo tu slevu přesuňte do Won\./);
});

test("N17 (changed by Ondřej, 7 Oct 2026): a Pro part says 'Pro' on its tile on every plan; a running sale is worded 'Běží výprodej'", async () => {
  const pro = await render("overview?state=modules&plan=pro");
  for (const key of ["outlet", "campaigns", "tryCart"]) {
    assert.match(tile(pro, key), /data-won-plan-badge="pro"/, key);
    assert.doesNotMatch(tile(pro, key), /data-won-tile-locked/, `${key}: not locked on Pro`);
  }
  assert.match(tile(pro, "outlet"), /Běží výprodej: /);
  assert.match(tile(await render("overview?state=modules"), "tryCart"), /data-won-tile-locked/, "Free: locked");
});

test("návrh 2: an amount for another market is suggested only from the rate set by hand in Shopify; without one the form says so", async () => {
  // 1 500 Kč × 0,04 = 60 €; 1 494 × 0,04 = 59,76 → a round 60; forints have no decimals.
  assert.equal(suggestedAmount(1500, 0.04, 2), 60);
  assert.equal(suggestedAmount(1494, 0.04, 2), 60);
  assert.equal(suggestedAmount(100, 0.04, 2), 4);
  assert.equal(suggestedAmount(1500, 15.8, 0), 23700);
  assert.equal(suggestedAmount(1500, undefined, 2), null, "no manual rate: nothing is suggested");
  assert.equal(suggestedAmount(0, 0.04, 2), null);

  let asked = 0;
  const graphql = async () => {
    asked += 1;
    return {
      data: {
        markets: {
          nodes: [
            { status: "ACTIVE", currencySettings: { baseCurrency: { currencyCode: "EUR", manualRate: "0.04" } } },
            { status: "ACTIVE", currencySettings: { baseCurrency: { currencyCode: "PLN", manualRate: null } } },
            { status: "DRAFT", currencySettings: { baseCurrency: { currencyCode: "HUF", manualRate: "15.8" } } },
            { status: "ACTIVE", currencySettings: { baseCurrency: { currencyCode: "USD", manualRate: "0.043" } } },
            { status: "ACTIVE", currencySettings: { baseCurrency: { currencyCode: "USD", manualRate: "0.05" } } },
          ],
        },
      },
    };
  };
  assert.deepEqual(await readMarketRates(graphql, "audit-rates.myshopify.com", "read_markets"), { EUR: 0.04 }, "automatic, switched-off and disagreeing markets have no rate to suggest with");
  assert.deepEqual(await readMarketRates(graphql, "audit-rates-2.myshopify.com", "read_products"), {}, "without the scope nothing is read");
  assert.equal(asked, 1);

  // The gift of the fixture has 1 500 Kč and no amount for Slovakia: the suggestion, or the sentence that no rate is set.
  // Milníky: one button for the whole amounts table (the empty cells are filled on the click, to be checked and saved).
  const withRate = await render("rewards");
  assert.match(withRate, /Vyplňte sloupec Česko \(CZK\)\. Ostatní trhy doplníme podle kurzu, který máte u trhu nastavený v Shopify\./);
  assert.match(withRate, /data-won-ms-suggest=""[\s\S]{0,900}<s-button variant="secondary">Navrhnout ostatní trhy<\/s-button>/);
  const without = await render("rewards?rates=none");
  assert.match(without, /Bez návrhu: Slovensko\. Trh nemá v Shopify ručně nastavený kurz, částku zadejte sami\./);
  assert.doesNotMatch(without, /Navrhnout ostatní trhy/);
});

test("N9 + N1: Milníky opened from the guide has a first step (free shipping) with the recipe's amounts; a new form shows no error yet", async () => {
  const html = await render("rewards?state=empty&start=shipping");
  assert.match(html, /<input type="hidden" name="ms\.step" value="shipping"\/>/);
  assert.match(html, /<input type="radio" name="ms\.shipping\.kind"[^>]*checked=""[^>]*value="shipping"\/>/);
  assert.match(html, /name="ms\.shipping\.amount\.CZK" label="1\. stupeň, Česko \(CZK\)"[^>]*value="1500"/);
  assert.match(html, /name="ms\.shipping\.amount\.EUR" label="1\. stupeň, Slovensko \(EUR\)"[^>]*value="60"/);
  assert.doesNotMatch(html, /částka chybí, v tomto trhu se stupeň nenabízí/);
  const plain = await render("rewards?state=empty");
  assert.doesNotMatch(plain, /name="ms\.step"/);
  assert.doesNotMatch(plain, /částka chybí/);
});

test("N6 + N7 + N10 + N19 + N21: Milníky says where the ladder shows, what to do after a save, and keeps the plan note with the steps", async () => {
  const html = await render("rewards?result=saved");
  assert.match(tile(html, "web", "data-won-view-body"), /Pruh nahoře ano · na stránce produktu ne · v košíku ano/);
  assert.match(html, /Pruh nahoře je zapnutý: jedna věta a tenký ukazatel na každé stránce\./);
  // The four places, each with its label.
  assert.deepEqual([...html.matchAll(/data-won-ms-place="(\w+)"/g)].map((m) => m[1]), ["topBar", "product", "drawer", "cart"]);
  const next = html.slice(html.indexOf("data-won-rewards-next"));
  assert.match(next.slice(0, 2600), /Zákazník uvidí 2 stupně\.[\s\S]*Slovensko: některý stupeň tam nemá částku a nenabízí se\.[\s\S]*Doplnit částky[\s\S]*Košík žebříček ukazuje\.[\s\S]*Na stránce produktu žebříček zatím není\.[\s\S]*Přidat na stránku produktu/);
  // N21: the plan note sits in the steps panel, under the tiles — not over the whole page.
  assert.ok(html.indexOf("Tohle je v tarifu Pro, zákazník to nedostane") > html.indexOf('data-won-view-panel="steps"'));
  // N19: the save button is hidden while "Odměny na webu" is open (nothing to save there) — it is shown for the form panels.
  assert.match(html, /<div style="display:block"><s-button type="submit" variant="primary">Uložit/);
  const empty = await render("rewards?state=empty");
  assert.match(tile(empty, "web", "data-won-view-body"), / · v košíku ne/);
  assert.match(tile(empty, "web", "data-won-view-body"), /data-won-tile-issues[^>]*>1 věc k vyřešení/);
});

test("N18: a tile has ONE border declaration, so a tile that stops being selected never keeps a stray colour", async () => {
  const html = await render("rewards");
  for (const body of html.match(/<div class="won-tile"[^>]*>/g) ?? []) {
    assert.match(body, /border:1px solid/);
    assert.doesNotMatch(body, /border-color/);
  }
});

test("N8: quantity levels name the market in one sentence, and a level that is not offered somewhere is something to resolve", async () => {
  const html = await render("tiers?plan=pro");
  assert.match(html, /Slovensko \(EUR\): úroveň od 6 ks se nenabízí\. Doplňte částku, nebo použijte procenta\./);
  assert.match(html, /label="Za kus: Slovensko \(EUR\)"/);
  const { config } = sanitizeConfig({
    markets: MARKETS,
    modules: { tiers: { sets: [{ id: "g", scope: "global", countAcross: "product", breaks: [{ minQty: 3, amountOff: { CZK: 3000, EUR: 120 } }, { minQty: 6, amountOff: { CZK: 6000 } }] }] } },
  });
  // The admin reads a config in its columns (loadConfig → core expandConfigAmounts): one amount key per market.
  // 7 Oct 2026: both euro markets lack the level, each is named by its market (one thing to resolve on the tile).
  const overview = tiersOverviewOf(expandConfigAmounts(config), "free", { state: "on", themeName: "Horizon" });
  assert.deepEqual(overview.missing, { global: ["EUR@sk", "EUR@de"], sets: [] }, "HUF is switched off: not asked for");
  assert.deepEqual(tiersStatus(overview, OK), { state: "active", issues: 1 });
});

test("N14: a campaign asks for the currencies of enabled markets only and says where the discount is not offered", async () => {
  const { config } = sanitizeConfig({
    markets: MARKETS,
    modules: {
      codes: {
        rules: [
          { id: "both", name: "Sleva", enabled: true, method: "automatic", value: { kind: "fixed", amount: { CZK: 20000, EUR: 800, HUF: 300000 } }, target: { kind: "order" } },
          { id: "czk", name: "Černý pátek", enabled: true, method: "automatic", value: { kind: "fixed", amount: { CZK: 30000 } }, target: { kind: "order" } },
        ],
      },
    },
  });
  const choices = campaignRuleChoices(expandConfigAmounts(config), "cs");
  assert.deepEqual(choices.map((c) => [c.id, c.currencies, c.missing]), [
    ["both", ["CZK", "EUR@de", "EUR@sk"], []],
    ["czk", ["CZK"], ["EUR@sk", "EUR@de"]],
  ]);
  const html = await render("campaigns?plan=pro&edit=bf");
  assert.doesNotMatch(html, /Sleva v kampani[^"]*HUF/);
  assert.match(html, /label="Sleva v kampani: Slovensko \(EUR\)"/);
  assert.match(html, /Slovensko: tahle sleva tam nemá částku, proto se tam nenabízí ani v kampani\./);
});

test("N15: the markets table — amounts, what is missing with its link, percent levels, switched-off markets last", () => {
  const { config } = sanitizeConfig({
    markets: MARKETS,
    modules: {
      codes: { rules: [{ id: "czk", name: "Černý pátek", enabled: true, method: "automatic", value: { kind: "fixed", amount: { CZK: 30000 } }, target: { kind: "order" } }] },
      rewards: { freeShipping: { threshold: { CZK: 100000, EUR: 4000 } }, gifts: [{ id: "g1", threshold: { CZK: 150000 }, choices: ["gid://shopify/ProductVariant/1"] }] },
      tiers: { sets: [{ id: "g", scope: "global", countAcross: "product", breaks: [{ minQty: 3, percent: 10 }] }] },
    },
  });
  const rows = marketRows(config, { plan: "free", names: { cz: "Česko", sk: "Slovensko", de: "Německo", hu: "Maďarsko" }, locale: "cs" });
  assert.deepEqual(rows.map((r) => [r.name, r.enabled, r.missing]), [
    ["Česko", true, 0],
    ["Slovensko", true, 2],
    ["Německo", true, 2],
    ["Maďarsko", false, 0],
  ]);
  const sk = rows[1]!;
  assert.equal(sk.shipping.kind, "amount");
  assert.match(sk.shipping.kind === "amount" ? sk.shipping.text : "", /^40\s€$/);
  assert.deepEqual(sk.gift, { kind: "missing", href: "/app/rewards#amounts" });
  assert.deepEqual(sk.discounts, { kind: "missing", href: "/app/discounts/czk#value", count: 1 });
  assert.deepEqual(sk.tiers, { kind: "percent" });
  assert.deepEqual(rows[0]!.discounts, { kind: "ok" });
  // 7 Oct 2026: two markets of one currency no longer share an amount — each row is its own market's.
  const own = sanitizeConfig({ markets: MARKETS, modules: { rewards: { freeShipping: { threshold: { CZK: 100000, "EUR@sk": 4000, "EUR@de": 6000 } }, gifts: [] } } }).config;
  const ownRows = marketRows(own, { plan: "free", names: { cz: "Česko", sk: "Slovensko", de: "Německo", hu: "Maďarsko" }, locale: "cs" });
  assert.deepEqual(ownRows.map((r) => (r.shipping.kind === "amount" ? r.shipping.text.replace(/\s/g, " ") : r.shipping.kind)), ["1 000 Kč", "40 €", "60 €", "missing"]);
  const onlySk = sanitizeConfig({ markets: MARKETS, modules: { rewards: { freeShipping: { threshold: { CZK: 100000, "EUR@sk": 4000 } }, gifts: [] } } }).config;
  assert.deepEqual(marketRows(onlySk, { plan: "free", locale: "cs" }).map((r) => r.shipping.kind), ["amount", "amount", "missing", "missing"], "Germany has no amount of its own: missing there, not Slovakia's");
});

test("N16: the sale page lists what there is to resolve, each row with the link to its sale", async () => {
  const html = await render("outlet?plan=pro");
  const todo = html.slice(html.indexOf("data-won-outlet-todo"), html.indexOf('id="running"'));
  assert.equal((todo.match(/href="#run-/g) ?? []).length, 2);
  assert.match(todo, /Ponožky Won — 39–42: po konci se vrátilo 2 ks\./);
  assert.match(tile(html, "sales", "data-won-view-body"), /data-won-tile-issues[^>]*>2 věci k vyřešení/, "the tile counts the same rows");
});

test("slovníček: the words a merchant does not know are gone from the screens", async () => {
  for (const path of ["overview?state=modules", "rewards", "tiers", "onboarding?step=3", "settings"]) {
    const text = (await render(path)).replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
    assert.doesNotMatch(text, /V tématu|Chybí v tématu|editor(u)? tématu|Synchronizovat znovu|Synchronizace se Shopify|zapsáno do Shopify|Počítání prahu|strop slevy/i, path);
  }
});

test("7 Oct 2026: quantity levels are numbered cards, suggestions sit in their own box, the preview has one heading and a colour picker", async () => {
  const html = await render("tiers");
  assert.equal((html.match(/data-won-tier-row/g) ?? []).length, 3);
  assert.match(html, />Úroveň 1<\/span><span[^>]*>od 3 ks</);
  assert.match(html, />Úroveň 3<\/span><span[^>]*>od 10 ks</);
  const text = html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(text, /Náhled na webu/, "one heading: Vzhled na webu");
  assert.equal((text.match(/Vzhled na webu/g) ?? []).length, 1);
  // The ready-made colours are offered on Free; the stored one ("theme") is checked.
  const picker = html.slice(html.indexOf("data-won-accent-picker"));
  for (const value of ["theme", "green", "blue", "orange", "red", "violet"]) assert.match(picker.slice(0, 6000), new RegExp(`<input type="radio" name="accentPreset"[^>]*value="${value}"`), value);
  assert.match(picker.slice(0, 6000), /Podle webu[\s\S]*Zelená[\s\S]*Fialová/);
  // (a fixed discount step of Milníky uses the same box for its amounts; the amounts table has one button of its own)
  const rewards = await render("rewards?plan=pro&state=discounts");
  assert.match(rewards, /data-won-amount-suggest/);
  assert.match(rewards, /data-won-ms-suggest=""/);
});

test("7 Oct 2026: Ochrana marže says 'Takhle by zasáhla' only above rows it describes", async () => {
  const off = (await render("margin?state=off&plan=pro")).replace(/<[^>]+>/g, " ");
  if (/Žádná aktivní sleva teď pod hranici nejde/.test(off)) assert.doesNotMatch(off, /Takhle by zasáhla/);
});

test("úkol 1 (7 Oct 2026): with Won switched off on the storefront, the colour picker says the colour cannot show there", async () => {
  // Won on: a picked colour needs no warning.
  const on = await render("tiers?accent=green");
  assert.ok(/<input type="radio" name="accentPreset"[^>]*checked=""[^>]*value="green"/.test(on), "the stored colour is the picked one");
  assert.ok(!on.includes("data-won-accent-embed-off"), "Won on: no warning");
  // Won off: the sentence and the one way to switch it on.
  const off = await render("tiers?accent=green&embed=off");
  const note = off.slice(off.indexOf("data-won-accent-embed-off"));
  assert.ok(off.includes("data-won-accent-embed-off"), "the note is there");
  assert.match(note.slice(0, 900).replace(/<[^>]+>/g, " "), /Won na webu je vypnutý, barva se proto na webu neukáže\.\s+Zapnout Won na webu/);
  assert.ok(/href="[^"]*activateAppId=/.test(note.slice(0, 900)), "the link switches Won on");
  // The colour of the storefront itself ("Podle webu") needs nothing from Won: no warning.
  assert.ok(!(await render("tiers?embed=off")).includes("data-won-accent-embed-off"), "the storefront's own colour: no warning");
  // Not known (no permission to read the storefront): the page does not claim it is off.
  assert.ok(!(await render("tiers?accent=green&embed=noscope")).includes("data-won-accent-embed-off"), "not known: nothing claimed");
  const en = (await render("tiers?accent=green&embed=off&locale=en")).replace(/<[^>]+>/g, " ");
  assert.match(en, /Won is switched off on your storefront, so the colour will not show there\./);
});

test("úkol 3 (7 Oct 2026): a campaign's amount fields suggest the other market's amount, or say there is no rate", async () => {
  const text = (part: string) => part.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const boxesOf = (html: string) => html.match(/<div data-won-suggest="[a-z]+"[\s\S]*?<\/div>/g) ?? [];
  // "Black Friday": 400 Kč off, typed only for Česko. Rate 0,04 → 16 € for Slovensko, offered with its button.
  const html = await render("campaigns?plan=pro&state=suggest&edit=bf");
  const boxes = boxesOf(html);
  assert.equal(boxes.length, 1, "the discount; the levels have both markets' amounts");
  assert.ok(boxes[0]!.startsWith('<div data-won-suggest="offer"'), "an offer");
  assert.ok(/Návrh\s+Slovensko \(EUR\): navrhujeme 16\s€/.test(text(boxes[0]!)), text(boxes[0]!));
  assert.ok(/<s-button[^>]*>Použít 16\s€<\/s-button>/.test(boxes[0]!), "the button fills the field");
  // Nothing is filled without the click.
  assert.ok(/<s-number-field name="cp\.amount\.dev-fixture-3\.EUR"[^>]*value=""/.test(html), "the field stays empty");
  assert.ok(html.includes('label="Sleva za kus v kampani: Slovensko (EUR)"'), "an amount per item is named by its market");
  // The amounts per item (40 and 60 Kč from 3 and 5 pieces), the other market's fields emptied: one suggestion per level.
  const levels = boxesOf(await render("campaigns?plan=pro&state=suggest&edit=bf&result=invalid-tier"));
  assert.equal(levels.length, 3, "the discount and the two levels");
  assert.deepEqual(levels.map((b) => (text(b).match(/navrhujeme ([\d,]+)\s€/) ?? [])[1]), ["16", "1,50", "2,50"], "1,60 and 2,40 € rounded like every suggestion");
  // No rate set by hand in Shopify: the form says so instead of guessing.
  const none = await render("campaigns?plan=pro&state=suggest&edit=bf&result=invalid-tier&rates=none");
  assert.equal((none.match(/data-won-suggest="none"/g) ?? []).length, 3);
  assert.equal((none.match(/data-won-suggest="offer"/g) ?? []).length, 0);
  assert.ok(/Bez návrhu/.test(text(boxesOf(none)[0]!)), text(boxesOf(none)[0]!));
  // Both markets already have their amount: nothing is suggested.
  assert.equal(((await render("campaigns?plan=pro&edit=bf")).match(/data-won-suggest=/g) ?? []).length, 0);
});
