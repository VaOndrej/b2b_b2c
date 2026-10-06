// Generated code batches through the config: sanitizer → function payload (the
// measured bytes) → engine matching (plan.ts matchCodes) → plan gate →
// collision checks → describe.

import assert from "node:assert/strict";
import { test } from "node:test";

import { codeBatchCheckKey, generateBatchCodes } from "../../src/discounts/code-batch.ts";
import { codeHash } from "../../src/discounts/code-hash.ts";
import { CONFIG_LIMITS, sanitizeConfig, type CodeBatch } from "../../src/discounts/config.ts";
import { describeGeneratedCodes, describeRule } from "../../src/discounts/describe.ts";
import { emitForNode } from "../../src/discounts/emit.ts";
import { FUNCTION_CONFIG_BUDGET_BYTES } from "../../src/discounts/function-config.ts";
import { buildShopFunctionConfig, buildShopFunctionConfigWorstCase, findCodeBatchConflicts, findCodeHashCollisions } from "../../src/discounts/function-payload.ts";
import { explainGate, gateConfigForPlan } from "../../src/discounts/plan-gate.ts";
import { planCart } from "../../src/discounts/plan.ts";
import { cartOf, code, configOf, FIXTURE_NOW, FIXTURE_TZ, line, orderPct, outcome, payloadOf, pct } from "./engine-fixtures.ts";

const OPTS = { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ, shopCurrency: "CZK" };
const seedOf = (n: number) => n.toString(16).padStart(32, "0");
const batchOf = (n: number, extra: Partial<CodeBatch> = {}): CodeBatch => ({ id: `b${n}`, prefix: `B${String(n).padStart(3, "0")}-`, count: 100, seed: seedOf(n + 1), length: 10, alphabet: "both", ...extra });
const batchRule = (id: string, batches: unknown[], extra: Record<string, unknown> = {}) => pct(id, 10, { method: "code", codeBatches: batches, ...extra });

test("sanitizer: a valid batch is kept as it is; anything that would change its codes drops the batch whole", () => {
  const good = batchOf(1, { middle: "-", suffix: "X", removed: [3, 1, 1, 100, -1] });
  const { config, issues } = sanitizeConfig({
    modules: {
      codes: {
        rules: [
          batchRule("A", [
            good,
            { ...batchOf(2), prefix: " b002- " }, // trimmed, upper-cased: the same prefix
            { ...batchOf(3), seed: "XYZ" },
            { ...batchOf(4), prefix: "B" },
            { ...batchOf(5), alphabet: "hex" },
            { ...batchOf(6), length: 8 }, // too short for 100 codes
            { ...batchOf(7), count: 0 },
            { ...batchOf(8), suffix: "a b" },
            { ...batchOf(9), id: "b1" }, // a repeated id
            "junk",
          ]),
          batchRule("B", [{ ...batchOf(10), count: 5000 }, { ...batchOf(11), prefix: "B001-VIP" }, { ...batchOf(12), prefix: "B0" }]),
          pct("C", 10, { codeBatches: [batchOf(13)] }), // an automatic rule keeps its batches (off ≠ erased)
        ],
      },
    },
  });
  const [a, b, c] = config.modules.codes.rules;
  assert.deepEqual(a.codeBatches, [{ ...good, removed: [1, 3] }, batchOf(2)]);
  assert.deepEqual(b.codeBatches, [{ ...batchOf(10), count: CONFIG_LIMITS.codeBatchSize }]);
  assert.deepEqual(c.codeBatches, [batchOf(13)]);
  assert.deepEqual(
    issues.map((i) => [i.path, i.code, i.params?.field ?? i.params?.prefix ?? ""]),
    [
      ["modules.codes.rules[0].codeBatches[2]", "invalid_code_batch", "seed"],
      ["modules.codes.rules[0].codeBatches[3]", "invalid_code_batch", "prefix"],
      ["modules.codes.rules[0].codeBatches[4]", "invalid_code_batch", "alphabet"],
      ["modules.codes.rules[0].codeBatches[5]", "invalid_code_batch", "length"],
      ["modules.codes.rules[0].codeBatches[6]", "invalid_code_batch", "count"],
      ["modules.codes.rules[0].codeBatches[7]", "invalid_code_batch", "suffix"],
      ["modules.codes.rules[0].codeBatches[8]", "invalid_code_batch", "id"],
      ["modules.codes.rules[1].codeBatches[0].count", "too_many_batch_codes", ""],
      // No batch's prefix may start another's, shop-wide.
      ["modules.codes.rules[1].codeBatches", "code_batch_prefix_taken", "B001-VIP"],
      ["modules.codes.rules[1].codeBatches", "code_batch_prefix_taken", "B0"],
    ],
  );
  // At most CONFIG_LIMITS.codeBatchesPerRule batches a rule.
  const many = sanitizeConfig({ modules: { codes: { rules: [batchRule("A", Array.from({ length: 7 }, (_, i) => batchOf(i)))] } } });
  assert.equal(many.config.modules.codes.rules[0].codeBatches?.length, CONFIG_LIMITS.codeBatchesPerRule);
  assert.deepEqual(many.issues.map((i) => [i.code, i.params?.count]), [["too_many_code_batches", 2]]);
});

