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
  discountSubNavItems,
  goalsOfLayoutData,
  navItems,
  orderedModules,
} from "../../app/components/model/modules.ts";
import { APP_LAYOUT_ROUTE_ID, DiscountsSubNav } from "../../app/components/shell/SubNav.tsx";

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
      ["/app/rewards", "Odměny", false],
      ["/app/tiers", "Množstevní slevy", false],
      ["/app/outlet", "Výprodej", true],
      ["/app/campaigns", "Kampaně", true],
    ],
  );
  assert.equal(discountSubNavItems("en", [])[0].label, "Discounts & codes");
});

test("goals are read defensively from the layout loader's data (the dev harness has none)", () => {
  assert.deepEqual(goalsOfLayoutData(undefined), []);
  assert.deepEqual(goalsOfLayoutData(null), []);
  assert.deepEqual(goalsOfLayoutData({ goals: "outlet" }), []);
  assert.deepEqual(goalsOfLayoutData({ apiKey: "k", locale: "cs", goals: ["outlet", "tiers"] }), ["outlet", "tiers"]);
});

/** DiscountsSubNav inside a router; with `goals` from a loader under the layout route id the real app uses, without = the dev harness. */
async function renderSubNav(active: (typeof DISCOUNT_PAGES)[number], goals?: string[]): Promise<string> {
  const page = { path: "page", Component: () => createElement(DiscountsSubNav, { active }) };
  const routes = goals ? [{ id: APP_LAYOUT_ROUTE_ID, path: "/", loader: () => ({ goals }), children: [page] }] : [{ id: "dev", path: "/", children: [page] }];
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request("http://localhost/page"));
  if (context instanceof Response) throw new Error(`unexpected response ${context.status}`);
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToStaticMarkup(createElement(LocaleProvider, { locale: "cs", children: createElement(StaticRouterProvider, { router, context }) }));
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

test("DiscountsSubNav: default order without the layout loader, goal order with it; Pro said by a badge", async () => {
  assert.deepEqual(hrefs(await renderSubNav("tiers")), ["/app/discounts", "/app/tiers", "/app/rewards", "/app/outlet", "/app/campaigns"]);
  const ordered = await renderSubNav("outlet", ["outlet", "rewards"]);
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
