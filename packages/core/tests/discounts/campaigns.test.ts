// MVP 6 (plan docs/plans/2026-10-02-won-discounts-mvp6.md): campaigns over time — status, the boundary the
// scheduler waits for (K4), the cart embed's campaign input from the LIVE shop config (K6), the admin draft
// validation (D3, A8 overlap), the payload's override filter (K2, D1) and the downgrade gate (K3, A6).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAMPAIGN_LIMITS,
  campaignBoundary,
  campaignInputFromShopConfig,
  campaignStatusAt,
  shopLocalToUtc,
  validateCampaignDraft,
  type CampaignDraft,
} from "../../src/discounts/campaigns.ts";
import { sanitizeConfig, type WonDiscountsConfig } from "../../src/discounts/config.ts";
import { buildNodeVars, buildShopFunctionConfig, buildShopFunctionConfigWorstCase, campaignInputFromVars } from "../../src/discounts/function-payload.ts";
import { gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { orderPct, pct } from "./engine-fixtures.ts";

const TZ = "Europe/Prague";
const OCT = { id: "oct", name: "Říjen", window: { start: "2026-10-10T00:00:00", end: "2026-10-12T00:00:00" }, overrides: [{ ruleId: "a", patch: { value: { kind: "percentage", percent: 30 } } }] };
const BF = { id: "bf", name: "Black Friday", window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:00" }, overrides: [{ ruleId: "a", patch: { enabled: true } }] };

function configOf(campaigns: unknown[], extra: Record<string, unknown> = {}): WonDiscountsConfig {
  const { config } = sanitizeConfig({
    modules: {
      codes: { rules: [pct("a", 10), orderPct("b", 5, { enabled: false })] },
      tiers: { sets: [{ id: "t", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10 }] }] },
      rewards: { gifts: [{ id: "g", threshold: { CZK: 100000 }, choices: ["gid://shopify/ProductVariant/1"] }], countOtherDiscounts: false },
      ...((extra.modules as object) ?? {}),
    },
    campaigns,
  });
  return config;
}

// --- status and boundary ------------------------------------------------------------------------------

test("status at a shop-local time: scheduled before, running from the start (inclusive) to the end (exclusive), ended after; killed wins", () => {
  const c = configOf([OCT]).campaigns[0]!;
  assert.equal(campaignStatusAt(c, "2026-10-09T23:59:59"), "scheduled");
  assert.equal(campaignStatusAt(c, "2026-10-10T00:00:00"), "running");
  assert.equal(campaignStatusAt(c, "2026-10-11T23:59:59"), "running");
  assert.equal(campaignStatusAt(c, "2026-10-12T00:00:00"), "ended");
  assert.equal(campaignStatusAt({ ...c, killed: true }, "2026-10-11T00:00:00"), "killed");
});

test("boundary (K4): the end of the selected campaign — the current one, else the next; none after the last", () => {
  const config = configOf([OCT, BF]);
  assert.equal(campaignBoundary(config, "2026-10-01T00:00:00"), "2026-10-12T00:00:00", "next = October: its end switches to BF");
  assert.equal(campaignBoundary(config, "2026-10-11T00:00:00"), "2026-10-12T00:00:00");
  assert.equal(campaignBoundary(config, "2026-10-12T00:00:00"), "2026-11-30T23:59:00");
  assert.equal(campaignBoundary(config, "2026-12-01T00:00:00"), null);
  assert.equal(campaignBoundary(configOf([{ ...OCT, killed: true }]), "2026-10-11T00:00:00"), null, "a killed campaign is never selected");
});

// --- the cart embed's campaign (K6) --------------------------------------------------------------

test("campaign input from the LIVE shop config = what a node with the selected campaign's vars gets", () => {
  const config = configOf([OCT]);
  for (const now of ["2026-10-01T00:00:00", "2026-10-10T00:00:00", "2026-10-11T12:00:00", "2026-10-12T00:00:00"]) {
    const live = JSON.parse(buildShopFunctionConfig(config, { now: "2026-10-01T00:00:00", shopTimezone: TZ }).json);
    const node = campaignInputFromVars(buildNodeVars({ kind: "automatic" }, config, "2026-10-01T00:00:00"), now);
    assert.deepEqual(campaignInputFromShopConfig(live, now), node, now);
  }
});

test("campaign input from a live config without a campaign (phase 1, none selected) or junk: no campaign", () => {
  const none = JSON.parse(buildShopFunctionConfig(configOf([]), { now: "2026-10-01T00:00:00", shopTimezone: TZ }).json);
  assert.deepEqual(campaignInputFromShopConfig(none, "2026-10-11T00:00:00"), { id: null, active: false, varsVersion: null });
  const phase1 = JSON.parse(buildShopFunctionConfig(configOf([OCT]), { now: "2026-10-11T00:00:00", shopTimezone: TZ, forceNoCampaign: true }).json);
  assert.deepEqual(campaignInputFromShopConfig(phase1, "2026-10-11T00:00:00"), { id: null, active: false, varsVersion: null });
  for (const junk of [null, 7, "x", { campaignId: "oct" }, { campaignId: "oct", campaignVarsVersion: "v", campaigns: [{ id: "oct", window: { start: 1 } }] }]) {
    assert.equal(campaignInputFromShopConfig(junk, "2026-10-11T00:00:00").active, false, JSON.stringify(junk));
  }
});

