// Storefront texts per language (feedback 2026-10-06, body 11–14): which languages a plan ships, what each
// language's metafield carries, what a text may say — and the sizes the storage decision rests on
// (docs/won-discounts/navrh-preklady-a-vzhled.md).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { CONFIG_LIMITS, sanitizeConfig, type WonDiscountsConfig } from "../../src/discounts/config.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { buildStorefrontConfig } from "../../src/discounts/storefront-config.ts";
import {
  LANGUAGE_LIMIT_FREE,
  languagesForPlan,
  milestoneNameKey,
  placeholdersOf,
  storefrontTextIssue,
  storefrontTexts,
  storefrontTextsKey,
  textLanguages,
} from "../../src/discounts/storefront-texts.ts";

function configOf(input: Record<string, unknown>): WonDiscountsConfig {
  const { config, issues } = sanitizeConfig(input);
  assert.deepEqual(issues, []);
  return config;
}

// The shape every shop has stored today: the three fixed languages, no list of languages.
const STORED_TODAY = {
  storefront: { appearancePreset: "chips", cardPricesEnabled: false },
  locales: { cs: { "tiers.heading": "Kup víc, plať míň", "cart.saved": "" }, sk: {}, en: { "tiers.heading": "Buy more", "cards.pct": "From {min} pcs −{pct} %" } },
};

test("a config stored before languages were a list: its texts are read as they are, and saving it again changes nothing", () => {
  const config = configOf(STORED_TODAY);
  assert.deepEqual(config.locales, STORED_TODAY.locales);
  assert.equal(config.storefront.languages, undefined);
  assert.deepEqual(textLanguages(config), ["cs", "en"], "languages with a text, in stored order");
  const again = configOf(JSON.parse(JSON.stringify(config)));
  assert.equal(JSON.stringify(again), JSON.stringify(config));
  assert.deepEqual(storefrontTexts(config), { cs: { "tiers.heading": "Kup víc, plať míň" }, en: { "tiers.heading": "Buy more", "cards.pct": "From {min} pcs −{pct} %" } });
});

test("languages: any locale Shopify knows, the merchant's order first, each once", () => {
  const config = configOf({
    storefront: { languages: ["de", "pt-BR", "de", "cs"] },
    locales: { cs: { "tiers.heading": "A" }, de: { "tiers.heading": "B" }, "pt-BR": { "tiers.heading": "C" }, hu: { "tiers.heading": "D" }, sk: {} },
  });
  assert.deepEqual(config.storefront.languages, ["de", "pt-br", "cs"]);
  assert.deepEqual(Object.keys(config.locales).sort(), ["cs", "de", "hu", "pt-br", "sk"]);
  assert.deepEqual(textLanguages(config), ["de", "pt-br", "cs", "hu"], "a language with texts that the list does not name comes last");
  assert.equal(storefrontTextsKey("pt-br"), "tx_pt-br");
});

test("a locale that is not one is dropped with an issue; the texts of the others stay", () => {
  const { config, issues } = sanitizeConfig({ storefront: { languages: ["cs", "../x", 7] }, locales: { cs: { a: "b" }, "not a locale": { a: "b" } } });
  assert.deepEqual(config.storefront.languages, ["cs"]);
  assert.deepEqual(Object.keys(config.locales), ["cs"]);
  assert.deepEqual(issues.map((i) => i.code).sort(), ["unknown_language", "unknown_language", "unknown_language"], "two in the list, one among the texts");
});

test("Free ships the default language and one more; Pro every one — the stored config keeps them all", () => {
  const stored = configOf({
    storefront: { languages: ["cs", "sk", "de", "hu"] },
    locales: { cs: { "tiers.heading": "A" }, sk: { "tiers.heading": "B" }, de: { "tiers.heading": "C" }, hu: { "tiers.heading": "D" } },
  });
  assert.equal(LANGUAGE_LIMIT_FREE, 2);
  assert.deepEqual(languagesForPlan(stored, "free"), ["cs", "sk"]);
  assert.deepEqual(languagesForPlan(stored, "pro"), ["cs", "sk", "de", "hu"]);
  const free = gateConfigForPlan(stored, "free").config;
  assert.deepEqual(Object.keys(storefrontTexts(free)), ["cs", "sk"]);
  assert.deepEqual(Object.keys(storefrontTexts(gateConfigForPlan(stored, "pro").config)), ["cs", "sk", "de", "hu"]);
  assert.deepEqual(Object.keys(stored.locales), ["cs", "sk", "de", "hu"], "the gate works on a copy");
});

