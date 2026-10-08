// The look of each storefront element (feedback 2026-10-06, bod 13): looks are not shared between modules, a
// custom look is confined to its element, and a config from before the split keeps the storefront as it was.

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig, type WonDiscountsConfig } from "../../src/discounts/config.ts";
import { LOOK_ELEMENTS, LOOK_ROOT } from "../../src/discounts/custom-look.ts";
import { elementLookCss, LOOK_PRESET_CSS, LOOK_PRESETS, lookPreset, LOOKS_ELEMENTS, looksCss, MILESTONE_BLINK_CSS, outletCountdown } from "../../src/discounts/looks.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { scopeCss } from "../../src/discounts/scope-css.ts";
import { buildStorefrontConfig } from "../../src/discounts/storefront-config.ts";

function configOf(input: Record<string, unknown>): WonDiscountsConfig {
  const { config, issues } = sanitizeConfig(input);
  assert.deepEqual(issues, []);
  return config;
}
const css = (config: WonDiscountsConfig, plan: "free" | "pro") => buildStorefrontConfig(gateConfigForPlan(config, plan).config, { configVersion: "v" }).appearance.css ?? "";

// The storefront settings a shop has stored today (before the split): one look, one colour, one custom look.
const STORED_TODAY = {
  storefront: {
    appearancePreset: "chips",
    cardPricesEnabled: false,
    accent: "green",
    custom: { vars: { accent: "#0a7d4f", tint: "#f2fbf6", radius: 4 }, css: ".won-tiers__heading { text-transform: uppercase; }\n.won-tiers__row[data-active=\"true\"] { font-weight: 700 }" },
  },
};
/** The root every block shared before the split (custom-look.ts WON_BLOCK_ROOT of 7 Oct 2026). */
const OLD_ROOT = ":is(.won-tiers,.won-cart,.won-cart-slot,.won-outlet,.won-progress,.won-campaign,.won-topbar)";
const OLD_CSS =
  `${OLD_ROOT}{--won-tiers-accent:#1a7f45}` +
  `${OLD_ROOT}{--won-tiers-accent:#0a7d4f;--won-tiers-tint:#f2fbf6;--won-tiers-radius:4px}` +
  (scopeCss(STORED_TODAY.storefront.custom.css, OLD_ROOT) as { css: string }).css;

test("conversion: a config stored before the split keeps its table's look, and its colours still reach the ladder", () => {
  const config = configOf(STORED_TODAY);
  assert.equal(config.storefront.appearancePreset, "chips");
  assert.equal(config.storefront.accent, "green");
  assert.deepEqual(config.storefront.custom, STORED_TODAY.storefront.custom, "the table's own fields are read as they are");
  assert.deepEqual(config.storefront.looks, { milestones: { accent: "green", custom: { vars: { accent: "#0a7d4f" }, css: "" } } });

  // On the storefront: the same declarations and the same rules as before, the table's under the table…
  const now = css(config, "pro");
  assert.equal(
    now,
    ".won-tiers{--won-tiers-accent:#1a7f45}.won-tiers{--won-tiers-accent:#0a7d4f;--won-tiers-tint:#f2fbf6;--won-tiers-radius:4px}" +
      `.won-tiers .won-tiers__heading{text-transform: uppercase;}.won-tiers .won-tiers__row[data-active="true"]{font-weight: 700}` +
      // …and the highlight colour on the ladder (the only other element that reads it).
      ".won-ms{--won-tiers-accent:#1a7f45}.won-ms{--won-tiers-accent:#0a7d4f}",
  );
  // The old stylesheet with its shared root narrowed to the table is exactly the table's part of the new one.
  assert.ok(now.startsWith(OLD_CSS.split(OLD_ROOT).join(".won-tiers")));
  // Free: the ready-made colour on both, no custom look on either.
  assert.equal(css(config, "free"), ".won-tiers{--won-tiers-accent:#1a7f45}.won-ms{--won-tiers-accent:#1a7f45}");
});

test("conversion happens once: load → save → load gives the same config, and a colour picked for the table later is the table's alone", () => {
  const first = configOf(STORED_TODAY);
  const again = configOf(JSON.parse(JSON.stringify(first)));
  assert.equal(JSON.stringify(again), JSON.stringify(first));
  // A converted config (it has `looks`) whose table gets a colour: nothing is copied any more.
  const later = configOf({ storefront: { appearancePreset: "chips", accent: "red", looks: {} } });
  assert.deepEqual(later.storefront.looks, {});
  assert.equal(css(later, "free"), ".won-tiers{--won-tiers-accent:#b42318}");
  // A config without any colour: nothing to copy, `looks` is there all the same.
  assert.deepEqual(configOf({ storefront: { appearancePreset: "default" } }).storefront.looks, {});
  assert.deepEqual(configOf({}).storefront.looks, {});
});

