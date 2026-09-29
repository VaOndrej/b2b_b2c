import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { marginFloorUnit } from "@won/core/discounts/margin";

import {
  impactGroups,
  impactProductCount,
  impactReason,
  MARGIN_ACTION,
  MARGIN_FIELD,
  MARGIN_INTENT,
  marginImpactHref,
  marginInForce,
  marginProof,
  marginSummary,
  mirrorCanRefresh,
  mirrorNeedsRefresh,
  mirrorText,
  readMarginDraft,
  readPercentField,
} from "../../app/components/model/margin.ts";
import type { CostMirrorView, MarginImpactRowView, MarginSettingsView, UiResult } from "../../app/components/model/types.ts";
import { Notice } from "../../app/components/shell/Notice.tsx";
import { LocaleProvider } from "../../app/i18n/context.tsx";
import { translator } from "../../app/i18n/index.ts";

// Ochrana marže in the admin (MVP 2, Task 4): the state line says what the PLAN
// runs (§17c, BILL-1), the §10 proof is the engine's floor (§10b), the live
// draft reads the same field names the action posts (contract with
// margin.server.ts readMarginForm), and nothing machine-shaped reaches the text (§4c).

const cs = translator("cs");
const en = translator("en");

const SETTINGS: MarginSettingsView = {
  enabled: true,
  minMarginPercent: 20,
  maxDiscountPercent: 40,
  collections: [
    { collectionId: "gid://shopify/Collection/7", title: "Podzimní kolekce", minMarginPercent: 30, maxDiscountPercent: null },
    { collectionId: "gid://shopify/Collection/9", title: "Doplňky", minMarginPercent: null, maxDiscountPercent: 10 },
  ],
};

const NO_RAW = /\b(max_percent|cost|collection|global|running|fresh|stale|failed|off)\b(?![a-z])/;

test("form field names are the contract with readMarginForm (margin.server.ts)", () => {
  assert.deepEqual(MARGIN_FIELD, {
    intent: "intent",
    enabled: "enabled",
    minMarginPercent: "minMarginPercent",
    maxDiscountPercent: "maxDiscountPercent",
    configVersion: "configVersion",
    replaceUnreadable: "replaceUnreadable",
    collectionId: "collectionId[]",
    collectionMin: "collectionMin[]",
    collectionMax: "collectionMax[]",
  });
  assert.deepEqual(MARGIN_INTENT, { save: "save", refreshCosts: "refreshCosts" });
  assert.equal(MARGIN_ACTION, "/app/margin");
  assert.equal(marginImpactHref("dev-f2-collection"), "/app/margin?rule=dev-f2-collection#impact");
  assert.equal(marginImpactHref(null), "/app/margin#impact");
});

test("state line: Pro states the collections; Free states the folded global values it really runs (§17c)", () => {
  assert.equal(marginSummary(SETTINGS, "pro", cs), "Min. marže 20 % · bez nákupní ceny sleva nejvýš 40 % · 2 kolekce s vlastním nastavením");
  // Free: core gateConfigForPlan folds the collections, strictest wins (m 30, p 10), no collection claim.
  assert.deepEqual(marginInForce(SETTINGS, "free").global, { maxDiscountPercent: 10, minMarginPercent: 30 });
  assert.deepEqual(marginInForce(SETTINGS, "free").perCollection, []);
  assert.equal(marginSummary(SETTINGS, "free", cs), "Min. marže 30 % · bez nákupní ceny sleva nejvýš 10 %");
  assert.equal(marginSummary({ ...SETTINGS, enabled: false }, "pro", cs), "Ochrana marže je vypnutá");
  assert.equal(marginSummary({ ...SETTINGS, minMarginPercent: null, collections: [] }, "pro", en), "Never below the cost price · without a cost price at most 40% off");
});

test("live draft: reads the typed values, keeps the stored one where a field does not parse", () => {
  const form = new FormData();
  form.set("enabled", "on");
  form.set("minMarginPercent", "12,5");
  form.set("maxDiscountPercent", "abc");
  form.append("collectionId[]", "gid://shopify/Collection/7");
  form.append("collectionMin[]", "");
  form.append("collectionMax[]", "15");
  const draft = readMarginDraft(form, SETTINGS);
  assert.equal(draft.enabled, true);
  assert.equal(draft.minMarginPercent, 12.5);
  assert.equal(draft.maxDiscountPercent, 40, "junk keeps the stored value (the server refuses it)");
  assert.deepEqual(draft.collections, [
    { collectionId: "gid://shopify/Collection/7", title: "Podzimní kolekce", minMarginPercent: null, maxDiscountPercent: 15 },
  ]);
  const off = new FormData();
  off.set("minMarginPercent", "");
  off.set("maxDiscountPercent", "30");
  assert.deepEqual(readMarginDraft(off, SETTINGS), { enabled: false, minMarginPercent: null, maxDiscountPercent: 30, collections: [] });
  assert.equal(readPercentField(null), null);
  assert.equal(readPercentField(" "), null);
  assert.equal(readPercentField("7.5"), 7.5);
});

