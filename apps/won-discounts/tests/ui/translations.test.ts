// Překlady (feedback 2026-10-06, body 11, 12, 14) — the pure model: where a text belongs, its name for the
// merchant, the rules a text must keep, the form as the server reads it, and the CSV export / import plan.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CONFIG_LIMITS } from "@won/core/discounts/config";

import {
  changedCount,
  defaultTextLang,
  exportCsv,
  groupLabel,
  importTexts,
  languageLimit,
  languageName,
  languagesNotShipped,
  parseCsv,
  planImport,
  readTranslationsForm,
  TEXT_GROUPS,
  textDefault,
  textError,
  textField,
  textGroup,
  textLabel,
} from "../../app/components/model/translations.ts";
import { CATALOGUES, translator } from "../../app/i18n/index.ts";
import { storefrontTextKeys, textRows } from "../../app/lib/integration/translations.server.ts";
import { DEV_MILESTONES_FIXTURE } from "../../app/lib/dev-harness.server.ts";

const cs = translator("cs");
const en = translator("en");
const ROWS = textRows(DEV_MILESTONES_FIXTURE, "cs");
const row = (key: string) => ROWS.find((r) => r.key === key)!;
const form = (entries: [string, string][]) => ({
  get: (name: string) => entries.find(([n]) => n === name)?.[1] ?? null,
  getAll: (name: string) => entries.filter(([n]) => n === name).map(([, v]) => v),
});

test("every text the merchant can change has a place and a name in both admin languages — never its key", () => {
  const keys = storefrontTextKeys();
  assert.ok(keys.length >= 36, String(keys.length));
  assert.equal(keys.includes("outlet.left"), false, "a plural Shopify fills in");
  assert.equal(keys.includes("progress.empty") || keys.includes("campaign.sample") || keys.includes("outlet.sample"), false, "what only the theme editor shows");
  for (const key of keys) {
    assert.ok(TEXT_GROUPS.includes(textGroup(key)));
    for (const locale of ["cs", "en"] as const) {
      assert.ok(Object.prototype.hasOwnProperty.call(CATALOGUES[locale], `translations.text.${key}`), `${locale}: translations.text.${key}`);
      const label = textLabel(row(key), translator(locale));
      assert.ok(label !== "" && !label.includes(key), `${key} → ${label}`);
    }
  }
  assert.deepEqual([textGroup("tiers.heading"), textGroup("cart.ms_left"), textGroup("cart.saved"), textGroup("outlet.badge"), textGroup("campaign.ends"), textGroup("cards.pct")], ["tiers", "milestones", "cart", "outlet", "campaigns", "cards"]);
  assert.equal(textLabel(row("tiers.heading"), cs), "Nadpis tabulky");
  assert.equal(textLabel(row("cart.ms_left"), en), "How much is left to the next step");
  assert.deepEqual(TEXT_GROUPS.map((g) => groupLabel(g, cs)), ["Množstevní tabulka", "Milníky", "Košík", "Výprodej", "Kampaně", "Ceny na kartách"]);
});

test("a Milníky discount step has a row for its own name, after the ladder's texts, named by the step", () => {
  const names = ROWS.filter((r) => r.key.startsWith("cart.ms_name."));
  assert.deepEqual(names.map((r) => r.key), ["cart.ms_name.ms-five", "cart.ms_name.ms-fixed"]);
  assert.equal(ROWS.indexOf(names[0]!), ROWS.findIndex((r) => r.key === "cart.ms_disc") + 1);
  assert.equal(textGroup(names[0]!.key), "milestones");
  assert.equal(textLabel(names[0]!, cs).replace(/\s/g, " "), "Vlastní název odměny: Sleva 5 % od 2 000 Kč / 80 €");
  assert.equal(textDefault(names[0]!, "cs"), "Sleva {value}", "without a name the ladder says the discount");
});

