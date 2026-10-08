// The look of each storefront element (feedback 2026-10-06, bod 13): looks are not shared between modules, a
// custom look is confined to its element, and a config from before the split keeps the storefront as it was.

import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeConfig, type WonDiscountsConfig } from "../../src/discounts/config.ts";
import { LOOK_ELEMENTS, LOOK_ROOT } from "../../src/discounts/custom-look.ts";
import { elementLookCss, LOOK_PRESET_CSS, LOOK_PRESETS, lookPreset, looksCss, MILESTONE_BLINK_CSS, outletCountdown, splitLegacyCss } from "../../src/discounts/looks.ts";
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

test("conversion: a config stored before the split keeps the storefront as it was — the table's look, its colours on the ladder, every rule with its element", () => {
  const config = configOf(STORED_TODAY);
  // One place for every element's look; the old fields are read and never written back.
  assert.deepEqual(Object.keys(config.storefront).sort(), ["cardPricesEnabled", "looks"]);
  assert.deepEqual(config.storefront.looks, {
    tiers: { preset: "chips", accent: "green", custom: STORED_TODAY.storefront.custom },
    milestones: { accent: "green", custom: { vars: { accent: "#0a7d4f" }, css: "" } },
  });

  // On the storefront: the same declarations and the same rules as before, the table's under the table…
  const now = css(config, "pro");
  assert.equal(
    now,
    ".won-tiers{--won-tiers-accent:#1a7f45}.won-tiers{--won-tiers-accent:#0a7d4f;--won-tiers-tint:#f2fbf6;--won-tiers-radius:4px}" +
      `.won-tiers .won-tiers__heading{text-transform: uppercase;}.won-tiers .won-tiers__row[data-active="true"]{font-weight: 700}` +
      // …and the highlight colour on the ladder (the only other element that read it).
      ".won-ms{--won-tiers-accent:#1a7f45}.won-ms{--won-tiers-accent:#0a7d4f}",
  );
  // The old stylesheet with its shared root narrowed to the table is exactly the table's part of the new one.
  assert.ok(now.startsWith(OLD_CSS.split(OLD_ROOT).join(".won-tiers")));
  // Free: the ready-made colour on both, no custom look on either.
  assert.equal(css(config, "free"), ".won-tiers{--won-tiers-accent:#1a7f45}.won-ms{--won-tiers-accent:#1a7f45}");
  assert.equal(buildStorefrontConfig(config, { configVersion: "v" }).appearance.preset, "chips");
});

test("conversion of the one old CSS: a rule goes to the element its selector names, a rule that names none to every element — nothing a shop wrote disappears", () => {
  const old = [
    ".won-tiers__row { padding: 4px }",
    ".won-cart__saved { font-weight: 700 }",
    ".won-topbar .won-ms__text { letter-spacing: 1px }",
    ".won-ms__track span { height: 6px }",
    ".won-outlet__badge { text-transform: uppercase }",
    ".won-campaign__title { font-size: 2em }",
    "@media (min-width: 750px) { .won-cart__code input { min-width: 12em } }",
    "p { margin: 0 }",
  ];
  const split = splitLegacyCss(old.join("\n"));
  const of = (...indexes: number[]) => indexes.map((n) => old[n]).join("\n");
  assert.deepEqual(split, {
    tiers: of(0, 7),
    cart: of(1, 2, 6, 7),
    milestones: of(2, 3, 7),
    outlet: of(4, 7),
    campaign: of(5, 7),
  });
  // Every rule of the old text is in at least one element; none was dropped.
  for (const rule of old) assert.ok(Object.values(split).some((text) => text.includes(rule)), rule);
  const config = configOf({ storefront: { appearancePreset: "default", custom: { vars: {}, css: old.join("\n") } } });
  assert.deepEqual(Object.fromEntries(LOOK_ELEMENTS.map((e) => [e, config.storefront.looks[e]?.custom?.css])), split);
  const shipped = css(config, "pro");
  for (const rule of [".won-tiers .won-tiers__row{padding: 4px}", ":is(.won-cart,.won-cart-slot,.won-topbar) .won-cart__saved{font-weight: 700}", ".won-ms .won-ms__track span{height: 6px}", ".won-outlet .won-outlet__badge{text-transform: uppercase}", ".won-campaign .won-campaign__title{font-size: 2em}", "@media (min-width: 750px){:is(.won-cart,.won-cart-slot,.won-topbar) .won-cart__code input{min-width: 12em}}", ".won-outlet p{margin: 0}"]) {
    assert.ok(shipped.includes(rule), rule);
  }
  // A text that cannot be divided stays whole with the table (the page then says why it is not used).
  assert.deepEqual(splitLegacyCss(".a{b:c"), { tiers: ".a{b:c" });
  assert.deepEqual(splitLegacyCss(""), {});
});