test("§10 proof is the engine's floor (core marginFloorUnit), in the shop currency's minor units", () => {
  const p = marginProof({ minMarginPercent: 20, maxDiscountPercent: 40 }, "CZK");
  assert.equal(p.price, 1000_00);
  assert.equal(p.cost, 600_00);
  assert.equal(p.withoutPays, 500_00);
  assert.equal(p.withoutMarginPercent, -20);
  assert.equal(p.withPays, marginFloorUnit({ unitPrice: 1000_00, costMinor: 600_00, minMarginPercent: 20, maxDiscountPercent: 40 }).floorUnit);
  assert.equal(p.withPays, 750_00);
  assert.equal(p.withMarginPercent, 20);
  assert.equal(p.withDiscountPercent, 25);
  assert.equal(p.noCostPays, 600_00);
  assert.equal(p.noCostDiscountPercent, 40);
  // Not set = never below the cost price; a ceiling above the wanted discount changes nothing.
  const bare = marginProof({ minMarginPercent: null, maxDiscountPercent: 100 }, "CZK");
  assert.equal(bare.withPays, 600_00);
  assert.equal(bare.noCostPays, 500_00);
  // JPY has no minor units.
  assert.equal(marginProof({ minMarginPercent: 0, maxDiscountPercent: 50 }, "JPY").price, 1000);
});

test("cost mirror: one sentence per state, the refresh button only where it can help", () => {
  const states: CostMirrorView[] = [
    { state: "off" },
    { state: "running", done: 340, total: 1240, since: "2026-09-28T13:55:00" },
    { state: "running", done: 250, total: null, since: "2026-09-28T13:55:00" },
    { state: "fresh", at: "2026-09-28T06:10:00" },
    { state: "stale", at: "2026-09-26T06:10:00" },
    { state: "stale", at: null },
    { state: "failed", at: "2026-09-28T06:10:00", problems: [] },
  ];
  const texts = states.map((s) => mirrorText(s, cs));
  assert.deepEqual(texts, [
    "Nákupní ceny načítáme, jen když je ochrana zapnutá.",
    "Právě načítáme nákupní ceny: 340 z 1240.",
    "Právě načítáme nákupní ceny (zatím 250).",
    "Aktuální, naposledy načteno 28. 9. 2026 06:10.",
    "Naposledy načteno 26. 9. 2026 06:10. Načti je znovu, ať pokladna zná aktuální ceny.",
    "Načtení se zatím nedokončilo. Načti je znovu.",
    "Načtení selhalo 28. 9. 2026 06:10.",
  ]);
  for (const s of states) {
    assert.doesNotMatch(mirrorText(s, en), /\{\w+\}|undefined/);
  }
  assert.deepEqual(states.map(mirrorNeedsRefresh), [false, false, false, false, true, true, true]);
  assert.deepEqual(states.map(mirrorCanRefresh), [false, false, false, true, true, true, true]);
});

test("Přehled zásahů: rows grouped by rule in loss order, one rule on demand, reasons in words", () => {
  const row = (ruleId: string, productId: string, variantId: string, over: Partial<MarginImpactRowView> = {}): MarginImpactRowView => ({
    ruleId,
    ruleName: ruleId.toUpperCase(),
    productId,
    variantId,
    title: variantId,
    wanted: 100,
    allowed: 50,
    basis: "cost",
    source: "global",
    ...over,
  });
  const rows = [row("b", "p1", "v1"), row("a", "p2", "v2"), row("b", "p1", "v3"), row("a", "p3", "v4")];
  assert.deepEqual(
    impactGroups(rows).map((g) => [g.ruleId, g.rows.map((r) => r.variantId)]),
    [
      ["b", ["v1", "v3"]],
      ["a", ["v2", "v4"]],
    ],
  );
  assert.deepEqual(impactGroups(rows, "a").map((g) => g.ruleId), ["a"]);
  assert.equal(impactProductCount({ rows, orderRules: [], withoutCost: 0 }), 3);
  assert.equal(impactReason({ basis: "cost", source: "global" }, cs), "hranice z nákupní ceny");
  assert.equal(impactReason({ basis: "max_percent", source: "collection" }, cs), "nemá nákupní cenu, platí strop slevy · nastavení kolekce");
  for (const tr of [cs, en]) {
    for (const basis of ["cost", "max_percent"] as const) {
      for (const source of ["global", "collection"] as const) {
        assert.doesNotMatch(impactReason({ basis, source }, tr), /max_percent|_/);
      }
    }
  }
  assert.doesNotMatch(impactReason({ basis: "max_percent", source: "collection" }, cs), NO_RAW);
});

test("Notice: 'Obnovit nákupní ceny' answers that the read runs in the background; a save that starts it says so too", () => {
  // A successful outcome renders no fetcher button, so no router is needed.
  const Provider = LocaleProvider as unknown as (props: { locale: "cs" | "en"; children?: ReactNode }) => ReactElement;
  const render = (result: UiResult, locale: "cs" | "en" = "cs") =>
    renderToStaticMarkup(createElement(Provider, { locale }, createElement(Notice, { result })));
  const refreshed = render({ ok: true, message: "synced", syncing: { costs: true } });
  assert.match(refreshed, /Načítání nákupních cen běží/);
  assert.match(refreshed, /Nákupní ceny načítáme ze Shopify na pozadí/);
  const saved = render({ ok: true, message: "saved", sync: { ok: true, problems: [], warnings: [] }, syncing: { costs: true } });
  assert.match(saved, /Uloženo a propsáno do Shopify/);
  assert.match(saved, /Nákupní ceny načítáme ze Shopify na pozadí/);
  assert.match(render({ ok: true, message: "synced", syncing: { costs: true } }, "en"), /Reading cost prices/);
});