test("the default text of a language: the extension's own for cs / sk, the English one for any other", () => {
  assert.deepEqual(["cs", "sk", "en", "de", "pt-br", "cs-cz"].map(defaultTextLang), ["cs", "sk", "en", "en", "en", "cs"]);
  assert.equal(textDefault(row("tiers.heading"), "cs"), "Množstevní sleva");
  assert.equal(textDefault(row("tiers.heading"), "de"), "Quantity discount");
  assert.equal(languageName("sk", cs), "slovenština");
  assert.equal(languageName("de", en), "German");
});

test("a text that drops or adds a part in curly braces is refused with the part named; so is one over the length limit", () => {
  const reference = textDefault(row("cart.saved"), "cs");
  assert.equal(textError("cart.saved", reference, ""), null);
  assert.equal(textError("cart.saved", reference, "Sleva {amount}"), null);
  assert.deepEqual(textError("cart.saved", reference, "Sleva"), { key: "translations.error.missing", params: { parts: "{amount}" } });
  assert.deepEqual(textError("cart.saved", reference, "Sleva {amount} {price}"), { key: "translations.error.extra", params: { parts: "{price}" } });
  assert.deepEqual(textError("tiers.heading", "Množstevní sleva", "x".repeat(CONFIG_LIMITS.localeStringLength + 1)), { key: "translations.error.tooLong", params: { max: CONFIG_LIMITS.localeStringLength } });
  assert.deepEqual(textError("campaign.units", "d,h,min,s", "dny,hodiny"), { key: "translations.error.units" });
  assert.equal(cs.t("translations.error.missing", { parts: "{amount}" }), "V textu chybí {amount}. Bez toho se na webu nedoplní.");
});

test("the form: the tables in order, only the rows' fields, every text checked against its language's default", () => {
  const ok = readTranslationsForm(
    form([
      ["lang", "cs"],
      ["lang", "pt-BR"],
      ["lang", "cs"],
      [textField("cs", "tiers.heading"), "  Kup víc  "],
      [textField("cs", "cart.saved"), ""],
      [textField("pt-br", "cart.saved"), "Economize {amount}"],
      ["tx.cs.not.a.key", "x"],
      ["tx.de.tiers.heading", "Mehr"],
    ]),
    ROWS,
  );
  assert.deepEqual(ok, { ok: true, form: { languages: ["cs", "pt-br"], texts: { cs: { "tiers.heading": "Kup víc", "cart.saved": "" }, "pt-br": { "cart.saved": "Economize {amount}" } } } });
  const bad = readTranslationsForm(form([["lang", "cs"], ["lang", "../x"], [textField("cs", "cart.saved"), "Sleva"]]), ROWS);
  assert.deepEqual(bad, {
    ok: false,
    errors: [
      { field: "lang", key: "translations.error.language" },
      { field: "tx.cs.cart.saved", key: "translations.error.missing", params: { parts: "{amount}" } },
    ],
  });
});

test("the plan's limit: Free the default language and one more; languages stored past it are named", () => {
  assert.equal(languageLimit("free"), 2);
  assert.equal(languageLimit("pro"), null);
  assert.deepEqual(languagesNotShipped(["cs", "sk", "de", "hu"], "free"), ["de", "hu"]);
  assert.deepEqual(languagesNotShipped(["cs", "sk", "de", "hu"], "pro"), []);
  assert.equal(changedCount({ "tiers.heading": "A", "cart.saved": "  ", "not.a.row": "x" }, ROWS), 1);
});

// --- CSV ---------------------------------------------------------------------------------------------------

const VALUES = { cs: { "tiers.heading": "Kup víc, plať míň", "cart.saved": 'Ušetříte "hodně": {amount}' }, sk: { "tiers.heading": "Kúp viac" } };
const LANGS = ["cs", "sk"];

