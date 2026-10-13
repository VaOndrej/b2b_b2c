import assert from "node:assert/strict";
import { test } from "node:test";

import { APPEARANCE_PRESETS, DEFAULT_CONFIG } from "@won/core/discounts/config";

import { LOOK_FIELD, customLookSet, liveCustomLookCss, presetLabel, readLookForm } from "../../app/components/model/looks.ts";
import { COMBINATION_FIELD, combineDefaultSummary, readCombineDefaultForm } from "../../app/components/model/combination.ts";
import { COMBINE_FIELD, COMBINE_OFFERED, COMBINE_TYPES, combineSummary, combineTypeLabel, readCombineTypes } from "../../app/components/model/combine.ts";
import { embedActivationUrl, tiersBlockAddUrl, TIERS_BLOCK_HANDLE } from "../../app/components/model/embed.ts";
import { translator } from "../../app/i18n/index.ts";

// "Sčítá se s" (13 Oct 2026, model/combine.ts): the list of types a discount adds up with — the same labels,
// form fields and state sentence in the rule editor, on the module pages and in Nastavení (the list a new
// discount starts with; the four category switches of before are gone) — and Vzhled: the 4 presets (K7). The
// server parses the same fields the screen posts (SEC-1); no type key ever reaches the screen (§4c).

const cs = translator("cs");
const en = translator("en");

function form(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}

test("Sčítá se s: six types, each with its label; an owner is offered only the types it can meet", () => {
  assert.deepEqual([...COMBINE_TYPES], ["automatic", "code", "shipping", "tiers", "rewards", "outlet"]);
  assert.deepEqual(COMBINE_TYPES.map((type) => combineTypeLabel(type, cs)), ["Automatické slevy", "Slevové kódy", "Doprava zdarma", "Množstevní slevy", "Milníky", "Výprodej"]);
  for (const type of COMBINE_TYPES) assert.doesNotMatch(combineTypeLabel(type, en), /combine\./);
  assert.deepEqual([...COMBINE_OFFERED.automatic], [...COMBINE_TYPES]);
  assert.deepEqual([...COMBINE_OFFERED.shipping], ["automatic", "code", "tiers", "rewards"]);
  assert.deepEqual([...COMBINE_OFFERED.tiers], ["automatic", "code", "shipping", "rewards", "outlet"]);
  assert.deepEqual([...COMBINE_OFFERED.outlet], ["automatic", "code", "tiers", "rewards"]);
});

test("Sčítá se s: the form posts the ticked types and a marker; none ticked is an empty list, no marker is no list", () => {
  assert.equal(COMBINE_FIELD.types, "combineTypes");
  const posted = (types: string[]) => form([[COMBINE_FIELD.posted, "1"], ...types.map((type): [string, string] => [COMBINE_FIELD.types, type])]);
  // In the checkboxes' order, known types only, each once.
  assert.deepEqual(readCombineTypes(posted(["rewards", "automatic", "rewards", "bogus"]), "automatic"), ["automatic", "rewards"]);
  // Only what the owner is offered: a sale cannot name shipping.
  assert.deepEqual(readCombineTypes(posted(["shipping", "code", "outlet"]), "outlet"), ["code"]);
  assert.deepEqual(readCombineTypes(posted([]), "tiers"), []);
  assert.equal(readCombineTypes(form([[COMBINE_FIELD.types, "code"]]), "automatic"), null);
  // Nastavení reads the default list the same way; its other fields are untouched by it.
  assert.deepEqual(readCombineDefaultForm(posted(["shipping", "rewards"])), [...DEFAULT_CONFIG.engine.combineDefault]);
  assert.equal(readCombineDefaultForm(form([[COMBINATION_FIELD.unknownMarketLowest, "on"]])), null);
});

test("Sčítá se s: one state sentence — the types in words, then the exceptions by name (§17)", () => {
  assert.equal(combineSummary(["shipping", "automatic"], cs), "sčítá se s automatickými slevami a dopravou zdarma");
  assert.equal(combineSummary([], cs), "s jinou slevou se nesčítá");
  assert.equal(combineSummary(["code"], cs, ["NEWSLETTER"]), "sčítá se s slevovými kódy · výjimka: NEWSLETTER");
  assert.equal(combineSummary([], en, ["A", "B"]), "adds up with no other discount · exceptions: A and B");
  assert.equal(combineSummary(["tiers", "rewards", "outlet"], en), "adds up with quantity discounts, Milestones and sale items");
  assert.equal(combineDefaultSummary([...DEFAULT_CONFIG.engine.combineDefault], cs), "Nová sleva: sčítá se s dopravou zdarma a Milníky");
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
