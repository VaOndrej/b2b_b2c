// Entered codes against the longest Won code (MVP 2 audit rounds 6 and 7). A Won
// code has at most 64 characters (CONFIG_LIMITS.codeLength, UTF-16 units, trimmed
// and upper-cased); the shop payload carries the longest one (`maxCodeLength`).
// An entered code is never matched, while it still counts as one of the first 25
// entries, when it is longer than that + ENTERED_CODE_PADDING as entered (white
// space included), or when its normalized form (trimmed, upper-cased) is longer
// than it — it cannot be a Won code. The Rust function then neither trims nor
// upper-cases more of it than that bound (hash.rs `normalized_hash_within`),
// which bounds its work per code.

import assert from "node:assert/strict";
import { test } from "node:test";

import { ENTERED_CODE_PADDING, MAX_ENTERED_CODES, normalizeCart, normalizeCode } from "../../src/discounts/cart.ts";
import { codeHash } from "../../src/discounts/code-hash.ts";
import { CONFIG_LIMITS } from "../../src/discounts/config.ts";
import { emitForNode } from "../../src/discounts/emit.ts";
import { buildShopFunctionConfig, buildShopFunctionConfigWorstCase } from "../../src/discounts/function-payload.ts";
import { planCart, readMaxCodeLength } from "../../src/discounts/plan.ts";
import { cartOf, code, configOf, FIXTURE_NOW, FIXTURE_TZ, line, outcome, payloadOf, pct } from "./engine-fixtures.ts";

test("upper-casing never shortens a text in UTF-16 units and is idempotent, for every code point", () => {
  for (let cp = 0; cp <= 0x10ffff; cp += 1) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const c = String.fromCodePoint(cp);
    const up = c.toUpperCase();
    assert.ok(up.length >= c.length, `U+${cp.toString(16)}`);
    assert.equal(up.toUpperCase(), up, `U+${cp.toString(16)}`);
    assert.equal(normalizeCode(normalizeCode(`  ${c}x `)), normalizeCode(`  ${c}x `));
  }
});

test("the payload ships the longest Won code (trimmed, upper-cased) whenever a code rule ships codes", () => {
  const long = "Ž".repeat(64);
  const payload = payloadOf([pct("a", 10, code(["welcome15", " ß ", long])), pct("b", 5, code(["x"])), pct("c", 7)]);
  assert.equal(payload.modules.codes.maxCodeLength, 64);
  assert.equal(payloadOf([pct("a", 10, code(["welcome15", "straße"]))]).modules.codes.maxCodeLength, 9);
  // "ß" is one character entered, "SS" (2) stored: the stored length counts.
  assert.equal(payloadOf([pct("a", 10, code(["ß"]))]).modules.codes.maxCodeLength, 2);
  assert.ok(!("maxCodeLength" in payloadOf([pct("c", 7)]).modules.codes), "no code rule, no field");
  // The worst-case size check measures it too.
  const config = configOf([pct("a", 10, code([long]))]);
  const worst = buildShopFunctionConfigWorstCase(config);
  const built = buildShopFunctionConfig(config, { now: FIXTURE_NOW, shopTimezone: FIXTURE_TZ });
  assert.equal(worst.payload.modules.codes.maxCodeLength, 64);
  assert.equal(worst.bytes, built.bytes);
  assert.ok(built.json.includes('"maxCodeLength":64'));
});

test("readMaxCodeLength: a whole number 0–64; missing or junk reads as 64, more as 64", () => {
  assert.equal(CONFIG_LIMITS.codeLength, 64);
  const read = (v: unknown) => readMaxCodeLength({ modules: { codes: { rules: [], ...(v === undefined ? {} : { maxCodeLength: v }) } } });
  assert.equal(read(undefined), 64);
  for (const v of [9, 0, 64]) assert.equal(read(v), v);
  for (const v of [9.5, -1, "9", null, [9], true, 65, 300, 1e300]) assert.equal(read(v), 64, String(v));
  assert.equal(readMaxCodeLength({}), 64);
});