test("conversion of the shape in between (the looks split off, the table still in its own three fields): they become the table's look, nothing else moves", () => {
  const between = { storefront: { appearancePreset: "tiles", accent: "red", cardPricesEnabled: true, custom: { vars: { radius: 2 }, css: ".won-ms__text{color:red}" }, looks: { milestones: { preset: "sentence" } } } };
  const config = configOf(between);
  assert.deepEqual(config.storefront, {
    cardPricesEnabled: true,
    looks: { tiers: { preset: "tiles", accent: "red", custom: { vars: { radius: 2 }, css: ".won-ms__text{color:red}" } }, milestones: { preset: "sentence" } },
  });
  // The storefront gets what it got: the table's colour and custom look under the table, the ladder's look.
  assert.equal(css(config, "pro"), ".won-tiers{--won-tiers-accent:#b42318}.won-tiers{--won-tiers-radius:2px}.won-tiers .won-ms__text{color:red}" + LOOK_PRESET_CSS.milestones.sentence);
  // Once the table has its look under `looks`, a leftover old field is not read any more.
  assert.deepEqual(configOf({ storefront: { appearancePreset: "tiles", looks: { tiers: { preset: "chips" } } } }).storefront.looks, { tiers: { preset: "chips" } });
});

test("conversion happens once: load → save → load gives the same config, in every stored shape", () => {
  const shapes = [
    STORED_TODAY,
    { storefront: { appearancePreset: "tiles", accent: "red", custom: { vars: { radius: 2 }, css: "p{margin:0}" }, looks: { milestones: { preset: "sentence" } } } },
    { storefront: { cardPricesEnabled: false, looks: { tiers: { preset: "highlight", accent: "blue" }, cart: { custom: { vars: {}, css: ".won-cart__saved{color:red}" } } } } },
    { storefront: { appearancePreset: "default" } },
    {},
  ];
  for (const shape of shapes) {
    const first = configOf(shape);
    const again = configOf(JSON.parse(JSON.stringify(first)));
    assert.equal(JSON.stringify(again), JSON.stringify(first));
    assert.equal(css(again, "pro"), css(first, "pro"));
  }
  // A converted config whose table gets a colour: nothing is copied any more.
  const later = configOf({ storefront: { looks: { tiers: { preset: "chips", accent: "red" } } } });
  assert.deepEqual(later.storefront.looks, { tiers: { preset: "chips", accent: "red" } });
  assert.equal(css(later, "free"), ".won-tiers{--won-tiers-accent:#b42318}");
  // A stored config without any look: the plain table it always had. Only a shop with no storefront settings at all starts highlighted.
  assert.deepEqual(configOf({ storefront: { appearancePreset: "default" } }).storefront.looks, {});
  assert.deepEqual(configOf({ storefront: {} }).storefront.looks, {});
  assert.deepEqual(configOf({}).storefront.looks, { tiers: { preset: "highlight" } });
});

test("every element has its own look: a ready-made one, a colour, and on Pro own colours and CSS — confined to the element", () => {
  const config = configOf({
    storefront: {
      looks: {
        tiers: { preset: "tiles" },
        milestones: { preset: "checklist", accent: "violet", blink: true, custom: { vars: { accent: "#123456" }, css: ".won-ms__text{letter-spacing:1px}" } },
        outlet: { preset: "strip", custom: { vars: { tint: "#fff0f0", radius: 0 }, css: ":root{margin:0} .won-outlet__badge{text-transform:uppercase}" } },
        campaign: { preset: "card", accent: "orange" },
        cart: { custom: { vars: {}, css: ".won-cart__saved{font-weight:700}" } },
      },
    },
  });
  assert.deepEqual(Object.keys(config.storefront.looks), ["tiers", "milestones", "outlet", "campaign", "cart"]);
  assert.equal(buildStorefrontConfig(config, { configVersion: "v" }).appearance.preset, "tiles");
  const pro = css(config, "pro");
  assert.equal(
    pro,
    LOOK_PRESET_CSS.milestones.checklist + MILESTONE_BLINK_CSS + ".won-ms{--won-tiers-accent:#6d28d9}.won-ms{--won-tiers-accent:#123456}.won-ms .won-ms__text{letter-spacing:1px}" +
      LOOK_PRESET_CSS.outlet.strip + ".won-outlet{--won-tiers-tint:#fff0f0;--won-tiers-radius:0px}.won-outlet{margin:0}.won-outlet .won-outlet__badge{text-transform:uppercase}" +
      LOOK_PRESET_CSS.campaign.card + ".won-campaign{--won-tiers-accent:#b45309}" +
      ":is(.won-cart,.won-cart-slot,.won-topbar) .won-cart__saved{font-weight:700}",
  );
  // Free: the ready-made looks and colours stay, every custom look goes; the stored config keeps them.
  assert.equal(css(config, "free"), LOOK_PRESET_CSS.milestones.checklist + MILESTONE_BLINK_CSS + ".won-ms{--won-tiers-accent:#6d28d9}" + LOOK_PRESET_CSS.outlet.strip + LOOK_PRESET_CSS.campaign.card + ".won-campaign{--won-tiers-accent:#b45309}");
  assert.ok(config.storefront.looks.outlet?.custom);
});

