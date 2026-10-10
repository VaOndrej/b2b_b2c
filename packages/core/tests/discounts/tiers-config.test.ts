// MVP 3 (contracts K1, K7): the tier-set sanitizer and the appearance preset.
// A break has exactly one value (percent OR an amount per currency), breaks
// are ascending and unique by minQty (whole items 1–CONFIG_LIMITS.tierMinQty),
// a set is of ONE kind (all percent or all amount: the lowest break's kind) and
// its values never fall as the quantity grows (per currency for amounts); set
// ids are unique; an appearance preset is one of APPEARANCE_PRESETS. Every
// change is reported with structured params (the admin words the issue from
// code + params only).

import assert from "node:assert/strict";
import { test } from "node:test";

import { APPEARANCE_PRESETS, CONFIG_LIMITS, sanitizeConfig } from "../../src/discounts/config.ts";

const tiersOf = (sets: unknown[]) => sanitizeConfig({ modules: { tiers: { sets } } });
const set = (breaks: unknown[], extra: Record<string, unknown> = {}) => ({ id: "t", scope: "global", countAcross: "line", breaks, ...extra });

test("a break with both a percent and an amount keeps the percent, with an issue naming its quantity", () => {
  const { config, issues } = tiersOf([set([{ minQty: 3, percent: 10, amountOff: { CZK: 50_00 } }])]);
  assert.deepEqual(config.modules.tiers.sets[0].breaks, [{ minQty: 3, percent: 10 }]);
  assert.deepEqual(issues, [
    {
      path: "modules.tiers.sets[0].breaks[0]",
      code: "tier_break_two_values",
      message: "The break from 3 items had both a percent and an amount; the percent was kept.",
      params: { minQty: 3 },
    },
  ]);
});

test("an empty amount next to a percent is no second value (a form sends both fields)", () => {
  const { config, issues } = tiersOf([set([{ minQty: 3, percent: 10, amountOff: {} }])]);
  assert.deepEqual(config.modules.tiers.sets[0].breaks, [{ minQty: 3, percent: 10 }]);
  assert.deepEqual(issues, []);
});

test("a break without a value (no percent, no amount in any currency) is dropped with an issue", () => {
  const { config, issues } = tiersOf([
    set([{ minQty: 2 }, { minQty: 3, amountOff: {} }, { minQty: 4, percent: null }, { minQty: 5, amountOff: { CZK: 20_00 } }]),
  ]);
  assert.deepEqual(config.modules.tiers.sets[0].breaks, [{ minQty: 5, amountOff: { CZK: 20_00 } }]);
  assert.deepEqual(
    issues.map((i) => [i.path, i.code, i.params]),
    [
      ["modules.tiers.sets[0].breaks[0]", "tier_break_without_value", { minQty: 2 }],
      ["modules.tiers.sets[0].breaks[1]", "tier_break_without_value", { minQty: 3 }],
      ["modules.tiers.sets[0].breaks[2]", "tier_break_without_value", { minQty: 4 }],
    ],
  );
});

test("a percent that is not a number takes the invalid_percent path: the default 0 % is saved (like a rule's value)", () => {
  const { config, issues } = tiersOf([set([{ minQty: 4, percent: "10" }])]);
  assert.deepEqual(config.modules.tiers.sets[0].breaks, [{ minQty: 4, percent: 0 }]);
  assert.deepEqual(issues.map((i) => [i.path, i.code, i.params]), [
    ["modules.tiers.sets[0].breaks[0].percent", "invalid_percent", { min: 0, max: 100, value: '"10"', fallback: 0 }],
  ]);
});

test("fix round 2: a junk percent next to a usable amount is no second value — the amount stays, invalid_percent says so", () => {
  const { config, issues } = tiersOf([set([{ minQty: 3, percent: "", amountOff: { CZK: 50_00 } }])]);
  assert.deepEqual(config.modules.tiers.sets[0].breaks, [{ minQty: 3, amountOff: { CZK: 50_00 } }]);
  assert.deepEqual(issues.map((i) => [i.path, i.code, i.params]), [
    ["modules.tiers.sets[0].breaks[0].percent", "invalid_percent", { min: 0, max: 100, value: '""', fallback: "amount", minQty: 3 }],
  ]);
});

