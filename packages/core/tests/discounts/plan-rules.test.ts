// Rule eligibility boundaries: minimum per currency, currency without a value,
// schedule at DAY granularity in shop time, codes, markets, segments, campaign
// overrides, precomputed targeting, robustness and determinism.

import assert from "node:assert/strict";
import { test } from "node:test";

import { planCart } from "../../src/discounts/plan.ts";
import { ruleRef } from "../../src/discounts/targeting.ts";
import {
  cartOf,
  code,
  fixed,
  freeShip,
  line,
  lineOf,
  orderFixed,
  orderPct,
  outcome,
  payloadOf,
  pct,
  winners,
} from "./engine-fixtures.ts";

// --- minimum per currency -------------------------------------------------------------------

test("minimum subtotal per currency: one minor unit short is below, the exact value applies", () => {
  const rules = [orderPct("O", 10, { minimum: { subtotal: { CZK: 1000_00 } } })];
  const short = planCart(cartOf([line("L1", 999_99)]), payloadOf(rules));
  assert.equal(short.order, null);
  assert.equal(outcome(short, "O").state, "below_minimum");
  assert.equal(outcome(short, "O").missing?.subtotal, 1);

  const exact = planCart(cartOf([line("L1", 1000_00)]), payloadOf(rules));
  assert.equal(exact.order?.amount, 100_00);
});

test("a minimum without a value in the cart currency takes the rule out of play (MKT-1)", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00)], { currency: "EUR" }),
    payloadOf([orderPct("O", 10, { minimum: { subtotal: { CZK: 1000_00 } } })]),
  );
  assert.equal(plan.order, null);
  assert.equal(outcome(plan, "O").state, "currency_missing");
});

test("an empty minimum map means no subtotal minimum", () => {
  const plan = planCart(cartOf([line("L1", 1_00)]), payloadOf([orderPct("O", 10, { minimum: { subtotal: {} } })]));
  assert.equal(outcome(plan, "O").state, "applied");
});

test("minimum quantity counts items, not lines", () => {
  const rules = [orderPct("O", 10, { minimum: { quantity: 3 } })];
  const below = planCart(cartOf([line("L1", 100_00, 2)]), payloadOf(rules));
  assert.equal(outcome(below, "O").state, "below_minimum");
  assert.equal(outcome(below, "O").missing?.quantity, 1);
  const ok = planCart(cartOf([line("L1", 100_00, 2), line("L2", 100_00, 1)]), payloadOf(rules));
  assert.equal(outcome(ok, "O").state, "applied");
});

test("a product rule's minimum counts only the lines it targets, before discounts, outlet included [spec]", () => {
  const rules = [pct("A", 10, { minimum: { subtotal: { CZK: 1000_00 } } }), pct("B", 50)];
  const plan = planCart(
    cartOf([
      line("L1", 600_00, 1, ["A", "B"]),
      line("L2", 400_00, 1, ["A"], { outlet: true }),
      line("L3", 5000_00),
    ]),
    payloadOf(rules),
  );
  // 600 + 400 (outlet counts, pre-discount even though B wins L1) = 1000 → A is eligible.
  assert.notEqual(outcome(plan, "A").state, "below_minimum");
  assert.deepEqual(winners(plan, "L1"), ["B"]);
  assert.equal(outcome(plan, "A").state, "outranked");
});

// --- currency without a value ------------------------------------------------------------------

test("a fixed amount without a value in the cart currency is not offered at all (never 0, never converted)", () => {
  const plan = planCart(
    cartOf([line("L1", 100_00, 1, ["F"])], { currency: "EUR" }),
    payloadOf([fixed("F", { CZK: 100_00 })]),
  );
  assert.equal(lineOf(plan, "L1").product, null);
  assert.equal(outcome(plan, "F").state, "currency_missing");

  const order = planCart(cartOf([line("L1", 100_00)], { currency: "EUR" }), payloadOf([orderFixed("O", { CZK: 1 })]));
  assert.equal(outcome(order, "O").state, "currency_missing");
});

test("free shipping with a minimum only applies in currencies that have a value", () => {
  const rules = [freeShip("S", { minimum: { subtotal: { CZK: 1500_00 } } })];
  const czk = planCart(cartOf([line("L1", 1500_00)]), payloadOf(rules));
  assert.equal(czk.shipping?.ruleId, "S");
  const eur = planCart(cartOf([line("L1", 1500_00)], { currency: "EUR" }), payloadOf(rules));
  assert.equal(eur.shipping, null);
  assert.equal(outcome(eur, "S").state, "currency_missing");
});

