import assert from "node:assert/strict";
import { test } from "node:test";

import { cs } from "../../app/i18n/cs.ts";
import { en } from "../../app/i18n/en.ts";
import { joinList, resolveLocale, t, tp } from "../../app/i18n/index.ts";

// Doctrine A10: the admin speaks Czech or English. The two catalogues must be the
// same set of keys with the same placeholders, or one language silently shows a
// raw key or a "{n}" to a merchant (§4c).

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("cs and en define exactly the same keys", () => {
  const csKeys = Object.keys(cs).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(
    csKeys.filter((k) => !enKeys.includes(k)),
    [],
    "keys missing in en",
  );
  assert.deepEqual(
    enKeys.filter((k) => !csKeys.includes(k)),
    [],
    "keys missing in cs",
  );
});

test("every key has the same placeholders in both languages, and no empty text", () => {
  for (const key of Object.keys(cs) as (keyof typeof cs)[]) {
    assert.deepEqual(placeholders(en[key]), placeholders(cs[key]), `placeholders differ for ${key}`);
    // listJoin/listLast are separators; everything else is real copy.
    if (!key.startsWith("common.list")) {
      assert.ok(cs[key].trim().length > 0, `empty cs text: ${key}`);
      assert.ok(en[key].trim().length > 0, `empty en text: ${key}`);
    }
  }
});

test("plural sets are complete: every .one has .few and .other in both languages", () => {
  for (const key of Object.keys(cs)) {
    if (!key.endsWith(".one")) continue;
    const base = key.slice(0, -".one".length);
    for (const form of ["few", "other"]) {
      assert.ok(`${base}.${form}` in cs, `cs missing ${base}.${form}`);
      assert.ok(`${base}.${form}` in en, `en missing ${base}.${form}`);
    }
  }
});

test("Czech plurals: 1 / 2–4 / 0 and 5+", () => {
  assert.equal(tp("cs", "count.rule", 0), "0 pravidel");
  assert.equal(tp("cs", "count.rule", 1), "1 pravidlo");
  assert.equal(tp("cs", "count.rule", 3), "3 pravidla");
  assert.equal(tp("cs", "count.rule", 5), "5 pravidel");
  assert.equal(tp("en", "count.rule", 1), "1 rule");
  assert.equal(tp("en", "count.rule", 3), "3 rules");
});

test("the admin locale Shopify passes maps to cs or en", () => {
  assert.equal(resolveLocale("cs"), "cs");
  assert.equal(resolveLocale("cs-CZ"), "cs");
  assert.equal(resolveLocale("sk"), "cs");
  assert.equal(resolveLocale("en"), "en");
  assert.equal(resolveLocale("de-DE"), "en");
  assert.equal(resolveLocale(null), "cs");
  assert.equal(resolveLocale(""), "cs");
});

test("t() interpolates and keeps an unknown placeholder visible", () => {
  assert.equal(t("cs", "overview.configLine", { version: 1, rules: "2 pravidla" }), "Konfigurace: verze 1 · 2 pravidla");
  assert.equal(t("en", "editor.amount.label", {}), "Amount in {currency}");
  assert.equal(joinList("cs", ["A", "B", "C"]), "A, B a C");
  assert.equal(joinList("en", ["A", "B"]), "A and B");
});

test("numeric params follow the admin's number format (audit fix round 2): cs groups thousands with a no-break space, en with a comma; strings stay as they are", () => {
  assert.equal(t("cs", "margin.mirror.running", { done: 340, total: 1240 }), "Právě načítáme nákupní ceny: 340 z 1\u00a0240 variant. Stránka se obnovuje sama.");
  assert.equal(t("en", "margin.mirror.running", { done: 340, total: 1240 }), "Reading cost prices right now: 340 of 1,240 variants. The page refreshes by itself.");
  assert.equal(tp("cs", "margin.costs.missing", 12500), "12\u00a0500 produktů nemá nákupní cenu");
  assert.equal(t("cs", "margin.costs.coverage", { with: 1226, total: 1240 }), "Varianty s nákupní cenou: 1\u00a0226 z 1\u00a0240.");
  // An id, a code or a version is passed as a string: never grouped.
  assert.equal(t("cs", "overview.configLine", { version: "2026", rules: "6 pravidel" }), "Konfigurace: verze 2026 · 6 pravidel");
  assert.equal(t("cs", "editor.error.codeTaken", { code: "12345" }), "Kód 12345 už má jiná sleva.");
});
