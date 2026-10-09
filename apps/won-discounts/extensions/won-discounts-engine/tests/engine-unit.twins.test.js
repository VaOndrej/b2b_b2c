// The TS twins of the Rust unit tests (src/engine/tests.rs and the product
// metafield test in src/json.rs): each twin runs the same scenario through the
// TS engine (@won/core planCart + emitForNode, or the reference adapter) and
// asserts the SAME expected values as its Rust test. So every expectation the
// Rust unit tests make is also proven true of the reference, and a Rust test
// without a twin (or a twin without a Rust test) fails the pairing test below.
// When a Rust expectation changes, change its twin in the same commit.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCart } from "@won/core/discounts/cart";
import { codeHash } from "@won/core/discounts/code-hash";
import { CONFIG_LIMITS } from "@won/core/discounts/config";
import { emitForNode } from "@won/core/discounts/emit";
import { mapToFunctionOutput, roundingTiePossible } from "@won/core/discounts/function-output";
import { applyProductMargin, ceilTol, costMinorUnits, MARGIN_TOLERANCE, MAX_MARGIN_REFS, marginFloorUnit, readMarginPayload, resolveMargin, strictestMargin } from "@won/core/discounts/margin";
import { ENTERED_CODE_PADDING, MAX_ENTERED_CODES, planCart } from "@won/core/discounts/plan";
import { ORDER_SEARCH_EXACT_LINES, ORDER_SEARCH_NEAR, orderSetLimit, searchOrderSets } from "@won/core/discounts/plan-margin";
import { readTiersPayload } from "@won/core/discounts/tiers";
import { describe, expect, test } from "vitest";

import { adaptInput, decimalNumber } from "./reference-adapter.js";

const EXT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// --- Scenario helpers (the TS counterparts of the helpers in src/engine/tests.rs) --------------

const W = [codeHash("WELCOME15")];
const pct = (id, percent, more = {}) => ({ id, enabled: true, name: id, method: "automatic", value: { kind: "percentage", percent }, target: { kind: "products" }, ...more });
const code = (id, percent, hashes, more = {}) => pct(id, percent, { method: "code", codeHashes: hashes, ...more });
const cfg = (rules, extra = {}) => ({ modules: { codes: { rules } }, ...extra });
const line = (id, quantity, unitPrice, ruleIds, more = {}) => ({ id, variantId: "", productId: "", quantity, unitPrice, ruleIds, ...more });
const cart = (lines, enteredCodes = [], more = {}) => ({
  currency: "CZK",
  countryCode: "CZ",
  lines,
  enteredCodes,
  campaign: { id: null, active: false, varsVersion: null },
  today: "2026-10-01",
  locale: "cs",
  ...more,
});
/** [owner, value, amount] of a line's product stack, like `product_of` in tests.rs. */
const productOf = (plan, lineId) => {
  const p = plan.lines.find((l) => l.lineId === lineId)?.product;
  return p ? [p.ownerRuleId, p.value, p.amount] : null;
};
/** The rule's gate state; "applied"/"outranked"/… = eligible (None in Rust). */
const gated = (plan, id) => {
  const s = plan.rules.find((r) => r.ruleId === id)?.state;
  return ["applied", "combined", "outranked", "not_combinable", "zero_value"].includes(s) ? null : s;
};
const lineIds = (emission) => emission.productCandidates.map((c) => c.lineId);
const order = (id, value, more = {}) => ({ id, enabled: true, name: id, method: "automatic", value, target: { kind: "order" }, ...more });
/** A config with `modules.margin` = the compact payload (margin_rules in tests.rs). */
const mcfg = (rules, margin, extra = {}) => ({ modules: { codes: { rules }, margin }, ...extra });
/** A line with a cost price in CZK (cost_line in tests.rs). */
const costLine = (id, quantity, unitPrice, cost, ruleIds, more = {}) => line(id, quantity, unitPrice, ruleIds, { unitCost: cost, unitCostCurrency: "CZK", ...more });
/** A config with `modules.tiers` = the shop-config form of tiers.ts (tier_rules in tests.rs). */
const tcfg = (rules, tiers, extra = {}) => ({ modules: { codes: { rules }, tiers }, ...extra });
/** A line of product `productId` whose metafield has `tierRef` (undefined: none; tier_line in tests.rs). */
const tline = (id, quantity, unitPrice, productId, tierRef, more = {}) =>
  line(id, quantity, unitPrice, [], { productId, ...(tierRef === undefined ? {} : { tierRef }), ...more });
/** mulberry32, `below(n)` = next % n (`Mulberry` in tests.rs draws the same numbers). */
const mulberry = (seed) => {
  let a = seed >>> 0;
  return {
    below(n) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) % n;
    },
  };
};
/** `clustered_lines` in tests.rs: tied rate classes, lines near 0,2, ordinary lines and repeats. */
const clusteredLines = (r) => {
  const style = r.below(3);
  const n = style === 2 ? 1 + r.below(40) : 12 + r.below(40);
  const classes = Array.from({ length: 1 + r.below(style === 0 ? 2 : 4) }, () => {
    const h0 = 1 + r.below(50);
    return [h0, h0 + 1 + r.below(500), r.below(2) === 1];
  });
  const percent = [5, 20, 30, 50, 90][r.below(5)];
  const lines = [];
  for (let i = 0; i < n; i++) {
    const roll = r.below(10);
    const kind = style === 0 ? [0, 0, 0, 0, 0, 0, 0, 2, 3, 1][roll] : style === 1 ? [1, 1, 1, 1, 1, 1, 1, 0, 2, 3][roll] : [0, 0, 0, 1, 1, 2, 2, 2, 3, 3][roll];
    if (kind === 3 && lines.length > 0) {
      lines.push(lines[r.below(lines.length)]);
    } else if (kind === 0) {
      const [h0, x0, twice] = classes[r.below(classes.length)];
      const k = 1 + r.below(30);
      lines.push({ after: k * x0, before: twice ? 2 * k * x0 : k * x0, headroom: k * h0 });
    } else if (kind === 1) {
      const h = 2 ** 40 + r.below(2 ** 31);
      const a = 5 * h + 1 + r.below(2);
      lines.push({ after: a, before: a, headroom: h });
    } else {
      const a = 1 + r.below(100_000);
      const h = r.below(a);
      lines.push({ after: a, before: a + r.below(a), headroom: h });
    }
  }
  return { lines, percent };
};
const close = (actual, expected, eps) => {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(eps);
};
const autoLines = (plan, lineCount) =>
  mapToFunctionOutput(emitForNode(plan, { kind: "automatic" }, null), { plan, classes: ["PRODUCT", "ORDER"], lineCount });

// --- Twins, by the name of their Rust test --------------------------------------------------------

