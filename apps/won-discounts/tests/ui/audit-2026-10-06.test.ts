// The admin preview imports the storefront CSS / locales with Vite `?raw`: node needs the hook first.
import "./support/raw-import.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

import { sanitizeConfig } from "@won/core/discounts/config";

import { codesStatus, tiersStatus } from "../../app/components/model/module-status.ts";
import { marketRows, sharedCurrencyGroups } from "../../app/components/model/markets-overview.ts";
import type { RuleStatus } from "../../app/components/model/rule-status.ts";
import type { SyncView } from "../../app/components/model/types.ts";
import { campaignRuleChoices } from "../../app/lib/integration/campaigns-admin.server.ts";
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
  assert.match(html, /href="\/app\/rewards#gift"/);
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

test("N17: a shop on Pro is not told 'Pro' on its tiles", async () => {
  const pro = await render("overview?state=modules&plan=pro");
  assert.doesNotMatch(tile(pro, "outlet"), /data-won-plan-badge/);
  assert.match(tile(pro, "outlet"), /Běží výprodej: /);
  assert.match(tile(await render("overview?state=modules"), "outlet"), /data-won-plan-badge="pro"/, "Free still sees what is Pro");
});

test("N9 + N1: Odměny opened from the guide has free shipping on with the recipe's amounts; a new form shows no error yet", async () => {
  const html = await render("rewards?state=empty&start=shipping");
  assert.match(html, /<s-switch[^>]*name="rw\.ship\.on"[^>]*checked/);
  assert.match(html, /label="Od částky: Česko \(CZK\)"[^>]*value="1500"/);
  assert.match(html, /label="Od částky: Slovensko \(EUR\)"[^>]*value="60"/);
  assert.doesNotMatch(html, /částka chybí, v tomto trhu se odměna nenabízí/);
  const plain = await render("rewards?state=empty");
  assert.doesNotMatch(plain, /<s-switch[^>]*name="rw\.ship\.on"[^>]*checked/);
  assert.doesNotMatch(plain, /částka chybí/);
});

test("N6 + N7 + N10 + N19 + N21: Odměny says where rewards show, what to do after a save, and keeps the plan note with the gifts", async () => {
  const html = await render("rewards?result=saved");
  assert.match(tile(html, "web", "data-won-view-body"), /V košíku ano · na stránce produktu ne · na úvodní stránce ne · pruh nahoře ano/);
  assert.match(html, /Pruh nahoře na celém webu je zapnutý\./);
  const next = html.slice(html.indexOf("data-won-rewards-next"));
  assert.match(next.slice(0, 1500), /Zákazník odměny uvidí v košíku\.[\s\S]*Na stránce produktu odměny zatím nejsou\.[\s\S]*Přidat na stránku produktu/);
  // N21: the plan note sits in the gift panel, under the tiles — not over the whole page.
  assert.ok(html.indexOf("Tohle je v tarifu Pro, zákazník to nedostane") > html.indexOf('data-won-view-panel="gift"'));
  // N19: the save button is hidden while "Odměny na webu" is open (nothing to save there) — it is shown for the form panels.
  assert.match(html, /<div style="display:block"><s-button type="submit" variant="primary">Uložit/);
  const empty = await render("rewards?state=empty");
  assert.match(tile(empty, "web", "data-won-view-body"), /V košíku ne · /);
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
  const overview = tiersOverviewOf(config, "free", { state: "on", themeName: "Horizon" });
  assert.deepEqual(overview.missing, { global: ["EUR"], sets: [] }, "HUF is switched off: not asked for");
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
  const choices = campaignRuleChoices(config, "cs");
  assert.deepEqual(choices.map((c) => [c.id, c.currencies, c.missing]), [
    ["both", ["CZK", "EUR"], []],
    ["czk", ["CZK"], ["EUR"]],
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
  assert.deepEqual(sk.gift, { kind: "missing", href: "/app/rewards#gift" });
  assert.deepEqual(sk.discounts, { kind: "missing", href: "/app/discounts/czk#value", count: 1 });
  assert.deepEqual(sk.tiers, { kind: "percent" });
  assert.deepEqual(rows[0]!.discounts, { kind: "ok" });
  assert.deepEqual(sharedCurrencyGroups(rows), [{ currency: "EUR", names: ["Slovensko", "Německo"] }], "two markets, one currency: said in words");
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