// --- schedule (day granularity, shop time) ------------------------------------------------------

const SCHEDULED = pct("A", 10, {
  schedule: { startsAt: "2026-11-27T18:00:00+01:00", endsAt: "2026-11-30T23:59:59+01:00" },
});

test("schedule is evaluated per shop-local DATE: start and end days are inclusive [spec]", () => {
  const at = (today: string) => outcome(planCart(cartOf([line("L1", 100_00, 1, ["A"])], { today }), payloadOf([SCHEDULED])), "A");
  assert.equal(at("2026-11-26").state, "not_started");
  assert.equal(at("2026-11-26").startsOn, "2026-11-27");
  assert.equal(at("2026-11-27").state, "applied", "a rule starting at 18:00 is live the whole start day");
  assert.equal(at("2026-11-30").state, "applied");
  assert.equal(at("2026-12-01").state, "ended");
  assert.equal(at("2026-12-01").endsOn, "2026-11-30");
});

test("an end exactly at midnight means the previous day was the last one", () => {
  const rule = pct("A", 10, { schedule: { endsAt: "2026-12-01T00:00:00+01:00" } });
  const plan = planCart(cartOf([line("L1", 100_00, 1, ["A"])], { today: "2026-12-01" }), payloadOf([rule]));
  assert.equal(outcome(plan, "A").state, "ended");
  assert.equal(outcome(plan, "A").endsOn, "2026-11-30");
});

test("the admin simulation passes `now`; the day is taken from it exactly as the function would", () => {
  const plan = planCart(
    cartOf([line("L1", 100_00, 1, ["A"])], { today: undefined, now: "2026-11-27T09:00:00" }),
    payloadOf([SCHEDULED]),
  );
  assert.equal(outcome(plan, "A").state, "applied");
});

test("a scheduled rule without any known date is never applied", () => {
  const plan = planCart(cartOf([line("L1", 100_00, 1, ["A"])], { today: undefined }), payloadOf([SCHEDULED]));
  assert.equal(outcome(plan, "A").state, "schedule_unknown");
});

// --- disabled, codes -----------------------------------------------------------------------------

test("a disabled rule never applies", () => {
  const plan = planCart(cartOf([line("L1", 100_00, 1, ["A"])]), payloadOf([pct("A", 10, { enabled: false })]));
  assert.equal(outcome(plan, "A").state, "disabled");
  assert.equal(lineOf(plan, "L1").product, null);
});

test("entered codes match case-insensitively and are reported per code", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00)], { enteredCodes: [" vip10 ", "NATIVE5"] }),
    payloadOf([orderPct("V", 10, code(["VIP10"]))]),
  );
  assert.equal(plan.order?.amount, 100_00);
  assert.deepEqual(
    plan.codes.map((c) => [c.code, c.ruleId, c.state]),
    [
      ["VIP10", "V", "applied"],
      ["NATIVE5", null, "unknown"],
    ],
  );
  assert.deepEqual(outcome(plan, "V").enteredCodes, ["VIP10"]);
});

test("two codes of the same rule: only the first entered one counts (one code per node, C2)", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00)], { enteredCodes: ["B", "A"] }),
    payloadOf([orderPct("V", 10, code(["A", "B"]))]),
  );
  assert.equal(plan.order?.amount, 100_00);
  assert.deepEqual(plan.codes.map((c) => [c.code, c.state]), [["B", "applied"], ["A", "same_rule"]]);
});

test("a code with no targeted line in the cart says so", () => {
  const plan = planCart(
    cartOf([line("L1", 1000_00)], { enteredCodes: ["BOTY"] }),
    payloadOf([pct("C", 10, code(["BOTY"]))]),
  );
  assert.equal(plan.codes[0].state, "no_target_lines");
});

// --- Pro targeting -------------------------------------------------------------------------------

test("Pro market targeting: only in listed markets; unknown market = not offered", () => {
  const rules = [orderPct("O", 10, { targeting: { markets: ["cz"] } })];
  const cz = planCart(cartOf([line("L1", 100_00)], { marketHandle: "cz" }), payloadOf(rules));
  assert.equal(outcome(cz, "O").state, "applied");
  const sk = planCart(cartOf([line("L1", 100_00)], { marketHandle: "sk" }), payloadOf(rules));
  assert.equal(outcome(sk, "O").state, "market");
  const unknown = planCart(cartOf([line("L1", 100_00)]), payloadOf(rules));
  assert.equal(outcome(unknown, "O").state, "market");
});

