// MVP 6.1 (plan docs/plans/2026-10-04-won-discounts-mvp6-1.md, contracts L2–L8): a campaign may override the
// breaks of a quantity tier set — only when the override is at least as generous as the base for every quantity
// and currency (E2). The function reads the campaign's sets INSTEAD of the base ones while the campaign is live
// (L4); the storefront shows them from a minute after the start until 7 minutes before the end (L6, L7).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAMPAIGN_TIERS,
  campaignTierSets,
  campaignTiersPayload,
  campaignTiersShownAt,
  tierOverrideIssue,
} from "../../src/discounts/campaign-tiers.ts";
import { campaignBoundary, validateCampaignDraft, type CampaignDraft } from "../../src/discounts/campaigns.ts";
import { CONFIG_LIMITS, sanitizeConfig, type TierBreak, type TierSet, type WonDiscountsConfig } from "../../src/discounts/config.ts";
import { buildNodeVars, buildShopFunctionConfig, buildShopFunctionConfigWorstCase, campaignInputFromVars } from "../../src/discounts/function-payload.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { buildStorefrontConfig } from "../../src/discounts/storefront-config.ts";
import { cartOf, lineOf, pct } from "./engine-fixtures.ts";

const TZ = "Europe/Prague";
const P = (n: number) => `gid://shopify/Product/${n}`;
const WINDOW = { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:00" };
const GLOBAL = { id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 10 }, { minQty: 5, percent: 15 }] };
const SCOPED = { id: "s", scope: { productIds: [P(7)] }, countAcross: "line", breaks: [{ minQty: 3, amountOff: { CZK: 1000, EUR: 40 } }] };
const tierOverride = (setId: string, breaks: unknown[]) => ({ ruleId: setId, patch: { breaks } });
const BF = (overrides: unknown[], extra: Record<string, unknown> = {}) => ({ id: "bf", name: "Black Friday", window: WINDOW, overrides, ...extra });

function configOf(campaigns: unknown[], sets: unknown[] = [GLOBAL, SCOPED]): WonDiscountsConfig {
  return sanitizeConfig({
    modules: { codes: { rules: [pct("a", 10)] }, tiers: { sets }, rewards: { gifts: [{ id: "gift", threshold: { CZK: 100000 }, choices: ["gid://shopify/ProductVariant/1"] }] } },
    campaigns,
  }).config;
}

const set = (breaks: TierBreak[]): TierSet => ({ id: "x", scope: "global", countAcross: "line", breaks });

// --- E2: the same or more generous ----------------------------------------------------------------

test("percent override: equal or higher at every break is fine; an extra lower break is fine", () => {
  const base = set([{ minQty: 2, percent: 10 }, { minQty: 5, percent: 15 }]);
  assert.equal(tierOverrideIssue(base, [{ minQty: 2, percent: 10 }, { minQty: 5, percent: 15 }]), null, "equal");
  assert.equal(tierOverrideIssue(base, [{ minQty: 2, percent: 20 }]), null, "one higher break covers both");
  assert.equal(tierOverrideIssue(base, [{ minQty: 1, percent: 5 }, { minQty: 2, percent: 12 }, { minQty: 4, percent: 30 }]), null);
});

test("percent override: lower at any quantity names the first quantity it fails at", () => {
  const base = set([{ minQty: 2, percent: 10 }, { minQty: 5, percent: 15 }]);
  assert.deepEqual(tierOverrideIssue(base, [{ minQty: 2, percent: 12 }]), { kind: "less", minQty: 5, currency: null }, "12 % < 15 % from 5 items");
  assert.deepEqual(tierOverrideIssue(base, [{ minQty: 3, percent: 30 }]), { kind: "less", minQty: 2, currency: null }, "nothing at 2 items");
  assert.deepEqual(tierOverrideIssue(base, [{ minQty: 2, percent: 9 }, { minQty: 5, percent: 50 }]), { kind: "less", minQty: 2, currency: null });
});

