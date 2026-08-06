import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_LOCALE,
  LOCALE_LIMIT_FREE,
  capLocaleSettingsForPlan,
  localeLanguage,
  localeLimit,
  normalizeLocale,
  resolveLocalizedText,
  sanitizeLocaleSettings,
} from "../../src/toasts/locales.ts";

test("normalizeLocale lowercases, hyphenates, and rejects junk", () => {
  assert.equal(normalizeLocale("EN"), "en");
  assert.equal(normalizeLocale("pt_BR"), "pt-br");
  assert.equal(normalizeLocale("  Cs  "), "cs");
  assert.equal(normalizeLocale("zh-Hant-TW"), "zh-hant-tw");
  assert.equal(normalizeLocale(""), "");
  assert.equal(normalizeLocale("!!"), "");
  assert.equal(normalizeLocale(123), "");
});

test("localeLanguage returns the primary subtag", () => {
  assert.equal(localeLanguage("pt-BR"), "pt");
  assert.equal(localeLanguage("en"), "en");
  assert.equal(localeLanguage("nonsense!"), "");
});

test("resolveLocalizedText follows exact → language → default → any", () => {
  const map = { en: "Hello", "pt-br": "Olá BR", de: "Hallo" };

  // exact
  assert.equal(resolveLocalizedText(map, "de", "en"), "Hallo");
  // language-only match (shopper pt-PT, only pt-br present)
  assert.equal(resolveLocalizedText(map, "pt-PT", "en"), "Olá BR");
  // unknown locale → default locale
  assert.equal(resolveLocalizedText(map, "fr", "en"), "Hello");
  // default missing → any non-empty
  assert.equal(resolveLocalizedText({ de: "Hallo" }, "fr", "en"), "Hallo");
  // empty map → ""
  assert.equal(resolveLocalizedText({}, "en", "en"), "");
  assert.equal(resolveLocalizedText(undefined, "en", "en"), "");
});

test("resolveLocalizedText treats whitespace-only as missing", () => {
  assert.equal(resolveLocalizedText({ en: "   ", de: "Hallo" }, "en", "en"), "Hallo");
});

test("sanitizeLocaleSettings normalises, dedupes, forces default first, defaults to en", () => {
  const s = sanitizeLocaleSettings({
    defaultLocale: "CS",
    enabledLocales: ["cs", "EN", "cs", "de"],
  });
  assert.equal(s.defaultLocale, "cs");
  assert.deepEqual(s.enabledLocales, ["cs", "en", "de"]);

  const empty = sanitizeLocaleSettings(undefined);
  assert.equal(empty.defaultLocale, DEFAULT_LOCALE);
  assert.deepEqual(empty.enabledLocales, [DEFAULT_LOCALE]);
});

test("sanitizeLocaleSettings always keeps the default even if omitted from the list", () => {
  const s = sanitizeLocaleSettings({ defaultLocale: "en", enabledLocales: ["de", "fr"] });
  assert.equal(s.enabledLocales[0], "en");
  assert.ok(s.enabledLocales.includes("de"));
});

test("plan cap: Free keeps default + up to LOCALE_LIMIT_FREE, Pro keeps many", () => {
  assert.equal(localeLimit("free"), LOCALE_LIMIT_FREE);
  assert.ok(localeLimit("pro") > LOCALE_LIMIT_FREE);

  const settings = { defaultLocale: "en", enabledLocales: ["en", "de", "fr", "es"] };
  const free = capLocaleSettingsForPlan(settings, "free");
  assert.equal(free.enabledLocales.length, LOCALE_LIMIT_FREE);
  assert.equal(free.enabledLocales[0], "en", "default locale is never capped out");

  const pro = capLocaleSettingsForPlan(settings, "pro");
  assert.deepEqual(pro.enabledLocales, ["en", "de", "fr", "es"]);
});