test("every element has its own look: a ready-made one, a colour, and on Pro own colours and CSS — confined to the element", () => {
  const config = configOf({
    storefront: {
      appearancePreset: "tiles",
      looks: {
        milestones: { preset: "checklist", accent: "violet", blink: true, custom: { vars: { accent: "#123456" }, css: ".won-ms__text{letter-spacing:1px}" } },
        outlet: { preset: "strip", custom: { vars: { tint: "#fff0f0", radius: 0 }, css: ":root{margin:0} .won-outlet__badge{text-transform:uppercase}" } },
        campaign: { preset: "card", accent: "orange" },
      },
    },
  });
  assert.deepEqual(Object.keys(config.storefront.looks), ["milestones", "outlet", "campaign"]);
  const pro = css(config, "pro");
  assert.equal(
    pro,
    LOOK_PRESET_CSS.milestones.checklist + MILESTONE_BLINK_CSS + ".won-ms{--won-tiers-accent:#6d28d9}.won-ms{--won-tiers-accent:#123456}.won-ms .won-ms__text{letter-spacing:1px}" +
      LOOK_PRESET_CSS.outlet.strip + ".won-outlet{--won-tiers-tint:#fff0f0;--won-tiers-radius:0px}.won-outlet{margin:0}.won-outlet .won-outlet__badge{text-transform:uppercase}" +
      LOOK_PRESET_CSS.campaign.card + ".won-campaign{--won-tiers-accent:#b45309}",
  );
  // Free: the ready-made looks and colours stay, every custom look goes; the stored config keeps them.
  assert.equal(css(config, "free"), LOOK_PRESET_CSS.milestones.checklist + MILESTONE_BLINK_CSS + ".won-ms{--won-tiers-accent:#6d28d9}" + LOOK_PRESET_CSS.outlet.strip + LOOK_PRESET_CSS.campaign.card + ".won-campaign{--won-tiers-accent:#b45309}");
  assert.ok(config.storefront.looks.outlet?.custom);
});

test("one element's custom CSS can never style another: every rule a merchant writes starts with the element's own root", () => {
  for (const element of LOOKS_ELEMENTS) {
    const out = elementLookCss(element, { custom: { vars: {}, css: ".won-tiers{display:none} .won-ms,.won-outlet,.won-campaign{color:red} :root{opacity:.5} @media (min-width:1px){body{margin:0}}" } });
    const root = LOOK_ROOT[element];
    assert.equal(out, `${root} .won-tiers{display:none}${root} .won-ms,${root} .won-outlet,${root} .won-campaign{color:red}${root}{opacity:.5}@media (min-width:1px){${root}{margin:0}}`);
  }
  // The roots are four different elements of the extension's markup; none is inside another's.
  assert.deepEqual(LOOK_ELEMENTS.map((e) => LOOK_ROOT[e]), [".won-tiers", ".won-ms", ".won-outlet", ".won-campaign"]);
});

test("ready-made looks: the first of each element is the look it always had (no CSS at all); an unknown one falls back to it with an issue", () => {
  for (const element of LOOKS_ELEMENTS) {
    const presets = LOOK_PRESETS[element];
    assert.equal(presets.length, 3);
    assert.deepEqual(Object.keys(LOOK_PRESET_CSS[element]), [...presets]);
    assert.equal(LOOK_PRESET_CSS[element][presets[0]], "");
    assert.equal(lookPreset(element, undefined), presets[0]);
    assert.equal(elementLookCss(element, undefined), "");
    for (const preset of presets.slice(1)) {
      const rules = LOOK_PRESET_CSS[element][preset]!;
      assert.ok(rules.length > 0 && !/[<\\]|url\(|@import/.test(rules), `${element}.${preset}`);
      // Our own rules never reach outside the element either.
      for (const selector of rules.replace(/\{[^}]*\}/g, "\n").split(/[\n,]/).filter(Boolean)) assert.ok(selector.includes(`${LOOK_ROOT[element]}${LOOK_ROOT[element]}`), `${element}.${preset}: ${selector}`);
    }
  }
  assert.equal(looksCss(configOf({}).storefront), "");
  const junk = sanitizeConfig({ storefront: { looks: { milestones: { preset: "fireworks", accent: "pink", blink: "yes" }, outlet: "x", campaign: { preset: "countdown" } } } });
  assert.deepEqual(junk.config.storefront.looks, {});
  assert.deepEqual(junk.issues.map((i) => i.code).sort(), ["invalid_look", "unknown_accent", "unknown_look"]);
});

test("the sale badge's countdown: the storefront config says when the block needs its script", () => {
  const of = (preset: string | undefined) => buildStorefrontConfig(configOf({ storefront: { looks: preset ? { outlet: { preset } } : {} } }), { configVersion: "v" }).appearance;
  assert.deepEqual(of(undefined), { preset: "default" });
  assert.equal(of("countdown").oc, 1);
  assert.equal(of("strip").oc, 1);
  assert.equal(outletCountdown({ outlet: { preset: "badge" } }), false);
});

// --- The size behind the storage decision (docs/won-discounts/navrh-preklady-a-vzhled.md) ------------------

test("four custom looks at their densest fit the storefront config with room to spare", () => {
  const dense = ".a{b:c}".repeat(Math.floor(4000 / 7));
  const config = configOf({ storefront: { custom: { vars: {}, css: dense }, looks: Object.fromEntries(LOOKS_ELEMENTS.map((e) => [e, { preset: LOOK_PRESETS[e][2], custom: { vars: {}, css: dense } }])) } });
  const bytes = new TextEncoder().encode(css(config, "pro")).length;
  assert.ok(bytes > 40_000 && bytes < 50_000, `${bytes} B`);
});
