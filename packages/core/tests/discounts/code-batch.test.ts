// Generated code batches (plan 2026-10-06 dávka 4): code-batch.ts — the keyed
// hash, the generator, the check the function matches by, making a batch.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  batchPrefixesClash,
  CODE_BATCH_CHARS,
  CODE_BATCH_CHECK_LENGTH,
  codeBatchCheck,
  codeBatchCheckKey,
  codeBatchCodeLength,
  codeBatchMinLength,
  codeBatchPattern,
  codeBatchPayload,
  createCodeBatch,
  generateBatchCodes,
  isProCodeBatch,
  listBatchCodes,
  matchesCodeBatch,
  readCodeBatch,
  removeBatchCodes,
  ruleCodes,
  sipHash24,
} from "../../src/discounts/code-batch.ts";
import { codeHash } from "../../src/discounts/code-hash.ts";
import { CONFIG_LIMITS, type CodeBatch } from "../../src/discounts/config.ts";

/** A seeded byte source (the injected RNG): the same batch every run. */
function seededBytes(seed: number): (n: number) => Uint8Array {
  let state = seed >>> 0;
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      out[i] = state >>> 24;
    }
    return out;
  };
}

const hex = ([high, low]: readonly [number, number]) => high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
const SEED = "000102030405060708090a0b0c0d0e0f";
const batchOf = (extra: Partial<CodeBatch> = {}): CodeBatch => ({ id: "b1", prefix: "BF-", count: 100, seed: SEED, length: 10, alphabet: "both", ...extra });

test("SipHash-2-4: the reference vectors (key 00…0f; the paper's 15-byte message, the empty one, 8 and 9 bytes)", () => {
  // The key bytes 00 01 … 0f as two little-endian 64-bit numbers, written high digits first.
  const key = "07060504030201000f0e0d0c0b0a0908";
  const message = (n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => i));
  assert.equal(hex(sipHash24(key, message(15))), "a129ca6149be45e5");
  assert.equal(hex(sipHash24(key, "")), "726fdb47dd0e0e31");
  // vectors_sip64[8] and [9] of the reference implementation (bytes little-endian).
  assert.equal(hex(sipHash24(key, message(8))), "93f5f5799a932462");
  assert.equal(hex(sipHash24(key, message(9))), "9e0082df0ba9e4b0");
});

test("alphabets: no 0 / O, 1 / I / L; the check is at least 18 bits", () => {
  assert.equal(CODE_BATCH_CHARS.both.length, 31);
  assert.equal(CODE_BATCH_CHARS.letters.length, 23);
  assert.equal(CODE_BATCH_CHARS.digits.length, 8);
  for (const chars of Object.values(CODE_BATCH_CHARS)) {
    assert.doesNotMatch(chars, /[01OIL]/);
    assert.equal(new Set(chars).size, chars.length);
  }
  for (const alphabet of ["both", "letters", "digits"] as const) {
    assert.ok(CODE_BATCH_CHECK_LENGTH[alphabet] * Math.log2(CODE_BATCH_CHARS[alphabet].length) >= 18, alphabet);
  }
  // The shortest random part that keeps a guess at a real code under 1 in 10 000.
  assert.equal(codeBatchMinLength("both", 100), 9);
  assert.equal(codeBatchMinLength("both", 1000), 9);
  assert.equal(codeBatchMinLength("letters", 1000), 10);
  assert.equal(codeBatchMinLength("digits", 100), 13);
  assert.equal(codeBatchMinLength("digits", 1000), 14);
});

test("generator: the same codes every time, unique, of the batch's shape; each carries its check", () => {
  const batch = batchOf({ count: 1000 });
  const codes = generateBatchCodes(batch);
  assert.deepEqual(generateBatchCodes(batch), codes, "deterministic");
  assert.equal(codes.length, 1000);
  assert.equal(new Set(codes).size, 1000);
  assert.deepEqual(codes.slice(0, 3), ["BF-KZG8E2NAVT", "BF-EHG852G9N8", "BF-RPH79S627G"]);
  assert.deepEqual(generateBatchCodes(batchOf({ count: 3 })), codes.slice(0, 3), "a smaller batch is a prefix of a larger one");
  for (const code of codes) assert.match(code, /^BF-[2-9A-HJKMNP-Z]{10}$/);
  const read = readCodeBatch(codeBatchPayload(batch));
  assert.ok(read);
  assert.ok(codes.every((code) => matchesCodeBatch(read, code)));
  // Another seed: other codes, and the first batch's check refuses them.
  const other = generateBatchCodes(batchOf({ count: 1000, seed: "ffffffffffffffffffffffffffffffff" }));
  assert.equal(other.filter((code) => codes.includes(code)).length, 0);
  assert.ok(other.filter((code) => matchesCodeBatch(read, code)).length <= 1, "2⁻¹⁹·⁸ a code");
  // The check key is derived: it is not the seed, and it alone does not list the codes.
  assert.equal(codeBatchCheckKey(SEED), "fMMWc55qaEgjTq67");
  assert.match(codeBatchCheckKey("ffffffffffffffffffffffffffffffff"), /^[A-Za-z0-9_-]{16}$/);
  // The check covers every other character of the code, the prefix included.
  assert.equal(codeBatchCheck(codeBatchCheckKey(SEED), "BF-KZG8E2", "both"), "NAVT");
  assert.equal(codeBatchCheck(codeBatchCheckKey(SEED), "BF-ABCDEF", "letters"), "TEGG");
});