test("a break without a usable minimum quantity is dropped with an issue; a fractional, < 1 or too large one is adjusted with an issue", () => {
  const max = CONFIG_LIMITS.tierMinQty;
  assert.equal(max, 10_000);
  const { config, issues } = tiersOf([
    set([{ percent: 5 }, { minQty: "3", percent: 5 }, { minQty: 2.9, percent: 5 }, { minQty: -4, percent: 1 }, { minQty: 25_000, percent: 9 }]),
  ]);
  assert.deepEqual(config.modules.tiers.sets[0].breaks, [
    { minQty: 1, percent: 1 },
    { minQty: 2, percent: 5 },
    { minQty: max, percent: 9 },
  ]);
  assert.deepEqual(
    issues.map((i) => [i.path, i.code, i.params ?? null]),
    [
      ["modules.tiers.sets[0].breaks[0]", "tier_break_without_quantity", null],
      ["modules.tiers.sets[0].breaks[1]", "tier_break_without_quantity", null],
      ["modules.tiers.sets[0].breaks[2].minQty", "clamped_tier_quantity", { value: 2.9, to: 2, min: 1, max }],
      ["modules.tiers.sets[0].breaks[3].minQty", "clamped_tier_quantity", { value: -4, to: 1, min: 1, max }],
      ["modules.tiers.sets[0].breaks[4].minQty", "clamped_tier_quantity", { value: 25_000, to: max, min: 1, max }],
    ],
  );
});

test("a set is of one kind: the lowest break's kind wins, a break of the other kind is dropped with an issue", () => {
  const { config, issues } = tiersOf([
    set([{ minQty: 5, amountOff: { CZK: 50_00 } }, { minQty: 2, percent: 5 }, { minQty: 7, percent: 12 }, { minQty: 3, amountOff: { CZK: 10_00 } }]),
  ]);
  assert.deepEqual(config.modules.tiers.sets[0].breaks, [
    { minQty: 2, percent: 5 },
    { minQty: 7, percent: 12 },
  ]);
  assert.deepEqual(issues.map((i) => [i.path, i.code, i.params]), [
    ["modules.tiers.sets[0].breaks[3]", "tier_break_other_kind", { minQty: 3 }],
    ["modules.tiers.sets[0].breaks[0]", "tier_break_other_kind", { minQty: 5 }],
  ]);
});

test("values never fall as the quantity grows: a percent, and an amount per currency, lower than an earlier break's is dropped", () => {
  const percent = tiersOf([set([{ minQty: 2, percent: 10 }, { minQty: 3, percent: 5 }, { minQty: 5, percent: 10 }, { minQty: 8, percent: 15 }])]);
  assert.deepEqual(percent.config.modules.tiers.sets[0].breaks.map((b) => [b.minQty, b.percent]), [
    [2, 10],
    [5, 10],
    [8, 15],
  ]);
  assert.deepEqual(percent.issues.map((i) => [i.path, i.code, i.params]), [["modules.tiers.sets[0].breaks[1]", "tier_break_lower_value", { minQty: 3 }]]);
  const amount = tiersOf([
    set([
      { minQty: 2, amountOff: { CZK: 50_00, EUR: 2_00 } },
      { minQty: 3, amountOff: { CZK: 40_00 } }, // CZK falls
      { minQty: 5, amountOff: { EUR: 3_00 } }, // EUR rises (no CZK: not compared in CZK)
      { minQty: 7, amountOff: { CZK: 60_00, EUR: 1_00 } }, // EUR falls below the 5-item break
      { minQty: 9, amountOff: { CZK: 60_00, EUR: 3_00 } },
    ]),
  ]);
  assert.deepEqual(amount.config.modules.tiers.sets[0].breaks.map((b) => b.minQty), [2, 5, 9]);
  assert.deepEqual(amount.issues.map((i) => [i.path, i.code, i.params]), [
    ["modules.tiers.sets[0].breaks[1]", "tier_break_lower_value", { minQty: 3 }],
    ["modules.tiers.sets[0].breaks[3]", "tier_break_lower_value", { minQty: 7 }],
  ]);
});

