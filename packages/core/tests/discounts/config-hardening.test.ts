import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONFIG_LIMITS,
  createDefaultConfig,
  DEFAULT_CONFIG,
  isNewerSchema,
  isShopLocalDateTime,
  readStoredConfig,
  sanitizeConfig,
  SCHEMA_VERSION,
  type ConfigIssue,
} from "../../src/discounts/config.ts";

// Audit MVP 0 fixes (P1-1, P2-1, P2-2, P2-3, P3-10): the sanitizer never hands out
// the shared default, bounds every list that reaches storage, normalises codes,
// sanitises campaign overrides/windows and flags configs written by a newer schema.

function rule(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    enabled: true,
    name: `Rule ${id}`,
    method: "automatic",
    value: { kind: "percentage", percent: 10 },
    target: { kind: "order" },
    ...extra,
  };
}

function hasIssue(issues: ConfigIssue[], code: string, pathPrefix?: string): boolean {
  return issues.some((i) => i.code === code && (pathPrefix === undefined || i.path.startsWith(pathPrefix)));
}

// --- P1-1: DEFAULT_CONFIG is shared and must be immutable ------------------------------

test("DEFAULT_CONFIG is deep-frozen, so no caller can mutate the shared default", () => {
  assert.ok(Object.isFrozen(DEFAULT_CONFIG));
  assert.ok(Object.isFrozen(DEFAULT_CONFIG.engine.combination));
  assert.ok(Object.isFrozen(DEFAULT_CONFIG.modules.codes.rules));
  assert.ok(Object.isFrozen(DEFAULT_CONFIG.modules.margin.global));
  assert.ok(Object.isFrozen(DEFAULT_CONFIG.locales.cs));
  assert.throws(() => {
    (DEFAULT_CONFIG.modules.codes.rules as unknown as unknown[]).push(rule("leak"));
  }, TypeError);
  assert.throws(() => {
    (DEFAULT_CONFIG.engine.combination as { outletWithAnything: boolean }).outletWithAnything = true;
  }, TypeError);
  assert.equal(DEFAULT_CONFIG.modules.codes.rules.length, 0);
});

test("readStoredConfig/sanitizeConfig/createDefaultConfig hand out fresh mutable copies", () => {
  const a = readStoredConfig({});
  const b = sanitizeConfig(undefined).config;
  const c = createDefaultConfig();
  for (const copy of [a, b, c]) {
    assert.notStrictEqual(copy, DEFAULT_CONFIG);
    assert.notStrictEqual(copy.modules.codes.rules, DEFAULT_CONFIG.modules.codes.rules);
    assert.notStrictEqual(copy.locales.cs, DEFAULT_CONFIG.locales.cs);
    assert.equal(Object.isFrozen(copy), false);
    assert.deepEqual(copy, DEFAULT_CONFIG);
  }

  // Mutating one handed-out copy (shop A) never changes what the next caller (shop B) gets.
  a.modules.codes.rules.push(readStoredConfig({ modules: { codes: { rules: [rule("a")] } } }).modules.codes.rules[0]);
  a.engine.combination.outletWithAnything = true;
  c.locales.cs.leaked = "shop A text";
  assert.deepEqual(readStoredConfig({}), DEFAULT_CONFIG);
  assert.deepEqual(createDefaultConfig(), DEFAULT_CONFIG);
});

// --- P2-1: hard caps -------------------------------------------------------------------------

test("rules are capped at CONFIG_LIMITS.rules with a human-readable issue", () => {
  const { config, issues } = sanitizeConfig({
    modules: { codes: { rules: Array.from({ length: CONFIG_LIMITS.rules + 5 }, (_, i) => rule(`r${i}`)) } },
  });
  assert.equal(CONFIG_LIMITS.rules, 200);
  assert.equal(config.modules.codes.rules.length, 200);
  assert.equal(config.modules.codes.rules[199].id, "r199");
  const issue = issues.find((i) => i.code === "too_many_rules");
  assert.ok(issue, "expected a too_many_rules issue");
  assert.match(issue.message, /200/);
  assert.match(issue.message, /5/);
});