test("amount override: compared per currency; a currency the base offers must stay offered", () => {
  const base = set([{ minQty: 3, amountOff: { CZK: 1000, EUR: 40 } }, { minQty: 6, amountOff: { CZK: 2000 } }]);
  assert.equal(tierOverrideIssue(base, [{ minQty: 3, amountOff: { CZK: 2000, EUR: 40 } }]), null);
  assert.equal(tierOverrideIssue(base, [{ minQty: 3, amountOff: { CZK: 1000, EUR: 50, USD: 100 } }, { minQty: 6, amountOff: { CZK: 2000, EUR: 50 } }]), null, "a new currency is more");
  assert.deepEqual(tierOverrideIssue(base, [{ minQty: 3, amountOff: { CZK: 2000 } }]), { kind: "less", minQty: 3, currency: "EUR" }, "EUR dropped");
  assert.deepEqual(tierOverrideIssue(base, [{ minQty: 3, amountOff: { CZK: 1500, EUR: 40 } }]), { kind: "less", minQty: 6, currency: "CZK" });
});

test("another kind than the base (percent ↔ amount) is refused: it cannot be compared without a price", () => {
  assert.deepEqual(tierOverrideIssue(set([{ minQty: 2, percent: 10 }]), [{ minQty: 2, amountOff: { CZK: 5000 } }]), { kind: "kind", minQty: 2, currency: null });
  assert.deepEqual(tierOverrideIssue(set([{ minQty: 2, amountOff: { CZK: 100 } }]), [{ minQty: 2, percent: 90 }]), { kind: "kind", minQty: 2, currency: "CZK" });
});

test("an override without a break is empty; a base without a break accepts any override", () => {
  assert.deepEqual(tierOverrideIssue(set([{ minQty: 2, percent: 10 }]), []), { kind: "empty", minQty: 0, currency: null });
  assert.equal(tierOverrideIssue(set([]), [{ minQty: 2, percent: 10 }]), null);
});

// --- L2: the campaign's sets ------------------------------------------------------------------------

test("campaign sets: a generous breaks override replaces the set's breaks; anything else stays unused", () => {
  const config = configOf([
    BF([
      tierOverride("g", [{ minQty: 2, percent: 20 }]),
      tierOverride("s", [{ minQty: 3, amountOff: { CZK: 500, EUR: 40 } }]), // less: unused
      { ruleId: "a", patch: { value: { kind: "percentage", percent: 30 } } },
    ]),
  ]);
  const result = campaignTierSets(config.modules.tiers, config.campaigns[0]!);
  assert.deepEqual(result.applied, ["g"]);
  assert.deepEqual(result.unused, ["s"]);
  assert.deepEqual(result.sets.find((s) => s.id === "g")!.breaks, [{ minQty: 2, percent: 20 }]);
  assert.deepEqual(result.sets.find((s) => s.id === "s")!.breaks, config.modules.tiers.sets[1]!.breaks, "the base stays");
  assert.deepEqual(campaignTiersPayload(config.modules.tiers, config.campaigns[0]!), {
    global: "g",
    sets: [["g", "line", [], [[2, 20]]], ["s", "line", ["CZK", "EUR"], [[3, [1000, 40]]]]],
  });
});

test("campaign sets: countAcross alone, an unreachable set and a campaign without tier overrides give no payload", () => {
  const second = { id: "g2", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 1 }] };
  const config = configOf(
    [BF([{ ruleId: "g", patch: { countAcross: "cart" } }, tierOverride("g2", [{ minQty: 2, percent: 50 }])])],
    [GLOBAL, second],
  );
  const result = campaignTierSets(config.modules.tiers, config.campaigns[0]!);
  assert.deepEqual(result.applied, []);
  assert.deepEqual(result.unused.sort(), ["g", "g2"]);
  assert.equal(campaignTiersPayload(config.modules.tiers, config.campaigns[0]!), null);
  const rulesOnly = configOf([BF([{ ruleId: "a", patch: { enabled: false } }])]);
  assert.equal(campaignTiersPayload(rulesOnly.modules.tiers, rulesOnly.campaigns[0]!), null);
});

