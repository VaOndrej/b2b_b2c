import assert from "node:assert/strict";
import { test } from "node:test";

import { APPEARANCE_PRESETS, DEFAULT_CONFIG } from "@won/core/discounts/config";

import { APPEARANCE_FIELD, isAppearancePreset, presetLabel, readAppearanceForm } from "../../app/components/model/appearance.ts";
import {
  COMBINATION_FIELD,
  COMBINATION_KEYS,
  combinationSentence,
  combinationSummary,
  readCombinationForm,
} from "../../app/components/model/combination.ts";
import { embedActivationUrl, tiersBlockAddUrl, TIERS_BLOCK_HANDLE } from "../../app/components/model/embed.ts";
import { translator } from "../../app/i18n/index.ts";

// Nastavení: the Free per-category combination switches (A1, engine.combination —
// the MVP 1 debt) and Vzhled: the 4 presets (K7). Each switch has one sentence per
// position saying what it does (§4c: no enum on screen), the server parses the
// same fields the screen posts (SEC-1).

const cs = translator("cs");
const en = translator("en");

function form(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

test("combination: the four Free switches, in the engine's own names; unchecked = off", () => {
  assert.deepEqual([...COMBINATION_KEYS], ["outletWithAnything", "productWithOrder", "productWithShipping", "orderWithShipping"]);
  assert.equal(COMBINATION_FIELD.productWithOrder, "productWithOrder");
  assert.deepEqual(readCombinationForm(form([["productWithOrder", "on"], ["orderWithShipping", "on"]])), {
    outletWithAnything: false,
    productWithOrder: true,
    productWithShipping: false,
    orderWithShipping: true,
  });
  // The defaults (DEFAULT_CONFIG.engine.combination) read back as they are.
  const d = DEFAULT_CONFIG.engine.combination;
  assert.deepEqual(
    readCombinationForm(form(COMBINATION_KEYS.filter((k) => d[k]).map((k) => [k, "on"]))),
    { outletWithAnything: d.outletWithAnything, productWithOrder: d.productWithOrder, productWithShipping: d.productWithShipping, orderWithShipping: d.orderWithShipping },
  );
});

test("combination: a sentence per switch and position, and a state line of what adds up (§17)", () => {
  assert.equal(combinationSentence("productWithOrder", false, cs), "Platí buď slevy na produkty, nebo sleva z objednávky: podle toho, co dá zákazníkovi víc.");
  assert.equal(combinationSentence("productWithShipping", false, en), "When the cart has a product discount (a quantity discount included), no shipping discount applies.");
  for (const key of COMBINATION_KEYS) {
    for (const on of [true, false]) {
      assert.notEqual(combinationSentence(key, on, cs), combinationSentence(key, !on, cs), `${key}: on and off differ`);
    }
  }
  assert.equal(
    combinationSummary({ outletWithAnything: false, productWithOrder: true, productWithShipping: true, orderWithShipping: true }, cs),
    "Sčítá se: produkty s objednávkou, produkty s dopravou a objednávka s dopravou",
  );
  assert.equal(
    combinationSummary({ outletWithAnything: false, productWithOrder: false, productWithShipping: false, orderWithShipping: false }, cs),
    "Nic se nesčítá, platí vždy jen jedna kategorie slev",
  );
});

test("appearance: exactly the core presets (K7), each with a label; the form takes only one of them", () => {
  assert.deepEqual([...APPEARANCE_PRESETS], ["default", "highlight", "chips", "tiles"]);
  assert.equal(APPEARANCE_FIELD.preset, "preset");
  for (const preset of APPEARANCE_PRESETS) {
    assert.ok(isAppearancePreset(preset));
    assert.doesNotMatch(presetLabel(preset, cs), /appearance\./);
  }
  assert.equal(presetLabel("default", cs), "Tabulka");
  assert.equal(presetLabel("tiles", en), "Tiles");
  assert.deepEqual(readAppearanceForm(form([["preset", "chips"]])), { ok: true, preset: "chips" });
  assert.deepEqual(readAppearanceForm(form([["preset", "neon"]])), { ok: false, errors: [{ field: "preset", key: "appearance.error.preset" }] });
  assert.equal(isAppearancePreset("neon"), false);
});

test("theme-editor deep links: the block (addAppBlockId, product template, main section) and the embed, by the app's API key", () => {
  assert.equal(TIERS_BLOCK_HANDLE, "quantity_tiers");
  assert.equal(
    tiersBlockAddUrl("won-dev.myshopify.com", "abc123"),
    "https://won-dev.myshopify.com/admin/themes/current/editor?template=product&addAppBlockId=abc123/quantity_tiers&target=mainSection",
  );
  assert.equal(tiersBlockAddUrl("evil.example.com", "abc123"), null);
  assert.equal(tiersBlockAddUrl("won-dev.myshopify.com", ""), null);
  assert.match(embedActivationUrl("won-dev.myshopify.com", "abc123") ?? "", /activateAppId=abc123\/won_discounts_embed/);
});
