import assert from "node:assert/strict";
import { test } from "node:test";

import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

import { LocaleProvider } from "../../app/i18n/context.tsx";
import {
  ADMIN_MODULES,
  DISCOUNT_PAGES,
  discountPages,
  discountPageStates,
  discountSubNavItems,
  layoutReloads,
  navItems,
  orderedModules,
} from "../../app/components/model/modules.ts";
import type { DiscountNavData } from "../../app/components/model/modules.ts";
import { DiscountNav, DiscountsSubNav } from "../../app/components/shell/SubNav.tsx";
import { SectionNav } from "../../app/components/shell/SectionNav.tsx";

// The menu after 6 Oct 2026 (docs/won-discounts/plan-zmen-2026-10-06.md, P1): the
// Shopify sidebar has five items after the home link; the discount pages share
// "Slevy" and a sub-navigation on the page, ordered by the onboarding goals
// ("Vybrané moduly dáme na první místo" — goals only ORDER, every page stays).
// Tarif and Vyzkoušet košík live in Nastavení. The nav is the shared Won one
// (@won/app-kit/admin-nav, SHARE-1) with a localized home label.

test("goals put their modules first, in the order picked; every module stays", () => {
  assert.deepEqual(orderedModules([]), [...ADMIN_MODULES]);
  assert.deepEqual(orderedModules(["margin", "migrate", "rewards", "margin"]), ["margin", "rewards", "tiers", "outlet", "campaigns", "appearance"]);
  for (const goals of [[], ["outlet"], ["tiers", "rewards", "outlet", "margin"]] as const) {
    assert.deepEqual([...orderedModules(goals)].sort(), [...ADMIN_MODULES].sort());
  }
});

test("sidebar: exactly five items after the home link, in a fixed order, whatever the goals", () => {
  const items = navItems("cs");
  assert.deepEqual(
    items.map((i) => i.to),
    ["/app/discounts", "/app/margin", "/app/appearance", "/app/analytics", "/app/settings"],
  );
  assert.deepEqual(
    items.map((i) => i.label),
    ["Slevy", "Ochrana marže", "Vzhled", "Přehledy", "Nastavení"],
  );
  assert.deepEqual(
    navItems("en").map((i) => i.label),
    ["Discounts", "Margin protection", "Appearance", "Reports", "Settings"],
  );
});

test("sidebar: no plan suffix, no Tarif, no Vyzkoušet košík (they live in Nastavení)", () => {
  for (const locale of ["cs", "en"] as const) {
    for (const item of navItems(locale)) {
      assert.doesNotMatch(item.label, /\(Pro\)/, item.label);
      assert.notEqual(item.to, "/app/plan");
      assert.notEqual(item.to, "/app/try-cart");
    }
  }
});

test("sub-navigation of Slevy: Slevy a kódy first, then the four modules in goal order", () => {
  assert.deepEqual(discountPages([]), ["discounts", "tiers", "rewards", "outlet", "campaigns"]);
  assert.deepEqual(discountPages(["outlet", "margin", "rewards"]), ["discounts", "outlet", "rewards", "tiers", "campaigns"]);
  // A goal that is not a discount page (margin, migrate) never adds or drops an item.
  for (const goals of [[], ["margin"], ["migrate"], ["tiers", "rewards", "outlet", "margin"]] as const) {
    assert.deepEqual([...discountPages(goals)].sort(), [...DISCOUNT_PAGES].sort());
    assert.equal(discountPages(goals)[0], "discounts");
  }
});

test("sub-navigation items: the URLs stay, labels carry no plan suffix, Pro is a flag", () => {
  const items = discountSubNavItems("cs", ["rewards"]);
  assert.deepEqual(
    items.map((i) => [i.to, i.label, i.pro]),
    [
      ["/app/discounts", "Slevy a kódy", false],
      ["/app/rewards", "Milníky", false],
      ["/app/tiers", "Množstevní slevy", false],
      ["/app/outlet", "Výprodej", true],
      ["/app/campaigns", "Kampaně", true],
    ],
  );
  assert.equal(discountSubNavItems("en", [])[0].label, "Discounts & codes");
});

