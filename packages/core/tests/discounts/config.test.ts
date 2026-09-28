import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_CONFIG,
  migrateConfig,
  readStoredConfig,
  sanitizeConfig,
  SCHEMA_VERSION,
  type DiscountRuleValue,
} from "../../src/discounts/config.ts";

test("sanitizeConfig(null) returns the default config", () => {
  const { config, issues } = sanitizeConfig(null);
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.deepEqual(issues, []);
});

test("sanitizeConfig drops unknown top-level keys", () => {
  const { config } = sanitizeConfig({
    schemaVersion: 1,
    thisKeyDoesNotExist: "surprise",
    markets: [],
  });
  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.ok(!("thisKeyDoesNotExist" in config));
});

test("engine.combination.outletWithAnything falls back to false on bad input, with an issue", () => {
  const { config, issues } = sanitizeConfig({
    engine: { combination: { outletWithAnything: "yes" } },
  });
  assert.equal(config.engine.combination.outletWithAnything, false);
  assert.ok(
    issues.some((i) => i.path === "engine.combination.outletWithAnything"),
    "expected an issue for the invalid boolean",
  );
});

test("margin.global.maxDiscountPercent clamps 150 to 100, with an issue", () => {
  const { config, issues } = sanitizeConfig({
    modules: { margin: { global: { maxDiscountPercent: 150 } } },
  });
  assert.equal(config.modules.margin.global.maxDiscountPercent, 100);
  assert.ok(
    issues.some((i) => i.path === "modules.margin.global.maxDiscountPercent"),
    "expected an issue for the out-of-range percent",
  );
});

// audit P3-10: percent fields must not coerce a string/boolean/null via Number() —
// same policy as sanitizeMoneyByCurrency (only a finite `number` is accepted).
test("margin.global.maxDiscountPercent rejects a numeric string instead of coercing it", () => {
  const { config, issues } = sanitizeConfig({
    modules: { margin: { global: { maxDiscountPercent: "50" } } },
  });
  assert.equal(config.modules.margin.global.maxDiscountPercent, DEFAULT_CONFIG.modules.margin.global.maxDiscountPercent);
  assert.ok(issues.some((i) => i.path === "modules.margin.global.maxDiscountPercent" && i.code === "invalid_percent"));
});

test("a rule's percentage value rejects true/null instead of coercing them", () => {
  const base = { id: "r1", enabled: true, name: "R", method: "automatic", target: { kind: "order" } };
  for (const bad of [true, null, "10", [10], {}]) {
    const { config, issues } = sanitizeConfig({
      modules: { codes: { rules: [{ ...base, value: { kind: "percentage", percent: bad } }] } },
    });
    assert.deepEqual(config.modules.codes.rules[0].value, ({ kind: "percentage", percent: 0 } satisfies DiscountRuleValue));
    assert.ok(
      issues.some((i) => i.path === "modules.codes.rules[0].value.percent" && i.code === "invalid_percent"),
      `expected invalid_percent for ${JSON.stringify(bad)}`,
    );
  }
});

test("readStoredConfig never throws and always returns a valid config", () => {
  assert.deepEqual(readStoredConfig({}), DEFAULT_CONFIG);
  assert.deepEqual(readStoredConfig("garbage"), DEFAULT_CONFIG);
  assert.deepEqual(readStoredConfig(undefined), DEFAULT_CONFIG);
  assert.deepEqual(readStoredConfig(42), DEFAULT_CONFIG);
  assert.deepEqual(readStoredConfig([1, 2, 3]), DEFAULT_CONFIG);
});

test("a v0 fixture without schemaVersion survives migration", () => {
  // Pre-v1 shape: no schemaVersion field at all, and a legacy-looking partial shape.
  const v0Fixture = {
    markets: [{ handle: "cz", currency: "czk", enabled: true }],
    modules: {
      codes: { rules: [{ id: "r1", name: "Welcome", method: "automatic" }] },
    },
  };
  const migrated = migrateConfig(v0Fixture);
  assert.equal((migrated as { schemaVersion?: number }).schemaVersion, SCHEMA_VERSION);

  const config = readStoredConfig(v0Fixture);
  assert.equal(config.schemaVersion, SCHEMA_VERSION);
  assert.equal(config.markets.length, 1);
  assert.equal(config.markets[0].currency, "CZK");
  assert.equal(config.modules.codes.rules.length, 1);
});

// --- Property test: sanitizeConfig must be idempotent -----------------------------
// Seeded PRNG (mulberry32) so failures are reproducible without a fuzzing dependency.
function mulberry32(seed: number) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomPrimitive(rng: () => number): unknown {
  const choice = Math.floor(rng() * 8);
  switch (choice) {
    case 0:
      return rng() * 400 - 100; // includes negatives, out-of-range percents
    case 1:
      return NaN;
    case 2:
      return rng() < 0.5;
    case 3:
      return ["yes", "", "CZK", "eur", "products", "best", "auto", "garbage", "a b", "r1", "2026-11-27T00:00:00Z", "tiers"][
        Math.floor(rng() * 12)
      ];
    case 4:
      return null;
    case 5:
      return undefined;
    case 6:
      return [];
    case 7:
    default:
      return {};
  }
}

function randomValue(rng: () => number, depth: number): unknown {
  if (depth <= 0) return randomPrimitive(rng);
  const shape = Math.floor(rng() * 4);
  if (shape === 0) return randomPrimitive(rng);
  if (shape === 1) {
    const len = Math.floor(rng() * 3);
    return Array.from({ length: len }, () => randomValue(rng, depth - 1));
  }
  // object: mix of real config-ish keys and noise keys
  const keys = [
    "schemaVersion",
    "markets",
    "engine",
    "combination",
    "outletWithAnything",
    "productWithProduct",
    "modules",
    "codes",
    "rules",
    "tiers",
    "sets",
    "rewards",
    "gifts",
    "countOtherDiscounts",
    "outlet",
    "display",
    "reopenOnReturnAfterEnd",
    "margin",
    "global",
    "maxDiscountPercent",
    "minMarginPercent",
    "perCollection",
    "campaigns",
    "storefront",
    "locales",
    "onboarding",
    "id",
    "name",
    "method",
    "value",
    "kind",
    "percent",
    "amount",
    "target",
    "currency",
    "handle",
    "enabled",
    // fix round 2: references, schedules, ids and goals
    "schedule",
    "startsAt",
    "endsAt",
    "combinesWith",
    "ruleIds",
    "origin",
    "nativeId",
    "targeting",
    "segments",
    "goals",
    "overrides",
    "patch",
    "ruleId",
    "window",
    "killed",
    "noiseKey",
  ];
  const out: Record<string, unknown> = {};
  const n = Math.floor(rng() * 5);
  for (let i = 0; i < n; i++) {
    const key = keys[Math.floor(rng() * keys.length)];
    out[key] = randomValue(rng, depth - 1);
  }
  return out;
}

test("sanitizeConfig is idempotent over 20 random seeded inputs", () => {
  const rng = mulberry32(1234567);
  for (let seed = 0; seed < 20; seed++) {
    const input = randomValue(rng, 4);
    const once = sanitizeConfig(input).config;
    const twice = sanitizeConfig(once).config;
    assert.deepEqual(
      twice,
      once,
      `seed ${seed}: sanitizeConfig(sanitizeConfig(x).config) must equal sanitizeConfig(x).config\ninput: ${JSON.stringify(input)}`,
    );
  }
});