test("Pro segment targeting: only for customers in a listed segment", () => {
  const rules = [orderPct("O", 10, { targeting: { segments: ["vip"] } })];
  const vip = planCart(cartOf([line("L1", 100_00)], { customer: { segments: ["vip", "b2b"] } }), payloadOf(rules));
  assert.equal(outcome(vip, "O").state, "applied");
  const anon = planCart(cartOf([line("L1", 100_00)]), payloadOf(rules));
  assert.equal(outcome(anon, "O").state, "segment");
});

// --- precomputed targeting --------------------------------------------------------------------------

test("targeting comes only from line.ruleIds: product/collection rules skip lines without their id", () => {
  const plan = planCart(
    cartOf([line("L1", 100_00, 1, ["A"]), line("L2", 100_00)]),
    payloadOf([pct("A", 10, { target: { kind: "collections", ids: ["gid://shopify/Collection/1"] } })]),
  );
  assert.deepEqual(winners(plan, "L1"), ["A"]);
  assert.deepEqual(winners(plan, "L2"), []);
});

test("a variant-scoped rule reference applies to that variant only", () => {
  const ref = ruleRef("A", { variantId: "gid://shopify/ProductVariant/42" });
  const plan = planCart(
    cartOf([
      line("L1", 100_00, 1, [ref], { variantId: "gid://shopify/ProductVariant/42" }),
      line("L2", 100_00, 1, [ref], { variantId: "gid://shopify/ProductVariant/43" }),
    ]),
    payloadOf([pct("A", 10)]),
  );
  assert.deepEqual(winners(plan, "L1"), ["A"]);
  assert.deepEqual(winners(plan, "L2"), []);
});

// --- campaigns (C4 window + C7 varsVersion handshake) -------------------------------------------

const CAMPAIGN = {
  id: "bf",
  name: "Black Friday",
  window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:59" },
  overrides: [{ ruleId: "A", patch: { value: { kind: "percentage", percent: 30 } } }],
};

/** The node's campaign input when its variables match the shop config (what the sync writes). */
function matching(payload: ReturnType<typeof payloadOf>, active = true) {
  return { id: payload.campaignId, active, varsVersion: payload.campaignVarsVersion };
}

test("campaign overrides apply when the node's campaign + varsVersion match the shop config and the window is live", () => {
  const payload = payloadOf([pct("A", 10)], { campaigns: [CAMPAIGN] });
  assert.equal(payload.campaignId, "bf");
  const active = planCart(cartOf([line("L1", 1000_00, 1, ["A"])], { campaign: matching(payload) }), payload);
  assert.equal(lineOf(active, "L1").product?.amount, 300_00);
  assert.equal(active.campaignId, "bf");
});

test("an inactive window, a stale varsVersion or another campaign id: the plan has no campaign", () => {
  const payload = payloadOf([pct("A", 10)], { campaigns: [CAMPAIGN] });
  const cases = [
    matching(payload, false),
    { ...matching(payload), varsVersion: "v-stale" },
    { ...matching(payload), varsVersion: null },
    { ...matching(payload), id: "october" },
    { id: null, active: true, varsVersion: null },
    null,
  ];
  for (const campaign of cases) {
    const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"])], { campaign }), payload);
    assert.equal(lineOf(plan, "L1").product?.amount, 100_00, JSON.stringify(campaign));
    assert.equal(plan.campaignId, null);
  }
});

test("no campaign in the shop config: a node that still claims one plans without it", () => {
  const withCampaign = payloadOf([pct("A", 10)], { campaigns: [CAMPAIGN] });
  const without = payloadOf([pct("A", 10)]);
  assert.equal(without.campaignId, null);
  const plan = planCart(cartOf([line("L1", 1000_00, 1, ["A"])], { campaign: matching(withCampaign) }), without);
  assert.equal(lineOf(plan, "L1").product?.amount, 100_00);
});

test("a killed campaign never ships, so it never applies", () => {
  const payload = payloadOf([pct("A", 10)], { campaigns: [{ ...CAMPAIGN, killed: true }] });
  assert.equal(payload.campaignId, null);
  const plan = planCart(
    cartOf([line("L1", 1000_00, 1, ["A"])], { campaign: { id: "bf", active: true, varsVersion: null } }),
    payload,
  );
  assert.equal(lineOf(plan, "L1").product?.amount, 100_00);
  assert.equal(plan.campaignId, null);
});