test("the strip's states are the modules' states; 'Slevy a kódy' is the module codes; what is not known has none", () => {
  assert.deepEqual(discountPageStates({}), {});
  assert.deepEqual(
    discountPageStates({ codes: { state: "active", issues: 2 }, tiers: { state: "inactive", issues: 0 }, outlet: { state: "locked", issues: 0 }, margin: { state: "attention", issues: 1 } }),
    { discounts: "active", tiers: "inactive", outlet: "locked" },
  );
});

test("the layout reads its data again after a save, on a new locale and on another page — not inside one page", () => {
  const stay = { submitted: false, localeInUrl: false, fromPath: "/app/tiers", toPath: "/app/tiers" };
  assert.equal(layoutReloads(stay), false, "a hash or a query string on the same page");
  assert.equal(layoutReloads({ ...stay, toPath: "/app/rewards" }), true);
  assert.equal(layoutReloads({ ...stay, submitted: true }), true);
  assert.equal(layoutReloads({ ...stay, localeInUrl: true }), true);
});

test("an item carries its module's state for the dot; a locked module has none (the Pro badge says it)", () => {
  const items = discountSubNavItems("cs", [], { discounts: "active", tiers: "attention", rewards: "inactive", outlet: "locked" });
  assert.deepEqual(
    items.map((i) => [i.key, i.state ?? null]),
    [["discounts", "active"], ["tiers", "attention"], ["rewards", "inactive"], ["outlet", null], ["campaigns", null]],
  );
  assert.ok(discountSubNavItems("cs", []).every((i) => i.state === undefined), "no states known → no dots");
});

/** DiscountsSubNav inside a router; `nav` = what the layout (or the dev harness) provides through DiscountNav, absent = no provider. */
async function renderSubNav(active: (typeof DISCOUNT_PAGES)[number], nav?: DiscountNavData, locale: "cs" | "en" = "cs"): Promise<string> {
  const strip = createElement(DiscountsSubNav, { active });
  const page = { path: "page", Component: () => (nav ? createElement(DiscountNav.Provider, { value: nav }, strip) : strip) };
  const handler = createStaticHandler([{ id: "dev", path: "/", children: [page] }]);
  const context = await handler.query(new Request("http://localhost/page"));
  if (context instanceof Response) throw new Error(`unexpected response ${context.status}`);
  const router = createStaticRouter(handler.dataRoutes, context);
  // eslint-disable-next-line react/no-children-prop -- LocaleProvider types `children` as a required prop
  return renderToStaticMarkup(createElement(LocaleProvider, { locale, children: createElement(StaticRouterProvider, { router, context }) }));
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
}

test("DiscountsSubNav: a labelled nav of links, exactly one marked as the current page", async () => {
  for (const active of DISCOUNT_PAGES) {
    const html = await renderSubNav(active);
    assert.match(html, /<nav aria-label="Slevy"/);
    assert.equal(html.match(/aria-current="page"/g)?.length, 1, `${active}: one current item`);
    const to = active === "discounts" ? "/app/discounts" : `/app/${active}`;
    assert.match(html, new RegExp(`<a href="${to}" aria-current="page"`), `${active}: the current item is its own page`);
  }
});

