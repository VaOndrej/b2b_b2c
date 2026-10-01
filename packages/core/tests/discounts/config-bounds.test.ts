import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CONFIG_LIMITS,
  isIsoDateTime,
  isValidEntityId,
  ONBOARDING_GOALS,
  readStoredConfig,
  sanitizeConfig,
  type ConfigIssue,
} from "../../src/discounts/config.ts";
import {
  encodeFunctionConfig,
  encodeFunctionConfigWorstCase,
  FUNCTION_CONFIG_BUDGET_BYTES,
} from "../../src/discounts/function-config.ts";

// Audit MVP 0, fix round 2: the rest of P2-1 (every stored list and string is
// bounded, not only what reaches the function payload), the rest of P2-2
// (orphaned combinesWith, rule.schedule), id policy, markets, onboarding goals,
// and the save-time budget measured over every campaign state (re-review K).

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

const storedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const WINDOW = { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:59" };
const MB = 1024 * 1024;

// --- combinesWith: orphaned references ---------------------------------------------------

test("combinesWith keeps existing rule ids, drops orphans with an issue and merges duplicates", () => {
  const { config, issues } = sanitizeConfig({
    modules: {
      codes: {
        rules: [
          rule("a", { combinesWith: { ruleIds: ["b", "missing", "b", "ghost"] } }),
          rule("b", { combinesWith: { ruleIds: ["a"] } }),
        ],
      },
    },
  });
  assert.deepEqual(config.modules.codes.rules[0].combinesWith, { ruleIds: ["b"] });
  assert.deepEqual(config.modules.codes.rules[1].combinesWith, { ruleIds: ["a"] });
  assert.ok(hasIssue(issues, "orphan_combines_with", "modules.codes.rules[0].combinesWith.ruleIds"));
  assert.ok(!hasIssue(issues, "orphan_combines_with", "modules.codes.rules[1]"));
});

test("combinesWith pointing at a rule that was dropped (no id / over the cap) is an orphan too", () => {
  const { config, issues } = sanitizeConfig({
    modules: { codes: { rules: [rule("a", { combinesWith: { ruleIds: [""] } }), { name: "no id" }] } },
  });
  assert.deepEqual(config.modules.codes.rules[0].combinesWith, { ruleIds: [] });
  assert.ok(hasIssue(issues, "orphan_combines_with"));
});

test("a campaign override patching combinesWith is pruned against the real rule ids", () => {
  const { config, issues } = sanitizeConfig({
    modules: { codes: { rules: [rule("a"), rule("b")] } },
    campaigns: [
      {
        id: "bf",
        name: "BF",
        window: WINDOW,
        overrides: [{ ruleId: "a", patch: { combinesWith: { ruleIds: ["b", "nope"] } } }],
        killed: false,
      },
    ],
  });
  assert.deepEqual(config.campaigns[0].overrides[0].patch.combinesWith, { ruleIds: ["b"] });
  assert.ok(hasIssue(issues, "orphan_combines_with", "campaigns[0].overrides[0].patch.combinesWith"));
});

// --- rule.schedule ------------------------------------------------------------------------

test("isIsoDateTime accepts only ISO 8601 date-times with a zone designator", () => {
  for (const ok of ["2026-11-27T00:00:00Z", "2026-11-27T00:00:00+01:00", "2026-11-27T00:00Z", "2024-02-29T23:59:59.123-05:00"]) {
    assert.equal(isIsoDateTime(ok), true, ok);
  }
  for (const bad of ["2026-11-27T00:00:00", "2026-11-27", "garbage", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "2026-11-27T24:00:00Z", "2026-11-27T00:00:00+25:00", "2026-11-27 00:00:00Z", 1, null]) {
    assert.equal(isIsoDateTime(bad), false, JSON.stringify(bad));
  }
});

test("a valid schedule is kept as-is; an empty or null schedule is simply omitted", () => {
  const { config, issues } = sanitizeConfig({
    modules: {
      codes: {
        rules: [
          rule("both", { schedule: { startsAt: "2026-11-27T00:00:00+01:00", endsAt: "2026-11-30T23:59:59+01:00" } }),
          rule("open", { schedule: { startsAt: "2026-11-27T00:00:00Z", endsAt: null } }),
          rule("empty", { schedule: {} }),
          rule("null", { schedule: null }),
        ],
      },
    },
  });
  const [both, open, empty, nul] = config.modules.codes.rules;
  assert.deepEqual(both.schedule, { startsAt: "2026-11-27T00:00:00+01:00", endsAt: "2026-11-30T23:59:59+01:00" });
  assert.equal(both.enabled, true);
  assert.deepEqual(open.schedule, { startsAt: "2026-11-27T00:00:00Z" });
  assert.equal("schedule" in empty, false);
  assert.equal("schedule" in nul, false);
  assert.ok(!hasIssue(issues, "invalid_schedule"));
});

test("an invalid schedule is removed AND the rule is disabled, with an issue", () => {
  const { config, issues } = sanitizeConfig({
    modules: {
      codes: {
        rules: [
          rule("garbage", { schedule: { startsAt: "garbage" } }),
          rule("no-zone", { schedule: { startsAt: "2026-11-27T00:00:00" } }),
          rule("inverted", { schedule: { startsAt: "2026-12-01T00:00:00Z", endsAt: "2026-11-30T00:00:00Z" } }),
          rule("same", { schedule: { startsAt: "2026-12-01T01:00:00+01:00", endsAt: "2026-12-01T00:00:00Z" } }),
          rule("not-object", { schedule: "tomorrow" }),
          rule("number", { schedule: { endsAt: 1_700_000_000 } }),
        ],
      },
    },
  });
  assert.equal(config.modules.codes.rules.length, 6);
  config.modules.codes.rules.forEach((r, i) => {
    assert.equal("schedule" in r, false, `${r.id}: schedule removed`);
    assert.equal(r.enabled, false, `${r.id}: rule disabled`);
    assert.ok(hasIssue(issues, "invalid_schedule", `modules.codes.rules[${i}].schedule`), `${r.id}: issue`);
  });
  // Stable on the next read: no schedule, still disabled, no new issue.
  const again = sanitizeConfig(config);
  assert.deepEqual(again.config, config);
  assert.ok(!hasIssue(again.issues, "invalid_schedule"));
});

// --- ids ----------------------------------------------------------------------------------

test("isValidEntityId: 1-64 characters of [A-Za-z0-9_-]", () => {
  assert.equal(isValidEntityId("rule_1-A"), true);
  assert.equal(isValidEntityId("x".repeat(64)), true);
  for (const bad of ["", "x".repeat(65), "a b", "a/b", "ř", "gid://shopify/X/1", 42, null]) {
    assert.equal(isValidEntityId(bad), false, JSON.stringify(bad));
  }
});

test("an invalid id is regenerated deterministically (issue), and references follow it", () => {
  const input = {
    modules: {
      codes: {
        rules: [
          rule("rule one", { combinesWith: { ruleIds: ["x".repeat(65)] } }),
          rule("x".repeat(65), { combinesWith: { ruleIds: ["rule one"] } }),
        ],
      },
      tiers: { sets: [{ id: "tier/1", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }] },
      rewards: { gifts: [{ id: "gift 1", threshold: { CZK: 100_00 }, choices: ["v1"] }] },
    },
    campaigns: [
      {
        id: "Black Friday 2026",
        name: "BF",
        window: WINDOW,
        overrides: [
          { ruleId: "rule one", patch: { enabled: false } },
          { ruleId: "tier/1", patch: { countAcross: "cart" } },
          { ruleId: "gift 1", patch: { choices: ["v2"] } },
        ],
        killed: false,
      },
    ],
  };
  const { config, issues } = sanitizeConfig(input);
  const [r1, r2] = config.modules.codes.rules;
  const set = config.modules.tiers.sets[0];
  const gift = config.modules.rewards.gifts[0];
  const campaign = config.campaigns[0];
  for (const id of [r1.id, r2.id, set.id, gift.id, campaign.id]) assert.equal(isValidEntityId(id), true, id);
  assert.match(r1.id, /^rule-[0-9a-z]+$/);
  assert.match(set.id, /^tier-[0-9a-z]+$/);
  assert.match(gift.id, /^gift-[0-9a-z]+$/);
  assert.match(campaign.id, /^campaign-[0-9a-z]+$/);
  assert.notEqual(r1.id, r2.id);
  assert.deepEqual(r1.combinesWith, { ruleIds: [r2.id] });
  assert.deepEqual(r2.combinesWith, { ruleIds: [r1.id] });
  assert.deepEqual(
    campaign.overrides.map((o) => o.ruleId),
    [r1.id, set.id, gift.id],
  );
  assert.equal(issues.filter((i) => i.code === "invalid_id").length, 5);
  assert.ok(!hasIssue(issues, "orphan_override"));
  assert.ok(!hasIssue(issues, "orphan_combines_with"));

  // Deterministic (the same stored row always gives the same ids) and idempotent.
  assert.deepEqual(sanitizeConfig(input).config, config);
  const again = sanitizeConfig(config);
  assert.deepEqual(again.config, config);
  assert.ok(!hasIssue(again.issues, "invalid_id"));
});

test("a missing id still drops the entry (nothing to derive an id from)", () => {
  const { config, issues } = sanitizeConfig({ modules: { codes: { rules: [rule(""), rule("ok")] } } });
  assert.deepEqual(config.modules.codes.rules.map((r) => r.id), ["ok"]);
  assert.ok(hasIssue(issues, "missing_id", "modules.codes.rules[0]"));
});

test("campaign ids are capped at 64 characters, so the function payload of each campaign state is bounded", () => {
  const { config } = sanitizeConfig({
    campaigns: [{ id: "c".repeat(5000), name: "long", window: WINDOW, overrides: [], killed: false }],
  });
  assert.ok(config.campaigns[0].id.length <= CONFIG_LIMITS.idLength);
});

// --- markets, onboarding goals --------------------------------------------------------------

test("markets are capped at 50 with an issue", () => {
  const markets = Array.from({ length: 60 }, (_, i) => ({ handle: `m${i}`, currency: "CZK", enabled: true }));
  const { config, issues } = sanitizeConfig({ markets });
  assert.equal(CONFIG_LIMITS.markets, 50);
  assert.equal(config.markets.length, 50);
  assert.ok(hasIssue(issues, "too_many_markets", "markets"));
});

test("onboarding goals keep only known values, once each, in order", () => {
  const { config, issues } = sanitizeConfig({
    onboarding: { goals: ["tiers", "hack", "tiers", "rewards", 7, "margin"], step: 2 },
  });
  assert.deepEqual(config.onboarding.goals, ["tiers", "rewards", "margin"]);
  assert.ok(hasIssue(issues, "unknown_onboarding_goal", "onboarding.goals"));
  assert.deepEqual([...ONBOARDING_GOALS], ["rewards", "tiers", "outlet", "margin", "migrate"]);
});

// --- P2-1 remainder: every stored list and string is bounded -------------------------------
// One regression per path the fix-round-1 re-review used to store 3-4 MB configs
// behind a ~500 B function payload.

test("re-review path 1: 3 000 goals x 1 kB no longer reach storage", () => {
  const { config, issues } = sanitizeConfig({ onboarding: { goals: Array.from({ length: 3000 }, (_, i) => `${i}${"g".repeat(1000)}`) } });
  assert.deepEqual(config.onboarding.goals, []);
  assert.ok(storedBytes(config) < 4096, `stored ${storedBytes(config)} B`);
  assert.ok(hasIssue(issues, "unknown_onboarding_goal"));
  assert.ok(JSON.stringify(issues).length < 4096, "issues stay small too");
});

test("re-review path 2: 30 000 markets are capped", () => {
  const markets = Array.from({ length: 30_000 }, (_, i) => ({ handle: `market-${i}`, currency: "EUR", enabled: true }));
  const { config, issues } = sanitizeConfig({ markets });
  assert.equal(config.markets.length, CONFIG_LIMITS.markets);
  assert.ok(storedBytes(config) < 8192, `stored ${storedBytes(config)} B`);
  assert.ok(hasIssue(issues, "too_many_markets"));
});

test("re-review path 3: a 3 MB origin.nativeId is refused (gid format + length)", () => {
  const { config, issues } = sanitizeConfig({
    modules: {
      codes: {
        rules: [
          rule("huge", { origin: { nativeId: `gid://shopify/DiscountCodeNode/${"9".repeat(3 * MB)}` } }),
          rule("ok", { origin: { nativeId: "gid://shopify/DiscountCodeNode/1234567890" } }),
          rule("auto", { origin: { nativeId: "gid://shopify/DiscountAutomaticNode/42" } }),
          rule("junk", { origin: { nativeId: "not-a-gid" } }),
        ],
      },
    },
  });
  const [huge, ok, auto, junk] = config.modules.codes.rules;
  assert.equal("origin" in huge, false);
  assert.deepEqual(ok.origin, { nativeId: "gid://shopify/DiscountCodeNode/1234567890" });
  assert.deepEqual(auto.origin, { nativeId: "gid://shopify/DiscountAutomaticNode/42" });
  assert.equal("origin" in junk, false);
  assert.ok(storedBytes(config) < 4096, `stored ${storedBytes(config)} B`);
  assert.ok(hasIssue(issues, "invalid_origin", "modules.codes.rules[0].origin.nativeId"));
  assert.ok(JSON.stringify(issues).length < 4096, "issue messages never echo the 3 MB value");
});

test("re-review path 4: a KILLED campaign's override patch is bounded like a live one", () => {
  const segments = Array.from({ length: 30_000 }, (_, i) => `gid://shopify/Segment/${i}${"0".repeat(40)}`); // ~70 chars each, 2 MB in all
  const { config, issues } = sanitizeConfig({
    modules: { codes: { rules: [rule("r1")] } },
    campaigns: [
      {
        id: "killed",
        name: "Killed",
        window: { start: "garbage", end: "x" }, // auto-killed, so it never reaches the function payload
        overrides: [{ ruleId: "r1", patch: { targeting: { segments, markets: ["m".repeat(3 * MB)] } } }],
        killed: false,
      },
    ],
  });
  assert.equal(config.campaigns[0].killed, true);
  const targeting = config.campaigns[0].overrides[0].patch.targeting as { segments: string[]; markets: string[] };
  assert.ok(targeting.segments.length <= CONFIG_LIMITS.listItems);
  assert.deepEqual(targeting.markets, []);
  assert.ok(storedBytes(config) < 64 * 1024, `stored ${storedBytes(config)} B`);
  assert.ok(hasIssue(issues, "too_many_items", "campaigns[0].overrides[0].patch.targeting.segments"));
  assert.ok(hasIssue(issues, "reference_too_long", "campaigns[0].overrides[0].patch.targeting.markets"));
});

test("reference lists are capped in count (250) and item length (100) everywhere", () => {
  const ids = Array.from({ length: 300 }, (_, i) => `gid://shopify/Product/${i}`);
  const { config, issues } = sanitizeConfig({
    modules: {
      codes: { rules: [rule("r1", { target: { kind: "products", productIds: ids, variantIds: ["v".repeat(101), "ok"] } })] },
      tiers: { sets: [{ id: "t1", scope: { collectionIds: ids }, countAcross: "line", breaks: [] }] },
      rewards: { gifts: [{ id: "g1", threshold: { CZK: 1 }, choices: ids, fallbackVariantId: "f".repeat(101) }] },
    },
  });
  const target = config.modules.codes.rules[0].target as { productIds: string[]; variantIds: string[] };
  assert.equal(CONFIG_LIMITS.listItems, 250);
  assert.equal(CONFIG_LIMITS.referenceLength, 100);
  assert.equal(target.productIds.length, 250);
  assert.deepEqual(target.variantIds, ["ok"]);
  assert.equal((config.modules.tiers.sets[0].scope as { collectionIds: string[] }).collectionIds.length, 250);
  assert.equal(config.modules.rewards.gifts[0].choices.length, 250);
  assert.equal("fallbackVariantId" in config.modules.rewards.gifts[0], false);
  assert.ok(hasIssue(issues, "too_many_items", "modules.codes.rules[0].target.productIds"));
  assert.ok(hasIssue(issues, "reference_too_long", "modules.codes.rules[0].target.variantIds"));
  assert.ok(hasIssue(issues, "too_many_items", "modules.tiers.sets[0].scope.collectionIds"));
  assert.ok(hasIssue(issues, "reference_too_long", "modules.rewards.gifts[0].fallbackVariantId"));
});

test("money maps are capped at 50 currencies with an issue", () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const amount = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`X${letters[Math.floor(i / 26)]}${letters[i % 26]}`, 100]));
  const { config, issues } = sanitizeConfig({
    modules: { codes: { rules: [rule("r1", { value: { kind: "fixed", amount } })] } },
  });
  const value = config.modules.codes.rules[0].value as { amount: Record<string, number> };
  assert.equal(Object.keys(value.amount).length, CONFIG_LIMITS.currenciesPerAmount);
  assert.ok(hasIssue(issues, "too_many_currencies", "modules.codes.rules[0].value.amount"));
});

