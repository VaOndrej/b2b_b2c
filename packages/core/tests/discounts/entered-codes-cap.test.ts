// Only the first 25 entered codes count ([spec], MVP 2 audit round 5b): of the
// codes as entered (a cart can hold 250), the first MAX_ENTERED_CODES —
// trimmed, upper-cased, empty ones dropped, each once — are matched to rules.
// A later code is never matched: its outcome is `over_limit`, its rule (if any)
// does not see it, and its code node emits nothing. The cap counts entries, so
// repeats cannot stretch it. Explain says so once.

import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_ENTERED_CODES, normalizeCart } from "../../src/discounts/cart.ts";
import { emitForNode } from "../../src/discounts/emit.ts";
import { explainPlan } from "../../src/discounts/explain.ts";
import { planCart, MAX_ENTERED_CODES as PLAN_MAX_ENTERED_CODES } from "../../src/discounts/plan.ts";
import { cartOf, code, line, outcome, payloadOf, pct } from "./engine-fixtures.ts";

const foreign = (n: number, from = 0) => Array.from({ length: n }, (_, k) => `PARTNER${from + k}`);
const rules = [pct("vip", 20, code(["VIP"])), pct("late", 30, code(["LATE"]))];

test("the cap is 25, counted over the codes as entered (blanks and repeats included)", () => {
  assert.equal(MAX_ENTERED_CODES, 25);
  assert.equal(PLAN_MAX_ENTERED_CODES, 25);
  const cart = (codes: string[]) => normalizeCart(cartOf([line("L1", 100_00)], { enteredCodes: codes }));
  const mixed = cart([" vip ", "VIP", "   ", ...foreign(22), "LATE", "NEXT"]);
  assert.deepEqual(mixed.enteredCodes.slice(0, 2), ["VIP", "PARTNER0"]);
  assert.equal(mixed.enteredCodes.length, 25, "VIP, 22 partners, LATE, NEXT");
  assert.equal(mixed.consideredCodes, 23, "entries 1–25: VIP twice, a blank, 22 partners");
  assert.equal(cart(foreign(10)).consideredCodes, 10);
  assert.equal(cart(foreign(300)).consideredCodes, 25);
});

test("a code entered past the first 25 is never matched: its rule does not apply, its code node emits nothing, its outcome is over_limit", () => {
  const payload = payloadOf(rules);
  const lines = [line("L1", 1000_00, 1, ["vip", "late"])];
  const plan = planCart(cartOf(lines, { enteredCodes: ["vip", ...foreign(24), "late", ...foreign(200, 24)] }), payload);
  assert.equal(outcome(plan, "vip").state, "applied");
  assert.equal(outcome(plan, "late").state, "code_not_entered");
  assert.deepEqual(outcome(plan, "late").enteredCodes, []);
  const byCode = new Map(plan.codes.map((c) => [c.code, c]));
  assert.deepEqual(byCode.get("LATE"), { code: "LATE", ruleId: null, state: "over_limit" });
  assert.equal(byCode.get("PARTNER23")?.state, "unknown", "the 25th code counts (a foreign one)");
  assert.equal(byCode.get("PARTNER24")?.state, "over_limit");
  assert.equal(plan.codes.filter((c) => c.state === "over_limit").length, 201);
  assert.deepEqual(emitForNode(plan, { kind: "code", ruleId: "late" }, "LATE").productCandidates, []);
  assert.deepEqual(emitForNode(plan, { kind: "code", ruleId: "vip" }, "vip").productCandidates.map((c) => c.lineId), ["L1"]);
  // One entry fewer before it: LATE is the 25th and wins (30 % beats 20 %).
  const fewer = planCart(cartOf(lines, { enteredCodes: ["vip", ...foreign(23), "late"] }), payload);
  assert.equal(outcome(fewer, "late").state, "applied");
  assert.ok(fewer.codes.every((c) => c.state !== "over_limit"));
  // Repeats count as entries: 30× VIP, then LATE → LATE is past the cap.
  const repeats = planCart(cartOf(lines, { enteredCodes: [...Array.from({ length: 30 }, () => "VIP"), "LATE"] }), payload);
  assert.equal(outcome(repeats, "late").state, "code_not_entered");
  assert.equal(repeats.codes.find((c) => c.code === "LATE")?.state, "over_limit");
});

test("explain says it once, in Czech and English, and only when a code was over the limit", () => {
  const payload = payloadOf(rules);
  const lines = [line("L1", 1000_00, 1, ["vip", "late"])];
  const over = planCart(cartOf(lines, { enteredCodes: ["vip", ...foreign(40)] }), payload);
  const text = (plan: ReturnType<typeof planCart>, locale: "cs" | "en") => explainPlan(plan, locale).map((i) => i.text);
  const cs = text(over, "cs").filter((t) => t.includes("víc než"));
  assert.deepEqual(cs, ["Zadaných kódů je víc než 25, další se už nezapočítají."]);
  assert.deepEqual(text(over, "en").filter((t) => t.includes("More than")), ["More than 25 codes were entered; the rest aren't counted."]);
  assert.equal(explainPlan(over, "cs").find((i) => i.text.includes("víc než"))?.tone, "warning");
  const within = planCart(cartOf(lines, { enteredCodes: ["vip", ...foreign(24)] }), payload);
  assert.ok(!text(within, "cs").some((t) => t.includes("víc než 25")));
});