test("DiscountsSubNav: default order without a provider, goal order with it; Pro said by a badge", async () => {
  assert.deepEqual(hrefs(await renderSubNav("tiers")), ["/app/discounts", "/app/tiers", "/app/rewards", "/app/outlet", "/app/campaigns"]);
  const ordered = await renderSubNav("outlet", { goals: ["outlet", "rewards"], states: {} });
  assert.deepEqual(hrefs(ordered), ["/app/discounts", "/app/outlet", "/app/rewards", "/app/tiers", "/app/campaigns"]);
  assert.match(ordered, /<a href="\/app\/outlet" aria-current="page"/);
  // Two Pro pages, two badges; the label itself has no "(Pro)".
  assert.equal(ordered.match(/>Pro<\/span>/g)?.length, 2);
  assert.doesNotMatch(ordered, /\(Pro\)/);
  // One row that scrolls sideways on a narrow screen instead of wrapping.
  assert.match(ordered, /overflow-x:auto/);
  assert.match(ordered, /flex-wrap:nowrap/);
  // No URL hash: WonSection anchors own it.
  for (const href of hrefs(ordered)) assert.doesNotMatch(href, /#/);
});

test("DiscountsSubNav: a dot per known state, in the pill's colours, with the state in words for screen readers", async () => {
  const nav: DiscountNavData = { goals: [], states: { discounts: "active", tiers: "attention", rewards: "inactive", outlet: "locked" } };
  const html = await renderSubNav("tiers", nav);
  const link = (key: string) => html.slice(html.lastIndexOf("<a ", html.indexOf(`data-won-subnav-item="${key}"`)), html.indexOf("</a>", html.indexOf(`data-won-subnav-item="${key}"`)));
  // Green runs, red needs attention, grey does not run: the same colours as the pill's dot (WonSection PILL_COLOR).
  assert.match(link("discounts"), /data-won-dot="active"[\s\S]*background:#1a8f4b[\s\S]*>Aktivní: <\/span><\/span>Slevy a kódy/);
  assert.match(link("tiers"), /data-won-dot="attention"[\s\S]*background:#b42318[\s\S]*>Vyžaduje pozornost: <\/span><\/span>Množstevní slevy/);
  assert.match(link("rewards"), /data-won-dot="inactive"[\s\S]*background:#c3cad2[\s\S]*>Neaktivní: <\/span><\/span>Milníky/);
  // The dot itself is hidden from screen readers; the word is in the link's text.
  assert.match(link("tiers"), /<span aria-hidden="true" style="width:7px/);
  // Locked and not known: no dot, the Pro badge stays.
  for (const key of ["outlet", "campaigns"]) {
    assert.doesNotMatch(link(key), /data-won-dot/, key);
    assert.match(link(key), />Pro<\/span>/, key);
  }
  assert.equal(html.match(/data-won-dot=/g)?.length, 3);
  assert.match(await renderSubNav("tiers", nav, "en"), /data-won-dot="attention"[\s\S]*?>Needs attention: <\/span><\/span>Quantity/);
  assert.doesNotMatch(await renderSubNav("tiers"), /data-won-dot/, "no provider → no dots");
});

test("SectionNav: a dot only at a section that has a state, the same dot as the strip's, with the state in words", () => {
  const items = [
    { anchor: "a", label: "První" },
    { anchor: "b", label: "Druhá", state: "attention" as const },
    { anchor: "c", label: "Třetí", state: "active" as const },
  ];
  // eslint-disable-next-line react/no-children-prop -- LocaleProvider types `children` as a required prop
  const html = renderToStaticMarkup(createElement(LocaleProvider, { locale: "cs", children: createElement(SectionNav, { label: "Na této stránce", items, children: null }) }));
  const link = (anchor: string) => html.slice(html.indexOf(`href="#${anchor}"`), html.indexOf("</a>", html.indexOf(`href="#${anchor}"`)));
  // P2: nothing without content — no grey dot for "no state".
  assert.doesNotMatch(link("a"), /data-won-dot/);
  assert.match(link("a"), />První$/);
  assert.match(link("b"), /data-won-dot="attention"[\s\S]*background:#b42318[\s\S]*>Vyžaduje pozornost: <\/span><\/span><\/span>Druhá$/);
  assert.match(link("c"), /data-won-dot="active"[\s\S]*background:#1a8f4b[\s\S]*>Aktivní: <\/span><\/span><\/span>Třetí$/);
  // The links stay plain anchors (they work before hydration); the first one is the current one.
  assert.match(html, /<a class="won-jump__link" href="#a" aria-current="location">/);
  assert.equal(html.match(/data-won-dot=/g)?.length, 2);
});

test("@won/app-kit WonNavMenu: homeLabel is optional, default unchanged", async () => {
  // packages/app-kit has no tsconfig of its own, so tsx compiles its JSX with the
  // classic runtime (React.createElement); the app's bundler uses the automatic one.
  (globalThis as { React?: unknown }).React = React;
  const { WonNavMenu } = await import("@won/app-kit/admin-nav");
  const plain = renderToStaticMarkup(createElement(WonNavMenu, { items: [{ to: "/app/settings", label: "Settings" }] }));
  assert.match(plain, /<a href="\/app" rel="home">Overview<\/a>/);
  const localized = renderToStaticMarkup(createElement(WonNavMenu, { homeLabel: "Přehled", items: [] }));
  assert.match(localized, /<a href="\/app" rel="home">Přehled<\/a>/);
});