test("margin overrides per collection are capped: the rest fold into the global setting, with an issue (audit P3-5)", () => {
  const perCollection = Array.from({ length: CONFIG_LIMITS.marginOverrides + 5 }, (_, i) => ({
    collectionId: `gid://shopify/Collection/${i}`,
    maxDiscountPercent: 20,
  }));
  const { config, issues } = sanitizeConfig({ modules: { margin: { perCollection } } });
  assert.equal(config.modules.margin.perCollection.length, CONFIG_LIMITS.marginOverrides);
  assert.ok(hasIssue(issues, "margin_overrides_folded"));
  assert.equal(config.modules.margin.global.maxDiscountPercent, 20, "folded, never dropped");
});

test("storedConfigBytes is the documented 256 KiB backstop", () => {
  assert.equal(CONFIG_LIMITS.storedConfigBytes, 262_144);
});

test("the bounded sanitizer stays idempotent on a config that hit every new cap", () => {
  const input = {
    markets: Array.from({ length: 55 }, (_, i) => ({ handle: `m${i}`, currency: "CZK" })),
    modules: {
      codes: {
        rules: [
          rule("a b", { combinesWith: { ruleIds: ["c", "zzz", "a b"] }, schedule: { startsAt: "nope" } }),
          rule("c", { targeting: { segments: Array.from({ length: 260 }, (_, i) => `s${i}`) }, origin: { nativeId: "x" } }),
        ],
      },
    },
    campaigns: [{ id: "c".repeat(70), name: "C", window: WINDOW, overrides: [{ ruleId: "a b", patch: { combinesWith: { ruleIds: ["c", "q"] } } }], killed: false }],
    onboarding: { goals: ["margin", "margin", "x"] },
  };
  const once = sanitizeConfig(input).config;
  assert.deepEqual(sanitizeConfig(once).config, once);
  assert.deepEqual(readStoredConfig(JSON.parse(JSON.stringify(once))), once);
});

