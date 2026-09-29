import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { marginFloorUnit } from "@won/core/discounts/margin";

import {
  ceilingOnlyText,
  impactReason,
  impactRuleSummary,
  impactSummary,
  MARGIN_ACTION,
  marginDecimalErrors,
  MARGIN_FIELD,
  MARGIN_INTENT,
  marginImpactHref,
  marginInForce,
  marginNoteText,
  marginProof,
  marginSummary,
  mirrorCanRefresh,
  mirrorNeedsRefresh,
  mirrorText,
  readMarginDraft,
  readPercentField,
  tooManyDecimals,
} from "../../app/components/model/margin.ts";
import type { CostMirrorView, MarginImpactView, MarginOverviewView, MarginSettingsView, SyncView, UiResult } from "../../app/components/model/types.ts";
import { MarginOverviewCard } from "../../app/components/margin/MarginOverviewCard.tsx";
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
  assert.equal(marginSummary(SETTINGS, "pro", cs), "Min. marže 20\u00a0% · bez nákupní ceny sleva nejvýš 40\u00a0% · 2 kolekce s vlastním nastavením");
  // Free: core gateConfigForPlan folds the collections, strictest wins (m 30, p 10), no collection claim.
  assert.deepEqual(marginInForce(SETTINGS, "free").global, { maxDiscountPercent: 10, minMarginPercent: 30 });
  assert.deepEqual(marginInForce(SETTINGS, "free").perCollection, []);
  assert.equal(marginSummary(SETTINGS, "free", cs), "Min. marže 30\u00a0% · bez nákupní ceny sleva nejvýš 10\u00a0%");
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
    "Právě načítáme nákupní ceny: 340 z 1\u00a0240.",
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