test("duplicate rule ids: the first rule wins, later ones are dropped with an issue", () => {
  const { config, issues } = sanitizeConfig({
    modules: { codes: { rules: [rule("c", { name: "first" }), rule("d"), rule("c", { name: "second" })] } },
  });
  assert.deepEqual(
    config.modules.codes.rules.map((r) => [r.id, r.name]),
    [
      ["c", "first"],
      ["d", "Rule d"],
    ],
  );
  assert.ok(hasIssue(issues, "duplicate_rule_id", "modules.codes.rules[2]"));
});

test("codes are trimmed, upper-cased and de-duplicated within a rule", () => {
  const { config, issues } = sanitizeConfig({
    modules: {
      codes: { rules: [rule("r1", { method: "code", codes: [" sleva10 ", "SLEVA10", "vip", "", "   ", 42] })] },
    },
  });
  assert.deepEqual(config.modules.codes.rules[0].codes, ["SLEVA10", "VIP"]);
  assert.ok(hasIssue(issues, "duplicate_code", "modules.codes.rules[0].codes"));
});

test("a code already used by an earlier rule is removed from the later rule (Shopify codes are case-insensitive)", () => {
  const { config, issues } = sanitizeConfig({
    modules: {
      codes: {
        rules: [rule("r1", { method: "code", codes: ["SLEVA10"] }), rule("r2", { method: "code", codes: ["sleva10", "NEW"] })],
      },
    },
  });
  assert.deepEqual(config.modules.codes.rules[0].codes, ["SLEVA10"]);
  assert.deepEqual(config.modules.codes.rules[1].codes, ["NEW"]);
  assert.ok(hasIssue(issues, "duplicate_code", "modules.codes.rules[1].codes"));
});

test("codes longer than 255 characters are dropped, codes per rule are capped at 1000", () => {
  const long = "X".repeat(CONFIG_LIMITS.codeLength + 1);
  const many = Array.from({ length: CONFIG_LIMITS.codesPerRule + 3 }, (_, i) => `CODE${i}`);
  const { config, issues } = sanitizeConfig({
    modules: { codes: { rules: [rule("r1", { method: "code", codes: [long, "X".repeat(255), ...many] })] } },
  });
  const codes = config.modules.codes.rules[0].codes ?? [];
  assert.equal(CONFIG_LIMITS.codeLength, 255);
  assert.equal(CONFIG_LIMITS.codesPerRule, 1000);
  assert.equal(codes.length, 1000);
  assert.equal(codes[0], "X".repeat(255));
  assert.ok(!codes.includes(long));
  assert.ok(hasIssue(issues, "code_too_long", "modules.codes.rules[0].codes"));
  assert.ok(hasIssue(issues, "too_many_codes", "modules.codes.rules[0].codes"));
});

test("tier sets (50), breaks per set (10) and gift tiers (10) are capped with issues", () => {
  const { config, issues } = sanitizeConfig({
    modules: {
      tiers: {
        sets: Array.from({ length: 52 }, (_, i) => ({
          id: `t${i}`,
          scope: "global",
          countAcross: "line",
          breaks: Array.from({ length: 12 }, (_, j) => ({ minQty: j + 2, percent: j + 1 })),
        })),
      },
      rewards: {
        gifts: Array.from({ length: 11 }, (_, i) => ({ id: `g${i}`, threshold: { CZK: 100_00 * (i + 1) }, choices: ["v1"] })),
      },
    },
  });
  assert.equal(config.modules.tiers.sets.length, CONFIG_LIMITS.tierSets);
  assert.equal(config.modules.tiers.sets[0].breaks.length, CONFIG_LIMITS.breaksPerTierSet);
  assert.equal(config.modules.rewards.gifts.length, CONFIG_LIMITS.giftTiers);
  assert.ok(hasIssue(issues, "too_many_tier_sets", "modules.tiers.sets"));
  assert.ok(hasIssue(issues, "too_many_tier_breaks", "modules.tiers.sets[0].breaks"));
  assert.ok(hasIssue(issues, "too_many_gift_tiers", "modules.rewards.gifts"));
});

