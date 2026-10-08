// Vzhled u modulů (feedback 2026-10-06, body 12 a 13) — the pure model of a look's section and what must be gone
// with the Vzhled page: no link to its address, no text that sends a merchant "to Vzhled".

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { LOOK_ELEMENTS } from "@won/core/discounts/custom-look";
import { LOOK_PRESETS } from "@won/core/discounts/looks";

import { isLookElement, LOOK_FIELD, LOOKS_ACTION, presetDetails, presetLabel, readLookForm } from "../../app/components/model/looks.ts";
import { CATALOGUES, translator } from "../../app/i18n/index.ts";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app");
const form = (entries: [string, string][]) => ({
  get: (name: string) => entries.find(([n]) => n === name)?.[1] ?? null,
  getAll: (name: string) => entries.filter(([n]) => n === name).map(([, v]) => v),
});

test("every ready-made look of every element has a name and a one-line description in both admin languages", () => {
  for (const locale of ["cs", "en"] as const) {
    const tr = translator(locale);
    for (const element of LOOK_ELEMENTS) {
      assert.ok(isLookElement(element));
      for (const preset of LOOK_PRESETS[element]) {
        for (const text of [presetLabel(element, preset, tr), presetDetails(element, preset, tr)]) assert.ok(text !== "" && !/^(looks|appearance)\./.test(text), `${locale} ${element}.${preset}: ${text}`);
      }
      for (const key of [`looks.title.${element}`, `looks.cssHint.${element}`]) assert.ok(Object.prototype.hasOwnProperty.call(CATALOGUES[locale], key), `${locale}: ${key}`);
    }
  }
  const cs = translator("cs");
  assert.deepEqual(LOOK_PRESETS.milestones.map((p) => presetLabel("milestones", p, cs)), ["Ukazatel se značkami", "Odškrtávací seznam", "Jedna věta"]);
  assert.deepEqual(LOOK_PRESETS.outlet.map((p) => presetLabel("outlet", p, cs)), ["Štítek", "Štítek s odpočtem", "Pruh"]);
  assert.deepEqual(LOOK_PRESETS.campaign.map((p) => presetLabel("campaign", p, cs)), ["Banner s odpočtem", "Pruh", "Karta"]);
});

test("a look's form as the server reads it: only known looks and colours, the flash only for the ladder, the custom look as typed", () => {
  assert.equal(LOOKS_ACTION, "/app/looks");
  assert.deepEqual(readLookForm(form([["element", "milestones"], ["preset", "checklist"], ["accent", "green"], ["blink", "on"], ["look.accent", "#0A7D4F"], ["look.radius", "4"], ["look.css", " .won-ms__text{color:red} "]])), {
    ok: true,
    look: { element: "milestones", preset: "checklist", accent: "green", blink: true, custom: { vars: { accent: "#0a7d4f", radius: 4 }, css: " .won-ms__text{color:red} " } },
  });
  // A colour not sent = the theme's; the flash is the ladder's alone; nothing typed = no custom look.
  assert.deepEqual(readLookForm(form([["element", "outlet"], ["preset", "strip"], ["blink", "on"], ["look.css", "   "]])), { ok: true, look: { element: "outlet", preset: "strip", accent: "theme", custom: null } });
  // The table posts only its custom look: its ready-made look and colour are its page's.
  assert.deepEqual(readLookForm(form([["element", "tiers"], ["preset", "tiles"], ["accent", "red"], ["look.tint", "#fff"]])), { ok: true, look: { element: "tiers", custom: { vars: { tint: "#fff" }, css: "" } } });
  assert.deepEqual(readLookForm(form([["element", "campaign"], ["preset", "badge"], ["accent", "pink"], ["look.line", "blue"], ["look.radius", "33"]])), {
    ok: false,
    errors: [
      { field: LOOK_FIELD.preset, key: "looks.error.preset" },
      { field: LOOK_FIELD.accentPreset, key: "looks.error.accent" },
      { field: LOOK_FIELD.line, key: "looks.error.color" },
      { field: LOOK_FIELD.radius, key: "looks.error.radius", params: { max: 32 } },
    ],
  });
  assert.deepEqual(readLookForm(form([["element", "cart"]])), { ok: false, errors: [{ field: "element", key: "looks.error.preset" }] });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return name === "generated" ? [] : sources(file);
    return /\.(ts|tsx)$/.test(name) ? [file] : [];
  });
}

test("Vzhled is gone: its address only redirects to Překlady, nothing in the app links to it, and no text sends a merchant there", () => {
  const route = readFileSync(path.join(APP, "routes/app.appearance.tsx"), "utf8");
  assert.match(route, /const \{ redirect \} = await authenticate\.admin\(request\);\s+return redirect\("\/app\/translations"\);/);
  assert.doesNotMatch(route, /export (const|function|default)[^\n]*(action|function )/, "no page and no action behind the old address");
  for (const file of sources(APP)) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /\/app\/appearance/, `${path.relative(APP, file)} links to the old address`);
  }
  for (const locale of ["cs", "en"] as const) {
    for (const [key, text] of Object.entries(CATALOGUES[locale])) {
      assert.doesNotMatch(text, /(ve|do|na stránce) Vzhledu?\b|\b(in|to|on) Appearance\b|\bOpen Look\b/, `${locale} ${key}: ${text}`);
    }
    assert.equal(Object.prototype.hasOwnProperty.call(CATALOGUES[locale], "nav.appearance") || Object.prototype.hasOwnProperty.call(CATALOGUES[locale], "module.appearance"), false);
  }
});
