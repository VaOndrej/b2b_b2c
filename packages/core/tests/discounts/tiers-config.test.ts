// MVP 3 (contracts K1, K7): the tier-set sanitizer and the appearance preset.
// A break has exactly one value (percent OR an amount per currency), breaks
// are ascending and unique by minQty, set ids are unique; an appearance preset
// is one of APPEARANCE_PRESETS. Every change is reported with structured params
// (the admin words the issue from code + params only).

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
    set([{ minQty: 2 }, { minQty: 3, amountOff: {} }, { minQty: 4, percent: "10" }, { minQty: 5, amountOff: { CZK: 20_00 } }]),
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

test("a break without a usable minimum quantity is dropped with an issue; a fractional or < 1 one is floored to ≥ 1", () => {
  const { config, issues } = tiersOf([set([{ percent: 5 }, { minQty: "3", percent: 5 }, { minQty: 2.9, percent: 5 }, { minQty: -4, percent: 1 }])]);
  assert.deepEqual(config.modules.tiers.sets[0].breaks, [
    { minQty: 1, percent: 1 },
    { minQty: 2, percent: 5 },
  ]);
  assert.deepEqual(
    issues.map((i) => [i.path, i.code, i.params ?? null]),
    [
      ["modules.tiers.sets[0].breaks[0]", "tier_break_without_quantity", null],
      ["modules.tiers.sets[0].breaks[1]", "tier_break_without_quantity", null],
    ],
  );
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
      { minQty: 10, amountOff: { CZK: 100_00 } },
      { minQty: 3, amountOff: { EUR: 1_00 } },
    ]),
  ]);
  assert.deepEqual(config.modules.tiers.sets[0].breaks, [
    { minQty: 3, percent: 10 },
    { minQty: 5, percent: 15 },
    { minQty: 10, amountOff: { CZK: 100_00 } },
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
    set([{ minQty: 5, percent: 15, amountOff: { CZK: 1 } }, { minQty: 3, percent: 10 }, { minQty: 3, percent: 1 }, { minQty: 7 }]),
    { id: "s", scope: { collectionIds: ["gid://shopify/Collection/1"] }, countAcross: "cart", breaks: [{ minQty: 2, amountOff: { czk: 10_00, EUR: 40 } }] },
  ]).config;
  const again = sanitizeConfig(first);
  assert.deepEqual(again.issues, []);
  assert.deepEqual(again.config, first);
});

// --- appearance preset (K7) --------------------------------------------------------------------

test("K7: the appearance preset is one of APPEARANCE_PRESETS; an unknown one becomes default with an issue", () => {
  assert.deepEqual([...APPEARANCE_PRESETS], ["default", "highlight", "chips", "tiles"]);
  for (const preset of APPEARANCE_PRESETS) {
    const { config, issues } = sanitizeConfig({ storefront: { appearancePreset: preset } });
    assert.equal(config.storefront.appearancePreset, preset);
    assert.deepEqual(issues, []);
  }
  const { config, issues } = sanitizeConfig({ storefront: { appearancePreset: "neon", cardPricesEnabled: true } });
  assert.equal(config.storefront.appearancePreset, "default");
  assert.equal(config.storefront.cardPricesEnabled, true);
  assert.deepEqual(issues, [
    {
      path: "storefront.appearancePreset",
      code: "unknown_appearance_preset",
      message: 'Appearance "neon" is not one of default, highlight, chips, tiles; "default" was used.',
      params: { value: '"neon"', fallback: "default" },
    },
  ]);
  const junk = sanitizeConfig({ storefront: { appearancePreset: 7 } });
  assert.equal(junk.config.storefront.appearancePreset, "default");
  assert.equal(junk.issues[0]?.code, "unknown_appearance_preset");
  // Left out: the default, silently.
  assert.deepEqual(sanitizeConfig({ storefront: {} }).issues, []);
  assert.equal(sanitizeConfig({}).config.storefront.appearancePreset, "default");
});