test("campaigns (50) and overrides per campaign (200) are capped with issues", () => {
  const day = (i: number, hour: number) => new Date(Date.UTC(2027, 0, 1 + i, hour)).toISOString().slice(0, 19);
  const campaigns = Array.from({ length: 52 }, (_, i) => ({
    id: `c${i}`,
    name: `Campaign ${i}`,
    window: { start: day(i, 0), end: day(i, 12) }, // non-overlapping half days

    overrides: i === 0 ? Array.from({ length: 205 }, () => ({ ruleId: "r1", patch: { enabled: false } })) : [],
    killed: false,
  }));
  const { config, issues } = sanitizeConfig({ modules: { codes: { rules: [rule("r1")] } }, campaigns });
  assert.equal(config.campaigns.length, CONFIG_LIMITS.campaigns);
  assert.equal(config.campaigns[0].overrides.length, CONFIG_LIMITS.overridesPerCampaign);
  assert.ok(hasIssue(issues, "too_many_campaigns", "campaigns"));
  assert.ok(hasIssue(issues, "too_many_overrides", "campaigns[0].overrides"));
});

test("locale strings are truncated to 500 characters with an issue", () => {
  const { config, issues } = sanitizeConfig({ locales: { cs: { title: "é".repeat(600), ok: "Doprava zdarma" } } });
  assert.equal(CONFIG_LIMITS.localeStringLength, 500);
  assert.equal(config.locales.cs.title.length, 500);
  assert.equal(config.locales.cs.ok, "Doprava zdarma");
  assert.ok(hasIssue(issues, "locale_text_too_long", "locales.cs.title"));
});

test("locale keys per language are capped with an issue", () => {
  const texts = Object.fromEntries(
    Array.from({ length: CONFIG_LIMITS.localeKeysPerLanguage + 3 }, (_, i) => [`key${i}`, "x"]),
  );
  const { config, issues } = sanitizeConfig({ locales: { en: texts } });
  assert.equal(Object.keys(config.locales.en).length, CONFIG_LIMITS.localeKeysPerLanguage);
  assert.ok(hasIssue(issues, "too_many_locale_keys", "locales.en"));
});

test("CONFIG_LIMITS is frozen", () => {
  assert.ok(Object.isFrozen(CONFIG_LIMITS));
});

// --- P2-2: campaigns ----------------------------------------------------------------------