test("pattern (Pro): a middle splits the random part, a suffix follows it; digits and letters stay in their alphabet", () => {
  const batch = batchOf({ prefix: "VIP", length: 13, alphabet: "digits", middle: "-X-", suffix: "_24", count: 50 });
  assert.equal(codeBatchPattern(batch), "VIPXXXXXXX-X-XXXXXX_24");
  assert.equal(codeBatchCodeLength(batch), 22);
  const codes = generateBatchCodes(batch);
  assert.deepEqual(codes.slice(0, 2), ["VIP6953524-X-899542_24", "VIP5653323-X-537345_24"]);
  for (const code of codes) assert.match(code, /^VIP[2-9]{7}-X-[2-9]{6}_24$/);
  const read = readCodeBatch(codeBatchPayload(batch));
  assert.ok(read);
  assert.ok(codes.every((code) => matchesCodeBatch(read, code)));
  // One character off anywhere — a random one, a literal of the middle or of the suffix: no match
  // (the function knows neither literal: the check covers them).
  const [code] = codes;
  const flip = (text: string, at: number) => text.slice(0, at) + (text[at] === "2" ? "3" : "2") + text.slice(at + 1);
  for (let at = 0; at < code.length; at += 1) assert.equal(matchesCodeBatch(read, flip(code, at)), false, `position ${at}`);
  assert.equal(matchesCodeBatch(read, `${code}2`), false);
  assert.equal(matchesCodeBatch(read, code.slice(1)), false);
  // A short random part: the middle never splits the check (7 characters of both: 3 + 4).
  assert.equal(codeBatchPattern({ prefix: "A-", length: 7, alphabet: "both", middle: "-" }), "A-XXX-XXXX");
  assert.equal(codeBatchPattern({ prefix: "A-", length: 8, alphabet: "digits", middle: "-" }), "A-XX-XXXXXX");
  for (const letter of generateBatchCodes(batchOf({ alphabet: "letters", count: 20 }))) assert.match(letter, /^BF-[A-HJKMNP-Z]{10}$/);
  assert.equal(isProCodeBatch(batch), true);
  assert.equal(isProCodeBatch(batchOf()), false);
  assert.equal(isProCodeBatch(batchOf({ length: 11 })), true);
});

test("\"PREFIX-anything\" is not a code of the batch: 200 000 guesses of the right shape, about one in 31⁴ passes", () => {
  const read = readCodeBatch(codeBatchPayload(batchOf()));
  assert.ok(read);
  const bytes = seededBytes(7);
  const chars = CODE_BATCH_CHARS.both;
  let passed = 0;
  for (let i = 0; i < 200_000; i += 1) {
    const guess = `BF-${Array.from(bytes(10), (b) => chars[b % chars.length]).join("")}`;
    if (matchesCodeBatch(read, guess)) passed += 1;
  }
  // Expected 200 000 / 923 521 ≈ 0.2.
  assert.ok(passed <= 3, `${passed} guesses passed`);
  for (const text of ["BF-", "BF-ANYTHING", "BF-AAAAAAAAAA", "bf-kzg8e2navt", "XX-KZG8E2NAVT", ""]) assert.equal(matchesCodeBatch(read, text), false, text);
});

