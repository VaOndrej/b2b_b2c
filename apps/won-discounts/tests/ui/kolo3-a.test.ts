// The admin preview imports the storefront CSS / locales with Vite `?raw`: node needs the hook first.
import "./support/raw-import.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

// Feedback 3 (6 Oct 2026), dávka A — body 1, 2, 3, 5, 6, 8, 15. Every check renders the real screen in the dev
// harness (the same loader → component path as a request) and reads the markers the shell writes:
// `data-won-state` on a status label, `data-won-placement` on a theme-placement label, `data-won-tile` on a home tile.

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

/** The markup of one WonSection (sections are never nested). */
function section(html: string, id: string): string {
  const start = html.indexOf(`<section id="${id}"`);
  assert.ok(start >= 0, `section #${id} is on the page`);
  return html.slice(start, html.indexOf("</section>", start));
}

/** The markup of one home tile. */
function tile(html: string, key: string): string {
  const start = html.indexOf(`data-won-tile="${key}"`);
  assert.ok(start >= 0, `tile ${key} is on the home page`);
  const next = html.indexOf("data-won-tile=", start + 10);
  return html.slice(start, next < 0 ? undefined : next);
}

const stateOf = (markup: string) => /data-won-state="(\w+)"/.exec(markup)?.[1] ?? null;
const count = (markup: string, re: RegExp) => (markup.match(re) ?? []).length;
/** Plan markers: "Pro" and "Pro · odemknout". */
const PRO_BADGE = /data-won-plan-badge="pro"/g;