test("an entered code longer than the longest Won code is never matched, and counts toward the 25", () => {
  const payload = payloadOf([pct("w", 10, code(["WELCOME15"])), pct("s", 15, code(["STRASSE"]))]);
  assert.equal(payload.modules.codes.maxCodeLength, 9);
  // A hand-made payload also lists the hash of a 10-character code.
  payload.modules.codes.rules.push({ ...payload.modules.codes.rules[0], id: "l", codeHashes: [codeHash("WELCOME150")], value: { kind: "percentage", percent: 20 } });
  const lines = [line("L1", 100_00, 1, ["w", "s", "l"])];
  const plan = planCart(cartOf(lines, { enteredCodes: ["　 welcome15  ", "straße", "welcome150"] }), payload);
  assert.deepEqual(outcome(plan, "w").enteredCodes, ["WELCOME15"]);
  assert.deepEqual(outcome(plan, "s").enteredCodes, ["STRASSE"]);
  assert.equal(outcome(plan, "l").state, "code_not_entered");
  assert.equal(plan.codes.find((c) => c.code === "WELCOME150")?.state, "unknown");
  assert.deepEqual(emitForNode(plan, { kind: "code", ruleId: "l" }, "welcome150").productCandidates, []);
  // The entries: every one counts, whatever it holds, and keeps its length as entered.
  const cart = normalizeCart(cartOf(lines, { enteredCodes: [" welcome15 ", "", 7 as unknown as string, "ß"] }));
  assert.deepEqual(cart.consideredEntries, [
    { code: "WELCOME15", rawLength: 11 },
    { code: "", rawLength: 0 },
    { code: "", rawLength: 0 },
    { code: "SS", rawLength: 1 },
  ]);
  assert.equal(cart.consideredCodes, 2);
  // 25 codes that are too long, or empty, or not strings, then STRASSE: past the cap.
  for (const filler of ["X".repeat(10), "", "   ", null]) {
    const entered = [...Array.from({ length: MAX_ENTERED_CODES }, () => filler), "STRASSE"] as string[];
    assert.equal(outcome(planCart(cartOf(lines, { enteredCodes: entered }), payload), "s").state, "code_not_entered", String(filler));
    assert.deepEqual(outcome(planCart(cartOf(lines, { enteredCodes: entered.slice(1) }), payload), "s").enteredCodes, ["STRASSE"], String(filler));
  }
});

test("an entered code longer than the longest Won code + 16 as entered, or whose upper-case form is longer than it, is never matched, and counts", () => {
  assert.equal(ENTERED_CODE_PADDING, 16);
  // WELCOME15 (9) and STRASSE (7) are the shop's codes, FFIFFIFFI (9, "ﬃﬃﬃ" entered)
  // too; a hand-made payload also lists FFIFFIFFIFFI (12, "ﬃﬃﬃﬃ" entered).
  const payload = payloadOf([pct("w", 10, code(["WELCOME15"])), pct("s", 15, code(["STRASSE"])), pct("f", 12, code(["ﬃﬃﬃ"]))]);
  assert.equal(payload.modules.codes.maxCodeLength, 9);
  payload.modules.codes.rules.push({ ...payload.modules.codes.rules[0], id: "g", codeHashes: [codeHash("FFIFFIFFIFFI")], value: { kind: "percentage", percent: 20 } });
  const lines = [line("L1", 100_00, 1, ["w", "s", "f", "g"])];
  const codesOf = (entered: string[]) => {
    const plan = planCart(cartOf(lines, { enteredCodes: entered }), payload);
    return ["w", "s", "f", "g"].map((id) => outcome(plan, id).enteredCodes);
  };
  // 9 + 16 = 25 as entered matches; 26 does not.
  assert.deepEqual(codesOf([`${" ".repeat(8)}welcome15${"\u3000".repeat(8)}`]), [["WELCOME15"], [], [], []]);
  assert.deepEqual(codesOf([`${" ".repeat(8)}welcome15${"\u3000".repeat(9)}`]), [[], [], [], []]);
  assert.deepEqual(codesOf([`\t${"\ufeff".repeat(15)}WELCOME15`, `welcome15${"\n".repeat(17)}`]), [["WELCOME15"], [], [], []]);
  // The bound is the longest Won code's: a shorter one may carry more white space (straße: 6 + 19 = 25).
  assert.deepEqual(codesOf([`straße${"\u2000".repeat(19)}`]), [[], ["STRASSE"], [], []]);
  assert.deepEqual(codesOf([`straße${"\u2000".repeat(20)}`]), [[], [], [], []]);
  // Upper-cased length: ﬃﬃﬃ becomes 9 characters (matched), ﬃﬃﬃﬃ 12 (never, even with its hash listed).
  assert.deepEqual(codesOf(["ﬃﬃﬃ", "ﬃﬃﬃﬃ"]), [[], [], ["FFIFFIFFI"], []]);
  const plan = planCart(cartOf(lines, { enteredCodes: ["ﬃﬃﬃﬃ", `welcome15${" ".repeat(17)}`] }), payload);
  assert.equal(outcome(plan, "g").state, "code_not_entered");
  assert.deepEqual(plan.codes.map((c) => [c.code, c.state]), [["FFIFFIFFIFFI", "unknown"], ["WELCOME15", "unknown"]]);
  assert.deepEqual(emitForNode(plan, { kind: "code", ruleId: "g" }, "ﬃﬃﬃﬃ").productCandidates, []);
  // Such entries count: 25 of them, then STRASSE is past the cap.
  for (const filler of [`W${" ".repeat(30)}`, "ßßßßß", "\u3000".repeat(26)]) {
    const entered = [...Array.from({ length: MAX_ENTERED_CODES }, () => filler), "STRASSE"];
    assert.deepEqual(codesOf(entered)[1], [], filler);
    assert.deepEqual(codesOf(entered.slice(1))[1], ["STRASSE"], filler);
  }
});