// --- re-review K: the save-time budget covers every campaign state --------------------------

test("encodeFunctionConfig can be forced to a campaign (or none) regardless of now", () => {
  const { config } = sanitizeConfig({
    campaigns: [
      { id: "early", name: "E", window: { start: "2026-01-01T00:00:00", end: "2026-01-02T00:00:00" }, overrides: [], killed: false },
      { id: "late", name: "L", window: { start: "2026-06-01T00:00:00", end: "2026-06-02T00:00:00" }, overrides: [], killed: false },
    ],
  });
  const forced = JSON.parse(encodeFunctionConfig(config, { campaignId: "late", now: "2026-01-01T12:00:00" }).json);
  assert.equal(forced.campaignId, "late");
  assert.equal(forced.campaignStart, "2026-06-01T00:00:00");
  const none = JSON.parse(encodeFunctionConfig(config, { campaignId: null }).json);
  assert.equal(none.campaignId, null);
  assert.equal(none.campaignStart, "1970-01-01T00:00:00");
});

test("encodeFunctionConfigWorstCase measures the largest state over time (every live campaign and none)", () => {
  const { config } = sanitizeConfig({
    campaigns: [
      { id: "a", name: "A", window: { start: "2026-01-01T00:00:00", end: "2026-01-02T00:00:00" }, overrides: [], killed: false },
      { id: "b".repeat(64), name: "B", window: { start: "2026-06-01T00:00:00", end: "2026-06-02T00:00:00" }, overrides: [], killed: false },
    ],
  });
  const worst = encodeFunctionConfigWorstCase(config);
  assert.equal(worst.campaignId, "b".repeat(64));
  // At save time (before the first window) the sync would write campaign "a",
  // which is smaller than the state it will write in June.
  const atSave = encodeFunctionConfig(config, { now: "2025-12-31T00:00:00" });
  assert.ok(worst.bytes > atSave.bytes);
  for (const campaignId of [null, "a", "b".repeat(64)]) {
    assert.ok(worst.bytes >= encodeFunctionConfig(config, { campaignId }).bytes);
  }
  assert.equal(worst.fits, worst.bytes <= FUNCTION_CONFIG_BUDGET_BYTES);
  // No live campaign: the worst case is the no-campaign state.
  assert.equal(encodeFunctionConfigWorstCase(sanitizeConfig({}).config).campaignId, null);
});

