import assert from "node:assert/strict";
import { test } from "node:test";

import { CONFIG_LIMITS, sanitizeConfig, type ConfigIssue } from "../../src/discounts/config.ts";

// ConfigIssue.params (MVP 2, Task 3 fix round 3): a UI words an issue in its
// own language from `code` + `params`, never by reading the English
// `message`. So every number the message names (a limit, a count, the value
// given, the value kept) must also be in `params` — checked here over a
// battery of inputs that reaches every code whose message names a value. The
// `message` itself is unchanged (logs, tests).

function rule(id: string, extra: Record<string, unknown> = {}) {
  return { id, enabled: true, name: `Rule ${id}`, method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "order" }, ...extra };
}

const WINDOW = (day: number) => ({
  start: `2026-01-${String(day).padStart(2, "0")}T00:00:00`,
  end: `2026-01-${String(day).padStart(2, "0")}T12:00:00`,
});

/** Inputs, each sanitized on its own (one config would hit CONFIG_LIMITS.maxIssues). */
const BATTERY: unknown[] = [
  // Rules: values, targets, priority, codes, schedule, ids, origin, combinesWith, booleans, enums.
  {
    modules: {
      codes: {
        rules: [
          rule("pct", { value: { kind: "percentage", percent: 150 } }),
          rule("pctjunk", { value: { kind: "percentage", percent: "12" } }),
          rule("badvalue", { value: { kind: "bogus7" } }),
          rule("badtarget", { target: { kind: "nowhere9" } }),
          rule("ship", { value: { kind: "freeShipping" }, target: { kind: "order" } }),
          rule("prio", { priority: 2500 }),
          rule("prio2", { priority: "3" }),
          rule("sched", { schedule: { startsAt: "2026-13-45T00:00:00Z" } }),
          rule("sched2", { schedule: { startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z" } }),
          rule("bad id 42!"),
          rule("orig", { origin: { nativeId: "gid://shopify/Product/12" } }),
          rule("comb", { combinesWith: { ruleIds: ["ghost-7", "pct"] } }),
          rule("bool", { enabled: 1 }),
          rule("enum", { method: "sometimes2" }),
          rule("pct", {}),
          rule("money", { value: { kind: "fixed", amount: { CZK: 5e12, EUR: 100 } } }),
          rule("codes", {
            method: "code",
            codes: ["LETO", "leto", "X".repeat(CONFIG_LIMITS.codeLength + 1), "ZIMA"],
          }),
          rule("taken", { method: "code", codes: ["ZIMA", "JARO"] }),
          rule("targets", {
            target: {
              kind: "products",
              productIds: [...Array.from({ length: CONFIG_LIMITS.listItems + 3 }, (_, i) => `gid://shopify/Product/${i + 1}`), "p".repeat(CONFIG_LIMITS.referenceLength + 1)],
              variantIds: [],
            },
          }),
          rule("currencies", {
            value: {
              kind: "fixed",
              amount: Object.fromEntries(
                Array.from({ length: CONFIG_LIMITS.currenciesPerAmount + 2 }, (_, i) => [`C${String.fromCharCode(65 + (i % 26))}${String.fromCharCode(65 + Math.floor(i / 26))}`, 100]),
              ),
            },
          }),
        ],
      },
    },
  },
  { modules: { codes: { rules: [rule("many", { method: "code", codes: Array.from({ length: CONFIG_LIMITS.codesPerRule + 4 }, (_, i) => `K${i}`) })] } } },
  { modules: { codes: { rules: Array.from({ length: CONFIG_LIMITS.rules + 5 }, (_, i) => rule(`r${i}`)) } } },
  // More issues than CONFIG_LIMITS.maxIssues → issues_truncated.
  { modules: { codes: { rules: Array.from({ length: CONFIG_LIMITS.maxIssues + 7 }, (_, i) => rule(`b${i}`, { enabled: "yes" })) } } },
  // Margin (MVP 2).
  {
    modules: {
      margin: {
        enabled: true,
        global: { minMarginPercent: 12.35, maxDiscountPercent: 120 },
        perCollection: [
          { collectionId: "gid://shopify/Collection/1", minMarginPercent: "x" },
          ...Array.from({ length: CONFIG_LIMITS.marginOverrides + 3 }, (_, i) => ({ collectionId: `gid://shopify/Collection/${i + 2}`, maxDiscountPercent: 10 })),
        ],
      },
    },
  },
  // Markets, locales, onboarding.
  {
    markets: [
      { handle: "cz", currency: "xx1" },
      { handle: "sk", currency: "EUR", countries: ["SK", "S1", "CZE"] },
      ...Array.from({ length: CONFIG_LIMITS.markets + 2 }, (_, i) => ({ handle: `m${i}`, currency: "CZK" })),
    ],
    locales: {
      cs: { long: "a".repeat(CONFIG_LIMITS.localeStringLength + 1), ...Object.fromEntries(Array.from({ length: CONFIG_LIMITS.localeKeysPerLanguage + 2 }, (_, i) => [`k${i}`, "x"])) },
    },
    onboarding: { goals: ["margin", "goal-9", 42], step: 1 },
  },
  // Tiers and gifts.
  {
    modules: {
      tiers: {
        sets: [
          { id: "t", scope: "global", countAcross: "line", breaks: Array.from({ length: CONFIG_LIMITS.breaksPerTierSet + 2 }, (_, i) => ({ minQty: i + 2, percent: 5 })) },
          ...Array.from({ length: CONFIG_LIMITS.tierSets + 1 }, (_, i) => ({ id: `s${i}`, scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] })),
        ],
      },
      rewards: { gifts: Array.from({ length: CONFIG_LIMITS.giftTiers + 3 }, (_, i) => ({ id: `g${i}`, threshold: { CZK: 1000 }, choices: [] })) },
    },
  },
  // Campaigns.
  {
    modules: { codes: { rules: [rule("a1"), rule("t")] }, tiers: { sets: [{ id: "t", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }] } },
    campaigns: [
      { id: "c1", name: "Léto 2026", window: WINDOW(1), overrides: [{ ruleId: "a1", patch: { name: "x", method: "code" } }, { ruleId: "nope-3", patch: { value: { kind: "percentage", percent: 5 } } }, { ruleId: "t", patch: { enabled: false } }, { ruleId: "a1", patch: {} }], killed: false },
      { id: "c1", name: "Dup", window: WINDOW(3), overrides: [], killed: false },
      { id: "c2", name: "Zima 7", window: { start: "2026-01-05T00:00:00", end: "2026-01-04T00:00:00" }, overrides: [], killed: false },
      { id: "c3", name: "Overlap 11", window: { start: "2026-01-01T06:00:00", end: "2026-01-02T00:00:00" }, overrides: [], killed: false },
      { id: "c4", name: "Many", window: WINDOW(9), overrides: Array.from({ length: CONFIG_LIMITS.overridesPerCampaign + 3 }, () => ({ ruleId: "a1", patch: { enabled: false } })), killed: false },
    ],
  },
  { campaigns: Array.from({ length: CONFIG_LIMITS.campaigns + 2 }, (_, i) => ({ id: `k${i}`, name: `K${i}`, window: { start: `2027-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00`, end: `2027-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00` }, overrides: [], killed: false })) },
];

/** Numbers that are fixed wording, not values (the schedule's format hint, the node id shape). */
const FIXED_TEXT = [/ISO 8601/g, /\(e\.g\. [^)]*\)/g, /gid:\/\/shopify\/DiscountCodeNode\/…/g, /YYYY-MM-DDTHH:MM:SS/g];

const numbersIn = (text: string) => text.match(/\d+(?:\.\d+)?/g) ?? [];

function issues(): ConfigIssue[] {
  return BATTERY.flatMap((input) => sanitizeConfig(input).issues);
}

test("every number an issue's message names is also in its params (the admin words issues from code + params only)", () => {
  const all = issues();
  const failures: string[] = [];
  for (const issue of all) {
    let text = issue.message;
    for (const re of FIXED_TEXT) text = text.replace(re, "");
    const wanted = numbersIn(text);
    if (wanted.length === 0) continue;
    const have = new Set(Object.values(issue.params ?? {}).flatMap((v) => numbersIn(String(v))));
    const missing = wanted.filter((n) => !have.has(n));
    if (missing.length > 0) failures.push(`${issue.code} @ ${issue.path}: ${missing.join(", ")} not in ${JSON.stringify(issue.params)} — ${issue.message}`);
  }
  assert.deepEqual(failures, []);
});

test("the battery reaches every code whose message names a value (the check above is not vacuous)", () => {
  const reached = new Set(issues().map((i) => i.code));
  const valued = [
    "ambiguous_override",
    "clamped_money",
    "clamped_percent",
    "clamped_priority",
    "code_too_long",
    "duplicate_campaign_id",
    "duplicate_code",
    "duplicate_rule_id",
    "invalid_boolean",
    "invalid_campaign_window",
    "invalid_country",
    "invalid_currency",
    "invalid_enum",
    "invalid_id",
    "invalid_origin",
    "invalid_percent",
    "invalid_priority",
    "invalid_schedule",
    "invalid_target",
    "invalid_value",
    "issues_truncated",
    "locale_text_too_long",
    "orphan_combines_with",
    "orphan_override",
    "overlapping_campaign",
    "override_field_not_allowed",
    "reference_too_long",
    "rounded_percent",
    "too_many_campaigns",
    "too_many_codes",
    "too_many_currencies",
    "too_many_gift_tiers",
    "too_many_items",
    "too_many_locale_keys",
    "too_many_margin_overrides",
    "too_many_markets",
    "too_many_overrides",
    "too_many_rules",
    "too_many_tier_breaks",
    "too_many_tier_sets",
    "unknown_onboarding_goal",
    "value_target_mismatch",
  ];
  assert.deepEqual(valued.filter((code) => !reached.has(code)), []);
});

test("params carry what a UI needs: the two duplicate_code cases are told apart, rounded/clamped values are numbers", () => {
  const all = issues();
  const merged = all.find((i) => i.code === "duplicate_code" && i.params?.reason === "merged");
  const taken = all.find((i) => i.code === "duplicate_code" && i.params?.reason === "taken");
  assert.deepEqual(merged?.params, { reason: "merged", count: 1 });
  assert.deepEqual(taken?.params, { reason: "taken", codes: "ZIMA", more: 0, count: 1 });
  const rounded = all.find((i) => i.code === "rounded_percent")!;
  assert.deepEqual(rounded.params, { value: 12.35, to: 12.4, decimals: 1 });
  const clamped = all.find((i) => i.code === "clamped_percent" && i.path === "modules.margin.global.maxDiscountPercent")!;
  assert.deepEqual(clamped.params, { value: 120, min: 0, max: 100, to: 100 });
  assert.equal(rounded.message, "Margin percents keep one decimal; 12.35 was rounded to 12.4 (the stricter side, never a larger discount).", "message unchanged");
});

test("a list in params is its first five values plus how many more — never the English 'and N more' (a UI words that itself)", () => {
  const codes = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"];
  const { issues: list } = sanitizeConfig({
    modules: {
      codes: {
        rules: [
          rule("first", { method: "code", codes }),
          rule("second", { method: "code", codes }),
          rule("comb", { combinesWith: { ruleIds: ["g1", "g2", "g3", "g4", "g5", "g6", "g7"] } }),
          rule("money", { value: { kind: "fixed", amount: Object.fromEntries(["CZK", "EUR", "USD", "GBP", "PLN", "HUF"].map((c) => [c, 5e12])) } }),
        ],
      },
    },
    onboarding: { goals: ["u1", "u2", "u3", "u4", "u5", "u6"], step: 1 },
  });
  const byCode = (code: string) => list.find((i) => i.code === code)?.params;
  assert.deepEqual(byCode("duplicate_code"), { reason: "taken", codes: "A1, A2, A3, A4, A5", more: 3, count: 8 });
  assert.deepEqual(byCode("orphan_combines_with"), { ids: '"g1", "g2", "g3", "g4", "g5"', more: 2, count: 7 });
  assert.deepEqual(byCode("clamped_money"), { max: CONFIG_LIMITS.moneyMinorUnits, currencies: "CZK, EUR, USD, GBP, PLN", more: 1, count: 6 });
  assert.equal(byCode("unknown_onboarding_goal")?.values, '"u1", "u2", "u3", "u4", "u5"');
  assert.equal(byCode("unknown_onboarding_goal")?.more, 1);
  // The English message is unchanged (logs).
  assert.equal(list.find((i) => i.code === "duplicate_code")!.message, "Code(s) A1, A2, A3, A4, A5 and 3 more already belong to an earlier rule and were removed from this one.");
  for (const issue of [...list, ...issues()]) {
    for (const [name, value] of Object.entries(issue.params ?? {})) {
      assert.doesNotMatch(String(value), /\band \d+ more\b/, `${issue.code}.${name}: English inside a param`);
    }
  }
});

test("an issue without values carries no params (and the shape stays JSON-serialisable)", () => {
  const { issues: list } = sanitizeConfig({ modules: { codes: { rules: [{ name: "no id" }] } }, markets: [{ currency: "CZK" }] });
  const handle = list.find((i) => i.code === "missing_handle")!;
  assert.equal("params" in handle, false);
  assert.deepEqual(JSON.parse(JSON.stringify(list)), list);
});