test("a campaign that re-targets a rule uses the campaign-scoped references only while it applies", () => {
  const retarget = {
    ...CAMPAIGN,
    overrides: [{ ruleId: "A", patch: { target: { kind: "collections", ids: ["gid://shopify/Collection/9"] } } }],
  };
  const payload = payloadOf([pct("A", 10)], { campaigns: [retarget] });
  const lines = [line("L1", 100_00, 1, ["A"]), line("L2", 100_00, 1, [ruleRef("A", { campaignId: "bf" })])];
  const during = planCart(cartOf(lines, { campaign: matching(payload) }), payload);
  assert.deepEqual([winners(during, "L1"), winners(during, "L2")], [[], ["A"]]);
  const outside = planCart(cartOf(lines), payload);
  assert.deepEqual([winners(outside, "L1"), winners(outside, "L2")], [["A"], []]);
});

// --- robustness, determinism ------------------------------------------------------------------------

test("a missing or invalid shop config (null over 10 000 B, C7) is an empty plan with reason config_missing", () => {
  for (const bad of [null, undefined, "x", 42, [], {}, { modules: "nope" }, { modules: { codes: {} } }]) {
    const plan = planCart(cartOf([line("L1", 100_00, 1, ["A"])], { enteredCodes: ["X"] }), bad as never);
    assert.equal(plan.reason, "config_missing", JSON.stringify(bad));
    assert.equal(lineOf(plan, "L1").product, null);
    assert.equal(plan.order, null);
    assert.equal(plan.shipping, null);
    assert.deepEqual(plan.rules, []);
  }
});

test("junk rules inside a valid config are skipped, the rest still plans", () => {
  const payload = payloadOf([pct("A", 10)]);
  (payload.modules.codes.rules as unknown[]).unshift(null, 1, { id: 5 }, { id: "Z", value: { kind: "bogus" } });
  const plan = planCart(cartOf([line("L1", 100_00, 1, ["A", "Z"])]), payload);
  assert.equal(plan.reason, undefined);
  assert.deepEqual(winners(plan, "L1"), ["A"]);
  assert.deepEqual(plan.rules.map((r) => r.ruleId), ["A"]);
});

test("an invalid cart never throws: empty plan with reason invalid_input", () => {
  const broken = planCart({ currency: "CZK", lines: "no" } as never, payloadOf([pct("A", 10)]));
  assert.deepEqual(broken.lines, []);
  assert.equal(broken.reason, undefined);
  const thrown = planCart(null as never, payloadOf([pct("A", 10)]));
  assert.equal(thrown.reason, "invalid_input");
  assert.equal(typeof thrown.error, "string");
});

test("lines with nonsense quantity or price are treated as zero, never negative", () => {
  const plan = planCart(
    cartOf([line("L1", -5, 2, ["A"]), line("L2", 100_00, Number.NaN, ["A"]), line("L3", 100_00, 1.7, ["A"])]),
    payloadOf([pct("A", 10)]),
  );
  assert.equal(lineOf(plan, "L1").subtotal, 0);
  assert.equal(lineOf(plan, "L2").subtotal, 0);
  assert.equal(lineOf(plan, "L3").quantity, 1);
  assert.ok(plan.lines.every((l) => (l.product?.amount ?? 0) <= l.subtotal));
});

test("the plan is deterministic and independent of rule order in the config", () => {
  const rules = [pct("A", 10), pct("B", 10, { priority: 2 }), fixed("F", { CZK: 30_00 }), orderPct("O", 5), freeShip("S")];
  const cart = cartOf([line("L1", 250_00, 2, ["A", "B", "F"]), line("L2", 90_00, 1, ["A", "F"])]);
  const one = planCart(cart, payloadOf(rules));
  const again = planCart(cart, payloadOf(rules));
  assert.deepEqual(again, one);
  const reversed = planCart(cart, payloadOf([...rules].reverse()));
  assert.deepEqual(reversed.lines, one.lines);
  assert.deepEqual(reversed.order, one.order);
  assert.deepEqual(reversed.shipping, one.shipping);
});

test("the plan carries the later-MVP slots empty (gifts, warnings, progress)", () => {
  const plan = planCart(cartOf([line("L1", 100_00)]), payloadOf([]));
  assert.deepEqual(plan.gifts, []);
  assert.deepEqual(plan.warnings, []);
  assert.deepEqual(plan.progress, {});
});