test("the later of two overrides of one set wins", () => {
  const config = configOf([BF([tierOverride("g", [{ minQty: 2, percent: 20 }]), tierOverride("g", [{ minQty: 2, percent: 30 }])])]);
  assert.deepEqual(campaignTierSets(config.modules.tiers, config.campaigns[0]!).sets[0]!.breaks, [{ minQty: 2, percent: 30 }]);
});

// --- L3: the payload ------------------------------------------------------------------------------

test("the payload: the selected campaign carries its sets as `tiers`, the base stays in modules.tiers; rule overrides only in `overrides`", () => {
  const config = configOf([BF([tierOverride("g", [{ minQty: 2, percent: 20 }]), { ruleId: "a", patch: { enabled: false } }])]);
  const built = buildShopFunctionConfig(config, { now: "2026-11-28T00:00:00", shopTimezone: TZ });
  const campaign = built.payload.campaigns[0]!;
  assert.deepEqual(campaign.overrides.map((o) => o.ruleId), ["a"]);
  assert.deepEqual(campaign.tiers, { global: "g", sets: [["g", "line", [], [[2, 20]]], ["s", "line", ["CZK", "EUR"], [[3, [1000, 40]]]]] });
  assert.deepEqual(built.payload.modules.tiers.sets[0], ["g", "line", [], [[2, 10], [5, 15]]]);
  const plain = buildShopFunctionConfig(configOf([BF([{ ruleId: "a", patch: { enabled: false } }])]), { now: "2026-11-28T00:00:00", shopTimezone: TZ });
  assert.equal("tiers" in plain.payload.campaigns[0]!, false, "no tier override: no key, no bytes");
});

test("the tier cap holds for the campaign's sets on their own: over 550 B the config does not fit, and the worst case reports it", () => {
  const breaks = Array.from({ length: 10 }, (_, i) => ({ minQty: i + 2, percent: 1 }));
  const sets = Array.from({ length: 6 }, (_, i) => ({ id: `set_${i}`, scope: i === 0 ? "global" : { productIds: [P(i)] }, countAcross: "line", breaks: breaks.slice(0, 5) }));
  // Every set gets 10 breaks in the campaign: larger than the base.
  const config = configOf([BF(sets.map((s) => tierOverride(s.id, breaks)))], sets);
  const base = buildShopFunctionConfig(config, { now: "2026-12-05T00:00:00", shopTimezone: TZ });
  assert.equal(base.payload.campaigns.length, 0);
  assert.ok(base.tiers.fits && base.fits, `base ${base.tiers.bytes} B`);
  const live = buildShopFunctionConfig(config, { now: "2026-11-28T00:00:00", shopTimezone: TZ });
  const campaignBytes = new TextEncoder().encode(JSON.stringify(live.payload.campaigns[0]!.tiers)).length;
  assert.ok(campaignBytes > base.tiers.bytes);
  assert.equal(live.tiers.bytes, campaignBytes, "the larger part is reported");
  const worst = buildShopFunctionConfigWorstCase(config);
  assert.equal(worst.tiers.bytes, campaignBytes);
  assert.equal(worst.tiers.fits, campaignBytes <= CONFIG_LIMITS.tierPayloadBytes);
  const big = configOf([BF(sets.map((s) => tierOverride(s.id, breaks.map((b) => ({ ...b, percent: 12.5 })))))], sets);
  const over = buildShopFunctionConfigWorstCase(big);
  assert.ok(over.tiers.bytes > CONFIG_LIMITS.tierPayloadBytes, `${over.tiers.bytes} B`);
  assert.equal(over.fits, false);
});

// --- L4: the engine -------------------------------------------------------------------------------