test("payload: a batch ships as one short text among the rule's code hashes — its check key, never its seed or its codes", () => {
  const batch = batchOf(1, { prefix: "BF24-" });
  const payload = payloadOf([batchRule("A", [batch], { codes: ["VIP"] }), pct("B", 5, { codeBatches: [batchOf(2)] }), batchRule("C", [batchOf(3)])]);
  const [a, b, c] = payload.modules.codes.rules;
  assert.deepEqual(a.codeHashes, [codeHash("VIP"), `${codeBatchCheckKey(batch.seed)}0?0BF24-`]);
  assert.equal(b.codeHashes, undefined, "an automatic rule ships none");
  assert.equal(c.codeHashes?.length, 1, "batches alone");
  assert.equal(payload.modules.codes.maxCodeLength, 15);
  const json = JSON.stringify(payload);
  assert.equal(json.includes(batch.seed), false);
  assert.equal(json.includes(generateBatchCodes(batch)[0]), false);
  assert.equal("codeBatches" in a, false);
});

test("budget, measured: 27 B a batch (43 B as a rule's first code); 11 B a hand-typed code", () => {
  const bytes = (rules: unknown[]) => buildShopFunctionConfig(configOf(rules as never[]), OPTS).bytes;
  const base = bytes([batchRule("A", [], { codes: ["LONGEST-CODE-15"] })]);
  const one = bytes([batchRule("A", [batchOf(1)], { codes: ["LONGEST-CODE-15"] })]);
  const two = bytes([batchRule("A", [batchOf(1), batchOf(2)], { codes: ["LONGEST-CODE-15"] })]);
  assert.equal(one - base, 27, "`,` + the quoted text: a 16-character key, 3 characters, a 5-character prefix");
  assert.equal(two - one, 27);
  const typed = bytes([batchRule("A", [], { codes: ["LONGEST-CODE-15", "ANOTHER"] })]);
  assert.equal(typed - base, 11);
  // A rule with batches only: `,"codeHashes":[…]` (16 B) + the first text (26 B), and `,"maxCodeLength":15` (19 B).
  assert.equal(bytes([batchRule("A", [batchOf(1)])]) - bytes([batchRule("A", [])]), 16 + 26 + 19);
  // A size the batch does not depend on: 1 or 1 000 codes, any pattern — the same bytes.
  assert.equal(bytes([batchRule("A", [batchOf(1, { count: 1 })])]), bytes([batchRule("A", [batchOf(1, { count: 1000 })])]));
  assert.equal(bytes([batchRule("A", [batchOf(1, { middle: "-", suffix: "X" })])]), bytes([batchRule("A", [batchOf(1)])]));

  // What fits: 50 000 generated codes (10 code discounts × 5 batches × 1 000) in under 40 % of the
  // budget; the whole budget holds ~750 hand-typed codes shop-wide.
  const rules = Array.from({ length: 10 }, (_, r) => batchRule(`r_${String(r).padStart(20, "0")}`, Array.from({ length: 5 }, (_, i) => batchOf(r * 5 + i, { count: 1000 }))));
  const big = buildShopFunctionConfigWorstCase(configOf(rules as never[]));
  assert.ok(big.fits);
  assert.ok(big.bytes < FUNCTION_CONFIG_BUDGET_BYTES * 0.4, `${big.bytes} B`);
  // And a config that does not fit is refused through the same `fits` as ever (200 rules × 5 batches).
  const over = Array.from({ length: 200 }, (_, r) => batchRule(`r_${String(r).padStart(20, "0")}`, Array.from({ length: 5 }, (_, i) => batchOf(r * 5 + i))));
  assert.equal(buildShopFunctionConfigWorstCase(configOf(over as never[])).fits, false);
});