test("a percent outside 0–100 is clamped with the existing clamped_percent issue", () => {
  const { config, issues } = tiersOf([set([{ minQty: 2, percent: 140 }])]);
  assert.deepEqual(config.modules.tiers.sets[0].breaks, [{ minQty: 2, percent: 100 }]);
  assert.deepEqual(issues.map((i) => [i.path, i.code, i.params]), [
    ["modules.tiers.sets[0].breaks[0].percent", "clamped_percent", { value: 140, min: 0, max: 100, to: 100 }],
  ]);
});

test("breaks come out ascending by minQty; a repeated minQty keeps the first and reports the rest", () => {
  const { config, issues } = tiersOf([
    set([
      { minQty: 5, percent: 15 },
      { minQty: 3, percent: 10 },
      { minQty: 5, percent: 20 },
      { minQty: 10, percent: 25 },
      { minQty: 3, percent: 12 },
    ]),
  ]);
  assert.deepEqual(config.modules.tiers.sets[0].breaks, [
    { minQty: 3, percent: 10 },
    { minQty: 5, percent: 15 },
    { minQty: 10, percent: 25 },
  ]);
  assert.deepEqual(
    issues.map((i) => [i.path, i.code, i.params]),
    [
      ["modules.tiers.sets[0].breaks[2]", "duplicate_tier_break", { minQty: 5 }],
      ["modules.tiers.sets[0].breaks[4]", "duplicate_tier_break", { minQty: 3 }],
    ],
  );
});

test("the break cap still keeps the first breaks given (then sorted)", () => {
  const breaks = Array.from({ length: CONFIG_LIMITS.breaksPerTierSet + 2 }, (_, i) => ({ minQty: 100 - i, percent: 1 }));
  // (equal values never fall)
  const { config, issues } = tiersOf([set(breaks)]);
  const kept = config.modules.tiers.sets[0].breaks.map((b) => b.minQty);
  assert.equal(kept.length, CONFIG_LIMITS.breaksPerTierSet);
  assert.deepEqual(kept, [...kept].sort((a, b) => a - b));
  assert.deepEqual(kept, Array.from({ length: CONFIG_LIMITS.breaksPerTierSet }, (_, i) => 91 + i));
  assert.equal(issues.find((i) => i.code === "too_many_tier_breaks")?.params?.count, 2);
});

test("a repeated tier set id keeps the first set and reports the duplicate", () => {
  const { config, issues } = tiersOf([set([{ minQty: 2, percent: 5 }]), set([{ minQty: 3, percent: 9 }], { scope: { productIds: ["gid://shopify/Product/1"] } })]);
  assert.equal(config.modules.tiers.sets.length, 1);
  assert.deepEqual(config.modules.tiers.sets[0].breaks, [{ minQty: 2, percent: 5 }]);
  assert.deepEqual(issues.map((i) => [i.path, i.code, i.params]), [["modules.tiers.sets[1]", "duplicate_tier_set_id", { id: "t" }]]);
});

test("the tier sanitizer is idempotent: a sanitized config sanitizes to itself without issues", () => {
  const first = tiersOf([
    set([{ minQty: 5, percent: 15, amountOff: { CZK: 1 } }, { minQty: 3, percent: 10 }, { minQty: 3, percent: 1 }, { minQty: 7 }, { minQty: 8, percent: 2 }, { minQty: 9, amountOff: { CZK: 1 } }]),
    { id: "s", scope: { collectionIds: ["gid://shopify/Collection/1"] }, countAcross: "cart", breaks: [{ minQty: 2, amountOff: { czk: 10_00, EUR: 40 } }] },
  ]).config;
  const again = sanitizeConfig(first);
  assert.deepEqual(again.issues, []);
  assert.deepEqual(again.config, first);
});

// --- appearance preset (K7) --------------------------------------------------------------------