test("engine: a live campaign with sets plans its sets instead of the base ones; outside the window or on a stale node the base applies", () => {
  const config = configOf([BF([tierOverride("g", [{ minQty: 2, percent: 20 }])])]);
  const payload = buildShopFunctionConfig(config, { now: "2026-11-01T00:00:00", shopTimezone: TZ }).payload;
  const vars = buildNodeVars({ kind: "automatic" }, config, "2026-11-01T00:00:00");
  const line = { id: "L1", variantId: "gid://shopify/ProductVariant/1", productId: P(1), quantity: 2, unitPrice: 100_00, ruleIds: [] };
  const at = (now: string, campaign = campaignInputFromVars(vars, now)) => lineOf(planCart(cartOf([line], { campaign }), payload), "L1").product;

  assert.equal(at("2026-11-26T23:59:59")!.amount, 20_00, "before: 10 %");
  assert.equal(at("2026-11-27T00:00:00")!.amount, 40_00, "in the window: 20 %");
  assert.equal(at("2026-11-27T00:00:00")!.ownerRuleId, "tier:g");
  assert.equal(at("2026-11-30T23:59:00")!.amount, 20_00, "after: 10 %");
  assert.equal(at("2026-11-28T00:00:00", { id: "bf", active: true, varsVersion: "stale" })!.amount, 20_00, "stale node: the base");
});

test("engine: the campaign's `tiers` is read only when it is an object; a broken one gives no tier at all (fail closed), never both parts", () => {
  const config = configOf([BF([tierOverride("g", [{ minQty: 2, percent: 20 }])])]);
  const built = buildShopFunctionConfig(config, { now: "2026-11-28T00:00:00", shopTimezone: TZ }).payload;
  const campaign = campaignInputFromVars(buildNodeVars({ kind: "automatic" }, config, "2026-11-28T00:00:00"), "2026-11-28T00:00:00");
  const line = { id: "L1", variantId: "gid://shopify/ProductVariant/1", productId: P(1), quantity: 2, unitPrice: 100_00, ruleIds: [] };
  const withTiers = (tiers: unknown) => {
    const payload = JSON.parse(JSON.stringify(built));
    if (tiers === undefined) delete payload.campaigns[0].tiers;
    else payload.campaigns[0].tiers = tiers;
    return lineOf(planCart(cartOf([line], { campaign }), payload), "L1").product;
  };
  assert.equal(withTiers(undefined)!.amount, 20_00, "no key: the base");
  assert.equal(withTiers(null)!.amount, 20_00, "null: the base");
  assert.equal(withTiers([1])!.amount, 20_00, "an array: the base");
  assert.equal(withTiers("x")!.amount, 20_00, "a string: the base");
  assert.equal(withTiers({}), null, "an object without sets: no sets");
  assert.equal(withTiers({ sets: 7, global: "g" }), null);
  assert.equal(withTiers({ sets: [["g", "line", [], [[2, 30]]]] }), null, "no global named: the line has no set");
  assert.equal(withTiers({ global: "g", sets: [["g", "line", [], [[2, 30]]]] })!.amount, 60_00);
});

// --- L5: the gate -----------------------------------------------------------------------------------

test("Free with a finishing campaign: overrides of the sets the gate narrowed are removed, the kept global set's stays", () => {
  const second = { id: "g2", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 1 }] };
  const config = configOf(
    [BF([tierOverride("g", [{ minQty: 2, percent: 20 }]), tierOverride("s", [{ minQty: 3, amountOff: { CZK: 5000, EUR: 80 } }]), tierOverride("g2", [{ minQty: 2, percent: 2 }]), { ruleId: "a", patch: { enabled: false } }])],
    [GLOBAL, SCOPED, second],
  );
  const gated = gateConfigForPlan(config, "free", { now: "2026-11-28T00:00:00", finishing: ["bf"] }).config;
  assert.deepEqual(gated.campaigns[0]!.overrides.map((o) => o.ruleId), ["g", "a"]);
  const payload = campaignTiersPayload(gated.modules.tiers, gated.campaigns[0]!);
  assert.deepEqual(payload, { global: "g", sets: [["g", "line", [], [[2, 20]]], ["s", "line", [], []]] }, "the scoped set stays inert");
  const pro = gateConfigForPlan(config, "pro", { now: "2026-11-28T00:00:00" }).config;
  assert.equal(pro.campaigns[0]!.overrides.length, 4);
});