// --- issues list is bounded too (audit P3-10 followup) -------------------------------------
// 30 000 markets each missing a handle used to push 30 000 separate ConfigIssues (the
// too_many_markets cap only limits how many markets are KEPT, not how many bad ones are
// reported). sanitizeConfig must cap the issues list itself.

test("30 000 bad markets no longer produce 30 000 issues", () => {
  const markets = Array.from({ length: 30_000 }, () => ({ currency: "EUR", enabled: true })); // no handle
  const { config, issues } = sanitizeConfig({ markets });
  assert.equal(config.markets.length, 0);
  assert.equal(issues.length, CONFIG_LIMITS.maxIssues + 1, "capped list plus one summary issue");
  assert.ok(hasIssue(issues, "missing_handle"), "the kept issues are still real ones");
  const summary = issues[issues.length - 1];
  assert.equal(summary.code, "issues_truncated");
  assert.match(summary.message, /29900 more/);
  assert.ok(storedBytes(issues) < 32 * 1024, `issues JSON stayed ${storedBytes(issues)} B`);
});

test("issues under the cap are returned unchanged, with no summary issue", () => {
  const markets = Array.from({ length: 5 }, () => ({ currency: "EUR", enabled: true }));
  const { issues } = sanitizeConfig({ markets });
  assert.equal(issues.length, 5);
  assert.ok(!hasIssue(issues, "issues_truncated"));
});