test("engine: an entered code of a batch counts for the batch's rule; a made-up code with the prefix does not", () => {
  const batch = batchOf(1, { prefix: "BF-" });
  const codes = generateBatchCodes(batch);
  const rules = [batchRule("K", [batch], { codes: ["HAND"] }), pct("A", 5)];
  const lines = [line("L", 1000_00, 1, ["K", "A"])];
  const plan = (entered: string[]) => planCart(cartOf(lines, { enteredCodes: entered }), payloadOf(rules));
  const state = (entered: string[]) => [outcome(plan(entered), "K").state, outcome(plan(entered), "A").state];

  assert.deepEqual(state([]), ["code_not_entered", "applied"]);
  assert.deepEqual(state([codes[0]]), ["applied", "outranked"]);
  assert.deepEqual(state([`  ${codes[57].toLowerCase()}\n`]), ["applied", "outranked"], "case and padding as for any code");
  assert.deepEqual(state(["hand"]), ["applied", "outranked"], "hand-typed codes keep working");
  assert.deepEqual(outcome(plan([codes[3], "HAND", codes[4]]), "K").enteredCodes, [codes[3], "HAND", codes[4]]);
  assert.deepEqual(plan([codes[3], codes[4]]).codes.map((c) => c.state), ["applied", "same_rule"]);

  // "PREFIX-anything": not the batch's code, so the rule is not entered and the automatic discount stays.
  const last = codes[0].at(-1) === "2" ? "3" : "2";
  for (const fake of ["BF-ANYTHING12", "BF-AAAAAAAAAA", `${codes[0].slice(0, -1)}${last}`, `${codes[0]}2`, codes[0].slice(0, -1)]) {
    const p = plan([fake]);
    assert.deepEqual([outcome(p, "K").state, outcome(p, "A").state], ["code_not_entered", "applied"], fake);
    assert.deepEqual(p.codes.map((c) => [c.ruleId, c.state]), [[null, "unknown"]], fake);
  }
  // Characters that upper-case INTO ASCII (ſ → S, ı → I) never make a batch code.
  const s = generateBatchCodes(batchOf(1, { prefix: "SI-" }));
  const withS = planCart(cartOf(lines, { enteredCodes: [s[0].replace("SI-", "ſı-")] }), payloadOf([batchRule("K", [batchOf(1, { prefix: "SI-" })])]));
  assert.equal(outcome(withS, "K").state, "code_not_entered");

  // The code node emits for a batch code as its triggering code, and for no other.
  const emitted = emitForNode(plan([codes[0]]), { kind: "code", ruleId: "K" }, codes[0]);
  assert.equal(emitted.productCandidates.length, 1);
  assert.deepEqual(emitForNode(plan([codes[0]]), { kind: "code", ruleId: "K" }, "BF-ANYTHING12").productCandidates, []);
});

test("engine: the phantom-stack abuse is closed — a made-up prefix code adds nothing to another code's stack", () => {
  // Pro: two code rules that combine. Before the check, R1's real code + "B001-anything" would have made R1's
  // node emit R2's part too.
  const batch = batchOf(1);
  const rules = [pct("R1", 10, { ...code(["REAL"]), combinesWith: { ruleIds: ["R2"] } }), batchRule("R2", [batch])];
  const lines = [line("L", 1000_00, 1, ["R1", "R2"])];
  const fake = planCart(cartOf(lines, { enteredCodes: ["REAL", "B001-ANYTHING12"] }), payloadOf(rules));
  assert.equal(fake.lines[0].product?.amount, 100_00);
  assert.deepEqual(fake.lines[0].product?.components.map((c) => c.ruleId), ["R1"]);
  const real = planCart(cartOf(lines, { enteredCodes: ["REAL", generateBatchCodes(batch)[0]] }), payloadOf(rules));
  assert.equal(real.lines[0].product?.amount, 200_00);
});