test("for the shop's own codes nothing changes: 3 000 random carts match exactly what matching every code would (property)", () => {
  // mulberry32
  let a = 20261006;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(rnd() * n);
  const pick = <T>(list: readonly T[]) => list[int(list.length)];
  const alphabets = ["ABCDEFGHJK", "áčďéěíňóřšťúůýž", "ßﬁﬃ", "ᾀᾳ", "\u{10428}\u{10429}", "中文", "0123456789-"];
  const word = (len: number) => {
    const chars = [...pick(alphabets)];
    let out = "";
    while (out.length < len) out += pick(chars);
    return out.slice(0, len).replace(/[\ud800-\udbff]$/, "Q");
  };
  const pad = () => pick(["", "", " ", " ", "　 ", "\t"]);
  let skipped = 0;
  let matched = 0;
  for (let i = 0; i < 3000; i += 1) {
    const rulesRaw = Array.from({ length: 1 + int(3) }, (_, k) => pct(`c${k}`, 5 + k, code(Array.from({ length: 1 + int(4) }, () => word(pick([1, 5, 12, 30, 64]))))));
    const payload = payloadOf(rulesRaw);
    const shopCodes = configOf(rulesRaw).modules.codes.rules.flatMap((r) => r.codes ?? []);
    const entered = Array.from({ length: pick([1, 5, 25, 30]) }, () =>
      shopCodes.length > 0 && rnd() < 0.5 ? `${pad()}${pick([(s: string) => s, (s: string) => s.toLowerCase()])(pick(shopCodes))}${pad()}` : `${pad()}${word(pick([3, 40, 64, 65, 100, 255]))}${pad()}`,
    );
    const plan = planCart(cartOf([line("L1", 100_00, 1, rulesRaw.map((r) => String(r.id)))], { enteredCodes: entered }), payload);
    // The model without the length rule: every one of the first 25 entries normalized and matched by hash.
    const want = new Map<string, string[]>();
    const owner = new Map<string, string>();
    for (const r of payload.modules.codes.rules) for (const h of r.codeHashes ?? []) if (!owner.has(h)) owner.set(h, r.id);
    for (const raw of entered.slice(0, MAX_ENTERED_CODES)) {
      const c = normalizeCode(raw);
      const id = c ? owner.get(codeHash(c)) : undefined;
      if (!id) continue;
      const list = want.get(id) ?? [];
      if (!list.includes(c)) list.push(c);
      want.set(id, list);
    }
    for (const r of payload.modules.codes.rules) {
      assert.deepEqual(outcome(plan, r.id).enteredCodes, want.get(r.id) ?? [], `case ${i} rule ${r.id}`);
      matched += (want.get(r.id) ?? []).length;
    }
    const max = readMaxCodeLength(payload as unknown as Record<string, unknown>);
    skipped += entered.slice(0, MAX_ENTERED_CODES).filter((raw) => raw.length > max + ENTERED_CODE_PADDING || normalizeCode(raw).length > max).length;
  }
  assert.ok(skipped > 3000 && matched > 3000, `skipped ${skipped}, matched ${matched}`);
});
