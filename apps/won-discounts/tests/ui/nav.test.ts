import assert from "node:assert/strict";
import { test } from "node:test";

import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { navItems, orderedModules, UPCOMING_MODULES } from "../../app/components/model/modules.ts";

// Onboarding step 1 promises "Vybrané moduly dáme v menu a v Přehledu na první
// místo" — goals only ORDER, every module stays. The nav is the shared Won one
// (@won/app-kit/admin-nav, SHARE-1) with a localized home label.

test("goals put their modules first, in the order picked; every module stays", () => {
  assert.deepEqual(orderedModules([]), [...UPCOMING_MODULES]);
  assert.deepEqual(orderedModules(["margin", "migrate", "rewards", "margin"]), [
    "margin",
    "rewards",
    "tiers",
    "outlet",
    "campaigns",
    "appearance",
  ]);
  for (const goals of [[], ["outlet"], ["tiers", "rewards", "outlet", "margin"]] as const) {
    assert.deepEqual([...orderedModules(goals)].sort(), [...UPCOMING_MODULES].sort());
  }
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