test("the payload text is read tolerantly, and anything off is no batch at all", () => {
  const key = codeBatchCheckKey(SEED);
  // key + alphabet + "0" + the code's length + "0" + the suffix's length + prefix.
  assert.equal(codeBatchPayload(batchOf()), `${key}0=0BF-`);
  assert.equal(codeBatchPayload(batchOf({ prefix: "VIP", alphabet: "digits", length: 13, middle: "-X-", suffix: "_24" })), `${key}2F3VIP`);
  assert.deepEqual(readCodeBatch(`${key}0=0BF-`), { key, prefix: "BF-", alphabet: "both", codeLength: 13, suffixLength: 0 });
  assert.deepEqual(readCodeBatch(`${key}2F3VIP`), { key, prefix: "VIP", alphabet: "digits", codeLength: 22, suffixLength: 3 });
  const bad: unknown[] = [
    null,
    {},
    [key, "BF-", 10, 0],
    "",
    key,
    `${key}0=`,
    `${key}0=0`, // no prefix
    `${key}0=0bf-`,
    `${key}0=0BF `,
    `${key}0=0BF-\n`,
    `${key}0=0BF-é`,
    `${key}3=0BF-`,
    `${key}/=0BF-`,
    `${key}0/0BF-`, // a length below "0"
    `${key}0=/BF-`,
    `${key}0q0BF-`, // 65 characters
    `${key}070BF-`, // 7 = 3 + 4: nothing between the prefix and the check
    `${key}290BF-`, // … 6 check digits
    `${key}0=6BF-`, // a suffix that leaves nothing either
    `${key.slice(1)}0=0BF-`,
    `é${key.slice(1)}0=0BF-`, // the key's characters are ASCII
  ];
  for (const raw of bad) assert.equal(readCodeBatch(raw), null, JSON.stringify(raw));
  assert.ok(readCodeBatch(`${key}080BF-`));
  assert.ok(readCodeBatch(`${key}0p0BF-`)); // 64 characters
  assert.ok(readCodeBatch(`${key}2:0BF-`));
  assert.ok(readCodeBatch(`${key}0=5BF-`));
});

test("removed codes keep their index; a rule's codes are the typed ones and every batch's in force", () => {
  const batch = batchOf({ count: 5 });
  const all = generateBatchCodes(batch);
  const less = removeBatchCodes(batch, [all[1].toLowerCase(), all[3], "NOT-A-CODE"]);
  assert.deepEqual(less.removed, [1, 3]);
  assert.deepEqual(listBatchCodes(less), [all[0], all[2], all[4]]);
  assert.deepEqual(removeBatchCodes(less, [all[0]]).removed, [0, 1, 3]);
  assert.equal(batch.removed, undefined, "never mutates");
  assert.deepEqual(ruleCodes({ method: "code", codes: ["vip", all[0]], codeBatches: [less] }), ["VIP", all[0], all[2], all[4]]);
  assert.deepEqual(ruleCodes({ method: "code" }), []);
});

test("createCodeBatch: Free = up to 100 random codes behind a short random prefix; pattern options are Pro", () => {
  const made = createCodeBatch({ count: 100 }, { plan: "free", randomBytes: seededBytes(1) });
  assert.ok(made.ok);
  const again = createCodeBatch({ count: 100 }, { plan: "free", randomBytes: seededBytes(1) });
  assert.deepEqual(again, made, "deterministic with an injected RNG");
  assert.match(made.batch.prefix, /^[A-HJKMNP-Z]{4}-$/);
  assert.match(made.batch.id, /^b_[0-9a-f]{12}$/);
  assert.match(made.batch.seed, /^[0-9a-f]{32}$/);
  assert.deepEqual([made.batch.length, made.batch.alphabet, made.batch.count], [10, "both", 100]);
  assert.equal(isProCodeBatch(made.batch), false);
  assert.equal(made.codes.length, 100);
  assert.equal(new Set(made.codes).size, 100);
  assert.deepEqual(generateBatchCodes(made.batch), made.codes);

  const free = (spec: Parameters<typeof createCodeBatch>[0]) => createCodeBatch(spec, { plan: "free", randomBytes: seededBytes(2) });
  assert.deepEqual(free({ count: 101 }), { ok: false, error: "count", params: { max: CONFIG_LIMITS.codeBatchSizeFree } });
  assert.deepEqual(free({ count: 0 }), { ok: false, error: "count", params: { max: 100 } });
  assert.deepEqual(free({ count: 2.5 }), { ok: false, error: "count", params: { max: 100 } });
  for (const field of ["prefix", "middle", "suffix"] as const) assert.deepEqual(free({ count: 5, [field]: "VIP" }), { ok: false, error: "pro_required", params: { field } });
  assert.deepEqual(free({ count: 5, length: 12 }), { ok: false, error: "pro_required", params: { field: "length" } });
  assert.deepEqual(free({ count: 5, alphabet: "digits" }), { ok: false, error: "pro_required", params: { field: "alphabet" } });
  assert.equal(free({ count: 5, prefix: "", middle: "" }).ok, true, "empty form fields are not options");
});