const TWINS = {
  welcome15_hash_is_code_hash_ts() {
    expect(codeHash("WELCOME15")).toBe("6a341c89");
  },

  per_line_the_better_discount_wins_never_a_sum() {
    const plan = planCart(cart([line("l1", 2, 10000, ["a", "b"]), line("l2", 1, 10000, ["a"])]), cfg([pct("a", 10), pct("b", 15)]));
    expect(productOf(plan, "l1")).toEqual(["b", { percent: 15 }, 3000]);
    expect(productOf(plan, "l2")).toEqual(["a", { percent: 10 }, 1000]);
  },

  ties_go_to_priority_then_id_never_config_order() {
    const lines = [line("l1", 1, 10000, ["zeta", "alpha"])];
    expect(productOf(planCart(cart(lines), cfg([pct("zeta", 10), pct("alpha", 10)])), "l1")[0]).toBe("alpha");
    expect(productOf(planCart(cart(lines), cfg([pct("zeta", 10, { priority: 5 }), pct("alpha", 10)])), "l1")[0]).toBe("zeta");
  },

  a_code_rule_needs_its_code_and_only_its_node_emits_it() {
    const c = cfg([pct("summer", 10), code("welcome", 15, W)]);
    const lines = [line("l1", 1, 10000, ["summer", "welcome"]), line("l2", 1, 10000, ["summer"])];
    const without = planCart(cart(lines), c);
    expect(gated(without, "welcome")).toBe("code_not_entered");
    expect(productOf(without, "l1")[0]).toBe("summer");
    const plan = planCart(cart(lines, [" welcome15 "]), c);
    expect(productOf(plan, "l1")[0]).toBe("welcome");
    expect(lineIds(emitForNode(plan, { kind: "automatic" }, null))).toEqual(["l2"]);
    const node = { kind: "code", ruleId: "welcome" };
    expect(lineIds(emitForNode(plan, node, "Welcome15"))).toEqual(["l1"]);
    expect(emitForNode(plan, node, "OTHER").productCandidates).toEqual([]);
    expect(emitForNode(plan, node, null).productCandidates).toEqual([]);
    expect(emitForNode(plan, { kind: "code", ruleId: "summer" }, "WELCOME15").productCandidates).toEqual([]);
    expect(emitForNode(plan, { kind: "code", ruleId: "nope" }, "WELCOME15").productCandidates).toEqual([]);
  },

  a_shared_code_hash_belongs_to_the_first_rule_listing_it() {
    const plan = planCart(cart([line("l1", 1, 10000, ["first", "second"])], ["WELCOME15"]), cfg([code("first", 5, W), code("second", 50, W)]));
    expect(gated(plan, "second")).toBe("code_not_entered");
    expect(productOf(plan, "l1")[0]).toBe("first");
  },

  outlet_lines_are_out_of_product_and_order_discounts() {
    const c = cfg([pct("a", 10), order("o", { kind: "percentage", percent: 10 })]);
    const plan = planCart(cart([line("l1", 1, 10000, ["a"]), line("l2", 1, 5000, ["a"], { outlet: true })]), c);
    expect(plan.lines[1].excluded).toBe("outlet");
    expect(plan.lines[1].product).toBeNull();
    expect([plan.order.base, plan.order.amount]).toEqual([9000, 900]);
    expect(plan.order.excludedLineIds).toEqual(["l2"]);
    const only = [line("l1", 1, 10000, ["a"], { outlet: true })];
    expect(gated(planCart(cart(only), c), "a")).toBe("outlet_only");
    const anything = planCart(cart(only), cfg([pct("a", 10)], { engine: { combination: { outletWithAnything: true } } }));
    expect(anything.lines[0].excluded).toBeNull();
    expect(productOf(anything, "l1")[2]).toBe(1000);
  },

  gift_lines_are_outside_every_discount_and_every_threshold() {
    const ship = { id: "s", enabled: true, name: "s", method: "automatic", value: { kind: "freeShipping" }, target: { kind: "shipping" }, minimum: { subtotal: { CZK: 20000 } } };
    const plan = planCart(cart([line("l1", 1, 10000, ["a"]), line("gift", 1, 50000, ["a"], { giftTierId: "t" })]), cfg([pct("a", 10), ship]));
    expect(plan.lines[1].excluded).toBe("gift");
    expect(plan.lines[1].product).toBeNull();
    expect(gated(plan, "s")).toBe("below_minimum");
  },

  the_minimum_is_the_whole_cart_outlet_included() {
    const c = cfg([pct("a", 10, { minimum: { subtotal: { CZK: 20000 }, quantity: 3 } })]);
    const plan = planCart(cart([line("l1", 1, 10000, ["a"]), line("l2", 2, 5000, [], { outlet: true })]), c);
    expect(gated(plan, "a")).toBeNull();
    expect(productOf(plan, "l1")[2]).toBe(1000);
    expect(gated(planCart(cart([line("l1", 2, 10000, ["a"])]), c), "a")).toBe("below_minimum");
  },

  a_currency_without_a_value_takes_the_rule_out_of_play() {
    const fixed = { id: "f", enabled: true, name: "f", method: "automatic", value: { kind: "fixed", amount: { EUR: 500 } }, target: { kind: "products" } };
    const plan = planCart(cart([line("l1", 1, 10000, ["f", "m"])]), cfg([fixed, pct("m", 10, { minimum: { subtotal: { EUR: 1000 } } })]));
    expect(gated(plan, "f")).toBe("currency_missing");
    expect(gated(plan, "m")).toBe("currency_missing");
    expect(plan.lines[0].product).toBeNull();
  },

  fixed_amounts_are_capped_per_item_and_at_the_order_base() {
    const f = { id: "f", enabled: true, name: "f", method: "automatic", value: { kind: "fixed", amount: { CZK: 5000 } }, target: { kind: "products" } };
    const o = order("o", { kind: "fixed", amount: { CZK: 1000000 } });
    const plan = planCart(cart([line("l1", 2, 3000, ["f"]), line("l2", 1, 8000, ["f"])]), cfg([f, o]));
    expect(productOf(plan, "l1")).toEqual(["f", { fixedPerItem: 3000 }, 6000]);
    expect(productOf(plan, "l2")).toEqual(["f", { fixedPerItem: 5000 }, 5000]);
    expect([plan.order.base, plan.order.value]).toEqual([3000, { fixedTotal: 3000 }]);
  },

  percentages_round_half_up_like_math_round() {
    const plan = planCart(cart([line("l1", 1, 1005, ["a"]), line("l2", 1, 1004, ["a"])]), cfg([pct("a", 10)]));
    expect(productOf(plan, "l1")[2]).toBe(101);
    expect(productOf(plan, "l2")[2]).toBe(100);
    const half = planCart(cart([line("l1", 3, 3333, ["a"])]), cfg([pct("a", 12.5)]));
    expect(productOf(half, "l1")).toEqual(["a", { percent: 12.5 }, 1250]);
  },

  exclusive_order_vs_products_better_scenario_wins_tie_keeps_products() {
    const off = { engine: { combination: { productWithOrder: false } } };
    const lines = [line("l1", 1, 10000, ["a"]), line("l2", 1, 10000, [])];
    const wins = planCart(cart(lines), cfg([pct("a", 10), order("o", { kind: "percentage", percent: 20 })], off));
    expect(wins.lines.every((l) => l.product === null)).toBe(true);
    expect(wins.order.amount).toBe(4000);
    const tie = planCart(cart(lines), cfg([pct("a", 10), order("o", { kind: "percentage", percent: 5 })], off));
    expect(tie.order).toBeNull();
    expect(productOf(tie, "l1")[2]).toBe(1000);
  },

  shipping_percent_beats_fixed_and_the_switches_can_block_it() {
    const ship = (id, value) => ({ id, enabled: true, name: id, method: "automatic", value, target: { kind: "shipping" } });
    const free = ship("free", { kind: "freeShipping" });
    const fixed = ship("fixed", { kind: "fixed", amount: { CZK: 999900 } });
    const half = ship("half", { kind: "percentage", percent: 50 });
    const lines = [line("l1", 1, 10000, ["a"])];
    const plan = planCart(cart(lines), cfg([fixed, half, free, pct("a", 10)]));
    expect([plan.shipping.ruleId, plan.shipping.value]).toEqual(["free", { percent: 100 }]);
    expect(planCart(cart(lines), cfg([fixed, pct("a", 10)])).shipping.value).toEqual({ fixedTotal: 999900 });
    const blocked = planCart(cart(lines), cfg([free, pct("a", 10)], { engine: { combination: { productWithShipping: false } } }));
    expect(blocked.shipping).toBeNull();
  },

  schedules_are_shop_local_days_end_inclusive_fail_closed() {
    const lines = [line("l1", 1, 10000, ["a"])];
    const run = (schedule, today) => gated(planCart(cart(lines, [], { today }), cfg([pct("a", 10, { schedule })])), "a");
    expect(run({ startsOn: "2026-10-02" }, "2026-10-01")).toBe("not_started");
    expect(run({ startsOn: "2026-09-01", endsOn: "2026-10-01" }, "2026-10-01")).toBeNull();
    expect(run({ endsOn: "2026-09-30" }, "2026-10-01")).toBe("ended");
    expect(run({ startsOn: "2026-09-01" }, undefined)).toBe("schedule_unknown");
    expect(run({ invalid: true }, "2026-10-01")).toBe("schedule_unknown");
    expect(run({ startsOn: "2026-09-01T00:00:00+02:00" }, "2026-10-01")).toBe("schedule_unknown");
    expect(run({}, "2026-10-01")).toBe("schedule_unknown");
    expect(run(null, "2026-10-01")).toBeNull();
  },

  market_targeting_matches_the_cart_country() {
    const lines = [line("l1", 1, 10000, ["a"])];
    const c = cfg([pct("a", 10, { targeting: { markets: ["eu"] } })], { marketCountries: { eu: ["cz", "SK"] } });
    expect(gated(planCart(cart(lines), c), "a")).toBeNull();
    expect(gated(planCart(cart(lines, [], { countryCode: "DE" }), c), "a")).toBe("market");
    expect(gated(planCart(cart(lines, [], { countryCode: undefined }), c), "a")).toBe("market");
    expect(gated(planCart(cart(lines), cfg([pct("a", 10, { targeting: { segments: ["vip"] } })])), "a")).toBe("unsupported");
  },

  market_targeting_with_many_markets_resolves_the_cart_country_once() {
    const markets = Array.from({ length: 50 }, (_, m) => `"m${m}": ["A${m}", "B${m}", "C${m}", "D${m}", ${m === 49 ? '"cz"' : '"XX"'}]`);
    markets.push('"m3": ["DE"]');
    markets[3] = '"m3": ["CZ"]';
    const marketCountries = JSON.parse(`{${markets.join(", ")}}`);
    const all = Array.from({ length: 50 }, (_, m) => `m${m}`);
    const ids = ["all", "not_last", "last", "unknown_first", "dup", "none"];
    const lists = [all, all.slice(0, 49), all.slice(49), ["nope", "m49"], all.slice(3, 4), []];
    const c = cfg(
      ids.map((id, k) => pct(id, 10, { targeting: { markets: lists[k] } })),
      { marketCountries },
    );
    const lines = [line("l1", 1, 10000, ids)];
    expect(ids.map((id) => gated(planCart(cart(lines), c), id))).toEqual([null, "market", null, null, "market", null]);
    expect(ids.map((id) => gated(planCart(cart(lines, [], { countryCode: undefined }), c), id))).toEqual(["market", "market", "market", "market", "market", null]);
  },

  only_the_first_25_entered_codes_count() {
    expect(MAX_ENTERED_CODES).toBe(25);
    const c = cfg([
      code("a", 5, [codeHash("ALPHA")]),
      code("b", 6, [codeHash("BETA"), codeHash("STRASSE")]),
      code("c", 7, [codeHash("GAMMA"), "ABCDEF12", "123"]),
      code("d", 8, ["811c9dc5"]),
      code("e", 9, [codeHash("DELTA")]),
    ]);
    const foreign = Array.from({ length: 19 }, (_, k) => `X${k}ž`);
    const entered = [" alpha ", "Alpha", "   ", "straße", "BETA", ...foreign, "gamma\u00a0", "delta", "ALPHA"];
    entered.push(...Array.from({ length: 250 }, (_, k) => `Y${k}`));
    const lines = [line("l1", 1, 10000, ["a", "b", "c", "d", "e"])];
    const plan = planCart(cart(lines, entered), c);
    const codes = (p, id) => p.rules.find((r) => r.ruleId === id).enteredCodes;
    expect(codes(plan, "a")).toEqual(["ALPHA"]);
    expect(codes(plan, "b")).toEqual(["STRASSE", "BETA"]);
    expect(codes(plan, "c")).toEqual(["GAMMA"]);
    expect([codes(plan, "d"), codes(plan, "e")]).toEqual([[], []]);
    expect(gated(plan, "e")).toBe("code_not_entered");
    expect(emitForNode(plan, { kind: "code", ruleId: "e" }, "delta").productCandidates).toEqual([]);
    expect(lineIds(emitForNode(plan, { kind: "code", ruleId: "c" }, "GAMMA"))).toEqual(["l1"]);
    // (TS only: every code's outcome) DELTA and every later new code are over the limit; ALPHA again is the counted one.
    const outcome = (code) => plan.codes.find((x) => x.code === code);
    expect([outcome("DELTA").state, outcome("DELTA").ruleId, outcome("Y0").state, outcome("X18Ž").state, outcome("ALPHA").state]).toEqual(["over_limit", null, "over_limit", "unknown", "outranked"]);
    const fewer = planCart(cart(lines, entered.filter((x) => x !== foreign[18])), c);
    expect(codes(fewer, "e")).toEqual(["DELTA"]);
    expect(productOf(fewer, "l1")[0]).toBe("e");
    expect(lineIds(emitForNode(fewer, { kind: "code", ruleId: "e" }, "delta"))).toEqual(["l1"]);
    const repeats = planCart(cart(lines, [...Array.from({ length: 30 }, () => "ALPHA"), "DELTA"]), c);
    expect(codes(repeats, "e")).toEqual([]);
  },

  an_entered_code_longer_than_every_won_code_is_never_matched_but_counts() {
    expect(CONFIG_LIMITS.codeLength).toBe(64);
    const rulesList = [code("w", 10, [codeHash("WELCOME15")]), code("l", 20, [codeHash("WELCOME150")]), code("s", 15, [codeHash("STRASSE")])];
    const withLength = (len) => ({ modules: { codes: { rules: rulesList, ...len } } });
    const c = withLength({ maxCodeLength: 9 });
    const lines = [line("l1", 1, 10000, ["w", "l", "s"])];
    const entered = ["\u3000 welcome15\u00a0", "straße", "welcome150"];
    const plan = planCart(cart(lines, entered), c);
    const codes = (p, id) => p.rules.find((r) => r.ruleId === id).enteredCodes;
    expect([codes(plan, "w"), codes(plan, "s"), codes(plan, "l")]).toEqual([["WELCOME15"], ["STRASSE"], []]);
    expect(gated(plan, "l")).toBe("code_not_entered");
    expect(productOf(plan, "l1")[0]).toBe("s");
    expect(emitForNode(plan, { kind: "code", ruleId: "l" }, "welcome150").productCandidates).toEqual([]);
    expect(lineIds(emitForNode(plan, { kind: "code", ruleId: "s" }, "STRASSE"))).toEqual(["l1"]);
    for (const len of [{}, { maxCodeLength: "9" }, { maxCodeLength: 9.5 }, { maxCodeLength: -1 }, { maxCodeLength: 300 }]) {
      const p = planCart(cart(lines, entered), withLength(len));
      expect(codes(p, "l")).toEqual(["WELCOME150"]);
      expect(productOf(p, "l1")[0]).toBe("l");
    }
    const none = planCart(cart(lines, entered), withLength({ maxCodeLength: 0 }));
    expect(["w", "l", "s"].every((id) => codes(none, id).length === 0)).toBe(true);
    for (const filler of ["X".repeat(100), "", "   "]) {
      const many = [...Array.from({ length: 25 }, () => filler), "STRASSE"];
      expect(codes(planCart(cart(lines, many), c), "s")).toEqual([]);
      expect(codes(planCart(cart(lines, many.slice(1)), c), "s")).toEqual(["STRASSE"]);
    }
  },

  an_entered_code_padded_or_upper_cased_past_the_bound_is_never_matched_but_counts() {
    expect(ENTERED_CODE_PADDING).toBe(16);
    const rulesList = [code("w", 10, [codeHash("WELCOME15")]), code("s", 15, [codeHash("STRASSE")]), code("f", 12, [codeHash("FFIFFIFFI")]), code("g", 20, [codeHash("FFIFFIFFIFFI")])];
    const c = { modules: { codes: { rules: rulesList, maxCodeLength: 9 } } };
    const lines = [line("l1", 1, 10000, ["w", "s", "f", "g"])];
    const codesOf = (entered) => {
      const plan = planCart(cart(lines, entered), c);
      return ["w", "s", "f", "g"].map((id) => plan.rules.find((r) => r.ruleId === id).enteredCodes);
    };
    expect(codesOf([`${" ".repeat(8)}welcome15${"\u3000".repeat(8)}`])).toEqual([["WELCOME15"], [], [], []]);
    expect(codesOf([`${" ".repeat(8)}welcome15${"\u3000".repeat(9)}`])).toEqual([[], [], [], []]);
    expect(codesOf([`\t${"\ufeff".repeat(15)}WELCOME15`, `welcome15${"\n".repeat(17)}`])[0]).toEqual(["WELCOME15"]);
    expect(codesOf([`straße${"\u2000".repeat(19)}`])[1]).toEqual(["STRASSE"]);
    expect(codesOf([`straße${"\u2000".repeat(20)}`])[1]).toEqual([]);
    expect(codesOf(["ﬃﬃﬃ", "ﬃﬃﬃﬃ"])).toEqual([[], [], ["FFIFFIFFI"], []]);
    const plan = planCart(cart(lines, ["ﬃﬃﬃﬃ"]), c);
    expect(gated(plan, "g")).toBe("code_not_entered");
    expect(emitForNode(plan, { kind: "code", ruleId: "g" }, "ﬃﬃﬃﬃ").productCandidates).toEqual([]);
    for (const filler of [`W${" ".repeat(30)}`, "ßßßßß", "\u3000".repeat(26)]) {
      const many = [...Array.from({ length: 25 }, () => filler), "STRASSE"];
      expect(codesOf(many)[1]).toEqual([]);
      expect(codesOf(many.slice(1))[1]).toEqual(["STRASSE"]);
    }
  },

  a_pro_stack_sums_capped_and_is_owned_by_its_code_rule() {
    const c = cfg([pct("p7", 15, { combinesWith: { ruleIds: ["p8"] } }), pct("p8", 17), code("c", 12, W, { combinesWith: { ruleIds: ["p8"] } })]);
    const stack = planCart(cart([line("l1", 1, 10000, ["p7", "p8"])]), c).lines[0].product;
    expect([stack.amount, stack.value, stack.message]).toEqual([3200, { fixedTotal: 3200 }, "p8 + p7"]);
    const plan = planCart(cart([line("l1", 1, 10000, ["p8", "c"])], ["WELCOME15"]), c);
    expect(plan.lines[0].product.message).toBe("p8 + c");
    expect(plan.lines[0].product.ownerRuleId).toBe("c");
    expect(emitForNode(plan, { kind: "automatic" }, null).productCandidates).toEqual([]);
    expect(emitForNode(plan, { kind: "code", ruleId: "c" }, "welcome15").productCandidates).toHaveLength(1);
    const capped = planCart(cart([line("l1", 1, 10000, ["x", "y"])]), cfg([pct("x", 60, { combinesWith: { ruleIds: ["y"] } }), pct("y", 70)]));
    expect(capped.lines[0].product.amount).toBe(10000);
    expect(capped.lines[0].product.components.map((c2) => c2.amount)).toEqual([7000, 3000]);
  },

  a_pro_stack_is_searched_among_the_six_best_ranked_candidates_only() {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const meshLink = (list, k) => ({ combinesWith: { ruleIds: list.slice(k + 1) } });
    const c = cfg(ids.map((id, k) => pct(id, 10 - k, meshLink(ids, k))));
    const plan = planCart(cart([line("l1", 1, 100000, ids)]), c);
    const stack = plan.lines[0].product;
    expect(stack.components.map((c2) => [c2.ruleId, c2.amount])).toEqual([["a", 10000], ["b", 9000], ["c", 8000], ["d", 7000], ["e", 6000], ["f", 5000]]);
    expect([stack.amount, stack.value, stack.message]).toEqual([45000, { fixedTotal: 45000 }, "a + b + c + d + e + f"]);
    expect(planCart(cart([line("l1", 1, 100000, ids.slice(0, 6))]), c).lines[0].product.components).toHaveLength(6);
    const partner = cfg([pct("a", 10, { combinesWith: { ruleIds: ["g"] } }), pct("b", 9), pct("c", 8), pct("d", 7), pct("e", 6), pct("f", 5), pct("g", 4)]);
    const capped = planCart(cart([line("l1", 1, 100000, ids.slice(0, 7)), line("l2", 1, 100000, ["a", "b", "g"])]), partner);
    expect(productOf(capped, "l1")).toEqual(["a", { percent: 10 }, 10000]);
    expect(productOf(capped, "l2")).toEqual(["a", { fixedTotal: 14000 }, 14000]);
    const orders = cfg(ids.slice(0, 7).map((id, k) => order(id, { kind: "percentage", percent: 7 - k }, meshLink(ids.slice(0, 7), k))));
    const withOrder = planCart(cart([line("l1", 1, 100000, [])]), orders);
    expect([withOrder.order.amount, withOrder.order.value]).toEqual([27000, { fixedTotal: 27000 }]);
    expect(withOrder.order.components.map((c2) => c2.ruleId)).toEqual(["a", "b", "c", "d", "e", "f"]);
  },

  campaign_overrides_apply_only_for_the_matching_live_variables() {
    const c = cfg([pct("a", 10), pct("b", 20)], {
      campaignId: "bf",
      campaignVarsVersion: "v1",
      campaigns: [
        {
          id: "bf",
          overrides: [
            { ruleId: "a", patch: { value: { kind: "percentage", percent: 30 } } },
            { ruleId: "b", patch: { target: { kind: "products" } } },
          ],
        },
      ],
    });
    const lines = [line("l1", 1, 10000, ["a"]), line("l2", 1, 10000, ["b"]), line("l3", 1, 10000, ["b@bf"])];
    const run = (id, active, varsVersion) => {
      const plan = planCart(cart(lines, [], { campaign: { id, active, varsVersion } }), c);
      return [plan.campaignId, plan.lines.map((l) => l.product?.amount ?? 0)];
    };
    expect(run("bf", true, "v1")).toEqual(["bf", [3000, 0, 2000]]);
    expect(run("bf", true, "stale")).toEqual([null, [1000, 2000, 0]]);
    expect(run("bf", false, "v1")).toEqual([null, [1000, 2000, 0]]);
    expect(run("xx", true, "v1")).toEqual([null, [1000, 2000, 0]]);
  },

  junk_rules_are_skipped_one_by_one_and_ids_are_unique() {
    const plan = planCart(
      cart([line("l1", 1, 10000, ["a", "t"])]),
      cfg([
        { id: "a", value: { kind: "bogus" }, target: { kind: "products" } },
        pct("a", 10),
        pct("a", 50),
        { id: "t", enabled: true, value: { kind: "percentage", percent: 5 }, target: { kind: "shelf" } },
      ]),
    );
    expect(plan.rules.map((r) => r.ruleId)).toEqual(["a"]);
    expect(productOf(plan, "l1")[2]).toBe(1000);
  },

  a_missing_or_invalid_config_plans_nothing() {
    const lines = [line("l1", 1, 10000, ["a"])];
    const plan = planCart(cart(lines), null);
    expect(plan.reason).toBe("config_missing");
    expect(emitForNode(plan, { kind: "automatic" }, null)).toEqual({ productCandidates: [], orderCandidates: [], deliveryCandidates: [] });
    expect(planCart(cart(lines), /** @type {any} */ ({ percent: 9 })).reason).toBe("config_missing");
  },

  unnamed_rules_are_described_in_the_cart_language() {
    const u = { id: "u", enabled: true, method: "automatic", value: { kind: "percentage", percent: 12.5 }, target: { kind: "collections" } };
    const lines = [line("l1", 1, 10000, ["u"])];
    expect(planCart(cart(lines), cfg([u])).lines[0].product.message).toBe("12,5 % na vybrané kolekce");
    expect(planCart(cart(lines, [], { locale: "en" }), cfg([u])).lines[0].product.message).toBe("12.5% off selected collections");
  },

  an_entitled_minimum_counts_only_the_rules_own_lines() {
    const c = cfg([
      pct("a", 10, { minimum: { subtotal: { CZK: 100000 }, quantity: 3 } }),
      pct("e", 5, { minimum: { subtotal: { CZK: 100000 }, quantity: 3, scope: "entitled" } }),
    ]);
    const lines = [
      line("l1", 1, 60000, ["a", "e"]),
      line("l2", 1, 30000, []),
      line("l3", 1, 10000, ["a", "e"], { outlet: true }),
      line("g", 1, 90000, ["a", "e"], { giftTierId: "t" }),
    ];
    const plan = planCart(cart(lines), c);
    expect(gated(plan, "a")).toBeNull();
    expect(gated(plan, "e")).toBe("below_minimum");
    const enough = planCart(cart([line("l1", 3, 100000, ["e"]), line("l2", 1, 100, [])]), c);
    expect(gated(enough, "e")).toBeNull();
    expect(productOf(enough, "l1")).toEqual(["e", { percent: 5 }, 15000]);
  },

  money_over_the_cap_reads_as_the_cap() {
    const plan = planCart(cart([line("l1", 1, 5_000_000_000_000, [])]), cfg([order("o", { kind: "fixed", amount: { CZK: 9e18 } })]));
    expect(plan.order.value).toEqual({ fixedTotal: 1_000_000_000_000 });
  },

  a_rounding_tie_is_emitted_as_its_exact_amount() {
    expect(roundingTiePossible(1005, 10) && roundingTiePossible(2750, 1.4) && roundingTiePossible(9990, 15)).toBe(true);
    expect(roundingTiePossible(1004, 10) || roundingTiePossible(0, 50)).toBe(false);
    expect(roundingTiePossible(50_000_000, 10) || roundingTiePossible(10_000_000, 50) || roundingTiePossible(123_456_789, 10)).toBe(false);
    expect(roundingTiePossible(123_456_785, 10) && roundingTiePossible(5_000_000_005, 10)).toBe(true);
    expect(roundingTiePossible(3990, 10) || roundingTiePossible(1995, 20)).toBe(false);
    const c = cfg([pct("t", 10), pct("a", 10, { combinesWith: { ruleIds: ["b"] } }), pct("b", 5), order("o", { kind: "percentage", percent: 10 })]);
    const lines = [line("l1", 1, 1005, ["t"]), line("l2", 1, 1004, ["t"]), line("l3", 3, 3330, ["a", "b"]), line("l4", 1, 106, [])];
    const plan = planCart(cart(lines), c);
    const out = mapToFunctionOutput(emitForNode(plan, { kind: "automatic" }, null), { plan, classes: ["PRODUCT", "ORDER"], lineCount: lines.length });
    expect(JSON.stringify(out.lines)).toBe(
      [
        '{"operations":[{"productDiscountsAdd":{"candidates":[',
        '{"message":"t","targets":[{"cartLine":{"id":"l1"}}],"value":{"fixedAmount":{"amount":"1.01","appliesToEachItem":true}}},',
        '{"message":"t","targets":[{"cartLine":{"id":"l2"}}],"value":{"percentage":{"value":10}}},',
        '{"message":"a + b","targets":[{"cartLine":{"id":"l3"}}],"value":{"fixedAmount":{"amount":"14.99","appliesToEachItem":false}}}',
        '],"selectionStrategy":"ALL"}},{"orderDiscountsAdd":{"candidates":[',
        '{"message":"o","targets":[{"orderSubtotal":{"excludedCartLineIds":[]}}],"value":{"fixedAmount":{"amount":"10.41"}}}',
        '],"selectionStrategy":"FIRST"}}]}',
      ].join(""),
    );
  },

  a_fixed_shipping_amount_goes_to_the_first_delivery_group_only() {
    const json = (value) => {
      const plan = planCart(cart([line("l1", 1, 10000, [])]), cfg([{ id: "s", enabled: true, name: "s", method: "automatic", value, target: { kind: "shipping" } }]));
      const out = mapToFunctionOutput(emitForNode(plan, { kind: "automatic" }, null), {
        plan,
        classes: ["SHIPPING"],
        lineCount: 1,
        deliveryGroupIds: ["g1", "g2"],
      });
      return JSON.stringify(out.delivery);
    };
    expect(json({ kind: "fixed", amount: { CZK: 5000 } })).toBe(
      '{"operations":[{"deliveryDiscountsAdd":{"candidates":[{"message":"s","targets":[{"deliveryGroup":{"id":"g1"}}],"value":{"fixedAmount":{"amount":"50.00"}}}],"selectionStrategy":"ALL"}}]}',
    );
    expect(json({ kind: "freeShipping" })).toBe(
      '{"operations":[{"deliveryDiscountsAdd":{"candidates":[{"message":"s","targets":[{"deliveryGroup":{"id":"g1"}},{"deliveryGroup":{"id":"g2"}}],"value":{"percentage":{"value":100}}}],"selectionStrategy":"ALL"}}]}',
    );
  },

  over_the_budget_ties_go_back_to_a_percent_before_any_drop() {
    const name = `Deset ${"Velmi dlouhý název slevy ".repeat(8)}`;
    const c = cfg([{ id: "a", enabled: true, name, method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "products" } }]);
    const lines = Array.from({ length: 200 }, (_, i) => line(`l${i + 1}`, 1, 1005 + 10 * i, ["a"]));
    const plan = planCart(cart(lines), c);
    const out = mapToFunctionOutput(emitForNode(plan, { kind: "automatic" }, null), { plan, classes: ["PRODUCT", "ORDER"], lineCount: lines.length });
    const json = JSON.stringify(out.lines);
    expect(json.split('"message":').length - 1).toBe(1);
    expect(json.split('"cartLine":').length - 1).toBe(200);
    expect(json).toContain('"value":{"percentage":{"value":10}}');
  },

  // --- Margin protection (MVP 2) ---

  ceil_tol_ignores_float_noise_and_never_gives_negative_zero() {
    expect(MARGIN_TOLERANCE).toBe(1e-6);
    expect(ceilTol(7)).toBe(7);
    expect(ceilTol(7.000001)).toBe(7);
    expect(ceilTol(7.0000011)).toBe(8);
    expect(ceilTol(7.999999)).toBe(8);
    expect(ceilTol(0)).toBe(0);
    expect(Object.is(ceilTol(0.0000005), 0)).toBe(true);
    expect(1000 * (1 - 70 / 100) > 300).toBe(true);
    expect(ceilTol(1000 * (1 - 70 / 100))).toBe(300);
  },

  the_floor_is_the_cost_plus_the_minimum_margin_else_the_maximum_discount() {
    const cost = (c, m) => marginFloorUnit({ unitPrice: 100_000, costMinor: c, minMarginPercent: m, maxDiscountPercent: 50 });
    expect(cost(50_000, 0)).toEqual({ floorUnit: 50_000, basis: "cost" });
    expect(cost(50_000, 20).floorUnit).toBe(62_500);
    expect(cost(50_000, 95).floorUnit).toBe(1_000_000);
    expect(cost(50_000, 100).floorUnit).toBe(1_000_000);
    expect(cost(50_000, Number.NaN).floorUnit).toBe(50_000);
    expect(marginFloorUnit({ unitPrice: 10_000, costMinor: 15_000, minMarginPercent: 0, maxDiscountPercent: 50 }).floorUnit).toBe(15_000);
    const noCost = (price, p) => marginFloorUnit({ unitPrice: price, costMinor: null, minMarginPercent: 20, maxDiscountPercent: p });
    expect(noCost(999, 50)).toEqual({ floorUnit: 500, basis: "max_percent" });
    expect(noCost(999, 0).floorUnit).toBe(999);
    expect(noCost(999, 100).floorUnit).toBe(0);
    expect(noCost(1000, 70).floorUnit).toBe(300);
    expect(noCost(1000, Number.NaN).floorUnit).toBe(500);
    expect(marginFloorUnit({ unitPrice: 1000, costMinor: 0, minMarginPercent: 0, maxDiscountPercent: 40 }).basis).toBe("max_percent");
    expect(marginFloorUnit({ unitPrice: 100, costMinor: 1e12, minMarginPercent: 95, maxDiscountPercent: 50 }).floorUnit).toBe(1_000_000_000_000);
  },

  a_cost_is_known_only_in_the_shop_currency_and_converts_with_the_rate() {
    close(costMinorUnits(12.34, "CZK", undefined, "CZK", "CZK"), 1234, 1e-9);
    close(costMinorUnits(12.34, "CZK", 0.04, "CZK", "CZK"), 1234, 1e-6);
    expect(costMinorUnits(undefined, "CZK", 1, "CZK", "CZK")).toBeNull();
    expect(costMinorUnits(0, "CZK", 1, "CZK", "CZK")).toBeNull();
    expect(costMinorUnits(-5, "CZK", 1, "CZK", "CZK")).toBeNull();
    expect(costMinorUnits(10, "EUR", 1, "CZK", "CZK")).toBeNull();
    expect(costMinorUnits(10, undefined, 1, "CZK", "CZK")).toBeNull();
    expect(costMinorUnits(10, "CZK", 1, "CZK", undefined)).toBeNull();
    close(costMinorUnits(100, "CZK", 0.04, "EUR", "CZK"), 400, 1e-9);
    expect(costMinorUnits(100, "CZK", undefined, "EUR", "CZK")).toBeNull();
    expect(costMinorUnits(100, "CZK", 0, "EUR", "CZK")).toBeNull();
    expect(costMinorUnits(100, "CZK", -1, "EUR", "CZK")).toBeNull();
    expect(costMinorUnits(100, "CZK", Number.POSITIVE_INFINITY, "EUR", "CZK")).toBeNull();
    close(costMinorUnits(100, "CZK", 6.5, "JPY", "CZK"), 650, 1e-9);
    close(costMinorUnits(1.2345, "KWD", undefined, "KWD", "KWD"), 1234.5, 1e-6);
    expect(costMinorUnits(1e300, "CZK", 1e300, "EUR", "CZK")).toBe(1e12);
  },

  the_margin_payload_is_read_tolerantly_and_off_unless_exactly_on() {
    for (const off of [
      { enabled: false, max: 50 },
      { enabled: "true", max: 50 },
      { enabled: true },
      { enabled: true, max: "50" },
      { global: { maxDiscountPercent: 10 }, perCollection: [] },
      [{ enabled: true, max: 50 }],
      null,
    ]) {
      expect(readMarginPayload(off)).toEqual({ enabled: false });
    }
    const on = readMarginPayload({
      enabled: true,
      max: 140,
      min: -5,
      cur: "czk",
      col: { 1: [120, null], 2: [null, -1], 3: [5], 4: ["x", 5], 5: [null, null], 6: 7 },
    });
    expect(on).toEqual({ enabled: true, max: 100, min: 0, col: { 1: [95, null], 2: [null, 0], 5: [null, null] } });
    expect(readMarginPayload({ enabled: true, max: 30, min: "x", cur: "EUR" })).toEqual({ enabled: true, max: 30, cur: "EUR" });
  },

  a_products_own_setting_comes_before_its_collections_field_by_field() {
    const payload = readMarginPayload(
      JSON.parse('{"enabled": true, "min": 10, "max": 50, "cur": "CZK", "col": {"1": [20, 40]}, "prod": {"7": [5, null], "8": [null, 90], "9": [60, 10], "__proto__": [1, 1], "10": [1], "11": [200, 200]}}'),
    );
    expect(Object.keys(payload.prod).length).toBe(4);
    expect(payload.prod["7"]).toEqual([5, null]);
    expect(payload.prod["8"]).toEqual([null, 90]);
    expect(payload.prod["11"]).toEqual([95, 100]);
    expect(Object.hasOwn(payload.prod, "10")).toBe(false);
    const settings = (refs, product) => {
      const s = applyProductMargin(payload, resolveMargin(payload, refs), product);
      return [s.minMarginPercent, s.maxDiscountPercent];
    };
    expect(settings(["1"], "gid://shopify/Product/99")).toEqual([20, 40]);
    expect(settings(["1"], "gid://shopify/Product/7")).toEqual([5, 40]);
    expect(settings([], "8")).toEqual([10, 90]);
    expect(settings(["1"], "9")).toEqual([60, 10]);
    expect(settings(["1"], "")).toEqual([20, 40]);
    const bare = readMarginPayload({ enabled: true, max: 50 });
    expect(applyProductMargin(bare, resolveMargin(bare, []), "gid://shopify/Product/7").source).toBe("global");
  },
  a_product_takes_the_strictest_of_its_collections_settings() {
    const payload = readMarginPayload({ enabled: true, min: 10, max: 50, col: { 1: [30, null], 2: [null, 10], 3: [null, null] } });
    const settings = (refs) => {
      const s = resolveMargin(payload, refs);
      return [s.minMarginPercent, s.maxDiscountPercent, s.source === "collection"];
    };
    expect(settings([])).toEqual([10, 50, false]);
    expect(settings(["1"])).toEqual([30, 50, true]);
    expect(settings(["1", "2"])).toEqual([30, 10, true]);
    expect(settings(["2", "1"])).toEqual([30, 10, true]);
    expect(settings(["3"])).toEqual([10, 50, true]);
    expect(settings(["99"])).toEqual([10, 50, false]);
    const bare = readMarginPayload(JSON.parse('{"enabled": true, "max": 40, "col": {"__proto__": [90, 0], "7": [null, 5]}}'));
    const proto = resolveMargin(bare, ["__proto__"]);
    expect([proto.minMarginPercent, proto.maxDiscountPercent, proto.source === "collection"]).toEqual([0, 40, false]);
    const seven = resolveMargin(bare, ["7"]);
    expect([seven.minMarginPercent, seven.maxDiscountPercent, seven.source === "collection"]).toEqual([0, 5, true]);
    const texts = readMarginPayload(
      JSON.parse(
        '{"enabled": true, "max": 50, "col": {"007": [1, null], "7": [2, null], "0": [3, null], "7.0": [4, null], "18446744073709551616": [5, null], "18446744073709551615": [6, null], "abc": [7, null], "": [8, null]}}',
      ),
    );
    const minOf = (ref) => {
      const s = resolveMargin(texts, [ref]);
      return s.source === "collection" ? s.minMarginPercent : null;
    };
    const refs = ["007", "7", "0", "7.0", "18446744073709551616", "18446744073709551615", "abc", "", "00", "+7", " 7", "1844674407370955161"];
    expect(refs.map(minOf)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, null, null, null, null]);
  },

  margin_off_plans_exactly_like_mvp1() {
    const rules = [pct("a", 60), order("o", { kind: "percentage", percent: 30 })];
    const bare = [line("l1", 2, 100_000, ["a"]), line("l2", 1, 30_000, [])];
    const withCosts = bare.map((l) => ({ ...l, unitCost: 900, unitCostCurrency: "CZK", marginRefs: ["1"] }));
    const mvp1 = planCart(cart(bare), cfg(rules)).lines;
    for (const margin of [{ enabled: false }, { global: { maxDiscountPercent: 10 }, perCollection: [] }]) {
      const plan = planCart(cart(withCosts, [], { shopToCartRate: 1 }), mcfg(rules, margin));
      expect(plan.lines).toEqual(mvp1);
      expect([plan.order.amount, plan.order.base, plan.order.excludedLineIds.length]).toEqual([33_000, 110_000, 0]);
      expect(plan.order.value).toEqual({ percent: 30 });
    }
  },

  a_product_line_is_cut_to_its_headroom_and_emitted_as_that_exact_amount() {
    const f = { id: "f", enabled: true, name: "f", method: "automatic", value: { kind: "fixed", amount: { CZK: 30000 } }, target: { kind: "products" } };
    const c = mcfg([pct("a", 30), f], { enabled: true, min: 20, max: 50, cur: "CZK" });
    const lines = [costLine("l1", 1, 100_000, 700, ["a"]), line("l2", 2, 20_000, ["a"]), line("l3", 3, 50_000, ["f"]), costLine("l4", 1, 100_000, 1000, ["a"])];
    const plan = planCart(cart(lines), c);
    expect(productOf(plan, "l1")).toEqual(["a", { fixedTotal: 12_500 }, 12_500]);
    expect(Boolean(plan.lines[0].marginCapped)).toBe(true);
    expect(productOf(plan, "l2")).toEqual(["a", { percent: 30 }, 12_000]);
    expect(Boolean(plan.lines[1].marginCapped)).toBe(false);
    expect(productOf(plan, "l3")).toEqual(["f", { fixedTotal: 75_000 }, 75_000]);
    expect(productOf(plan, "l4")).toBeNull();
    expect(Boolean(plan.lines[3].marginCapped)).toBe(true);
    expect(JSON.stringify(autoLines(plan, lines.length).lines)).toBe(
      [
        '{"operations":[{"productDiscountsAdd":{"candidates":[',
        '{"message":"a","targets":[{"cartLine":{"id":"l1"}}],"value":{"fixedAmount":{"amount":"125.00","appliesToEachItem":true}}},',
        '{"message":"a","targets":[{"cartLine":{"id":"l2"}}],"value":{"percentage":{"value":30}}},',
        '{"message":"f","targets":[{"cartLine":{"id":"l3"}}],"value":{"fixedAmount":{"amount":"250.00","appliesToEachItem":true}}}',
        '],"selectionStrategy":"ALL"}}]}',
      ].join(""),
    );
    const stack = planCart(cart([line("l1", 1, 1005, ["x", "y"])]), mcfg([pct("x", 10, { combinesWith: { ruleIds: ["y"] } }), pct("y", 10)], { enabled: true, max: 20 }));
    expect(stack.lines[0].product.amount).toBe(201);
    expect(JSON.stringify(autoLines(stack, 1).lines)).toContain('"value":{"fixedAmount":{"amount":"2.01","appliesToEachItem":true}}');
  },

  a_cost_in_another_cart_currency_converts_with_the_rate_else_the_ceiling_applies() {
    const c = mcfg([pct("a", 60)], { enabled: true, min: 10, max: 30, cur: "CZK" });
    const run = (rate) => planCart(cart([costLine("l1", 1, 4000, 500, ["a"])], [], { currency: "EUR", shopToCartRate: rate }), c).lines[0].product?.amount ?? null;
    expect(run(0.04)).toBe(1777);
    expect(run(undefined)).toBe(1200);
    expect(run(0)).toBe(1200);
  },

  a_pro_stack_is_cut_in_rank_order_and_its_owner_recomputed() {
    const rules = [pct("a", 20, { combinesWith: { ruleIds: ["b"] } }), code("b", 10, W)];
    const lines = [line("l1", 1, 100_000, ["a", "b"])];
    const wide = planCart(cart(lines, ["WELCOME15"]), mcfg(rules, { enabled: true, max: 25 }));
    const stack = wide.lines[0].product;
    expect(stack.components.map((c2) => [c2.ruleId, c2.amount])).toEqual([["a", 20_000], ["b", 5_000]]);
    expect([stack.ownerRuleId, stack.value, stack.message]).toEqual(["b", { fixedTotal: 25_000 }, "a + b"]);
    const tight = planCart(cart(lines, ["WELCOME15"]), mcfg(rules, { enabled: true, max: 15 }));
    const cut = tight.lines[0].product;
    expect(cut.components.map((c2) => [c2.ruleId, c2.amount])).toEqual([["a", 15_000]]);
    expect([cut.ownerRuleId, cut.message]).toEqual(["a", "a"]);
    expect(emitForNode(tight, { kind: "automatic" }, null).productCandidates[0].amount).toBe(15_000);
    expect(emitForNode(tight, { kind: "code", ruleId: "b" }, "WELCOME15").productCandidates).toEqual([]);
  },

  the_order_discount_is_safe_on_both_allocation_bases_with_a_reserve() {
    const percent = (p) => ({ kind: "percentage", percent: p });
    const plan = planCart(cart([line("l1", 1, 100_000, ["a"]), line("l2", 1, 50_000, [])]), mcfg([pct("a", 50), order("o", percent(20))], { enabled: true, max: 60 }));
    expect(productOf(plan, "l1")[2]).toBe(50_000);
    expect([plan.order.amount, plan.order.value, plan.order.base]).toEqual([14_998, { fixedTotal: 14_998 }, 100_000]);
    expect(plan.order.excludedLineIds).toEqual([]);
    const one = planCart(cart([line("l1", 1, 100_000, [])]), mcfg([order("o", percent(30))], { enabled: true, max: 20 }));
    expect(one.order.value).toEqual({ fixedTotal: 19_999 });
    const same = planCart(
      cart([costLine("a", 1, 100_000, 49.99, ["p"]), costLine("b", 1, 10_000, 94.99, [])]),
      mcfg([pct("p", 90), order("o", percent(50))], { enabled: true, max: 100, cur: "CZK" }),
    );
    expect([same.order.amount, same.order.value, same.order.base]).toEqual([5000, { percent: 50 }, 10_000]);
    expect(same.order.excludedLineIds).toEqual(["b"]);
  },

  lines_at_their_floor_are_left_out_of_the_order_discount() {
    const percent = { kind: "percentage", percent: 10 };
    const margin = { enabled: true, max: 50, cur: "CZK" };
    const plan = planCart(cart([line("l1", 1, 100_000, []), costLine("l2", 1, 100_000, 1000, []), line("l3", 1, 50_000, [])]), mcfg([order("o", percent)], margin));
    expect([plan.order.amount, plan.order.value, plan.order.base]).toEqual([15_000, { percent: 10 }, 150_000]);
    expect(plan.order.excludedLineIds).toEqual(["l2"]);
    expect(emitForNode(plan, { kind: "automatic" }, null).orderCandidates[0].excludedLineIds).toEqual(["l2"]);
    const fixedOrder = mcfg([order("o", { kind: "fixed", amount: { CZK: 10000 } })], margin);
    const kept = planCart(cart([line("l1", 1, 100_000, []), costLine("l2", 1, 100_000, 1000, [])]), fixedOrder).order;
    expect([kept.value, kept.excludedLineIds]).toEqual([{ fixedTotal: 10_000 }, ["l2"]]);
    const larger = planCart(cart([line("l1", 1, 100_000, []), line("l2", 1, 20_000, [])]), fixedOrder).order;
    expect([larger.amount, larger.base, larger.excludedLineIds.length]).toEqual([10_000, 120_000, 0]);
    const ship = { id: "s", enabled: true, name: "s", method: "automatic", value: { kind: "freeShipping" }, target: { kind: "shipping" } };
    const floored = planCart(cart([costLine("l1", 1, 100_000, 1000, [])]), mcfg([order("o", percent), ship], margin));
    expect(floored.order).toBeNull();
    expect(floored.shipping.ruleId).toBe("s");
  },

  exclusive_mode_protects_the_order_only_scenario_too() {
    const off = { engine: { combination: { productWithOrder: false } } };
    const o = order("o", { kind: "percentage", percent: 30 });
    const lines = [line("l1", 1, 100_000, ["a"]), costLine("l2", 1, 100_000, 1000, [])];
    const plan = planCart(cart(lines), mcfg([pct("a", 5), o], { enabled: true, max: 10, cur: "CZK" }, off));
    expect([plan.order.amount, plan.order.value, plan.order.excludedLineIds]).toEqual([9_999, { fixedTotal: 9_999 }, ["l2"]]);
    expect(plan.lines.every((l) => l.product === null)).toBe(true);
    const products = planCart(cart(lines), mcfg([pct("a", 50), o], { enabled: true, max: 60, cur: "CZK" }, off));
    expect(products.order).toBeNull();
    expect(productOf(products, "l1")[2]).toBe(50_000);
  },

  campaign_overrides_apply_first_then_margin_protection() {
    const c = mcfg([pct("a", 10)], { enabled: true, max: 40 }, {
      campaignId: "bf",
      campaignVarsVersion: "v1",
      campaigns: [{ id: "bf", overrides: [{ ruleId: "a", patch: { value: { kind: "percentage", percent: 70 } } }] }],
    });
    const plan = planCart(cart([line("l1", 1, 100_000, ["a"])], [], { campaign: { id: "bf", active: true, varsVersion: "v1" } }), c);
    expect(plan.campaignId).toBe("bf");
    expect(productOf(plan, "l1")).toEqual(["a", { fixedTotal: 40_000 }, 40_000]);
  },

  a_capped_line_is_never_relaxed_over_the_output_budget() {
    const fix = { id: "fix", enabled: true, name: "9,99 Kč z kusu", method: "automatic", value: { kind: "fixed", amount: { CZK: 999 } }, target: { kind: "products" }, combinesWith: { ruleIds: ["ten"] } };
    const lines = Array.from({ length: 200 }, (_, i) => line(`L${i + 1}`, 1, 5000 + (i + 1) * 101, ["fix", "ten"]));
    const plan = planCart(cart(lines), mcfg([fix, pct("ten", 10)], { enabled: true, max: 20 }));
    const capped = new Set(plan.lines.filter((l) => l.marginCapped).map((l) => l.lineId));
    expect(capped.size > 20 && capped.size < 200).toBe(true);
    const out = autoLines(plan, lines.length);
    expect(out.bytes).toBeLessThanOrEqual(19_000);
    const candidates = out.lines.operations[0].productDiscountsAdd.candidates;
    let percents = 0;
    for (const c2 of candidates) {
      if (c2.targets.some((t) => capped.has(t.cartLine.id))) expect("fixedAmount" in c2.value).toBe(true);
      if ("percentage" in c2.value) percents += 1;
    }
    expect(percents).toBeGreaterThan(0);
  },

  order_search_groups_equal_keys_searches_both_orderings_and_the_better_d_wins() {
    const lines = [
      { after: 10_000, before: 100_000, headroom: 5_000 },
      { after: 10_000, before: 10_000, headroom: 500 },
    ];
    const fiftyPercent = (base) => Math.min(Math.round((base * 50) / 100), base);
    const { byBefore, byAfter, best } = searchOrderSets(lines, fiftyPercent);
    expect(byBefore).toEqual({ members: [0, 1], amount: 1_000, base: 20_000, wanted: 10_000 });
    expect(byAfter).toEqual({ members: [0], amount: 5_000, base: 10_000, wanted: 5_000 });
    expect(best).toBe(byAfter);
  },

  order_search_ties_go_to_the_larger_set_then_to_the_h_s_set() {
    const lines = [
      { after: 98, before: 140, headroom: 47 },
      { after: 30, before: 30, headroom: 3 },
      { after: 65, before: 130, headroom: 11 },
      { after: 40, before: 100, headroom: 10 },
    ];
    const larger = searchOrderSets(lines, (base) => Math.min(30, base));
    expect([larger.byBefore.members, larger.byBefore.amount]).toEqual([[0], 30]);
    expect([larger.byAfter.members, larger.byAfter.amount]).toEqual([[0, 2, 3], 30]);
    expect(larger.best).toBe(larger.byAfter);
    const tie = searchOrderSets(
      [
        { after: 10, before: 20, headroom: 9 },
        { after: 10, before: 10, headroom: 5 },
      ],
      (base) => (base === 10 ? 5 : 0),
    );
    expect(tie.byBefore).toEqual({ members: [1], amount: 5, base: 10, wanted: 5 });
    expect(tie.byAfter).toEqual({ members: [0], amount: 5, base: 10, wanted: 5 });
    expect(tie.best).toBe(tie.byBefore);
    // No product discounts (a = s): both orderings give the same set, the h/s one is kept.
    const plain = [
      { after: 1000, before: 1000, headroom: 400 },
      { after: 500, before: 500, headroom: 30 },
      { after: 800, before: 800, headroom: 30 },
    ];
    const same = searchOrderSets(plain, (base) => Math.min(Math.round((base * 10) / 100), base));
    expect(same.byAfter).toEqual(same.byBefore);
    expect(same.best).toBe(same.byBefore);
    expect(same.byBefore).toEqual({ members: [0], amount: 100, base: 1000, wanted: 100 });
  },

  a_product_listing_more_than_4_margin_refs_takes_the_strictest_setting_of_the_payload() {
    expect(MAX_MARGIN_REFS).toBe(4);
    const margin = { enabled: true, min: 10, max: 50, cur: "CZK", col: { 1: [20, null], 2: [null, 30], 3: [5, 80] } };
    const strictest = strictestMargin(readMarginPayload(margin));
    expect([strictest.minMarginPercent, strictest.maxDiscountPercent, strictest.source]).toEqual([20, 30, "collection"]);
    const withRefs = (l, refs) => ({ ...l, marginRefs: refs });
    const lines = [
      withRefs(line("one", 1, 100_000, ["a"]), ["3"]),
      withRefs(line("four", 1, 100_000, ["a"]), ["3", "3", "3", "3"]),
      withRefs(line("five", 1, 100_000, ["a"]), ["3", "3", "3", "3", "3"]),
      withRefs(line("pair", 1, 100_000, ["a"]), ["1", "2"]),
      line("none", 1, 100_000, ["a"]),
      withRefs(costLine("cost5", 1, 100_000, 400, ["a"]), ["3", "3", "3", "3", "3"]),
      withRefs(costLine("cost1", 1, 100_000, 400, ["a"]), ["3"]),
    ];
    const plan = planCart(cart(lines), mcfg([pct("a", 90)], margin));
    expect(["one", "four", "five", "pair", "none", "cost5", "cost1"].map((id) => productOf(plan, id)[2])).toEqual([80_000, 80_000, 30_000, 30_000, 50_000, 50_000, 57_894]);
    const global = planCart(cart([withRefs(line("six", 1, 100_000, ["a"]), ["1", "2", "3", "4", "5", "6"])]), mcfg([pct("a", 90)], { enabled: true, min: 10, max: 50, cur: "CZK" }));
    expect(productOf(global, "six")[2]).toBe(50_000);
    const loose = strictestMargin(readMarginPayload({ enabled: true, min: 10, max: 50, col: { 3: [5, 80] } }));
    expect([loose.minMarginPercent, loose.maxDiscountPercent, loose.source]).toEqual([10, 50, "global"]);
  },

  the_order_search_takes_a_bound_never_above_the_exact_minimum_over_16_lines_tied_for_it() {
    expect(ORDER_SEARCH_EXACT_LINES).toBe(16);
    expect(1 + ORDER_SEARCH_NEAR).toBe(1 + 2 ** -48);
    const thirty = (base) => Math.min(Math.round((base * 30) / 100), base);
    const tied = (n) => Array.from({ length: n }, (_, i) => ({ after: 100 * (i + 1), before: 100 * (i + 1), headroom: 10 * (i + 1) }));
    const all = (n) => Array.from({ length: n }, (_, i) => i);
    const sumsOf = (lines) => [lines.reduce((t, l) => t + l.after, 0), lines.reduce((t, l) => t + l.before, 0)];
    expect(searchOrderSets(tied(16), thirty).best).toEqual({ members: all(16), amount: 1_360, base: 13_600, wanted: 4_080 });
    expect(searchOrderSets(tied(17), thirty).best).toEqual({ members: all(17), amount: 1_529, base: 15_300, wanted: 4_590 });
    expect(orderSetLimit(tied(17), ...sumsOf(tied(17)))).toEqual({ limit: 1_529, bounded: true });
    expect(orderSetLimit(tied(16), ...sumsOf(tied(16)))).toEqual({ limit: 1_360, bounded: false });
    const equal = [...tied(16), { after: 100, before: 100, headroom: 10 }];
    expect(searchOrderSets(equal, thirty).best.amount).toBe(1_370);
    const apart = [...tied(16), { after: 1_000, before: 1_000, headroom: 200 }];
    expect(orderSetLimit(apart, ...sumsOf(apart)).limit).toBe(1_460);
    const config = mcfg([order("o", { kind: "percentage", percent: 30 })], { enabled: true, min: 0, max: 100, cur: "CZK" });
    const lines = Array.from({ length: 17 }, (_, i) => costLine(`l${i + 1}`, 1, 10_000 * (i + 1), 90 * (i + 1) - 0.01, []));
    const plan = planCart(cart(lines), config);
    expect([plan.order.amount, plan.order.value, plan.order.base]).toEqual([152_999, { fixedTotal: 152_999 }, 1_530_000]);
    expect(plan.order.excludedLineIds).toEqual([]);
    for (let k = 1; k <= 17; k++) {
      const [s, floor] = [10_000 * k, 9_000 * k - 1];
      expect(s - Math.ceil((152_999 * s) / 1_530_000)).toBeGreaterThanOrEqual(floor);
    }
    expect(planCart(cart(lines.slice(0, 16)), config).order.amount).toBe(136_000);
  },

  the_order_search_on_clustered_rates_is_its_declared_definition_and_the_ts_digest() {
    // The TS search on the same 5 000 line sets: the same digest of its answers.
    const r = mulberry(20260930);
    let digest = 2166136261;
    let [afterWins, bounded, lowered] = [0, 0, 0];
    const mix = (v) => {
      digest = Math.imul(digest ^ (((v % 4294967296) + 4294967296) % 4294967296), 16777619) >>> 0;
    };
    for (let c = 0; c < 5000; c++) {
      const { lines, percent } = clusteredLines(r);
      const search = searchOrderSets(lines, (base) => Math.min(Math.round((base * percent) / 100), base));
      const best = search.best;
      for (const v of [best.amount, best.base, best.wanted, best.members.length, ...best.members]) mix(v);
      if (best === search.byAfter) afterWins += 1;
      if (search.bounded) bounded += 1;
      if (best.members.length === 0) continue;
      const set = best.members.map((i) => lines[i]);
      const baseBefore = set.reduce((t, l) => t + l.before, 0);
      let exact = Number.POSITIVE_INFINITY;
      for (const l of set) exact = Math.min(exact, Math.floor((l.headroom * best.base) / l.after), Math.floor((l.headroom * baseBefore) / l.before));
      expect(best.amount).toBeLessThanOrEqual(exact);
      if (best.amount < exact && best.amount < best.wanted) lowered += 1;
    }
    expect([digest, afterWins, bounded, lowered]).toEqual([1_276_480_379, 7, 822, 203]);
  },

  the_order_limit_bound_is_never_above_any_lines_value() {
    const r = mulberry(4096);
    const SAFE_BELOW = 1 - 2 ** -44;
    const big = () => r.below(2 ** 23) * 2 ** 23 + r.below(2 ** 23) + 1;
    let [equal, below] = [0, 0];
    for (let c = 0; c < 200_000; c++) {
      const regime = r.below(4);
      const [h0, x0] = [1 + r.below(50), 51 + r.below(500)];
      const n = 1 + r.below(4);
      const set = [];
      for (let i = 0; i < n; i++) {
        if (regime === 0) {
          const x = 1 + r.below(2000);
          set.push([r.below(x + 1), x]);
        } else if (regime === 1) {
          const k = 1 + r.below(1000);
          set.push([k * h0, k * x0]);
        } else if (regime === 2) {
          const x = big();
          set.push([Math.floor(x / (1 + r.below(9))), x]);
        } else {
          const h = 2 ** 40 + r.below(2 ** 31);
          set.push([h, 5 * h + 1 + r.below(3)]);
        }
      }
      const total = regime === 1 ? x0 * (1 + r.below(2 ** 20)) : regime === 2 ? big() * 64 : Math.max(...set.map(([, x]) => x)) + r.below(2 ** 30);
      let m = Number.POSITIVE_INFINITY;
      for (const [h, x] of set) m = Math.min(m, h / x);
      const bound = Math.floor(total * m * SAFE_BELOW);
      let exact = Number.POSITIVE_INFINITY;
      for (const [h, x] of set) exact = Math.min(exact, Math.floor((h * total) / x));
      expect(bound <= exact).toBe(true);
      if (bound === exact) equal += 1;
      else below += 1;
    }
    expect([equal, below]).toEqual([96_065, 103_935]);
  },

  // src/json.rs: the variant metafield, the product's marginRefs and the rate (adapter + normalizeCart).
  the_variant_cost_the_margin_refs_and_the_rate_read_like_the_ts_adapter() {
    const read = (variantJson, productJson = { ruleIds: [] }, rate = "1.0") => {
      const input = {
        discount: { discountClasses: ["PRODUCT"], vars: { jsonValue: { role: "automatic" } } },
        shop: { config: null, localTime: { date: "2026-10-01", campaignActive: false } },
        presentmentCurrencyRate: rate,
        cart: {
          cost: { subtotalAmount: { currencyCode: "CZK" } },
          lines: [
            {
              id: "l1",
              quantity: 1,
              cost: { amountPerQuantity: { amount: "1.0" } },
              gift: null,
              merchandise: {
                __typename: "ProductVariant",
                id: "gid://shopify/ProductVariant/42",
                wonVariant: { jsonValue: variantJson },
                product: { wonProduct: { jsonValue: productJson } },
              },
            },
          ],
        },
      };
      const normalized = normalizeCart(adaptInput(input).cart);
      const l = normalized.lines[0];
      return { cost: [l.unitCost, l.unitCostCurrency], marginRefs: l.marginRefs, marginRefCount: l.marginRefCount, rate: normalized.shopToCartRate };
    };
    expect(read({ cost: 12.5, cur: "CZK" }).cost).toEqual([12.5, "CZK"]);
    expect(read({ cost: "5", cur: 7 }).cost).toEqual([null, null]);
    expect(read({ cost: 3, cur: "czk" }).cost).toEqual([3, "czk"]);
    expect(read({ cost: -3, cur: "czk" }).cost).toEqual([-3, null]);
    expect(read([1]).cost).toEqual([null, null]);
    expect(read(null).cost).toEqual([null, null]);
    expect(read(null, { ruleIds: ["a"], marginRefs: ["1", 2, "3"] }).marginRefs).toEqual(["1", "3"]);
    expect(read(null, { marginRefs: ["7"] }).marginRefs).toEqual(["7"]);
    expect(read(null, { marginRefs: "1" }).marginRefs).toEqual([]);
    expect(read(null, { ruleIds: ["a"] }).marginRefs).toEqual([]);
    // (entries, refs used): more than MAX_MARGIN_REFS entries, junk included → none used.
    const counted = (product) => {
      const r = read(null, product);
      return [r.marginRefCount, r.marginRefCount > MAX_MARGIN_REFS ? 0 : r.marginRefs.length];
    };
    expect(counted({ marginRefs: ["1", "2", "3", 4] })).toEqual([4, 3]);
    expect(counted({ marginRefs: ["1", "2", "3", "4", null] })).toEqual([5, 0]);
    expect(counted({ marginRefs: "12345" })).toEqual([0, 0]);
    expect(read(null, undefined, "0.04").rate).toBe(0.04);
    expect(read(null, undefined, " 25.1 ").rate).toBe(25.1);
    expect(read(null, undefined, 7).rate).toBe(7);
    expect(decimalNumber("0.3")).toBe(0.3);
    expect(decimalNumber("0.0405000")).toBe(0.0405);
    expect(decimalNumber("000123.4500")).toBe(123.45);
    expect(decimalNumber("123456789012345")).toBe(123_456_789_012_345);
    expect(decimalNumber("0.0000000000000000000001")).toBe(1e-22);
    for (const junk of ["1e3", "-1", "", "0x10", "1.", ".5", true, null]) {
      expect(read(null, undefined, junk).rate).toBeNull();
      expect(decimalNumber(junk)).toBeUndefined();
    }
    expect(decimalNumber("0.000")).toBe(0);
    expect(decimalNumber("0.0400000000000000012345")).toBe(0.04);
    expect(decimalNumber("0.12345678901234567")).toBe(0.123456789012345);
    expect(decimalNumber("25.123456789012345678")).toBe(25.1234567890123);
    expect(decimalNumber("1234567890123456")).toBe(1_234_567_890_123_450);
    expect(decimalNumber("12345678901234567890123")).toBe(12_345_678_901_234_500_000_000);
    expect(decimalNumber("0.00000000000000000000001")).toBeUndefined();
    expect(decimalNumber(`1${"0".repeat(40)}`)).toBeUndefined();
  },

  // src/json.rs: the product metafield read (adapter + normalizeCart).
  product_metafield_reads_like_the_ts_adapter_and_normalize_cart() {
    const V = "gid://shopify/ProductVariant/42";
    const read = (jsonValue) => {
      const input = {
        discount: { discountClasses: ["PRODUCT"], vars: { jsonValue: { role: "automatic" } } },
        shop: { config: null, localTime: { date: "2026-10-01", campaignActive: false } },
        cart: {
          cost: { subtotalAmount: { currencyCode: "CZK" } },
          lines: [
            {
              id: "l1",
              quantity: 1,
              cost: { amountPerQuantity: { amount: "1.0" } },
              gift: null,
              merchandise: { __typename: "ProductVariant", id: V, product: { wonProduct: { jsonValue } } },
            },
          ],
        },
      };
      const l = normalizeCart(adaptInput(input).cart).lines[0];
      return [l.ruleIds, l.outlet];
    };
    const array = Array.from({ length: 43 }, () => null);
    array[42] = ["arr"];
    expect(read({ ruleIds: ["a"], variantRuleIds: { 42: ["v"] } })).toEqual([["a", "v"], false]);
    expect(read({ variantRuleIds: { [V]: ["g"] } })).toEqual([["g"], false]);
    expect(read({ variantRuleIds: { 42: null, [V]: ["g"] } })).toEqual([[], false]);
    expect(read({ variantRuleIds: { 42: "x" } })).toEqual([[], false]);
    expect(read({ variantRuleIds: { 43: ["x"] } })).toEqual([[], false]);
    expect(read({ variantRuleIds: array })).toEqual([["arr"], false]);
    expect(read({ ruleIds: ["a"], outlet: true })).toEqual([["a"], true]);
    expect(read({ outlet: [V] })).toEqual([[], true]);
    expect(read({ outlet: ["gid://shopify/ProductVariant/43"] })).toEqual([[], false]);
    expect(read({ ruleIds: "x" })).toEqual([[], false]);
    expect(read([["a"]])).toEqual([[], false]);
    expect(read({ ruleIds: ["a", 1, null, "b"] })).toEqual([["a", "b"], false]);
    expect(read(null)).toEqual([[], false]);
  },

  // --- Quantity tiers (MVP 3) ---

  a_line_takes_the_highest_offered_break_its_count_reaches() {
    const c = tcfg([], { global: "g", sets: [["g", "line", [], [[3, 10], [5, 15]]]] });
    const lines = [tline("l2", 2, 10000, "P1"), tline("l3", 3, 10000, "P2"), tline("l4", 4, 10000, "P3"), tline("l5", 5, 10000, "P4")];
    const plan = planCart(cart(lines), c);
    expect(productOf(plan, "l2")).toBeNull();
    expect(productOf(plan, "l3")).toEqual(["tier:g", { percent: 10 }, 3000]);
    expect(productOf(plan, "l4")).toEqual(["tier:g", { percent: 10 }, 4000]);
    expect(productOf(plan, "l5")).toEqual(["tier:g", { percent: 15 }, 7500]);
    expect(plan.lines[1].product.message).toBe("Od 3 ks \u2212" + "10\u00a0%");
    expect(JSON.stringify(autoLines(plan, lines.length).lines)).toBe(
      [
        '{"operations":[{"productDiscountsAdd":{"candidates":[',
        '{"message":"Od 3 ks \u221210\u00a0%","targets":[{"cartLine":{"id":"l3"}},{"cartLine":{"id":"l4"}}],"value":{"percentage":{"value":10}}},',
        '{"message":"Od 5 ks \u221215\u00a0%","targets":[{"cartLine":{"id":"l5"}}],"value":{"percentage":{"value":15}}}',
        '],"selectionStrategy":"ALL"}}]}',
      ].join(""),
    );
    const en = planCart(cart(lines, [], { locale: "en" }), c);
    expect(en.lines.filter((l) => l.product).map((l) => l.product.message)).toEqual(["From 3 items \u221210%", "From 3 items \u221210%", "From 5 items \u221215%"]);
  },

  tiers_count_per_line_per_product_or_across_the_cart() {
    const c = tcfg([], {
      sets: [
        ["line_s", "line", [], [[3, 10]]],
        ["prod_s", "product", [], [[3, 10]]],
        ["cart_s", "cart", [], [[5, 20]]],
      ],
    });
    const plan = planCart(
      cart([
        tline("a1", 2, 10000, "P1", "prod_s"),
        tline("a2", 1, 10000, "P1", "prod_s"),
        tline("b1", 2, 10000, "P2", "prod_s"),
        tline("c1", 2, 10000, "P3", "line_s"),
        tline("c2", 1, 10000, "P3", "line_s"),
        tline("d1", 2, 10000, "P4", "cart_s"),
        tline("d2", 3, 10000, "P5", "cart_s"),
      ]),
      c,
    );
    expect(productOf(plan, "a1")).toEqual(["tier:prod_s", { percent: 10 }, 2000]);
    expect(productOf(plan, "a2")).toEqual(["tier:prod_s", { percent: 10 }, 1000]);
    expect(productOf(plan, "b1")).toBeNull();
    expect(productOf(plan, "c1")).toBeNull();
    expect(productOf(plan, "c2")).toBeNull();
    expect(productOf(plan, "d1")).toEqual(["tier:cart_s", { percent: 20 }, 4000]);
    expect(productOf(plan, "d2")).toEqual(["tier:cart_s", { percent: 20 }, 6000]);
  },

  a_lines_set_is_its_tier_ref_else_the_global_one_and_gifts_and_outlets_count_no_tier() {
    const tiers = { global: "g", sets: [["g", "cart", [], [[3, 10]]], ["s", "line", [], [[1, 5]]]] };
    const lines = [
      tline("l1", 1, 10000, "P1"),
      tline("l2", 1, 10000, "P2", "s"),
      tline("l3", 1, 10000, "P3", "missing"),
      tline("l4", 1, 10000, "P4", ""),
      tline("l5", 1, 10000, "P5", undefined, { giftTierId: "t1" }),
      tline("l6", 1, 10000, "P6", undefined, { outlet: true }),
      tline("l7", 1, 10000, "P7"),
    ];
    const plan = planCart(cart(lines), tcfg([], tiers));
    expect(productOf(plan, "l1")).toBeNull();
    expect(productOf(plan, "l7")).toBeNull();
    expect(productOf(plan, "l2")).toEqual(["tier:s", { percent: 5 }, 500]);
    expect(productOf(plan, "l3")).toBeNull();
    expect(productOf(plan, "l4")).toBeNull();
    expect(productOf(plan, "l5")).toBeNull();
    const outlets = planCart(cart(lines), tcfg([], tiers, { engine: { combination: { outletWithAnything: true } } }));
    for (const id of ["l1", "l6", "l7"]) expect(productOf(outlets, id)).toEqual(["tier:g", { percent: 10 }, 1000]);
    expect(productOf(outlets, "l5")).toBeNull();
  },

  an_amount_tier_is_per_item_in_the_cart_currency_and_capped_at_the_price() {
    const c = tcfg([], { global: "m", sets: [["m", "line", ["CZK", "EUR"], [[2, [5000, 200]], [5, [8000, null]]]]] });
    const lines = [tline("l1", 2, 10000, "P1"), tline("l2", 5, 6000, "P2")];
    const plan = planCart(cart(lines), c);
    expect(productOf(plan, "l1")).toEqual(["tier:m", { fixedPerItem: 5000 }, 10000]);
    expect(productOf(plan, "l2")).toEqual(["tier:m", { fixedPerItem: 6000 }, 30000]);
    expect(JSON.stringify(autoLines(plan, lines.length).lines)).toBe(
      [
        '{"operations":[{"productDiscountsAdd":{"candidates":[',
        '{"message":"Od 2 ks \u221250\u00a0Kč za kus","targets":[{"cartLine":{"id":"l1"}}],"value":{"fixedAmount":{"amount":"50.00","appliesToEachItem":true}}},',
        '{"message":"Od 5 ks \u221280\u00a0Kč za kus","targets":[{"cartLine":{"id":"l2"}}],"value":{"percentage":{"value":100}}}',
        '],"selectionStrategy":"ALL"}}]}',
      ].join(""),
    );
    const eur = planCart(cart([tline("l3", 5, 1000, "P3")], [], { currency: "EUR" }), c);
    expect(productOf(eur, "l3")).toEqual(["tier:m", { fixedPerItem: 200 }, 1000]);
    expect(eur.lines[0].product.message).toBe("Od 2 ks \u22122\u00a0€ za kus");
    expect(productOf(planCart(cart([tline("l3", 5, 1000, "P3")], [], { currency: "USD" }), c), "l3")).toBeNull();
  },

  a_tier_competes_with_rules_never_stacks_and_takes_no_place_in_the_stack_pool() {
    const tiers = (p) => ({ global: "g", sets: [["g", "line", [], [[1, p]]]] });
    const lines = [tline("l1", 1, 10000, "P1", undefined, { ruleIds: ["a"] }), tline("l2", 1, 10000, "P2", undefined, { ruleIds: ["z"] })];
    const plan = planCart(cart(lines), tcfg([pct("a", 10), pct("z", 10)], tiers(10)));
    expect(productOf(plan, "l1")[0]).toBe("a");
    expect(productOf(plan, "l2")[0]).toBe("tier:g");
    expect(productOf(planCart(cart(lines), tcfg([pct("a", 10), pct("z", 10, { priority: 1 })], tiers(10))), "l2")[0]).toBe("z");
    const stack = [pct("p", 15, { combinesWith: { ruleIds: ["q"] } }), pct("q", 10)];
    for (const [tier, owner, amount] of [[20, "p", 2500], [25, "tier:g", 2500], [30, "tier:g", 3000]]) {
      const got = productOf(planCart(cart([tline("l1", 1, 10000, "P1", undefined, { ruleIds: ["p", "q"] })]), tcfg(stack, tiers(tier))), "l1");
      expect([got[0], got[2]]).toEqual([owner, amount]);
    }
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const meshLink = (list, k) => ({ combinesWith: { ruleIds: list.slice(k + 1) } });
    const mesh = planCart(cart([tline("l1", 1, 100000, "P1", undefined, { ruleIds: ids })]), tcfg(ids.map((id, k) => pct(id, 10 - k, meshLink(ids, k))), tiers(11)));
    const s = mesh.lines[0].product;
    expect(s.components.map((c2) => c2.ruleId)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect([s.amount, s.message]).toEqual([45000, "a + b + c + d + e + f"]);
    const listed = planCart(cart([tline("l1", 1, 10000, "P1", undefined, { ruleIds: ["x"] })]), tcfg([pct("x", 5, { combinesWith: { ruleIds: ["tier:g", "g"] } })], tiers(10)));
    expect(productOf(listed, "l1")).toEqual(["tier:g", { percent: 10 }, 1000]);
  },

  margin_protection_caps_a_tier_and_only_the_automatic_node_emits_it() {
    const c = { modules: { codes: { rules: [code("c", 5, W)] }, margin: { enabled: true, min: 20, max: 50, cur: "CZK" }, tiers: { global: "g", sets: [["g", "line", [], [[1, 30]]]] } } };
    const lines = [costLine("l1", 1, 100_000, 700, [], { productId: "P1" }), tline("l2", 2, 20_000, "P2")];
    const plan = planCart(cart(lines, ["WELCOME15"]), c);
    expect(productOf(plan, "l1")).toEqual(["tier:g", { fixedTotal: 12_500 }, 12_500]);
    expect(Boolean(plan.lines[0].marginCapped)).toBe(true);
    expect(plan.lines[0].product.message).toBe("Množstevní sleva od 1 ks");
    expect(productOf(plan, "l2")).toEqual(["tier:g", { percent: 30 }, 12_000]);
    expect(lineIds(emitForNode(plan, { kind: "automatic" }, null))).toEqual(["l1", "l2"]);
    expect(emitForNode(plan, { kind: "code", ruleId: "c" }, "WELCOME15").productCandidates).toEqual([]);
    expect(emitForNode(plan, { kind: "code", ruleId: "tier:g" }, "WELCOME15").productCandidates).toEqual([]);
    expect(JSON.stringify(autoLines(plan, lines.length).lines)).toBe(
      [
        '{"operations":[{"productDiscountsAdd":{"candidates":[',
        '{"message":"Množstevní sleva od 1 ks","targets":[{"cartLine":{"id":"l1"}}],"value":{"fixedAmount":{"amount":"125.00","appliesToEachItem":true}}},',
        '{"message":"Od 1 ks \u221230\u00a0%","targets":[{"cartLine":{"id":"l2"}}],"value":{"percentage":{"value":30}}}',
        '],"selectionStrategy":"ALL"}}]}',
      ].join(""),
    );
  },

  a_rule_whose_id_is_a_tier_candidates_id_is_read_as_the_tier_like_plan_ts() {
    const tiers = { global: "g", sets: [["g", "line", [], [[5, 10]]]] };
    const orderRule = order("tier:g", { kind: "percentage", percent: 10 });
    const lines = [tline("l1", 1, 10000, "P1", undefined, { ruleIds: ["tier:g"] })];
    const plain = planCart(cart(lines), tcfg([orderRule, pct("tier:g", 20)], tiers));
    expect(productOf(plain, "l1")).toBeNull();
    expect(plain.order?.amount).toBe(1000);
    const margin = planCart(cart(lines), { modules: { codes: { rules: [orderRule] }, margin: { enabled: true, min: 0, max: 100 }, tiers } });
    expect(margin.order).toBeNull();
    const en = planCart(cart(lines, [], { locale: "en" }), { modules: { codes: { rules: [] }, margin: { enabled: true, max: 10 }, tiers: { global: "g", sets: [["g", "line", [], [[1, 30]]]] } } });
    expect(productOf(en, "l1")).toEqual(["tier:g", { fixedTotal: 1000 }, 1000]);
    expect(en.lines[0].product.message).toBe("Quantity discount from 1 item");
  },

  the_exclusive_switch_drops_a_tier_like_a_product_discount() {
    const tiers = { global: "g", sets: [["g", "cart", [], [[2, 10]]]] };
    const off = { engine: { combination: { productWithOrder: false } } };
    const lines = [tline("l1", 1, 10000, "P1"), tline("l2", 1, 10000, "P2")];
    const orderWins = planCart(cart(lines), tcfg([order("o", { kind: "percentage", percent: 20 })], tiers, off));
    expect(orderWins.lines.every((l) => l.product === null)).toBe(true);
    expect(orderWins.order.amount).toBe(4000);
    const tie = planCart(cart(lines), tcfg([order("o", { kind: "percentage", percent: 10 })], tiers, off));
    expect(tie.order).toBeNull();
    expect(productOf(tie, "l2")).toEqual(["tier:g", { percent: 10 }, 1000]);
  },

  a_live_campaigns_tier_sets_are_read_instead_of_the_base_ones() {
    const run = (campaigns, id, active, varsVersion) => {
      const c = tcfg([], { global: "g", sets: [["g", "line", [], [[2, 10]]]] }, { campaignId: "bf", campaignVarsVersion: "v1", campaigns });
      const plan = planCart(cart([tline("l1", 2, 10000, "P1")], [], { campaign: { id, active, varsVersion } }), c);
      return plan.lines.find((l) => l.lineId === "l1")?.product?.amount ?? null;
    };
    const withTiers = (more) => [{ id: "bf", overrides: [], ...more }];
    const twenty = withTiers({ tiers: { global: "g", sets: [["g", "line", [], [[2, 20]]]] } });
    expect(run(twenty, "bf", true, "v1")).toBe(4000);
    expect(run(twenty, "bf", true, "stale")).toBe(2000);
    expect(run(twenty, "bf", false, "v1")).toBe(2000);
    expect(run(twenty, "xx", true, "v1")).toBe(2000);
    expect(run(twenty, null, true, null)).toBe(2000);
    for (const junk of [{}, { tiers: null }, { tiers: [1] }, { tiers: "x" }]) expect(run(withTiers(junk), "bf", true, "v1")).toBe(2000);
    for (const broken of [{ tiers: {} }, { tiers: { sets: 7, global: "g" } }, { tiers: { sets: [["g", "line", [], [[2, 30]]]] } }]) {
      expect(run(withTiers(broken), "bf", true, "v1")).toBeNull();
    }
    const two = [
      { id: "bf", killed: true, tiers: { global: "g", sets: [["g", "line", [], [[2, 50]]]] } },
      { id: "bf", tiers: { global: "g", sets: [["g", "line", [], [[2, 30]]]] } },
      { id: "bf", tiers: { global: "g", sets: [["g", "line", [], [[2, 40]]]] } },
    ];
    expect(run(two, "bf", true, "v1")).toBe(6000);
  },
  the_tier_payload_is_read_tolerantly() {
    const tiers = {
      global: "g",
      sets: [
        ["g", "line", ["EUR", 5, "CZK", "EUR"], [[5, [1, 700, 800]], [2, 12.5], "x", [3], [2.9, 40], [0.5, 5], [7, "5"], [4, [-1, null, 300.7]], [9, [1e13, 1, 2e13, 5]], [3, 150], [6, -20]]],
        ["g", "cart", [], [[1, 50]]],
        ["h", "total", [], [[1, 50]]],
        [7, "line", [], []],
        ["", "line", [], []],
        "junk",
        ["p", "product"],
        ["c", "cart", "CZK", [[1, [100]]]],
      ],
    };
    const read = (raw, currency) => {
      const r = readTiersPayload(raw, currency);
      return [r.global, [...r.sets.values()].map((s) => [s.id, s.count, s.breaks.map((b) => [b.minQty, b.percent, b.amount, b.offered])])];
    };
    const expected = (g) => ["g", [["g", "line", g], ["p", "product", []], ["c", "cart", [[1, null, null, false]]]]];
    expect(read(tiers, "CZK")).toEqual(expected([[2, 12.5, null, true], [3, 100, null, true], [4, null, 300, true], [5, null, 800, true], [6, 0, null, true], [9, null, 1e12, true]]));
    expect(read(tiers, "EUR")).toEqual(expected([[2, 12.5, null, true], [3, 100, null, true], [4, null, null, false], [5, null, 1, true], [6, 0, null, true], [9, null, 1e12, true]]));
    const none = [[2, 12.5, null, true], [3, 100, null, true], [4, null, null, false], [5, null, null, false], [6, 0, null, true], [9, null, null, false]];
    expect(read(tiers, "USD")).toEqual(expected(none));
    expect(read(tiers, "")).toEqual(expected(none));
    expect(read({ global: "zzz", sets: [["a", "line", [], [[1, 5]]]] }, "CZK")[0]).toBeNull();
    for (const junk of [[], null, { sets: {} }, { global: "a" }, 7]) expect(read(junk, "CZK")).toEqual([null, []]);
  },

  the_tier_ref_reads_like_the_ts_adapter_and_normalize_cart() {
    const read = (jsonValue) => {
      const input = {
        discount: { discountClasses: ["PRODUCT"], vars: { jsonValue: { role: "automatic" } } },
        shop: { config: null, localTime: { date: "2026-10-01", campaignActive: false } },
        cart: {
          cost: { subtotalAmount: { currencyCode: "CZK" } },
          lines: [{ id: "l1", quantity: 1, cost: { amountPerQuantity: { amount: "1.0" } }, gift: null, merchandise: { __typename: "ProductVariant", id: "gid://shopify/ProductVariant/42", product: { id: "gid://shopify/Product/7", wonProduct: { jsonValue } } } }],
        },
      };
      return normalizeCart(adaptInput(input).cart).lines[0].tierRef;
    };
    expect(read({ ruleIds: ["a"], variantRuleIds: {}, tierRef: "t_1" })).toBe("t_1");
    expect(read({ ruleIds: ["a"], variantRuleIds: {} })).toBeNull();
    expect(read({ ruleIds: ["a"], tierRef: null })).toBeNull();
    expect(read({ tierRef: "" })).toBe("");
    for (const junk of [5, true, ["t_1"], { id: "t_1" }]) expect(read({ tierRef: junk })).toBe("");
    expect(read({ ruleIds: ["a"], marginRefs: ["1"], outlet: true, tierRef: "t_2" })).toBe("t_2");
    expect(read([["a"]])).toBeNull();
    expect(read(null)).toBeNull();
  },

  per_item_minimums_judge_each_item_on_its_own() {
    const lines = [
      line("a1", 2, 10000, ["r#1:3"]),
      line("a2", 1, 10000, ["r#1:3"]),
      line("b1", 1, 10000, ["r#2:4"]),
      line("c1", 2, 10000, ["r"]),
      line("x", 5, 10000, []),
    ];
    let plan = planCart(cart(lines), cfg([pct("r", 10)]));
    expect(productOf(plan, "a1")).toEqual(["r", { percent: 10 }, 2000]);
    expect(productOf(plan, "a2")).toEqual(["r", { percent: 10 }, 1000]);
    expect(productOf(plan, "b1")).toBeNull();
    expect(productOf(plan, "c1")).toEqual(["r", { percent: 10 }, 2000]);
    expect(gated(plan, "r")).toBeNull();
    plan = planCart(cart(lines), cfg([pct("r", 10, { minimum: { quantity: 12 } })]));
    expect(productOf(plan, "a1")[2]).toBe(2000);
    expect(productOf(plan, "c1")).toBeNull();
    expect(gated(plan, "r")).toBeNull();
    expect(productOf(planCart(cart(lines), cfg([pct("r", 10, { minimum: { quantity: 6, scope: "entitled" } })])), "c1")[2]).toBe(2000);
    plan = planCart(cart(lines), cfg([pct("r", 10, { minimum: { subtotal: { CZK: 200000 } } })]));
    expect(gated(plan, "r")).toBe("below_minimum");
    expect(productOf(plan, "a1")).toBeNull();
    const short = [line("a1", 2, 10000, ["r#1:3"]), line("c1", 1, 10000, ["r"])];
    expect(gated(planCart(cart(short), cfg([pct("r", 10, { minimum: { quantity: 5 } })])), "r")).toBe("below_minimum");
  },

  a_product_in_two_collections_qualifies_through_any_of_them() {
    const c = cfg([pct("r", 10), pct("o", 10, { target: { kind: "order" }, minimum: { quantity: 99 } })]);
    const both = ["r#1:5", "r#2:2"];
    const lines = [
      line("p1", 1, 10000, both),
      line("p2", 1, 10000, ["r#2:2"]),
      line("p3", 3, 10000, ["r#1:5"]),
      line("p4", 1, 10000, ["r", "r#1:5"]),
      line("g", 9, 10000, ["r#1:5"], { giftTierId: "g" }),
      line("o1", 1, 10000, ["r#1:5"], { outlet: true }),
    ];
    let plan = planCart(cart(lines), c);
    expect(["p1", "p2", "p3", "p4", "g", "o1"].map((id) => productOf(plan, id)?.[2] ?? null)).toEqual([1000, 1000, 3000, 1000, null, null]);
    plan = planCart(cart([line("p1", 1, 10000, both), line("p2", 1, 10000, ["r#2:2"]), line("p3", 3, 10000, ["r#1:5"])]), c);
    expect(productOf(plan, "p1")[2]).toBe(1000);
    expect(productOf(plan, "p3")).toBeNull();
    plan = planCart(cart([line("l", 1, 10000, ["r#", "r#1", "r#1:0", "r#1:x", "r#1:1234567", "o#1:1"])]), c);
    expect(gated(plan, "r")).toBe("no_target_lines");
    expect(gated(plan, "o")).toBe("below_minimum");
  },

  a_generated_batch_code_enters_its_rule_a_made_up_one_does_not() {
    const key = "fMMWc55qaEgjTq67";
    const hashes = [[key, "BF-"], 7, `${key}0=0bf-`, `${key}0=0BF-`];
    const c = cfg([pct("k", 10, { method: "code", codeHashes: hashes }), pct("a", 5)]);
    const lines = [line("l", 1, 100000, ["k", "a"])];
    const plan = planCart(cart(lines, ["  bf-kzg8e2navt\n"]), c);
    expect(productOf(plan, "l").filter((_, i) => i !== 1)).toEqual(["k", 10000]);
    const node = { kind: "code", ruleId: "k" };
    expect(lineIds(emitForNode(plan, node, "BF-KZG8E2NAVT"))).toEqual(["l"]);
    expect(emitForNode(plan, node, "BF-EHG852G9N8").productCandidates).toEqual([]);
    expect(plan.rules.find((r) => r.ruleId === "k").enteredCodes).toEqual(["BF-KZG8E2NAVT"]);
    for (const fake of ["BF-ANYTHING12", "BF-KZG8E2NAVU", "BF-KZG8E2NAV", "BF-KZG8E2NAVT2", "ＢF-KZG8E2NAVT", "BF-KZG8E2NAV\u017f"]) {
      const p = planCart(cart(lines, [fake]), c);
      expect(gated(p, "k"), fake).toBe("code_not_entered");
      expect(productOf(p, "l").filter((_, i) => i !== 1), fake).toEqual(["a", 5000]);
    }
    const typed = cfg([pct("k", 10, { method: "code", codeHashes: [...hashes, ...W] })]);
    expect(gated(planCart(cart(lines, ["welcome15"]), typed), "k")).toBeNull();
    expect(gated(planCart(cart(lines, ["BF-RPH79S627G"]), typed), "k")).toBeNull();
  },
};

/** `#[test] fn name()` in a Rust source file. */
function rustTests(file) {
  const source = readFileSync(path.join(EXT_DIR, file), "utf8");
  return [...source.matchAll(/#\[test\]\s*fn (\w+)\(\)/g)].map((m) => m[1]);
}

describe("TS twins of the Rust unit tests", () => {
  test("every Rust engine test has a twin here, and every twin a Rust test", () => {
    const fromJson = [
      "product_metafield_reads_like_the_ts_adapter_and_normalize_cart",
      "the_variant_cost_the_margin_refs_and_the_rate_read_like_the_ts_adapter",
      "the_tier_ref_reads_like_the_ts_adapter_and_normalize_cart",
    ];
    const rust = [...rustTests("src/engine/tests.rs"), ...fromJson];
    for (const name of fromJson) expect(rustTests("src/json.rs")).toContain(name);
    expect(Object.keys(TWINS).sort()).toEqual([...rust].sort());
  });
  for (const [name, twin] of Object.entries(TWINS)) test(name, twin);
});