// --- L6, L7: the storefront and the scheduler ---------------------------------------------------------

test("the table shows the campaign's sets from a minute after the start until 7 minutes before the end", () => {
  assert.deepEqual(CAMPAIGN_TIERS, { showDelaySeconds: 60, hideLeadSeconds: 420 });
  const config = configOf([BF([tierOverride("g", [{ minQty: 2, percent: 20 }])])]);
  assert.equal(campaignTiersShownAt(config, "2026-11-26T12:00:00"), null, "scheduled");
  assert.equal(campaignTiersShownAt(config, "2026-11-27T00:00:59"), null, "the first minute: the base table");
  assert.equal(campaignTiersShownAt(config, "2026-11-27T00:01:00"), "bf");
  assert.equal(campaignTiersShownAt(config, "2026-11-30T23:51:59"), "bf");
  assert.equal(campaignTiersShownAt(config, "2026-11-30T23:52:00"), null, "7 minutes before the end: back to the base");
  assert.equal(campaignTiersShownAt(config, "2026-12-01T00:00:00"), null);
  assert.equal(campaignTiersShownAt(configOf([BF([{ ruleId: "a", patch: { enabled: false } }])]), "2026-11-28T00:00:00"), null, "no tier override");
  assert.equal(campaignTiersShownAt(configOf([BF([tierOverride("g", [{ minQty: 2, percent: 20 }])], { killed: true })]), "2026-11-28T00:00:00"), null);
  const short = configOf([{ ...BF([tierOverride("g", [{ minQty: 2, percent: 20 }])]), window: { start: "2026-11-27T00:00:00", end: "2026-11-27T00:08:00" } }]);
  for (const now of ["2026-11-27T00:00:30", "2026-11-27T00:01:00", "2026-11-27T00:02:00", "2026-11-27T00:07:59"]) assert.equal(campaignTiersShownAt(short, now), null, `8 minutes is too short (${now})`);
});

test("boundary: a campaign with tier overrides adds the table's switch on and off before its end", () => {
  const config = configOf([BF([tierOverride("g", [{ minQty: 2, percent: 20 }])])]);
  assert.equal(campaignBoundary(config, "2026-11-26T12:00:00"), "2026-11-27T00:01:00");
  assert.equal(campaignBoundary(config, "2026-11-27T00:00:30"), "2026-11-27T00:01:00");
  assert.equal(campaignBoundary(config, "2026-11-27T00:01:00"), "2026-11-30T23:52:00");
  assert.equal(campaignBoundary(config, "2026-11-30T23:52:00"), "2026-11-30T23:59:00");
  assert.equal(campaignBoundary(config, "2026-11-30T23:59:00"), null);
  const rulesOnly = configOf([BF([{ ruleId: "a", patch: { enabled: false } }])]);
  assert.equal(campaignBoundary(rulesOnly, "2026-11-26T12:00:00"), "2026-11-30T23:59:00", "no tier override: only the end (MVP 6)");
  const short = configOf([{ ...BF([tierOverride("g", [{ minQty: 2, percent: 20 }])]), window: { start: "2026-11-27T00:00:00", end: "2026-11-27T00:08:00" } }]);
  assert.equal(campaignBoundary(short, "2026-11-26T12:00:00"), "2026-11-27T00:08:00", "too short to switch the table");
});