test("the storefront config carries no texts: each language is its own metafield", () => {
  const built = buildStorefrontConfig(configOf(STORED_TODAY), { configVersion: "cv" });
  assert.equal("texts" in built, false);
});

test("placeholders: a text must use exactly the ones of the extension's text", () => {
  assert.deepEqual(placeholdersOf("{qty} ks za {total} ({price}/ks). {qty}"), ["price", "qty", "total"]);
  assert.equal(storefrontTextIssue("cart.saved", "Ušetříte {amount}.", ""), null, "empty = the extension's own");
  assert.equal(storefrontTextIssue("cart.saved", "Ušetříte {amount}.", "Sleva {amount}!"), null);
  assert.deepEqual(storefrontTextIssue("cart.saved", "Ušetříte {amount}.", "Sleva!"), { reason: "placeholders", missing: ["amount"], extra: [] });
  assert.deepEqual(storefrontTextIssue("cart.saved", "Ušetříte {amount}.", "Sleva {amount} {price}"), { reason: "placeholders", missing: [], extra: ["price"] });
  assert.deepEqual(storefrontTextIssue("tiers.heading", "Množstevní sleva", "x".repeat(CONFIG_LIMITS.localeStringLength + 1)), { reason: "too_long", max: CONFIG_LIMITS.localeStringLength });
  // The countdown's units: four of them.
  assert.equal(storefrontTextIssue("campaign.units", "d,h,min,s", "dní,hod,min,s"), null);
  assert.deepEqual(storefrontTextIssue("campaign.units", "d,h,min,s", "dní, hod"), { reason: "units" });
  // A Milníky step's own name: `{value}` may be used, nothing else.
  const name = milestoneNameKey("ms-1");
  assert.equal(name, "cart.ms_name.ms-1");
  assert.equal(storefrontTextIssue(name, "", "Věrnostní sleva {value}"), null);
  assert.equal(storefrontTextIssue(name, "", "Věrnostní sleva"), null);
  assert.deepEqual(storefrontTextIssue(name, "", "Sleva {amount}"), { reason: "placeholders", missing: [], extra: ["amount"] });
});

// --- The sizes behind the decision (navrh-preklady-a-vzhled.md) ----------------------------------------

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
/** Shopify's json metafield limit (shopify.dev "Metafield limits"). */
const METAFIELD_BYTES = 128_000;

function extensionKeys(): string[] {
  const flat = (value: Record<string, unknown>, prefix = ""): string[] => Object.entries(value).flatMap(([key, v]) => (typeof v === "string" ? [`${prefix}${key}`] : flat(v as Record<string, unknown>, `${prefix}${key}.`)));
  return flat(JSON.parse(readFileSync(new URL("../../../../apps/won-discounts/extensions/won-discounts-storefront/locales/en.default.json", import.meta.url), "utf8")));
}

test("one language at its worst (every text at the length limit, 3 bytes a character) fits a metafield of its own", () => {
  const keys = extensionKeys();
  assert.ok(keys.length >= 38);
  // The extension's texts and a name for each of the 6 discount steps a market can have.
  const all = [...keys, ...Array.from({ length: 6 }, (_, i) => milestoneNameKey(`ms-${"x".repeat(60)}${i}`))];
  const worst = Object.fromEntries(all.map((key) => [key, "中".repeat(CONFIG_LIMITS.localeStringLength)]));
  const size = bytes(worst);
  assert.ok(size < METAFIELD_BYTES, `${size} B`);
  // Two such languages would not fit one shared metafield: hence one each.
  assert.ok(size * 2 > METAFIELD_BYTES);
});