const WINDOW = { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:59" };

test("isShopLocalDateTime accepts only real YYYY-MM-DDTHH:MM:SS values", () => {
  assert.equal(isShopLocalDateTime("2026-09-28T14:00:00"), true);
  assert.equal(isShopLocalDateTime("2024-02-29T00:00:00"), true);
  for (const bad of ["garbage", "2026-13-45T00:00:00", "2026-02-30T00:00:00", "2026-09-28", "2026-09-28T24:00:00", "2026-09-28T14:00:00Z", "2026-09-28 14:00:00", 1, null]) {
    assert.equal(isShopLocalDateTime(bad), false, JSON.stringify(bad));
  }
});

test("a campaign override patch goes through the rule's own field sanitizers (percent clamp)", () => {
  const { config, issues } = sanitizeConfig({
    modules: { codes: { rules: [rule("r1")] } },
    campaigns: [
      {
        id: "bf",
        name: "Black Friday",
        window: WINDOW,
        overrides: [{ ruleId: "r1", patch: { value: { kind: "percentage", percent: 1000 }, enabled: "yes" } }],
        killed: false,
      },
    ],
  });
  const patch = config.campaigns[0].overrides[0].patch;
  assert.deepEqual(patch.value, { kind: "percentage", percent: 100 });
  assert.equal(patch.enabled, true, "invalid boolean falls back to the target rule's value");
  assert.ok(hasIssue(issues, "clamped_percent", "campaigns[0].overrides[0].patch.value.percent"));
  assert.ok(hasIssue(issues, "invalid_boolean", "campaigns[0].overrides[0].patch.enabled"));
});

test("override patch fields a campaign may not change are dropped (id, codes, method, __proto__, junk)", () => {
  // JSON.parse keeps "__proto__" as an own key, exactly like a stored/posted payload would.
  const patch = JSON.parse(
    '{"id":"hijack","codes":["FREE"],"method":"code","__proto__":{"polluted":true},"junk":"x","name":"BF sleva"}',
  );
  const { config, issues } = sanitizeConfig({
    modules: { codes: { rules: [rule("r1")] } },
    campaigns: [{ id: "bf", name: "BF", window: WINDOW, overrides: [{ ruleId: "r1", patch }], killed: false }],
  });
  const out = config.campaigns[0].overrides[0].patch;
  assert.deepEqual(Object.keys(out), ["name"]);
  assert.equal(out.name, "BF sleva");
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  for (const field of ["id", "codes", "method", "__proto__", "junk"]) {
    assert.ok(
      issues.some((i) => i.code === "override_field_not_allowed" && i.message.includes(field)),
      `expected an issue for ${field}`,
    );
  }
});

test("a huge disallowed patch key is truncated in the issue, not echoed whole (audit fix4-1)", () => {
  const hugeKey = "x".repeat(3_000_000);
  const patch = { [hugeKey]: "value" };
  const { config, issues } = sanitizeConfig({
    modules: { codes: { rules: [rule("r1")] } },
    campaigns: [{ id: "bf", name: "BF", window: WINDOW, overrides: [{ ruleId: "r1", patch }], killed: false }],
  });
  assert.deepEqual(config.campaigns[0].overrides, [], "the empty patch drops the whole override");
  const totalBytes = Buffer.byteLength(JSON.stringify(issues));
  assert.ok(totalBytes < 20_000, `issues JSON was ${totalBytes} bytes, expected < 20000`);
  const issue = issues.find((i) => i.code === "override_field_not_allowed");
  assert.ok(issue, "expected an override_field_not_allowed issue");
  assert.ok(issue!.path.length < 100, `path was ${issue!.path.length} chars`);
  assert.ok(issue!.message.length < 200, `message was ${issue!.message.length} chars`);
  assert.ok(issue!.path.includes("…") || issue!.path.length <= 70, "path should be truncated");
});

test("tier-set and gift-tier overrides are sanitized with the tier/gift sanitizers", () => {
  const { config } = sanitizeConfig({
    modules: {
      tiers: { sets: [{ id: "t1", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }] },
      rewards: { gifts: [{ id: "g1", threshold: { CZK: 1000_00 }, choices: ["v1"] }] },
    },
    campaigns: [
      {
        id: "bf",
        name: "BF",
        window: WINDOW,
        overrides: [
          { ruleId: "t1", patch: { breaks: [{ minQty: 2, percent: 250 }] } },
          { ruleId: "g1", patch: { threshold: { czk: 500_00, XX: 1 } } },
        ],
        killed: false,
      },
    ],
  });
  const [tierOverride, giftOverride] = config.campaigns[0].overrides;
  assert.deepEqual(tierOverride.patch, { breaks: [{ minQty: 2, percent: 100 }] });
  assert.deepEqual(giftOverride.patch, { threshold: { CZK: 500_00 } });
});

test("overrides whose target id does not exist are dropped with an issue", () => {
  const { config, issues } = sanitizeConfig({
    modules: { codes: { rules: [rule("r1")] } },
    campaigns: [
      {
        id: "bf",
        name: "BF",
        window: WINDOW,
        overrides: [
          { ruleId: "missing", patch: { enabled: false } },
          { ruleId: "r1", patch: { enabled: false } },
        ],
        killed: false,
      },
    ],
  });
  assert.deepEqual(config.campaigns[0].overrides, [{ ruleId: "r1", patch: { enabled: false } }]);
  assert.ok(hasIssue(issues, "orphan_override", "campaigns[0].overrides[0]"));
});

test("an invalid or inverted campaign window disables the campaign with an issue", () => {
  const { config, issues } = sanitizeConfig({
    campaigns: [
      { id: "garbage", name: "G", window: { start: "garbage", end: "2026-13-45" }, overrides: [], killed: false },
      { id: "inverted", name: "I", window: { start: "2026-12-02T00:00:00", end: "2026-12-01T00:00:00" }, overrides: [], killed: false },
      { id: "ok", name: "OK", window: WINDOW, overrides: [], killed: false },
    ],
  });
  const [garbage, inverted, ok] = config.campaigns;
  assert.equal(garbage.killed, true);
  assert.deepEqual(garbage.window, { start: "", end: "" });
  assert.equal(inverted.killed, true);
  assert.equal(ok.killed, false);
  assert.ok(hasIssue(issues, "invalid_campaign_window", "campaigns[0].window"));
  assert.ok(hasIssue(issues, "invalid_campaign_window", "campaigns[1].window"));
  assert.ok(!hasIssue(issues, "invalid_campaign_window", "campaigns[2]"));
});

test("overlapping campaign windows (A8): the earlier campaign is kept, the later one is disabled", () => {
  const { config, issues } = sanitizeConfig({
    campaigns: [
      { id: "later", name: "L", window: { start: "2026-11-29T00:00:00", end: "2026-12-05T00:00:00" }, overrides: [], killed: false },
      { id: "earlier", name: "E", window: WINDOW, overrides: [], killed: false },
      { id: "after", name: "A", window: { start: "2026-12-05T00:00:00", end: "2026-12-06T00:00:00" }, overrides: [], killed: false },
    ],
  });
  const byId = Object.fromEntries(config.campaigns.map((c) => [c.id, c.killed]));
  assert.deepEqual(byId, { later: true, earlier: false, after: false });
  assert.ok(hasIssue(issues, "overlapping_campaign", "campaigns[0]"));
});

test("duplicate campaign ids: the first campaign wins", () => {
  const { config, issues } = sanitizeConfig({
    campaigns: [
      { id: "bf", name: "first", window: WINDOW, overrides: [], killed: false },
      { id: "bf", name: "second", window: { start: "2027-01-01T00:00:00", end: "2027-01-02T00:00:00" }, overrides: [], killed: false },
    ],
  });
  assert.deepEqual(config.campaigns.map((c) => c.name), ["first"]);
  assert.ok(hasIssue(issues, "duplicate_campaign_id", "campaigns[1]"));
});

test("the hardened sanitizer is idempotent on a config that exercised every new rule", () => {
  const input = {
    modules: {
      codes: {
        rules: [
          rule("r1", { method: "code", codes: [" a ", "A", "b"] }),
          rule("r1"),
          rule("r2", { method: "code", codes: ["B", "c"] }),
        ],
      },
    },
    campaigns: [
      { id: "c1", name: "C1", window: WINDOW, overrides: [{ ruleId: "r2", patch: { value: { kind: "percentage", percent: 500 } } }], killed: false },
      { id: "c2", name: "C2", window: WINDOW, overrides: [{ ruleId: "nope", patch: {} }], killed: false },
      { id: "c3", name: "C3", window: { start: "x", end: "y" }, overrides: [], killed: false },
    ],
    locales: { sk: { t: "y".repeat(900) } },
  };
  const once = sanitizeConfig(input).config;
  const twice = sanitizeConfig(once);
  assert.deepEqual(twice.config, once);
});

// --- P2-3 / DATA-3: a config written by a newer schema -------------------------------------

const V2_FIXTURE = {
  schemaVersion: SCHEMA_VERSION + 1,
  modules: {
    codes: { rules: [rule("r1")] },
    bundles: { sets: [{ id: "b1", items: ["p1", "p2"] }] }, // unknown to v1
  },
  futureTopLevel: { anything: true },
};

test("isNewerSchema flags a stored config written by a newer schema only", () => {
  assert.equal(isNewerSchema(V2_FIXTURE), true);
  assert.equal(isNewerSchema({ schemaVersion: SCHEMA_VERSION }), false);
  assert.equal(isNewerSchema({}), false);
  assert.equal(isNewerSchema("garbage"), false);
  assert.equal(isNewerSchema({ schemaVersion: "2" }), false);
});

test("readStoredConfig still returns a usable config for a newer-schema row (read-only use)", () => {
  const config = readStoredConfig(V2_FIXTURE);
  assert.equal(config.schemaVersion, SCHEMA_VERSION);
  assert.equal(config.modules.codes.rules.length, 1);
  assert.ok(!("bundles" in config.modules));
});