test("plan gate: on Free a Pro pattern's batch is left out, a larger batch keeps its first 100 codes", () => {
  const patterned = batchOf(1, { middle: "-" });
  const large = batchOf(2, { count: 300, removed: [5, 150] });
  const plain = batchOf(3);
  const config = configOf([batchRule("A", [patterned, large, plain], { name: "Akce" }), batchRule("B", [batchOf(4, { suffix: "X" })], { enabled: false })]);
  assert.deepEqual(gateConfigForPlan(config, "pro").config, config);
  const free = gateConfigForPlan(config, "free");
  assert.deepEqual(free.config.modules.codes.rules[0].codeBatches, [{ ...large, count: 100, removed: [5] }, plain]);
  assert.equal(free.config.modules.codes.rules[1].codeBatches, undefined);
  assert.deepEqual(free.stripped, [
    { capability: "code_batch_pattern", reason: "removed", ruleId: "A", name: "Akce", entityId: "b1", count: 100 },
    { capability: "code_batch_size", reason: "reduced", ruleId: "A", name: "Akce", entityId: "b2", count: 199 },
  ]);
  assert.deepEqual(explainGate(free.stripped, "cs").map((e) => e.text), [
    "Sleva „Akce“: 100 vygenerovaných kódů s vlastním vzorem ve Free neplatí, vzor kódů je funkce Pro.",
    "Sleva „Akce“: ve Free platí z jedné dávky nejvýš 100 vygenerovaných kódů, dalších 199 kódů neplatí.",
  ]);
  // The first 100 codes are the same codes; the stored config keeps everything.
  assert.deepEqual(generateBatchCodes({ ...large, count: 100 }), generateBatchCodes(large).slice(0, 100));
  assert.equal(config.modules.codes.rules[0].codeBatches?.length, 3);
  // A patterned batch's code is not recognised on Free: no discount, never more.
  const codes = generateBatchCodes(patterned);
  const payload = buildShopFunctionConfig(free.config, OPTS).payload;
  assert.equal(outcome(planCart(cartOf([line("L", 100_00, 1, ["A"])], { enteredCodes: [codes[0]] }), payload), "A").state, "code_not_entered");
});

test("collisions: a hand-typed or native code the function could take for another code is found before saving", () => {
  const batch = batchOf(1);
  const codes = generateBatchCodes(batch);
  const clean = configOf([batchRule("A", [batch], { codes: ["VIP"] }), orderPct("B", 5, code(["WELCOME"]))]);
  assert.deepEqual(findCodeBatchConflicts(clean, ["NATIVE10"]), []);
  assert.deepEqual(findCodeHashCollisions(clean, ["NATIVE10"]), []);
  // A batch code typed into ANOTHER discount, or living on a native Shopify discount.
  const copied = configOf([batchRule("A", [batch]), orderPct("B", 5, code([codes[2]]))]);
  assert.deepEqual(findCodeBatchConflicts(copied, [codes[9].toLowerCase(), "ž"]), [
    { code: codes[2], ruleId: "B", batchId: "b1", batchRuleId: "A" },
    { code: codes[9], ruleId: null, batchId: "b1", batchRuleId: "A" },
  ]);
  // The same code typed into its own rule is no conflict; the hash check sees the generated codes too.
  assert.deepEqual(findCodeBatchConflicts(configOf([batchRule("A", [batch], { codes: [codes[2]] })])), []);
  assert.deepEqual(findCodeHashCollisions(copied), [], "the same text in two rules is one code (the sanitizer and Shopify refuse it elsewhere), not a hash collision");
  assert.equal(findCodeHashCollisions(copied, [codes[9]]).length, 0, "the same text is one code, not a collision of two");
});

test("describe: generated codes are counted, never listed", () => {
  assert.equal(describeGeneratedCodes(1, "cs"), "1 vygenerovaný kód");
  assert.equal(describeGeneratedCodes(3, "cs"), "3 vygenerované kódy");
  assert.equal(describeGeneratedCodes(100, "cs"), "100 vygenerovaných kódů");
  assert.equal(describeGeneratedCodes(1, "en"), "1 generated code");
  const rule = { method: "code" as const, value: { kind: "percentage" as const, percent: 10 }, target: { kind: "order" as const } };
  assert.equal(describeRule({ ...rule, codeBatches: [{ count: 100, removed: [1, 2] }] }, "cs", undefined, { codesKnown: true }), "10\u00a0% z objednávky · 98 vygenerovaných kódů");
  assert.equal(describeRule({ ...rule, codes: ["VIP"], codeBatches: [{ count: 100 }, { count: 50 }] }, "en"), "10% off the order · code VIP + 150 generated codes");
  assert.equal(describeRule({ ...rule, codes: [], codeBatches: [] }, "cs", undefined, { codesKnown: true }), "10\u00a0% z objednávky · kódem, zatím bez kódu");
});