test("Přehled zásahů is counted per rule from the full counts (audit P2-2), never from the shown rows; reasons in words", () => {
  const rule = (ruleId: string, variants: number, discountClass: "product" | "order" = "product") => ({ ruleId, ruleName: ruleId, discountClass, variants, rows: [] });
  const view = (over: Partial<MarginImpactView> = {}): MarginImpactView => ({ rules: [rule("a", 834), rule("b", 2), rule("o", 5, "order")], withoutCost: 0, status: "ready", ...over });
  assert.equal(impactSummary(view(), true, true, cs), "Ochrana sníží 3 slevy");
  assert.equal(impactSummary(view({ rules: [rule("a", 1)] }), true, true, en), "Protection lowers 1 discount");
  assert.equal(impactSummary(view({ status: "updating" }), true, true, cs), "Ochrana sníží 3 slevy · přepočítává se");
  assert.equal(impactSummary(view({ status: "computing", rules: [] }), true, true, cs), "Počítáme, kde ochrana zasáhne");
  assert.equal(impactSummary(view({ rules: [] }), true, true, cs), "Žádná aktivní sleva teď pod hranici nejde");
  assert.equal(impactSummary(null, false, true, cs), "Kde ochrana sníží slevy a o kolik");
  assert.equal(impactRuleSummary(rule("a", 834), cs), "Sníží se u 834 variant");
  assert.equal(impactRuleSummary(rule("a", 1), cs), "Sníží se u 1 varianty");
  assert.match(impactRuleSummary(rule("o", 5, "order"), cs), /^U 5 variant by sleva šla pod hranici/);
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

test("rule editor note: Pro counts VARIANTS (noun and number agree), an order rule has its own sentence, Free gets no number", () => {
  assert.equal(marginNoteText({ state: "ready", discountClass: "product", variants: 1 }, cs), "Na 1 variantě se sleva sníží na hranici marže.");
  assert.equal(marginNoteText({ state: "ready", discountClass: "product", variants: 3 }, cs), "Na 3 variantách se sleva sníží na hranici marže.");
  assert.equal(
    marginNoteText({ state: "updating", discountClass: "order", variants: 5 }, cs),
    "U 5 variant by sleva z objednávky šla pod hranici. Pokladna ji tam sníží nebo tyto položky vynechá.",
  );
  assert.equal(marginNoteText({ state: "ready", discountClass: "product" }, cs), "Ochrana marže tuhle slevu u některých produktů sníží.");
  assert.doesNotMatch(marginNoteText({ state: "ready", discountClass: "order" }, cs), /\d/, "Free: no number");
  assert.equal(marginNoteText({ state: "computing" }, cs), "Dopad ochrany marže na tuhle slevu se právě počítá.");
  assert.equal(marginNoteText({ state: "ready", discountClass: "product", variants: 2 }, en), "On 2 variants the discount is lowered to the margin floor.");
});

test("before the first complete read of the costs, the screen and the card say only the ceiling applies to unread products (audit P2-1)", () => {
  const running: CostMirrorView = { state: "running", done: 340, total: 1240, since: "2026-09-28T13:55:00" };
  const failed: CostMirrorView = { state: "failed", at: "2026-09-28T06:10:00", problems: [] };
  const on = { enabled: true, costsKnown: false, maxDiscountPercent: 40 };
  assert.equal(ceilingOnlyText({ ...on, mirror: running }, cs), "Dokud nenačteme nákupní ceny (340 z 1\u00a0240), platí u nenačtených produktů jen strop 40\u00a0%.");
  assert.equal(ceilingOnlyText({ ...on, mirror: failed }, cs), "Dokud nenačteme nákupní ceny, platí u nenačtených produktů jen strop 40\u00a0%.");
  assert.equal(ceilingOnlyText({ ...on, mirror: { state: "stale", at: null } }, cs), "Dokud nenačteme nákupní ceny, platí u nenačtených produktů jen strop 40\u00a0%.");
  assert.equal(ceilingOnlyText({ ...on, mirror: running, costsKnown: true }, cs), null, "after a complete read its costs stay in force");
  assert.equal(ceilingOnlyText({ ...on, mirror: running, enabled: false }, cs), null);
  assert.equal(ceilingOnlyText({ ...on, mirror: { state: "fresh", at: "2026-09-28T06:10:00" } }, cs), null);
  assert.match(ceilingOnlyText({ ...on, mirror: running }, en) ?? "", /^Until the cost prices are read \(340 of 1,240\), only the 40% ceiling applies/);
  // The max-discount field says the ceiling is also the fallback.
  assert.match(cs.t("margin.max.details"), /nákupní cenu jsme ještě nenačetli/);

  // The Přehled card: no green "Běží" before the first read finished; the sentence is on the card.
  const Provider = LocaleProvider as unknown as (props: { locale: "cs" | "en"; children?: ReactNode }) => ReactElement;
  const sync: SyncView = { state: "ok", at: "2026-09-28T16:20:00" };
  const card = (margin: MarginOverviewView) => renderToStaticMarkup(createElement(Provider, { locale: "cs" }, createElement(MarginOverviewCard, { margin, sync })));
  const first = card({ enabled: true, minMarginPercent: 20, maxDiscountPercent: 40, productsWithoutCost: null, mirror: running });
  assert.doesNotMatch(first, /Běží/);
  assert.match(first, /Dokud nenačteme nákupní ceny \(340 z 1\u00a0240\)/);
  const read = card({ enabled: true, minMarginPercent: 20, maxDiscountPercent: 40, productsWithoutCost: 3, mirror: { state: "fresh", at: "2026-09-28T06:10:00" } });
  assert.match(read, /Běží/);
  assert.doesNotMatch(read, /Dokud nenačteme/);
  // The promise is not absolute any more (P3-3).
  assert.equal(cs.t("soon.margin"), "Sleva ve Won nikdy nesrazí cenu pod hranici, kterou tu nastavíš.");
  assert.match(cs.t("margin.never"), /neklesla pod hranici/);
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

test("percents keep one decimal: a second decimal is refused before the save, never silently rounded (§12)", () => {
  for (const ok of ["", "12", "12,5", "12.5", "12.50", " 7.0 ", "abc"]) assert.equal(tooManyDecimals(ok), false, ok);
  for (const bad of ["12.55", "12,55", "0.05", "99.999"]) assert.equal(tooManyDecimals(bad), true, bad);
  const form = new FormData();
  form.set("minMarginPercent", "12.55");
  form.set("maxDiscountPercent", "40");
  form.append("collectionId[]", "gid://shopify/Collection/7");
  form.append("collectionMin[]", "30");
  form.append("collectionMax[]", "10,25");
  assert.deepEqual(marginDecimalErrors(form), [
    { field: "minMarginPercent", key: "margin.error.decimals" },
    { field: "collectionMax[0]", key: "margin.error.decimals" },
  ]);
  assert.equal(cs.t("margin.error.decimals"), "Zadej nejvýš jedno desetinné místo, třeba 12,5.");
});

test("a collection over the limit is worded by WHY (audit fix round 2): over 10 000 on its own, or — exact count — the budget used by margin collections read first", () => {
  assert.equal(cs.t("margin.collections.tooLargeUncounted"), "Kolekce má víc než 10 000 produktů, tolik Won při jedné synchronizaci nenačte. Proto platí přísnější hodnota pro celý obchod.");
  const exact = cs.t("margin.collections.tooLarge", { count: 4600 });
  assert.match(exact, /^Kolekce \(produktů: 4\u00a0600\) se už nevešla do limitu 10 000 produktů na jednu synchronizaci, ten spotřebovaly kolekce s nastavením marže, které Won čte dřív\./);
  assert.doesNotMatch(exact, /víc produktů, než Won/);
  assert.match(en.t("margin.collections.tooLarge", { count: 4600 }), /\(4,600 products\) no longer fit/);
});