test("storefront config: with the campaign shown `tiers` are the campaign's sets, `bt` the base and `tc` its id; otherwise neither key", () => {
  const config = configOf([BF([tierOverride("g", [{ minQty: 2, percent: 20 }])])]);
  const base = buildStorefrontConfig(config, { configVersion: "v" });
  assert.equal("bt" in base, false);
  assert.equal("tc" in base, false);
  assert.deepEqual(base.tiers.sets.g, { count: "line", breaks: [{ min: 2, pct: 10 }, { min: 5, pct: 15 }] });
  const shown = buildStorefrontConfig(config, { configVersion: "v", campaignId: "bf" });
  assert.deepEqual(shown.tiers.sets.g, { count: "line", breaks: [{ min: 2, pct: 20 }] });
  assert.deepEqual(shown.tiers.sets.s, base.tiers.sets.s);
  assert.deepEqual(shown.bt, base.tiers);
  assert.equal(shown.tc, "bf");
  for (const id of [null, "other"]) assert.deepEqual(buildStorefrontConfig(config, { configVersion: "v", campaignId: id }), base, String(id));
  const rulesOnly = configOf([BF([{ ruleId: "a", patch: { enabled: false } }])]);
  assert.equal("bt" in buildStorefrontConfig(rulesOnly, { configVersion: "v", campaignId: "bf" }), false, "a campaign without sets shows the base");
});

// --- L8: the admin draft -------------------------------------------------------------------------------

const NOW = "2026-10-04T10:00:00";
const draft = (over: Partial<CampaignDraft> = {}): CampaignDraft => ({ id: null, name: "Black Friday", start: WINDOW.start, end: WINDOW.end, overrides: [], ...over });

test("a draft with tier overrides only is valid and stores them as breaks patches", () => {
  const r = validateCampaignDraft(draft({ tiers: [{ setId: "g", breaks: [{ minQty: 2, percent: 20 }] }] }), configOf([]), { now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.campaign.overrides, [{ ruleId: "g", patch: { breaks: [{ minQty: 2, percent: 20 }] } }]);
});

test("draft errors of tier overrides: unknown set, less generous (quantity and currency), another kind, empty; none at all is `empty`", () => {
  const config = configOf([]);
  const errors = (tiers: CampaignDraft["tiers"]) => {
    const r = validateCampaignDraft(draft({ tiers }), config, { now: NOW });
    return r.ok ? [] : r.errors.map((e) => ({ field: e.field, key: e.key, params: e.params }));
  };
  assert.deepEqual(errors([{ setId: "nope", breaks: [{ minQty: 2, percent: 20 }] }]), [{ field: "tiers", key: "campaign.error.tierSet", params: undefined }]);
  assert.deepEqual(errors([{ setId: "g", breaks: [{ minQty: 2, percent: 12 }] }]), [{ field: "tiers", key: "campaign.error.tierLess", params: { set: "g", qty: 5, currency: "" } }]);
  assert.deepEqual(errors([{ setId: "s", breaks: [{ minQty: 3, amountOff: { CZK: 2000 } }] }]), [{ field: "tiers", key: "campaign.error.tierLess", params: { set: "s", qty: 3, currency: "EUR" } }]);
  assert.deepEqual(errors([{ setId: "g", breaks: [{ minQty: 2, amountOff: { CZK: 100 } }] }]), [{ field: "tiers", key: "campaign.error.tierKind", params: { set: "g" } }]);
  assert.deepEqual(errors([{ setId: "g", breaks: [] }]), [{ field: "tiers", key: "campaign.error.tierEmpty", params: { set: "g" } }]);
  assert.deepEqual(errors([]), [{ field: "overrides", key: "campaign.error.empty", params: undefined }]);
  assert.deepEqual(errors(undefined), [{ field: "overrides", key: "campaign.error.empty", params: undefined }]);
});

test("a draft's breaks go through the tier sanitizer: junk values never reach the stored campaign", () => {
  const r = validateCampaignDraft(
    draft({ tiers: [{ setId: "g", breaks: [{ minQty: 2, percent: 2000 }, { minQty: 5, percent: 1 }] as TierBreak[] }] }),
    configOf([]),
    { now: NOW },
  );
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.campaign.overrides[0]!.patch.breaks, [{ minQty: 2, percent: 100 }], "clamped to 100 %, the falling break dropped");
});
