import assert from "node:assert/strict";
import { test } from "node:test";

import { APPEARANCE_PRESETS, DEFAULT_CONFIG } from "@won/core/discounts/config";

import { LOOK_FIELD, customLookSet, liveCustomLookCss, presetLabel, readLookForm } from "../../app/components/model/looks.ts";
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

test("the table's looks: exactly the core presets (K7), each with a label; the look form takes only one of them", () => {
  assert.deepEqual([...APPEARANCE_PRESETS], ["default", "highlight", "chips", "tiles"]);
  assert.equal(LOOK_FIELD.preset, "preset");
  for (const preset of APPEARANCE_PRESETS) {
    assert.doesNotMatch(presetLabel("tiers", preset, cs), /looks\./);
    assert.deepEqual(readLookForm(form([["element", "tiers"], ["preset", preset]])), { ok: true, look: { element: "tiers", preset, accent: "theme", custom: null } });
  }
  assert.equal(presetLabel("tiers", "default", cs), "Tabulka");
  assert.equal(presetLabel("tiers", "tiles", en), "Tiles");
  assert.deepEqual(readLookForm(form([["element", "tiers"], ["preset", "neon"]])), { ok: false, errors: [{ field: "preset", key: "looks.error.preset" }] });
  assert.deepEqual(readLookForm(form([["element", "tiers"]])), { ok: false, errors: [{ field: "preset", key: "looks.error.preset" }] }, "an element with looks to pick must say which");
  // The cart has one look only: its form posts no pick.
  assert.deepEqual(readLookForm(form([["element", "cart"]])), { ok: true, look: { element: "cart", preset: "plain", accent: "theme", custom: null } });
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

test("plan 2026-10-06: a new shop starts with the highlighted look", () => {
  assert.deepEqual(DEFAULT_CONFIG.storefront.looks, { tiers: { preset: "highlight" } });
});

test("plan 2026-10-06: a look's section follows its form — the custom look as the storefront would get it, under the element's own root, only values a save would take", () => {
  const values = (map: Record<string, string>) => (field: string) => map[field] ?? "";
  assert.equal(customLookSet(values({})), false);
  assert.equal(customLookSet(values({ [LOOK_FIELD.radius]: "4" })), true);
  assert.equal(customLookSet(values({ [LOOK_FIELD.css]: "  " })), false);
  assert.equal(liveCustomLookCss("tiers", values({})), "");
  assert.equal(
    liveCustomLookCss("tiers", values({ [LOOK_FIELD.accent]: "#0A7D4F", [LOOK_FIELD.radius]: "4", [LOOK_FIELD.css]: ".won-tiers__heading{color:red}" })),
    ".won-tiers{--won-tiers-accent:#0a7d4f;--won-tiers-radius:4px}.won-tiers .won-tiers__heading{color:red}",
  );
  // The same fields in the ladder's section stay inside the ladder.
  assert.equal(liveCustomLookCss("milestones", values({ [LOOK_FIELD.accent]: "#0A7D4F", [LOOK_FIELD.css]: ".won-tiers{display:none}" })), ":not(.won-topbar)>.won-progress>.won-ms{--won-tiers-accent:#0a7d4f}:not(.won-topbar)>.won-progress>.won-ms .won-tiers{display:none}");
  // …and the same fields of the strip's section inside the strip's ladder.
  assert.equal(liveCustomLookCss("msBar", values({ [LOOK_FIELD.css]: ":root{gap:2em}" })), ".won-topbar .won-ms{gap:2em}");
  // What the server would refuse never reaches the preview: a colour that is not a hex, a radius out of range, CSS that cannot be scoped.
  assert.equal(liveCustomLookCss("tiers", values({ [LOOK_FIELD.accent]: "red", [LOOK_FIELD.radius]: "99", [LOOK_FIELD.css]: ".a{background:url(x)}" })), "");
});