// --- payload: rule overrides only (K2, D1) ----------------------------------------------------------

test("the payload ships only overrides of discount rules: tier set and gift tier overrides never reach the function", () => {
  const config = configOf([
    {
      ...OCT,
      overrides: [
        { ruleId: "a", patch: { value: { kind: "percentage", percent: 30 } } },
        { ruleId: "t", patch: { breaks: [{ minQty: 2, percent: 50 }] } },
        { ruleId: "g", patch: { threshold: { CZK: 100 } } },
      ],
    },
  ]);
  assert.equal(config.campaigns[0]!.overrides.length, 3, "stored as saved");
  const payload = buildShopFunctionConfig(config, { now: "2026-10-11T00:00:00", shopTimezone: TZ }).payload;
  assert.deepEqual(payload.campaigns[0]!.overrides.map((o) => o.ruleId), ["a"]);
  const worst = buildShopFunctionConfigWorstCase(config);
  assert.deepEqual((JSON.parse(worst.json) as { campaigns: { overrides: { ruleId: string }[] }[] }).campaigns[0]!.overrides.map((o) => o.ruleId), ["a"]);
});

// --- downgrade (K3, A6) ----------------------------------------------------------------------------

test("Free keeps exactly the campaigns allowed to finish, until their end; any other is stripped and reported", () => {
  const config = configOf([OCT, BF]);
  const during = gateConfigForPlan(config, "free", { now: "2026-10-11T00:00:00", finishing: ["oct"] });
  assert.deepEqual(during.config.campaigns.map((c) => c.id), ["oct"]);
  assert.deepEqual(during.stripped.filter((s) => s.capability === "campaigns").map((s) => s.entityId), ["bf"]);
  const after = gateConfigForPlan(config, "free", { now: "2026-10-12T00:00:00", finishing: ["oct"] });
  assert.deepEqual(after.config.campaigns, [], "ended: nothing left to finish");
  assert.deepEqual(gateConfigForPlan(config, "free", { now: "2026-10-11T00:00:00" }).config.campaigns, [], "no list: strip all (MVP 1)");
  const killed = gateConfigForPlan(configOf([{ ...OCT, killed: true }]), "free", { now: "2026-10-11T00:00:00", finishing: ["oct"] });
  assert.deepEqual(killed.config.campaigns, [], "a killed campaign never comes back");
  assert.deepEqual(gateConfigForPlan(config, "pro", { now: "2026-10-11T00:00:00", finishing: [] }).config.campaigns.length, 2, "Pro unchanged");
});

// --- admin draft (D3, A8) --------------------------------------------------------------------------

const NOW = "2026-10-02T10:00:00";
const draft = (over: Partial<CampaignDraft> = {}): CampaignDraft => ({
  id: null,
  name: "Black Friday",
  start: "2026-11-27T00:00:00",
  end: "2026-11-30T23:59:00",
  overrides: [{ ruleId: "a", value: { kind: "percentage", percent: 30 } }, { ruleId: "b", enabled: true }],
  ...over,
});