test("one element's custom CSS can never style another: every rule a merchant writes starts with the element's own root", () => {
  for (const element of LOOK_ELEMENTS) {
    const out = elementLookCss(element, { custom: { vars: {}, css: ".won-tiers{display:none} .won-ms,.won-outlet,.won-campaign{color:red} :root{opacity:.5} @media (min-width:1px){body{margin:0}}" } });
    const root = LOOK_ROOT[element];
    assert.equal(out, `${root} .won-tiers{display:none}${root} .won-ms,${root} .won-outlet,${root} .won-campaign{color:red}${root}{opacity:.5}@media (min-width:1px){${root}{margin:0}}`);
  }
  // The roots: four elements of the extension's markup and the frames the ladder sits in (the cart panel, its slot, the top strip).
  assert.deepEqual(LOOK_ELEMENTS.map((e) => LOOK_ROOT[e]), [".won-tiers", ".won-ms", ".won-outlet", ".won-campaign", ":is(.won-cart,.won-cart-slot,.won-topbar)"]);
});

test("ready-made looks: the first of each element is the look it always had (no CSS at all); an unknown one falls back to it with an issue", () => {
  // The table's ready-made looks are classes of its block and the cart has one look: neither has CSS here.
  assert.deepEqual([LOOK_PRESET_CSS.tiers, LOOK_PRESET_CSS.cart, LOOK_PRESETS.tiers.length, LOOK_PRESETS.cart.length], [{}, {}, 4, 1]);
  for (const element of ["milestones", "outlet", "campaign"] as const) {
    const presets = LOOK_PRESETS[element];
    assert.equal(presets.length, 3);
    assert.deepEqual(Object.keys(LOOK_PRESET_CSS[element]), [...presets]);
    assert.equal(LOOK_PRESET_CSS[element][presets[0]], "");
    assert.equal(lookPreset(element, undefined), presets[0]);
    assert.equal(elementLookCss(element, undefined), "");
    for (const preset of presets.slice(1)) {
      const rules = LOOK_PRESET_CSS[element][preset]!;
      assert.ok(rules.length > 0 && !/[<\\]|url\(|@import/.test(rules), `${element}.${preset}`);
      // Our own rules never reach outside the element either, and none doubles a class to win: each is more
      // specific than the extension's base rule it overrides (at most two classes), whatever order the stylesheets load in.
      for (const selector of rules.replace(/\{[^}]*\}/g, "\n").split(/[\n,]/).filter(Boolean)) {
        assert.ok(selector.includes(LOOK_ROOT[element]), `${element}.${preset}: ${selector}`);
        assert.doesNotMatch(selector, /(\.won-[a-z]+)\1(?![a-z_-])/, `${element}.${preset}: ${selector}`);
        assert.ok((selector.match(/\.[a-z]|\[|:not\(/g) ?? []).length >= 2, `${element}.${preset}: ${selector}`);
      }
    }
  }
  // The one base rule with two classes (the list is hidden in the compact size): the look that shows it has three.
  assert.ok(LOOK_PRESET_CSS.milestones.checklist!.startsWith(".won-ms.won-ms--compact .won-ms__list{display:grid}"));
  assert.equal(looksCss(configOf({}).storefront), "");
  for (const element of LOOK_ELEMENTS) assert.equal(lookPreset(element, undefined), LOOK_PRESETS[element][0]);
  const junk = sanitizeConfig({ storefront: { looks: { milestones: { preset: "fireworks", accent: "pink", blink: "yes" }, outlet: "x", campaign: { preset: "countdown" } } } });
  assert.deepEqual(junk.config.storefront.looks, {});
  assert.deepEqual(junk.issues.map((i) => i.code).sort(), ["invalid_look", "unknown_accent", "unknown_look"]);
});

test("the sale badge's countdown: the storefront config says when the block needs its script", () => {
  const of = (preset: string | undefined) => buildStorefrontConfig(configOf({ storefront: { looks: preset ? { outlet: { preset } } : {} } }), { configVersion: "v" }).appearance;
  // (a stored config with no look for the table: the plain table)
  assert.deepEqual(of(undefined), { preset: "default" });
  assert.equal(of("countdown").oc, 1);
  assert.equal(of("strip").oc, 1);
  assert.equal(outletCountdown({ outlet: { preset: "badge" } }), false);
});

// --- The size behind the storage decision (docs/won-discounts/navrh-preklady-a-vzhled.md) ------------------

test("five custom looks at their densest fit the storefront config with room to spare", () => {
  const dense = ".a{b:c}".repeat(Math.floor(4000 / 7));
  const config = configOf({ storefront: { looks: Object.fromEntries(LOOK_ELEMENTS.map((e) => [e, { preset: LOOK_PRESETS[e][LOOK_PRESETS[e].length - 1], custom: { vars: {}, css: dense } }])) } });
  const bytes = new TextEncoder().encode(css(config, "pro")).length;
  // 124 000 B is what the storefront config may hold: the looks take about half of it at the very most.
  assert.ok(bytes > 65_000 && bytes < 75_000, `${bytes} B`);
});