test("K7: the table's look is one of APPEARANCE_PRESETS, stored with every element's look; an unknown one becomes the table with an issue; only a config without storefront settings gets the new-shop look", async () => {
  const { lookPreset } = await import("../../src/discounts/looks.ts");
  const presetOf = (input: unknown) => {
    const { config, issues } = sanitizeConfig(input);
    return { preset: lookPreset("tiers", config.storefront.looks.tiers), issues, config };
  };
  assert.deepEqual([...APPEARANCE_PRESETS], ["default", "highlight", "chips", "tiles"]);
  for (const preset of APPEARANCE_PRESETS) {
    // As stored today, and as stored before the table's look moved under `looks` (read, never written back).
    for (const input of [{ storefront: { looks: { tiers: { preset } } } }, { storefront: { appearancePreset: preset } }, { storefront: { appearancePreset: preset, looks: {} } }]) {
      const read = presetOf(input);
      assert.equal(read.preset, preset);
      assert.deepEqual(read.issues, []);
      assert.equal("appearancePreset" in read.config.storefront, false);
    }
  }
  const { preset, issues, config } = presetOf({ storefront: { looks: { tiers: { preset: "neon" } }, cardPricesEnabled: true } });
  assert.equal(preset, "default");
  assert.equal(config.storefront.cardPricesEnabled, true);
  assert.deepEqual(issues, [
    {
      path: "storefront.looks.tiers.preset",
      code: "unknown_look",
      message: 'Look "neon" is not one of default, highlight, chips, tiles; "default" was used.',
      params: { value: '"neon"', fallback: "default" },
    },
  ]);
  // The same for the old field: the table, with an issue.
  const junk = presetOf({ storefront: { appearancePreset: 7 } });
  assert.equal(junk.preset, "default");
  assert.equal(junk.issues[0]?.code, "unknown_look");
  // A stored config that has storefront settings but no look keeps the table; a config with none is a new shop (highlight), silently.
  assert.equal(presetOf({ storefront: { cardPricesEnabled: true } }).preset, "default");
  assert.deepEqual(sanitizeConfig({ storefront: {} }).issues, []);
  assert.equal(presetOf({}).preset, "highlight");
});

test("the highlight colour is one of ACCENT_PRESETS on every plan; 'theme' is stored as absent; it ships as one CSS variable before the custom look", async () => {
  const { accentCss: accentUnder, ACCENT_COLORS, LOOK_ROOT, MILESTONE_ELEMENTS } = await import("../../src/discounts/custom-look.ts");
  const accentCss = (accent: string | undefined) => accentUnder(accent, LOOK_ROOT.tiers);
  const { gateConfigForPlan } = await import("../../src/discounts/plan-gate.ts");
  const { buildStorefrontConfig } = await import("../../src/discounts/storefront-config.ts");
  const green = sanitizeConfig({ storefront: { looks: { tiers: { preset: "chips", accent: "green" } } } });
  assert.equal(green.config.storefront.looks.tiers?.accent, "green");
  assert.deepEqual(green.issues, []);
  assert.equal(sanitizeConfig({ storefront: { looks: { tiers: { accent: "theme" } } } }).config.storefront.looks.tiers, undefined);
  const junk = sanitizeConfig({ storefront: { looks: { tiers: { accent: "#ff0000" } } } });
  assert.equal(junk.config.storefront.looks.tiers, undefined);
  assert.deepEqual(junk.issues.map((i) => i.code), ["unknown_accent"]);

  assert.equal(accentCss("theme"), "");
  assert.equal(accentCss(undefined), "");
  assert.match(accentCss("green"), new RegExp(`\\{--won-tiers-accent:${ACCENT_COLORS.green}\\}$`));

  // Free keeps the colour (the gate removes only the Pro custom look); Pro's own accent comes later in the CSS, so it wins.
  const both = sanitizeConfig({ storefront: { accent: "blue", custom: { vars: { accent: "#ff0000" }, css: "" } } }).config;
  const opts = { configVersion: "v", shopCurrency: "CZK" };
  const free = buildStorefrontConfig(gateConfigForPlan(both, "free").config, opts);
  // (a config from before the split: the colour is copied to the ladder once, so the storefront looks as it did)
  assert.equal(free.appearance.css, accentCss("blue") + MILESTONE_ELEMENTS.map((e) => accentUnder("blue", LOOK_ROOT[e])).join(""));
  const pro = buildStorefrontConfig(gateConfigForPlan(both, "pro").config, opts);
  assert.ok(pro.appearance.css!.startsWith(`${accentCss("blue")}.won-tiers{--won-tiers-accent:#ff0000}`) && pro.appearance.css!.endsWith(`${LOOK_ROOT.msDrawer}{--won-tiers-accent:#ff0000}`));
  assert.equal(buildStorefrontConfig(gateConfigForPlan(sanitizeConfig({}).config, "free").config, opts).appearance.css, undefined, "no colour: nothing is added");
});