test("body 2 a 3: the home page is a grid of tiles, each one a single link; no module cards, no 'Upravit' buttons", async () => {
  const html = await render("overview?state=modules&plan=pro");
  assert.match(html, /data-won-tiles/);
  const hrefs = ["/app/discounts", "/app/tiers", "/app/rewards", "/app/outlet", "/app/campaigns", "/app/margin", "/app/analytics", "/app/appearance", "/app/try-cart", "/app/settings"];
  for (const href of hrefs) assert.match(html, new RegExp(`<s-clickable href="${href}"[^>]*>\\s*<div[^>]*data-won-tile=`), `tile → ${href}`);
  assert.equal(count(html, /data-won-tile="/g), hrefs.length);
  // The whole tile is the link: nothing inside it is a button or a second link.
  for (const key of ["codes", "tiers", "rewards", "outlet", "campaigns", "margin"]) assert.doesNotMatch(tile(html, key), /<s-button|<s-link|<a /, key);
  // The module cards and their rows moved to the module pages.
  assert.doesNotMatch(html, /<section id="(tiers|rewards|outlet|campaigns|margin|analytics)"/);
  assert.doesNotMatch(html, /Spravovat slevy|Upravit množstevní slevy|Otevřít kampaně/);
  // One sentence with the real settings (P5), not a generic line.
  assert.match(tile(html, "tiers"), /Od 3 ks −10\s%, od 5 ks −15\s%/);
  assert.match(tile(html, "rewards"), /Doprava zdarma od 1\s000\sKč/);
  assert.match(tile(html, "margin"), /Min\. marže|nejvýš/);
  // What needs the merchant stays above the grid, each row with its link to the field.
  const live = await render("overview?state=live");
  assert.match(live, /href="\/app\/discounts\/dev-fixture-[^"]+#\w+"/);
  assert.ok(live.indexOf("Vyžaduje pozornost") < live.indexOf("data-won-tiles"), "attention sits above the tiles");
});

test("body 2 a 3: Pro modules on Free are amber tiles that lead to the module page; an empty shop still gets every tile", async () => {
  const free = await render("overview?state=modules");
  for (const key of ["outlet", "campaigns", "tryCart"]) {
    assert.equal(count(tile(free, key), PRO_BADGE), 1, `${key}: one Pro marker`);
    assert.match(tile(free, key), /data-won-tile-locked/);
  }
  assert.match(free, /<s-clickable href="\/app\/outlet"/);
  const empty = await render("overview?state=empty");
  assert.equal(count(empty, /data-won-tile="/g), 10);
  assert.equal(stateOf(tile(empty, "codes")), "inactive");
  assert.match(empty, /Krok 1 z/);
});

test("body 1 a 8: the home tile and the module page say the same state", async () => {
  for (const plan of ["", "&plan=pro"]) {
    const home = await render(`overview?state=modules${plan}`);
    const q = plan ? "?plan=pro" : "";
    const tiers = await render(`tiers${q}`);
    const rewards = await render(`rewards${q}`);
    const margin = await render(`margin${q}`);
    // Množstevní slevy: set up, written → "Aktivní" on both.
    assert.equal(stateOf(tile(home, "tiers")), "active", `tiers tile ${plan}`);
    assert.equal(stateOf(section(tiers, "global")), "active", `tiers page ${plan}`);
    // Odměny: free shipping and the gift each carry the label (bod 8).
    assert.equal(stateOf(tile(home, "rewards")), "active", `rewards tile ${plan}`);
    assert.equal(stateOf(section(rewards, "shipping")), "active", `shipping ${plan}`);
    assert.equal(stateOf(section(rewards, "gift")), "active", `gift ${plan}`);
    // Ochrana marže (the label was missing on both).
    assert.equal(stateOf(tile(home, "margin")), "active", `margin tile ${plan}`);
    assert.equal(stateOf(section(margin, "settings")), "active", `margin page ${plan}`);
    assert.match(section(margin, "settings"), />Aktivní</);
  }
  // Pro modules: running → active on both; on Free → locked (the Pro marker), never a green or grey label.
  const pro = await render("overview?state=modules&plan=pro");
  // (the sale fixture has a failed step: "Vyžaduje pozornost" on both, with the count on the tile)
  assert.equal(stateOf(tile(pro, "outlet")), "attention");
  assert.match(tile(pro, "outlet"), /data-won-tile-issues/);
  assert.equal(stateOf(section(await render("outlet?plan=pro&orders=on"), "running")), "attention");
  assert.equal(stateOf(tile(pro, "campaigns")), "active");
  assert.equal(stateOf(section(await render("campaigns?plan=pro"), "list")), "active");
  assert.equal(stateOf(tile(pro, "codes")), "active");
  assert.equal(stateOf(section(await render("discounts?sync=ok"), "list")), "active");
  // Off → "Neaktivní" on both, in words.
  const off = await render("overview?state=modules-off");
  assert.equal(stateOf(tile(off, "tiers")), "inactive");
  assert.equal(stateOf(tile(off, "margin")), "inactive");
  assert.match(tile(off, "margin"), />Neaktivní</);
  assert.equal(stateOf(section(await render("tiers?state=empty"), "global")), "inactive");
  assert.equal(stateOf(section(await render("margin?state=off"), "settings")), "inactive");
  assert.equal(stateOf(section(await render("rewards?state=empty"), "shipping")), "inactive");
  // A failed write: "Vyžaduje pozornost" on both.
  const failed = await render("overview?state=modules-failed");
  assert.equal(stateOf(tile(failed, "tiers")), "attention");
  assert.match(tile(failed, "tiers"), />Vyžaduje pozornost</);
  assert.equal(stateOf(section(await render("tiers?state=sync-failed"), "global")), "attention");
});

test("bod 1: the English label is 'Active'", async () => {
  const html = await render("overview?state=modules&plan=pro&locale=en");
  assert.match(tile(html, "tiers"), />Active</);
  assert.doesNotMatch(html, />Live</);
});

test("bod 5: a theme placement says where it stands — green in the theme, red missing with the add button in the header, grey not verified", async () => {
  const on = section(await render("tiers"), "block");
  assert.match(on, /data-won-placement="in_theme"[^>]*>.*?Na webu/s);
  assert.doesNotMatch(on, /Přidat na web/);
  const off = section(await render("tiers?state=alternate"), "block");
  assert.match(off, /data-won-placement="missing"[^>]*>.*?Na webu chybí/s);
  assert.match(off, /data-won-section-action[^>]*>\s*<s-button[^>]*variant="primary"[^>]*>Přidat na web/);
  const unknown = section(await render("tiers?state=block-unknown"), "block");
  assert.match(unknown, /data-won-placement="unknown"[^>]*>.*?Nepodařilo se zjistit/s);
  assert.match(unknown, /Zkontrolovat znovu/);
  // The same pattern for every placement: Won in the theme, the cart block, the rewards progress, the top bar,
  // the campaign banner, the sale badge.
  const rewards = await render("rewards");
  assert.match(section(rewards, "cart"), /data-won-placement="in_theme"/);
  assert.equal(count(section(rewards, "places"), /data-won-placement="/g), 3);
  assert.match(section(rewards, "places"), /data-won-placement="missing"[\s\S]*Přidat na web/);
  const draft = section(await render("rewards?state=embed-draft"), "cart");
  assert.match(draft, /data-won-placement="missing"/);
  assert.match(draft, /data-won-section-action/);
  assert.equal(count(section(await render("campaigns?plan=pro"), "places"), /data-won-placement="/g), 3);
  assert.match(section(await render("outlet?plan=pro"), "badge"), /data-won-placement="(in_theme|missing|unknown)"/);
});

test("bod 6: Pro is marked once per section — nothing amber and no second Pro marker inside", async () => {
  const cases: [string, string][] = [
    ["tiers?plan=pro", "pro"],
    ["tiers", "pro"],
    ["margin?plan=pro", "collections"],
    ["margin", "collections"],
    ["rule-editor?rule=dev-fixture-2&plan=pro", "pro"],
    ["rule-editor?rule=dev-fixture-2", "pro"],
    ["outlet", "new"],
    ["campaigns", "form"],
    ["analytics", "rules"],
    ["plan?plan=pro", "pro"],
  ];
  for (const [path, id] of cases) {
    const markup = section(await render(path), id);
    assert.equal(count(markup, PRO_BADGE), 1, `${path} #${id}: exactly one Pro marker`);
    assert.doesNotMatch(markup, /data-won-pro-frame="amber"/, `${path} #${id}: no amber frame inside a Pro section`);
    assert.doesNotMatch(markup, /data-won-block="pro"/, `${path} #${id}: nested blocks are neutral`);
  }
  // On the Pro plan the choice "Celý košík" inside an exception has no marker of its own (the shop has it).
  assert.doesNotMatch(section(await render("tiers?plan=pro"), "global"), PRO_BADGE);
  // A Pro piece inside a section that is not Pro keeps its one marker (Free: "Celý košík").
  assert.equal(count(section(await render("tiers"), "global"), PRO_BADGE), 2, "Free: Celý košík + Vlastní barvy a CSS");
});

test("bod 15: 'Prázdná sleva' is 'Vlastní sleva', with what it is, set apart from the recipes", async () => {
  const html = await render("discounts?state=empty");
  assert.match(html, /data-won-recipe="blank"/);
  assert.match(html, /Vlastní sleva/);
  assert.match(html, /Začnete s čistým formulářem a nastavíte vše sami\./);
  assert.doesNotMatch(html, /Prázdná sleva/);
  const en = await render("discounts?state=empty&locale=en");
  assert.match(en, /Custom discount/);
  assert.match(en, /You start with a clean form and set everything yourself\./);
});

// --- Feedback 6 Oct 2026 (after dávka A): what a tile covers + what is active; Výprodej as tiles ---------------

test("home tiles: each says what is under it, and below that what is active now", async () => {
  const html = await render("overview?state=modules&plan=pro");
  for (const key of ["codes", "tiers", "rewards", "outlet", "campaigns", "margin", "analytics", "appearance", "tryCart", "settings"]) {
    assert.match(tile(html, key), /data-won-tile-about/, `${key}: what the part is for`);
  }
  const rewards = tile(html, "rewards");
  assert.match(rewards, /data-won-tile-about[^>]*><span[^>]*>[^<]*doprava zdarma[^<]*dárek/i, "Odměny: what it covers");
  assert.match(rewards, /data-won-tile-active[^>]*>[^<]*Doprava zdarma od 1\s000\sKč/, "…and what is set");
  assert.ok(rewards.indexOf("data-won-tile-about") < rewards.indexOf("data-won-tile-active"), "the explanation first, the state under it");
  assert.match(tile(html, "tiers"), /data-won-tile-about[^>]*><span[^>]*>[^<]*podle počtu kusů/);
  assert.match(tile(html, "tiers"), /data-won-tile-active[^>]*>[^<]*Od 3 ks/);
  // Nothing set up: the explanation stays, the state line says so.
  const off = await render("overview?state=modules-off");
  assert.match(tile(off, "rewards"), /data-won-tile-about/);
  assert.match(tile(off, "rewards"), /data-won-tile-active[^>]*>[^<]*Žádná doprava zdarma ani dárek/);
});

test("Výprodej: three tiles instead of one long page — the sales (with their state), a new sale, how it works; one panel at a time", async () => {
  const html = await render("outlet?plan=pro&orders=on");
  assert.equal(count(html, /data-won-view-tile="/g), 3);
  for (const key of ["sales", "new", "info"]) assert.match(html, new RegExp(`data-won-view-tile="${key}"`));
  // The sales tile carries the module's state; a shop with running sales lands on them, not on the form.
  assert.match(html, /data-won-view-tile="sales"[^>]*aria-pressed="true"/);
  const panel = (key: string) => new RegExp(`data-won-view-panel="${key}"[^>]*style="display:(block|none)"`).exec(html)?.[1];
  assert.equal(panel("sales"), "block");
  assert.equal(panel("new"), "none");
  assert.equal(panel("info"), "none");
  // Inside the sales panel the running ones come first, the ended ones last.
  assert.ok(html.indexOf('<section id="running"') < html.indexOf('<section id="ended"'));
  assert.ok(html.indexOf('data-won-view-panel="sales"') < html.indexOf('<section id="running"'));
  // A sale just started: the page shows the sales (the new one on top), not the empty form again.
  const started = await render("outlet?plan=pro&result=started");
  assert.match(started, /data-won-view-tile="sales"[^>]*aria-pressed="true"/);
  // A refused start stays on the form with what was typed.
  const invalid = await render("outlet?plan=pro&result=invalid");
  assert.match(invalid, /data-won-view-tile="new"[^>]*aria-pressed="true"/);
  // Nothing yet: the form.
  const empty = await render("outlet?plan=pro&state=empty");
  assert.match(empty, /data-won-view-tile="new"[^>]*aria-pressed="true"/);
  // Free: the new-sale tile is the one Pro marker of the row.
  const free = await render("outlet");
  assert.match(free, /data-won-view-tile="new"[^>]*data-won-tile-locked/);
});

test("the module pages are tiles and one panel at a time: Množstevní slevy, Odměny, Kampaně, Ochrana marže", async () => {
  const pages: [string, string[], string][] = [
    ["tiers?plan=pro", ["global", "table", "exceptions"], "global"],
    ["rewards", ["shipping", "gift", "web"], "shipping"],
    ["campaigns?plan=pro", ["list", "form", "places"], "list"],
    ["campaigns?plan=pro&edit=weekend", ["list", "form", "places"], "form"],
    ["margin?plan=pro", ["settings", "costs", "collections", "impact"], "settings"],
  ];
  for (const [path, views, open] of pages) {
    const html = await render(path);
    assert.deepEqual([...html.matchAll(/data-won-view-tile="(\w+)"/g)].map((m) => m[1]), views, path);
    for (const view of views) {
      // Every tile says what the part is for; exactly the open panel is shown, the others stay mounted (their fields submit).
      assert.match(html, new RegExp(`data-won-view-tile="${view}"[\\s\\S]*?data-won-tile-about`), `${path} ${view}`);
      const shown = new RegExp(`data-won-view-panel="${view}" style="display:(block|none)"`).exec(html)?.[1];
      assert.equal(shown, view === open ? "block" : "none", `${path}: panel ${view}`);
    }
    assert.match(html, new RegExp(`data-won-view-tile="${open}"[^>]*aria-pressed="true"`), path);
  }
  // One form, one Save, outside the panels: still the last control of the page.
  const tiers = await render("tiers?plan=pro");
  assert.ok(tiers.lastIndexOf('type="submit"') > tiers.lastIndexOf("data-won-view-panel="));
  // The tile of a part carries the same state as its section and as the home tile.
  assert.match(tiers, /data-won-view-tile="global"[\s\S]*?data-won-state="active"/);
  // Free: the Pro parts are amber tiles.
  assert.match(await render("tiers"), /data-won-view-tile="exceptions"[^>]*data-won-tile-locked/);
  assert.match(await render("margin"), /data-won-view-tile="collections"[^>]*data-won-tile-locked/);
});
