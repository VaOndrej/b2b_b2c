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
import { emitForNode } from "@won/core/discounts/emit";
import { mapToFunctionOutput, roundingTiePossible } from "@won/core/discounts/function-output";
import { planCart } from "@won/core/discounts/plan";
import { describe, expect, test } from "vitest";

import { adaptInput } from "./reference-adapter.js";

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
};

/** `#[test] fn name()` in a Rust source file. */
function rustTests(file) {
  const source = readFileSync(path.join(EXT_DIR, file), "utf8");
  return [...source.matchAll(/#\[test\]\s*fn (\w+)\(\)/g)].map((m) => m[1]);
}

describe("TS twins of the Rust unit tests", () => {
  test("every Rust engine test has a twin here, and every twin a Rust test", () => {
    const rust = [...rustTests("src/engine/tests.rs"), "product_metafield_reads_like_the_ts_adapter_and_normalize_cart"];
    expect(rustTests("src/json.rs")).toContain("product_metafield_reads_like_the_ts_adapter_and_normalize_cart");
    expect(Object.keys(TWINS).sort()).toEqual([...rust].sort());
  });
  for (const [name, twin] of Object.entries(TWINS)) test(name, twin);
});