test("export: a row per text with its key, place and default, a column per language; what it writes it reads back the same", () => {
  const csv = exportCsv(ROWS, LANGS, VALUES, cs);
  assert.equal(csv.charCodeAt(0), 0xfeff, "a byte order mark: spreadsheets read the accents");
  const [header, ...lines] = parseCsv(csv);
  assert.deepEqual(header, ["key", "place", "default", "cs", "sk"]);
  assert.equal(lines.length, ROWS.length);
  assert.deepEqual(lines.find((l) => l[0] === "tiers.heading"), ["tiers.heading", "Množstevní tabulka: Nadpis tabulky", "Množstevní sleva", "Kup víc, plať míň", "Kúp viac"]);
  assert.deepEqual(lines.find((l) => l[0] === "cart.saved")!.slice(3), ['Ušetříte "hodně": {amount}', ""], "quotes and commas survive");
  const plan = planImport(csv, ROWS, LANGS, VALUES);
  assert.deepEqual({ changes: plan.changes, refused: plan.refused, unchanged: plan.unchanged }, { changes: [], refused: [], unchanged: ROWS.length * 2 });
});

test("import plan: changes are listed, and an unknown key, a missing {amount}, a text over the limit and a foreign column are refused with their reason", () => {
  const csv = [
    "key;place;default;cs;sk;de",
    "tiers.heading;;;Nový nadpis;Kúp viac;Mehr",
    "cart.saved;;;Ušetříte;;",
    `tiers.next;;;${"x".repeat(501)};;`,
    "cart.ms_done;;;;Máte všetko;",
    "tiers.unknown;;;x;y;",
  ].join("\n");
  const plan = planImport(csv, ROWS, LANGS, VALUES);
  assert.deepEqual(plan.changes, [
    { key: "tiers.heading", locale: "cs", from: "Kup víc, plať míň", to: "Nový nadpis" },
    { key: "cart.ms_done", locale: "sk", from: "", to: "Máte všetko" },
  ]);
  assert.deepEqual(plan.refused, [
    { reason: "language", column: "de" },
    { reason: "text", line: 3, key: "cart.saved", locale: "cs", error: { key: "translations.error.missing", params: { parts: "{amount}" } } },
    { reason: "text", line: 4, key: "tiers.next", locale: "cs", error: { key: "translations.error.tooLong", params: { max: 500 } } },
    { reason: "key", line: 6, key: "tiers.unknown" },
  ]);
  assert.deepEqual(importTexts(plan), { cs: { "tiers.heading": "Nový nadpis" }, sk: { "cart.ms_done": "Máte všetko" } });
  assert.deepEqual(planImport("something,else\n1,2", ROWS, LANGS, VALUES).refused, [{ reason: "header" }]);
});

test("an empty cell of an import puts the extension's own text back", () => {
  const plan = planImport("key,cs\ntiers.heading,", ROWS, LANGS, VALUES);
  assert.deepEqual(plan.changes, [{ key: "tiers.heading", locale: "cs", from: "Kup víc, plať míň", to: "" }]);
});

test("feedback 9 Oct 2026, bod 1: a language is complete when the customer never reads another language in it", async () => {
  const { missingTexts, languageProgressText } = await import("../../app/components/model/translations.ts");
  const { translator } = await import("../../app/i18n/index.ts");
  const cs = translator("cs");
  const rows = ["a", "b", "c", "d", "e"].map((key) => ({ key, defaults: { cs: "x", sk: "x", en: "x" } }));
  // The extension's own languages are always complete, with or without the merchant's texts.
  assert.equal(missingTexts("cs", {}, rows), 0);
  assert.equal(missingTexts("sk", undefined, rows), 0);
  assert.equal(missingTexts("en-GB", {}, rows), 0);
  // Any other language lacks every text the merchant has not written (a blank one is not written).
  assert.equal(missingTexts("de", { a: "Hallo", b: "  " }, rows), 4);
  assert.equal(missingTexts("de", Object.fromEntries(rows.map((row) => [row.key, "x"])), rows), 0);
  // Přehled knows only the counts.
  assert.equal(missingTexts("de", { a: "Hallo" }, 5), 4);
  assert.equal(missingTexts("cs", undefined, 5), 0);
  assert.equal(languageProgressText(0, cs), "Hotovo");
  assert.equal(languageProgressText(1, cs), "Chybí 1 text");
  assert.equal(languageProgressText(4, cs), "Chybí 4 texty");
  assert.equal(languageProgressText(37, cs), "Chybí 37 textů");
});
