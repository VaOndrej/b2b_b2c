import assert from "node:assert/strict";
import { test } from "node:test";

import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ADMIN_MODULES,
  isUpcomingModule,
  navItems,
  orderedModules,
  orderedUpcomingModules,
  UPCOMING_MODULES,
} from "../../app/components/model/modules.ts";

// Onboarding step 1 promises "Vybrané moduly dáme v menu a v Přehledu na první
// místo" — goals only ORDER, every module stays. The nav is the shared Won one
// (@won/app-kit/admin-nav, SHARE-1) with a localized home label.

test("goals put their modules first, in the order picked; every module stays", () => {
  assert.deepEqual(orderedModules([]), [...ADMIN_MODULES]);
  assert.deepEqual(orderedModules(["margin", "migrate", "rewards", "margin"]), [
    "margin",
    "rewards",
    "tiers",
    "outlet",
    "campaigns",
    "appearance",
  ]);
  for (const goals of [[], ["outlet"], ["tiers", "rewards", "outlet", "margin"]] as const) {
    assert.deepEqual([...orderedModules(goals)].sort(), [...ADMIN_MODULES].sort());
  }
});

test("MVP 2 + 3: Ochrana marže, Množstevní slevy and Vzhled are built — out of the coming-soon list, still in the nav in goal order", () => {
  for (const built of ["margin", "tiers", "appearance"]) {
    assert.ok(!(UPCOMING_MODULES as readonly string[]).includes(built), built);
    assert.equal(isUpcomingModule(built), false, built);
  }
  assert.equal(isUpcomingModule("rewards"), true);
  assert.deepEqual(orderedUpcomingModules(["margin", "outlet"]), ["outlet", "rewards", "campaigns"]);
  assert.deepEqual(
    navItems("cs", ["margin"]).map((i) => i.to),
    ["/app/discounts", "/app/try-cart", "/app/margin", "/app/tiers", "/app/rewards", "/app/outlet", "/app/campaigns", "/app/appearance", "/app/settings", "/app/plan"],
  );
});

test("nav: Slevy a kódy and Vyzkoušet košík first, modules by goals, Tarif last", () => {
  const items = navItems("cs", ["rewards"]);
  assert.deepEqual(
    items.map((i) => i.label),
    ["Slevy a kódy", "Vyzkoušet košík", "Odměny", "Množstevní slevy", "Výprodej (Pro)", "Ochrana marže", "Kampaně (Pro)", "Vzhled", "Nastavení", "Tarif"],
  );
  assert.equal(items[2].to, "/app/rewards");
  assert.equal(navItems("en", [])[0].label, "Discounts & codes");
});

test("@won/app-kit WonNavMenu: homeLabel is optional, default unchanged", async () => {
  // packages/app-kit has no tsconfig of its own, so tsx compiles its JSX with the
  // classic runtime (React.createElement); the app's bundler uses the automatic one.
  (globalThis as { React?: unknown }).React = React;
  const { WonNavMenu } = await import("@won/app-kit/admin-nav");
  const plain = renderToStaticMarkup(createElement(WonNavMenu, { items: [{ to: "/app/plan", label: "Plan" }] }));
  assert.match(plain, /<a href="\/app" rel="home">Overview<\/a>/);
  const localized = renderToStaticMarkup(createElement(WonNavMenu, { homeLabel: "Přehled", items: [] }));
  assert.match(localized, /<a href="\/app" rel="home">Přehled<\/a>/);
});
