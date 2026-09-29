// Debt paid in MVP 1: value/target kinds are validated against the exported
// `as const` arrays (one list, no drift), value/target compatibility, rule
// priority, and the split of config.ts keeps its public surface stable.

import assert from "node:assert/strict";
import { test } from "node:test";

import * as publicConfig from "../../src/discounts/config.ts";
import {
  DISCOUNT_TARGET_KINDS,
  DISCOUNT_VALUE_KINDS,
  sanitizeConfig,
} from "../../src/discounts/config.ts";

function sanitizeRule(rule: Record<string, unknown>) {
  const { config, issues } = sanitizeConfig({ modules: { codes: { rules: [{ id: "r", ...rule }] } } });
  return { rule: config.modules.codes.rules[0], issues };
}

const VALUE_SAMPLES: Record<(typeof DISCOUNT_VALUE_KINDS)[number], Record<string, unknown>> = {
  percentage: { kind: "percentage", percent: 10 },
  fixed: { kind: "fixed", amount: { CZK: 100 } },
  freeShipping: { kind: "freeShipping" },
};

test("every value kind in DISCOUNT_VALUE_KINDS is accepted as-is", () => {
  for (const kind of DISCOUNT_VALUE_KINDS) {
    const target = kind === "freeShipping" ? { kind: "shipping" } : { kind: "order" };
    const { rule, issues } = sanitizeRule({ value: VALUE_SAMPLES[kind], target });
    assert.equal(rule.value.kind, kind);
    assert.deepEqual(issues, [], kind);
  }
});

test("every target kind in DISCOUNT_TARGET_KINDS is accepted as-is", () => {
  for (const kind of DISCOUNT_TARGET_KINDS) {
    const { rule, issues } = sanitizeRule({ value: VALUE_SAMPLES.percentage, target: { kind } });
    assert.equal(rule.target.kind, kind);
    assert.deepEqual(issues, [], kind);
  }
});

test("an unknown kind is refused and the issue lists the allowed kinds from the array", () => {
  const value = sanitizeRule({ value: { kind: "bogo" }, target: { kind: "order" } });
  assert.deepEqual(value.rule.value, { kind: "percentage", percent: 0 });
  const valueIssue = value.issues.find((i) => i.code === "invalid_value");
  assert.ok(valueIssue);
  for (const kind of DISCOUNT_VALUE_KINDS) assert.ok(valueIssue.message.includes(kind), valueIssue.message);

  const target = sanitizeRule({ value: VALUE_SAMPLES.percentage, target: { kind: "customer" } });
  assert.deepEqual(target.rule.target, { kind: "order" });
  const targetIssue = target.issues.find((i) => i.code === "invalid_target");
  assert.ok(targetIssue);
  for (const kind of DISCOUNT_TARGET_KINDS) assert.ok(targetIssue.message.includes(kind), targetIssue.message);
});

test("free shipping always targets shipping; another target is corrected with an issue", () => {
  const { rule, issues } = sanitizeRule({ value: { kind: "freeShipping" }, target: { kind: "order" } });
  assert.deepEqual(rule.target, { kind: "shipping" });
  assert.equal(issues[0]?.code, "value_target_mismatch");
});

test("priority: optional integer 0-1000, clamped with an issue, never coerced from strings", () => {
  assert.equal(sanitizeRule({ value: VALUE_SAMPLES.percentage, target: { kind: "order" } }).rule.priority, undefined);
  assert.equal(sanitizeRule({ value: VALUE_SAMPLES.percentage, target: { kind: "order" }, priority: 7.9 }).rule.priority, 7);
  const high = sanitizeRule({ value: VALUE_SAMPLES.percentage, target: { kind: "order" }, priority: 5000 });
  assert.equal(high.rule.priority, 1000);
  assert.equal(high.issues[0]?.code, "clamped_priority");
  const text = sanitizeRule({ value: VALUE_SAMPLES.percentage, target: { kind: "order" }, priority: "5" });
  assert.equal(text.rule.priority, undefined);
  assert.equal(text.issues[0]?.code, "invalid_priority");
});

test("the split keeps the public surface of @won/core/discounts/config", () => {
  const values = Object.keys(publicConfig).sort();
  assert.deepEqual(values, [
    "COMBINATION_CATEGORIES",
    "CONFIG_LIMITS",
    "DEFAULT_CONFIG",
    "DISCOUNT_METHODS",
    "DISCOUNT_TARGET_KINDS",
    "DISCOUNT_VALUE_KINDS",
    "LOCALE_CODES",
    "MINIMUM_SCOPES",
    "ONBOARDING_GOALS",
    "OUTLET_DISPLAY_MODES",
    "PRODUCT_WITH_PRODUCT_MODES",
    "REOPEN_ON_RETURN_MODES",
    "SCHEMA_VERSION",
    "TIER_COUNT_ACROSS_MODES",
    "createDefaultConfig",
    "isIsoDateTime",
    "isNewerSchema",
    "isShopLocalDateTime",
    "isValidEntityId",
    "migrateConfig",
    "readStoredConfig",
    "sanitizeConfig",
  ]);
});

test("a market may list its countries: ISO 3166-1 alpha-2, upper-cased, unique; junk dropped with an issue", () => {
  const { config, issues } = sanitizeConfig({
    markets: [
      { handle: "eu", currency: "EUR", countries: ["sk", "AT", "SK", "xx1", 5] },
      { handle: "cz", currency: "CZK" },
    ],
  });
  assert.deepEqual(config.markets[0].countries, ["SK", "AT"]);
  assert.ok(!("countries" in config.markets[1]), "no countries given → field omitted (unchanged shape)");
  assert.equal(issues.find((i) => i.path === "markets[0].countries")?.code, "invalid_country");
});