test("createCodeBatch: Pro patterns are validated; prefixes never clash; codes clear of the shop's other codes", () => {
  const pro = (spec: Parameters<typeof createCodeBatch>[0], extra: Partial<Parameters<typeof createCodeBatch>[1]> = {}) =>
    createCodeBatch(spec, { plan: "pro", randomBytes: seededBytes(3), ...extra });
  const made = pro({ count: 1000, prefix: " bf24- ", middle: "-", suffix: "x", length: 12, alphabet: "letters" });
  assert.ok(made.ok);
  assert.deepEqual(
    { ...made.batch, id: "", seed: "" },
    { id: "", prefix: "BF24-", count: 1000, seed: "", length: 12, alphabet: "letters", middle: "-", suffix: "X" },
  );
  for (const code of made.codes) assert.match(code, /^BF24-[A-HJKMNP-Z]{6}-[A-HJKMNP-Z]{6}X$/);
  assert.equal(pro({ count: CONFIG_LIMITS.codeBatchSize }).ok, true);
  assert.deepEqual(pro({ count: 1001 }), { ok: false, error: "count", params: { max: 1000 } });
  assert.deepEqual(pro({ count: 5, prefix: "B" }), { ok: false, error: "prefix_invalid", params: { min: 2, max: 12 } });
  assert.deepEqual(pro({ count: 5, prefix: "SLEVA ČR" }), { ok: false, error: "prefix_invalid", params: { min: 2, max: 12 } });
  assert.deepEqual(pro({ count: 5, prefix: "ABCDEFGHIJKLM" }), { ok: false, error: "prefix_invalid", params: { min: 2, max: 12 } });
  assert.deepEqual(pro({ count: 5, suffix: "a b" }), { ok: false, error: "literal_invalid", params: { field: "suffix", max: 12 } });
  assert.deepEqual(pro({ count: 100, alphabet: "digits", length: 12 }), { ok: false, error: "length", params: { min: 13, max: 24 } });
  assert.deepEqual(pro({ count: 100, length: 25 }), { ok: false, error: "length", params: { min: 9, max: 24 } });
  assert.deepEqual(pro({ count: 5, alphabet: "hex" as "both" }), { ok: false, error: "alphabet" });
  // Digits without a length: the default is raised to the shortest safe one.
  const digits = pro({ count: 100, alphabet: "digits" });
  assert.ok(digits.ok);
  assert.equal(digits.batch.length, 13);

  // Prefixes: equal, or one starting the other, in either direction.
  assert.equal(batchPrefixesClash("BF-", "BF-"), true);
  assert.equal(batchPrefixesClash("BF", "BF-VIP"), true);
  assert.equal(batchPrefixesClash("BF-VIP", "BF-"), true);
  assert.equal(batchPrefixesClash("BF-", "BG-"), false);
  assert.deepEqual(pro({ count: 5, prefix: "bf-vip" }, { otherPrefixes: ["BF-"] }), { ok: false, error: "prefix_taken", params: { prefix: "BF-VIP" } });
  assert.equal(pro({ count: 5, prefix: "BG-" }, { otherPrefixes: ["BF-"] }).ok, true);
  // A drawn prefix avoids the others; an id avoids the rule's batches.
  const first = pro({ count: 5 });
  assert.ok(first.ok);
  const second = pro({ count: 5 }, { otherPrefixes: [first.batch.prefix], existingIds: [first.batch.id] });
  assert.ok(second.ok);
  assert.notEqual(second.batch.prefix, first.batch.prefix);
  assert.notEqual(second.batch.id, first.batch.id);

  // Collisions with the shop's other codes: the same text, or the same function hash → another seed is drawn.
  const plain = pro({ count: 50, prefix: "ZZ-" });
  assert.ok(plain.ok);
  const avoided = pro({ count: 50, prefix: "ZZ-" }, { otherCodes: [plain.codes[7].toLowerCase(), "WELCOME"] });
  assert.ok(avoided.ok);
  assert.notEqual(avoided.batch.seed, plain.batch.seed);
  assert.equal(avoided.codes.includes(plain.codes[7]), false);
  const taken = new Set(["WELCOME", plain.codes[7]].map(codeHash));
  assert.ok(avoided.codes.every((code) => !taken.has(codeHash(code))));
  // A source that always draws the same seed cannot get clear: reported, never a clashing batch.
  const stuck = createCodeBatch({ count: 5, prefix: "ZZ-" }, { plan: "pro", randomBytes: (n) => new Uint8Array(n).fill(7), otherCodes: generateBatchCodes({ prefix: "ZZ-", count: 5, seed: "07".repeat(16), length: 10, alphabet: "both" }) });
  assert.deepEqual(stuck, { ok: false, error: "collision" });
});