test("a valid draft becomes a campaign: a new id, the overrides as patches (value, enabled)", () => {
  const r = validateCampaignDraft(draft(), configOf([OCT]), { now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  assert.match(r.campaign.id, /^[A-Za-z0-9_-]{1,64}$/);
  assert.deepEqual(r.campaign.overrides, [
    { ruleId: "a", patch: { value: { kind: "percentage", percent: 30 } } },
    { ruleId: "b", patch: { enabled: true } },
  ]);
  assert.equal(r.campaign.killed, false);
});

test("draft errors land on their fields: name, window order, too short or long, past start, overlap names the other, unknown rule, no override", () => {
  const config = configOf([OCT]);
  const keys = (d: CampaignDraft) => {
    const r = validateCampaignDraft(d, config, { now: NOW });
    return r.ok ? [] : r.errors.map((e) => `${e.field}:${e.key}`);
  };
  assert.deepEqual(keys(draft({ name: "  " })), ["name:campaign.error.name"]);
  assert.deepEqual(keys(draft({ start: "2026-11-30T00:00:00", end: "2026-11-27T00:00:00" })), ["end:campaign.error.order"]);
  assert.deepEqual(keys(draft({ start: "2026-10-01T00:00:00", end: "2026-10-03T00:00:00" })), ["start:campaign.error.past"]);
  assert.deepEqual(keys(draft({ start: "2026-10-02T10:00:00", end: "2026-10-02T10:04:00" })), ["end:campaign.error.tooSoon"]);
  assert.deepEqual(keys(draft({ start: "2026-11-01T00:00:00", end: "2027-03-01T00:00:00" })), ["end:campaign.error.tooLong"]);
  assert.deepEqual(keys(draft({ start: "2026-10-11T00:00:00", end: "2026-10-13T00:00:00" })), ["start:campaign.error.overlap"]);
  const overlap = validateCampaignDraft(draft({ start: "2026-10-11T00:00:00", end: "2026-10-13T00:00:00" }), config, { now: NOW });
  assert.ok(!overlap.ok && overlap.errors[0]!.params?.other === "Říjen", "names the other campaign");
  assert.deepEqual(keys(draft({ overrides: [{ ruleId: "nope", enabled: true }] })), ["overrides:campaign.error.rule"]);
  assert.deepEqual(keys(draft({ overrides: [] })), ["overrides:campaign.error.empty"]);
  assert.deepEqual(keys(draft({ start: "bad", end: "2026-11-30T23:59:00" })), ["start:campaign.error.when"]);
  assert.equal(CAMPAIGN_LIMITS.maxDays, 92);
});

test("editing: a running campaign keeps its past start and may move its end; it never overlaps itself; a killed or ended one is not edited", () => {
  const config = configOf([OCT]);
  const running = validateCampaignDraft(draft({ id: "oct", name: "Říjen", start: OCT.window.start, end: "2026-10-13T00:00:00" }), config, { now: "2026-10-11T00:00:00" });
  assert.ok(running.ok, JSON.stringify(running));
  assert.equal(running.campaign.id, "oct");
  const ended = validateCampaignDraft(draft({ id: "oct", start: OCT.window.start, end: OCT.window.end }), config, { now: "2026-10-12T00:00:00" });
  assert.ok(!ended.ok && ended.errors[0]!.key === "campaign.error.notEditable");
  const killedConfig = configOf([{ ...OCT, killed: true }]);
  const killed = validateCampaignDraft(draft({ id: "oct", start: "2026-12-01T00:00:00", end: "2026-12-02T00:00:00" }), killedConfig, { now: NOW });
  assert.ok(!killed.ok && killed.errors[0]!.key === "campaign.error.notEditable");
});

test("a value override must suit the rule: percent 1–100 for a percentage rule, an amount per currency for a fixed one, none for free shipping", () => {
  const config = configOf([], { modules: { codes: { rules: [pct("a", 10), { id: "f", name: "F", method: "automatic", value: { kind: "fixed", amount: { CZK: 5000 } }, target: { kind: "order" } }, { id: "s", name: "S", method: "automatic", value: { kind: "freeShipping" }, target: { kind: "shipping" } }] } } });
  const bad = (ov: CampaignDraft["overrides"][number]) => {
    const r = validateCampaignDraft(draft({ overrides: [ov] }), config, { now: NOW });
    return r.ok ? "ok" : r.errors[0]!.key;
  };
  assert.equal(bad({ ruleId: "a", value: { kind: "percentage", percent: 0 } }), "campaign.error.value");
  assert.equal(bad({ ruleId: "a", value: { kind: "percentage", percent: 101 } }), "campaign.error.value");
  assert.equal(bad({ ruleId: "a", value: { kind: "fixed", amount: { CZK: 100 } } }), "campaign.error.value");
  assert.equal(bad({ ruleId: "f", value: { kind: "fixed", amount: { CZK: 9000 } } }), "ok");
  assert.equal(bad({ ruleId: "f", value: { kind: "fixed", amount: { CZK: 0 } } }), "campaign.error.value");
  assert.equal(bad({ ruleId: "s", value: { kind: "percentage", percent: 10 } }), "campaign.error.value");
  assert.equal(bad({ ruleId: "s", enabled: true }), "ok");
  assert.equal(bad({ ruleId: "a" }), "campaign.error.override", "neither a value nor enabled");
});

test("shop-local time → UTC through the shop's zone, DST included; an unknown zone throws", () => {
  assert.equal(shopLocalToUtc("2026-09-29T00:00:00", "Europe/Prague").toISOString(), "2026-09-28T22:00:00.000Z");
  assert.equal(shopLocalToUtc("2026-11-27T00:00:00", "Europe/Prague").toISOString(), "2026-11-26T23:00:00.000Z");
  assert.equal(shopLocalToUtc("2026-11-27T00:00:00", "America/New_York").toISOString(), "2026-11-27T05:00:00.000Z");
  assert.equal(shopLocalToUtc("2026-10-02T12:30:00", "UTC").toISOString(), "2026-10-02T12:30:00.000Z");
  // A wall time the clocks skip (02:30 on the spring-forward night) lands just after the gap.
  assert.equal(shopLocalToUtc("2027-03-28T02:30:00", "Europe/Prague").toISOString(), "2027-03-28T01:30:00.000Z");
  assert.throws(() => shopLocalToUtc("2026-10-02T12:30:00", "Mars/Olympus"));
});
