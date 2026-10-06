// Generated code batches (plan 2026-10-06, dávka 4). One batch = many codes
// that cost the stored config and the function payload a CONSTANT few bytes:
// the codes are rebuilt from the batch's seed, and the discount function
// recognises the batch by its prefix and a keyed check, never by a list.
// (A hand-typed code ships as an 11-byte hash: ~500 fit the 9 000 B budget
// shop-wide. A batch ships 27 B (5-character prefix) whatever its size.)
//
// A code, left to right:
//     prefix  B[0..a]  middle  B[a..]  CHECK  suffix
//   - prefix / middle / suffix: literals of `[A-Z0-9_-]` (middle and suffix are
//     Pro, usually empty);
//   - B, the BODY: `length − K` random characters of the batch's alphabet (no
//     0/O, 1/I/L); with a middle it is split after `a` = min(ceil(length / 2),
//     length − K) characters, so the check is never split;
//   - CHECK: K characters of the same alphabet (K = CODE_BATCH_CHECK_LENGTH: 4
//     of 31 or 23 characters, 6 of 8 digits — 18 bits or more), a keyed hash
//     of EVERY other character of the code, literals included.
//   `length` = the random part the merchant sees: body + check.
//
// Where the characters come from (SipHash-2-4, a keyed PRF; 64 bits out):
//   seed key   = the batch's `seed` (32 hex = 128 bits)
//   body of code i  = chars of SipHash(seed key, "b|<i>|<block>"), 4 a block
//   check key  = 16 characters of `[A-Za-z0-9_-]` from SipHash(seed key,
//                 "k|<block>") — 96 bits; its 16 bytes are a SipHash key
//   check of a code = chars of SipHash(check key, "<the code without its
//                 check>|<block>"), 4 a block
//   a character = alphabet[(w × A) >>> 16] for each 16-bit word w of the 64
//                 (low word first; A = the alphabet's size: bias < 0.05 %).
// Codes are taken for i = 0, 1, 2, … skipping a body already taken, until the
// batch has `count` of them: the same list every time, in every runtime.
//
// What knows what:
//   - stored config: the seed (a SECRET: it lists every code);
//   - function payload: the CHECK KEY only (codeBatchPayload, one text a batch) — enough to tell
//     "this is a code of the batch", not enough to list or make real codes;
//   - storefront config: nothing.
//
// Why a keyed check and not the prefix alone. VERIFIED in the function's own
// schema (extensions/won-discounts-engine/schema.graphql, `Input.
// enteredDiscountCodes`): for the two `run` targets this function has, the
// entered codes Shopify hands over "are validated to ensure they are not
// deleted, maintain an active status, and are eligible for the current cart"
// — a code that exists nowhere never reaches the function. But a code that
// DOES exist on another discount of the shop (a native Shopify discount,
// another app's, created any time later) does, and with the prefix alone
// "PREFIX-anything" of that kind would make the plan count the batch's rule as
// entered: every node plans the whole cart, so an automatic discount could
// lose to a code rule whose own node never runs (the shopper gets less), and
// in a Pro stack of two code rules the owner's node would emit the phantom
// rule's part too (the shopper gets MORE). ASSUMED, not tested live: that
// Shopify's validation holds exactly as documented. The check makes the match
// independent of both: only a code this batch generated (or a 2⁻¹⁸ guess)
// counts. Matching is the port spec of the Rust function (engine/batch.rs).
//
// Pure and dependency-free (32-bit arithmetic only: no BigInt, no node:crypto),
// so the admin can preview a pattern in the browser with the same code.

import { codeHash } from "./code-hash.ts";
import { CODE_BATCH_ALPHABETS, type CodeBatchAlphabet } from "./config/enums.ts";
import { CONFIG_LIMITS } from "./config/limits.ts";
import type { CodeBatch } from "./config/types.ts";

/** The characters of each alphabet: no 0 / O, no 1 / I / L. */
export const CODE_BATCH_CHARS: Readonly<Record<CodeBatchAlphabet, string>> = Object.freeze({
  both: "23456789ABCDEFGHJKMNPQRSTUVWXYZ",
  letters: "ABCDEFGHJKMNPQRSTUVWXYZ",
  digits: "23456789",
});

/** K: how many characters at the end of the random part are the keyed check (≥ 18 bits). */
export const CODE_BATCH_CHECK_LENGTH: Readonly<Record<CodeBatchAlphabet, number>> = Object.freeze({ both: 4, letters: 4, digits: 6 });

/** What a batch made on Free looks like (and what a Pro one starts from). */
export const CODE_BATCH_DEFAULTS = Object.freeze({ length: 10, alphabet: "both" as CodeBatchAlphabet });

/**
 * The bodies a batch can make must outnumber its codes this many times: a
 * shopper guessing a code of the batch hits a real one once in 10 000 tries at
 * most (the check does not help there: a real code's check is right).
 */
export const CODE_BATCH_SPACE_FACTOR = 10_000;

export const CODE_BATCH_LITERAL_RE = /^[A-Z0-9_-]*$/;
export const CODE_BATCH_SEED_RE = /^[0-9a-f]{32}$/;

/**
 * The shortest random part (check included) a batch of `count` codes may have
 * in `alphabet`: both / 100 codes → 9, both / 1 000 → 9, digits / 100 → 13.
 */
export function codeBatchMinLength(alphabet: CodeBatchAlphabet, count: number): number {
  const size = CODE_BATCH_CHARS[alphabet].length;
  const need = Math.max(1, count) * CODE_BATCH_SPACE_FACTOR;
  let body = 1;
  for (let space = size; space < need; space *= size) body += 1;
  return body + CODE_BATCH_CHECK_LENGTH[alphabet];
}

/** How long every code of the batch is. */
export function codeBatchCodeLength(batch: Pick<CodeBatch, "prefix" | "length" | "middle" | "suffix">): number {
  return batch.prefix.length + batch.length + (batch.middle?.length ?? 0) + (batch.suffix?.length ?? 0);
}

/** Where a middle splits the random part: after its first half, but never inside the check at its end. */
function firstPart(batch: Pick<CodeBatch, "length" | "alphabet" | "middle">): number {
  return batch.middle ? Math.min(Math.ceil(batch.length / 2), batch.length - CODE_BATCH_CHECK_LENGTH[batch.alphabet]) : batch.length;
}

/** "BF-XXXXX-XXXXX-VIP": the shape of a code, `x` for a random character (the admin's live preview). */
export function codeBatchPattern(batch: Pick<CodeBatch, "prefix" | "length" | "alphabet" | "middle" | "suffix">, x = "X"): string {
  const first = firstPart(batch);
  return `${batch.prefix}${x.repeat(first)}${batch.middle ?? ""}${x.repeat(batch.length - first)}${batch.suffix ?? ""}`;
}

// --- SipHash-2-4 on 32-bit halves ---------------------------------------------------------------

/** A 64-bit word as [high 32 bits, low 32 bits], both unsigned. */
export type Word64 = readonly [number, number];

function hexWord(hex: string, at: number): number {
  return Number.parseInt(hex.slice(at, at + 8), 16) >>> 0;
}

const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, "0");

/**
 * SipHash-2-4 of the ASCII text `message` under a 128-bit key written as 32
 * hex digits: k0 = digits 0–15, k1 = digits 16–31, each a 64-bit number, high
 * digits first. (The reference test vectors: tests/discounts/code-batch.test.ts.)
 */
export function sipHash24(keyHex: string, message: string): Word64 {
  return sipHash([hexWord(keyHex, 0), hexWord(keyHex, 8), hexWord(keyHex, 16), hexWord(keyHex, 24)], message);
}

/** 4 characters of `text` from `at` as a little-endian 32-bit number (the first is the lowest byte). */
function textWord(text: string, at: number): number {
  return ((text.charCodeAt(at) & 0xff) | ((text.charCodeAt(at + 1) & 0xff) << 8) | ((text.charCodeAt(at + 2) & 0xff) << 16) | ((text.charCodeAt(at + 3) & 0xff) << 24)) >>> 0;
}

/**
 * SipHash-2-4 under a key given as 16 ASCII characters — its bytes ARE the
 * key, as SipHash reads one: k0 = bytes 0–7, k1 = bytes 8–15, little-endian.
 * How the function payload carries a batch's check key (no parsing there).
 */
export function sipHash24TextKey(key16: string, message: string): Word64 {
  return sipHash([textWord(key16, 4), textWord(key16, 0), textWord(key16, 12), textWord(key16, 8)], message);
}

/** SipHash-2-4 with the key as [k0 high, k0 low, k1 high, k1 low]. */
function sipHash(key: readonly [number, number, number, number], message: string): Word64 {
  const [k0h, k0l, k1h, k1l] = key;
  let v0h = (k0h ^ 0x736f6d65) >>> 0;
  let v0l = (k0l ^ 0x70736575) >>> 0;
  let v1h = (k1h ^ 0x646f7261) >>> 0;
  let v1l = (k1l ^ 0x6e646f6d) >>> 0;
  let v2h = (k0h ^ 0x6c796765) >>> 0;
  let v2l = (k0l ^ 0x6e657261) >>> 0;
  let v3h = (k1h ^ 0x74656462) >>> 0;
  let v3l = (k1l ^ 0x79746573) >>> 0;
  let t = 0;
  const round = () => {
    // v0 += v1; v1 = rotl(v1, 13) ^ v0; v0 = rotl(v0, 32)
    t = v0l + v1l;
    v0h = (v0h + v1h + (t > 0xffffffff ? 1 : 0)) >>> 0;
    v0l = t >>> 0;
    t = ((v1h << 13) | (v1l >>> 19)) >>> 0;
    v1l = ((v1l << 13) | (v1h >>> 19)) >>> 0;
    v1h = (t ^ v0h) >>> 0;
    v1l = (v1l ^ v0l) >>> 0;
    t = v0h;
    v0h = v0l;
    v0l = t;
    // v2 += v3; v3 = rotl(v3, 16) ^ v2
    t = v2l + v3l;
    v2h = (v2h + v3h + (t > 0xffffffff ? 1 : 0)) >>> 0;
    v2l = t >>> 0;
    t = ((v3h << 16) | (v3l >>> 16)) >>> 0;
    v3l = ((v3l << 16) | (v3h >>> 16)) >>> 0;
    v3h = (t ^ v2h) >>> 0;
    v3l = (v3l ^ v2l) >>> 0;
    // v0 += v3; v3 = rotl(v3, 21) ^ v0
    t = v0l + v3l;
    v0h = (v0h + v3h + (t > 0xffffffff ? 1 : 0)) >>> 0;
    v0l = t >>> 0;
    t = ((v3h << 21) | (v3l >>> 11)) >>> 0;
    v3l = ((v3l << 21) | (v3h >>> 11)) >>> 0;
    v3h = (t ^ v0h) >>> 0;
    v3l = (v3l ^ v0l) >>> 0;
    // v2 += v1; v1 = rotl(v1, 17) ^ v2; v2 = rotl(v2, 32)
    t = v2l + v1l;
    v2h = (v2h + v1h + (t > 0xffffffff ? 1 : 0)) >>> 0;
    v2l = t >>> 0;
    t = ((v1h << 17) | (v1l >>> 15)) >>> 0;
    v1l = ((v1l << 17) | (v1h >>> 15)) >>> 0;
    v1h = (t ^ v2h) >>> 0;
    v1l = (v1l ^ v2l) >>> 0;
    t = v2h;
    v2h = v2l;
    v2l = t;
  };
  const n = message.length;
  const whole = n - (n % 8);
  const byte = (i: number) => message.charCodeAt(i) & 0xff;
  const absorb = (mh: number, ml: number) => {
    v3h = (v3h ^ mh) >>> 0;
    v3l = (v3l ^ ml) >>> 0;
    round();
    round();
    v0h = (v0h ^ mh) >>> 0;
    v0l = (v0l ^ ml) >>> 0;
  };
  for (let i = 0; i < whole; i += 8) {
    // Little-endian: byte i is the lowest.
    const ml = (byte(i) | (byte(i + 1) << 8) | (byte(i + 2) << 16) | (byte(i + 3) << 24)) >>> 0;
    const mh = (byte(i + 4) | (byte(i + 5) << 8) | (byte(i + 6) << 16) | (byte(i + 7) << 24)) >>> 0;
    absorb(mh, ml);
  }
  let lastL = 0;
  let lastH = ((n & 0xff) << 24) >>> 0;
  for (let i = whole; i < n; i += 1) {
    const shift = (i - whole) * 8;
    if (shift < 32) lastL = (lastL | (byte(i) << shift)) >>> 0;
    else lastH = (lastH | (byte(i) << (shift - 32))) >>> 0;
  }
  absorb(lastH, lastL);
  v2l = (v2l ^ 0xff) >>> 0;
  round();
  round();
  round();
  round();
  return [(v0h ^ v1h ^ v2h ^ v3h) >>> 0, (v0l ^ v1l ^ v2l ^ v3l) >>> 0];
}

/** `count` characters of `chars` from a hash of `${text}|<block>`, 4 a block (see the header). */
function hashChars(hash: (message: string) => Word64, text: string, chars: string, count: number): string {
  let out = "";
  for (let block = 0; out.length < count; block += 1) {
    const [high, low] = hash(`${text}|${block}`);
    for (const w of [low & 0xffff, low >>> 16, high & 0xffff, high >>> 16]) {
      if (out.length < count) out += chars[(w * chars.length) >>> 16];
    }
  }
  return out;
}

/** The 64 characters a check key is written in (6 bits each). */
const KEY_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * The key the function checks a code with, derived from the batch's seed: 16
 * characters of `[A-Za-z0-9_-]` (96 bits), which are the SipHash key's bytes.
 */
export function codeBatchCheckKey(seed: string): string {
  return hashChars((message) => sipHash24(seed, message), "k", KEY_CHARS, 16);
}

/** The check characters of a code, given every OTHER character of it in order (upper-case). */
export function codeBatchCheck(checkKey: string, codeWithoutCheck: string, alphabet: CodeBatchAlphabet): string {
  return hashChars((message) => sipHash24TextKey(checkKey, message), codeWithoutCheck, CODE_BATCH_CHARS[alphabet], CODE_BATCH_CHECK_LENGTH[alphabet]);
}

// --- Generating -----------------------------------------------------------------------------------

/**
 * Every code the batch generated, index order, `removed` ones included (a
 * removed index keeps its place, so the indexes stay stable). Always the same
 * list for the same batch. A batch the sanitizer would refuse (a random part
 * too short for `count`) may give fewer than `count`.
 */
export function generateBatchCodes(batch: Pick<CodeBatch, "prefix" | "count" | "seed" | "length" | "alphabet" | "middle" | "suffix">): string[] {
  const chars = CODE_BATCH_CHARS[batch.alphabet];
  const checkLength = CODE_BATCH_CHECK_LENGTH[batch.alphabet];
  const bodyLength = batch.length - checkLength;
  const out: string[] = [];
  if (!chars || bodyLength < 1 || !CODE_BATCH_SEED_RE.test(batch.seed)) return out;
  const checkKey = codeBatchCheckKey(batch.seed);
  const fromSeed = (message: string) => sipHash24(batch.seed, message);
  const middle = batch.middle ?? "";
  const suffix = batch.suffix ?? "";
  const first = Math.min(firstPart(batch), bodyLength);
  const taken = new Set<string>();
  // A sanitized batch has ≥ 10 000 bodies a code: a repeat is rare, the bound is never met.
  const tries = batch.count * 4 + 1000;
  for (let i = 0; out.length < batch.count && i < tries; i += 1) {
    const body = hashChars(fromSeed, `b|${i}`, chars, bodyLength);
    if (taken.has(body)) continue;
    taken.add(body);
    const head = `${batch.prefix}${body.slice(0, first)}${middle}${body.slice(first)}`;
    out.push(`${head}${codeBatchCheck(checkKey, head + suffix, batch.alphabet)}${suffix}`);
  }
  return out;
}

/** A batch as a (possibly read-only) config holds it. */
export type CodeBatchView = Readonly<Omit<CodeBatch, "removed">> & { readonly removed?: readonly number[] };

/** The batch's codes that are in force: generated, minus the ones the merchant deleted. */
export function listBatchCodes(batch: CodeBatchView): string[] {
  const all = generateBatchCodes(batch);
  if (!batch.removed || batch.removed.length === 0) return all;
  const removed = new Set(batch.removed);
  return all.filter((_, i) => !removed.has(i));
}

/** The batch without `codes` (the ones that are its codes; any other text is ignored). Never mutates. */
export function removeBatchCodes(batch: CodeBatchView, codes: readonly string[]): CodeBatch {
  const drop = new Set(codes.map((code) => code.trim().toUpperCase()));
  const removed = new Set(batch.removed ?? []);
  generateBatchCodes(batch).forEach((code, i) => {
    if (drop.has(code)) removed.add(i);
  });
  const { removed: _before, ...rest } = batch;
  return removed.size === 0 ? rest : { ...rest, removed: [...removed].sort((a, b) => a - b) };
}

type RuleCodes = { readonly method?: string; readonly codes?: readonly string[]; readonly codeBatches?: readonly CodeBatchView[] };

/** How many codes a rule's batches have in force. */
export function batchCodeCount(rule: RuleCodes): number {
  let n = 0;
  for (const batch of rule.codeBatches ?? []) n += Math.max(0, batch.count - (batch.removed?.length ?? 0));
  return n;
}

/** The rule has a code in force: a hand-typed one, or one of a generated batch (what "a code rule with codes" means). */
export function ruleHasCodes(rule: RuleCodes): boolean {
  return (rule.codes?.length ?? 0) > 0 || batchCodeCount(rule) > 0;
}

/**
 * Every code of a rule that must exist in Shopify as a redeem code: the
 * hand-typed ones, then each batch's (upper-case, each once). What the sync
 * puts on the rule's discount node and what "has this rule any code?" means.
 */
export function ruleCodes(rule: RuleCodes): string[] {
  const out = new Set<string>();
  for (const code of rule.codes ?? []) out.add(code.toUpperCase());
  for (const batch of rule.codeBatches ?? []) for (const code of listBatchCodes(batch)) out.add(code);
  return [...out];
}

// --- The function's side --------------------------------------------------------------------------

/**
 * A batch in the function payload (one more entry of `FunctionRule.codeHashes`,
 * never taken for a hash: those are 8 characters), ONE text:
 *   <check key: 16 characters><alphabet: "0" both, "1" letters, "2" digits>
 *   <code length: one character, "0" + the length><suffix length: likewise><prefix>
 * 19 characters + the prefix, whatever the batch's size or pattern. The
 * function needs no more: a code is the batch's when it has that length,
 * starts with the prefix, and the K characters before its last `suffix length`
 * ones are the keyed check of all its other characters (a wrong middle or
 * suffix fails the check like any other wrong character). Built to be read
 * with almost no work: the key's characters are the key's bytes, each number
 * is one character.
 */
export type FunctionCodeBatch = string;

/** Where the prefix starts in a batch's payload text. */
export const CODE_BATCH_PAYLOAD_HEAD = 19;

const lengthChar = (n: number) => String.fromCharCode(48 + n);

export function codeBatchPayload(batch: Pick<CodeBatch, "prefix" | "seed" | "length" | "alphabet" | "middle" | "suffix">): FunctionCodeBatch {
  return `${codeBatchCheckKey(batch.seed)}${CODE_BATCH_ALPHABETS.indexOf(batch.alphabet)}${lengthChar(codeBatchCodeLength(batch))}${lengthChar(batch.suffix?.length ?? 0)}${batch.prefix}`;
}

/** A payload batch as the engine reads it. */
export interface ReadCodeBatch {
  /** 16 ASCII characters: the SipHash key's bytes. */
  key: string;
  prefix: string;
  alphabet: CodeBatchAlphabet;
  /** How long every code of the batch is. */
  codeLength: number;
  /** How many characters follow the check (the suffix). */
  suffixLength: number;
}

// eslint-disable-next-line no-control-regex
const PAYLOAD_RE = /^([\x00-\x7f]{16})([012])([\x00-\x7f])([\x00-\x7f])([A-Z0-9_-]+)$/;

/**
 * Tolerant reader (the Rust function reads the same way, batch.rs
 * `is_batch_code`): used only when it is a text of exactly that form — 16
 * ASCII characters (any: they are key bytes), one of "0" / "1" / "2", a
 * character "0" + n for the code's length n (0–64 = CONFIG_LIMITS.codeLength),
 * a character "0" + s for the suffix's, and a non-empty prefix of `[A-Z0-9_-]`
 * — that leaves at least one character between the prefix and the check.
 * Anything else is no batch at all (it matches nothing: fail closed).
 */
export function readCodeBatch(raw: unknown): ReadCodeBatch | null {
  const m = typeof raw === "string" ? PAYLOAD_RE.exec(raw) : null;
  if (!m) return null;
  const alphabet = CODE_BATCH_ALPHABETS[Number(m[2])];
  const codeLength = m[3].charCodeAt(0) - 48;
  const suffixLength = m[4].charCodeAt(0) - 48;
  const prefix = m[5];
  if (codeLength < 0 || codeLength > CONFIG_LIMITS.codeLength || suffixLength < 0) return null;
  if (codeLength - prefix.length - suffixLength <= CODE_BATCH_CHECK_LENGTH[alphabet]) return null;
  return { key: m[1], prefix, alphabet, codeLength, suffixLength };
}

/**
 * Is `code` a code of the batch? `code` = an entered code, trimmed and
 * upper-cased, all ASCII (the caller checks: plan.ts `matchCodes`). Its
 * length, its prefix, and the check of all its other characters.
 */
export function matchesCodeBatch(batch: ReadCodeBatch, code: string): boolean {
  if (code.length !== batch.codeLength || !code.startsWith(batch.prefix)) return false;
  const end = code.length - batch.suffixLength;
  const start = end - CODE_BATCH_CHECK_LENGTH[batch.alphabet];
  return code.slice(start, end) === codeBatchCheck(batch.key, code.slice(0, start) + code.slice(end), batch.alphabet);
}

// --- Making a batch -------------------------------------------------------------------------------

/** One batch's prefix starts the other's (or they are equal): a code could then belong to either. */
export function batchPrefixesClash(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a);
}

export interface CodeBatchSpec {
  /** How many codes. */
  count: number;
  /** Pro. Absent (and always on Free): a short random one, e.g. "KXTR-". */
  prefix?: string;
  /** Pro. Characters of the random part, check included; absent = the default, raised to the shortest that is safe. */
  length?: number;
  /** Pro. Absent = "both". */
  alphabet?: CodeBatchAlphabet;
  /** Pro. */
  middle?: string;
  /** Pro. */
  suffix?: string;
}

export interface CreateCodeBatchOptions {
  /** The shop's plan: Free takes `count` only (≤ codeBatchSizeFree); any Pro option on Free is `pro_required`. */
  plan: "free" | "pro";
  /**
   * The source of randomness: `n` → n random bytes. Production passes a
   * cryptographic one (`(n) => crypto.getRandomValues(new Uint8Array(n))`);
   * tests a seeded one, and then the batch is the same every run.
   */
  randomBytes: (n: number) => Uint8Array;
  /** Every other code of the shop the caller knows: the Won rules' hand-typed codes and the shop's native discount codes. */
  otherCodes?: readonly string[];
  /** The prefixes of every other batch of the shop (all rules). */
  otherPrefixes?: readonly string[];
  /** Batch ids already used in the rule. */
  existingIds?: readonly string[];
}

export type CodeBatchError =
  | "count" // not a whole number 1–max (params: max)
  | "pro_required" // a pattern option on Free (params: field)
  | "prefix_invalid" // not 2–12 characters of A–Z 0–9 _ - (params: min, max)
  | "prefix_taken" // clashes with another batch's prefix (params: prefix)
  | "literal_invalid" // middle / suffix not ≤ 12 characters of A–Z 0–9 _ - (params: field, max)
  | "alphabet"
  | "length" // the random part is too short for the count, or too long (params: min, max)
  | "collision"; // could not find codes clear of the shop's other codes (practically never)

export type CreateCodeBatchResult =
  | { ok: true; batch: CodeBatch; codes: string[] }
  | { ok: false; error: CodeBatchError; params?: Record<string, string | number> };

const hexOf = (bytes: Uint8Array) => Array.from(bytes, (b) => (b & 0xff).toString(16).padStart(2, "0")).join("");

/** "KXTR-": four random letters and a dash, clear of the other batches' prefixes. */
function randomPrefix(randomBytes: (n: number) => Uint8Array, others: readonly string[]): string | null {
  const letters = CODE_BATCH_CHARS.letters;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const prefix = `${Array.from(randomBytes(4), (b) => letters[b % letters.length]).join("")}-`;
    if (!others.some((other) => batchPrefixesClash(prefix, other))) return prefix;
  }
  return null;
}

/**
 * Make a batch: validate the spec for the plan, draw a seed, and make sure no
 * generated code is — or could be taken for — another code of the shop
 * (`otherCodes`: equal text, equal function hash, or a text the new batch's
 * check would accept); a clash draws another seed. Pure given `randomBytes`.
 * The caller appends `batch` to the rule's `codeBatches` and saves; `codes` is
 * the list to show.
 */
export function createCodeBatch(spec: CodeBatchSpec, opts: CreateCodeBatchOptions): CreateCodeBatchResult {
  const pro = opts.plan === "pro";
  const fail = (error: CodeBatchError, params?: Record<string, string | number>): CreateCodeBatchResult => (params ? { ok: false, error, params } : { ok: false, error });
  const max = pro ? CONFIG_LIMITS.codeBatchSize : CONFIG_LIMITS.codeBatchSizeFree;
  if (!Number.isInteger(spec.count) || spec.count < 1 || spec.count > max) return fail("count", { max });
  if (!pro) {
    for (const field of ["prefix", "length", "alphabet", "middle", "suffix"] as const) {
      if (spec[field] !== undefined && spec[field] !== "") return fail("pro_required", { field });
    }
  }
  const alphabet = spec.alphabet ?? CODE_BATCH_DEFAULTS.alphabet;
  if (!CODE_BATCH_ALPHABETS.includes(alphabet)) return fail("alphabet");
  const literalMax = CONFIG_LIMITS.codeBatchLiteralLength;
  const middle = (spec.middle ?? "").trim().toUpperCase();
  const suffix = (spec.suffix ?? "").trim().toUpperCase();
  for (const [field, value] of [["middle", middle], ["suffix", suffix]] as const) {
    if (value.length > literalMax || !CODE_BATCH_LITERAL_RE.test(value)) return fail("literal_invalid", { field, max: literalMax });
  }
  const minLength = codeBatchMinLength(alphabet, spec.count);
  const maxLength = CONFIG_LIMITS.codeBatchRandomLength;
  const length = spec.length ?? Math.max(CODE_BATCH_DEFAULTS.length, minLength);
  if (!Number.isInteger(length) || length < minLength || length > maxLength) return fail("length", { min: minLength, max: maxLength });

  const others = (opts.otherPrefixes ?? []).map((p) => p.trim().toUpperCase()).filter((p) => p !== "");
  let prefix: string;
  if (spec.prefix !== undefined && spec.prefix !== "") {
    prefix = spec.prefix.trim().toUpperCase();
    if (prefix.length < CONFIG_LIMITS.codeBatchPrefixMin || prefix.length > literalMax || !CODE_BATCH_LITERAL_RE.test(prefix)) {
      return fail("prefix_invalid", { min: CONFIG_LIMITS.codeBatchPrefixMin, max: literalMax });
    }
    if (others.some((other) => batchPrefixesClash(prefix, other))) return fail("prefix_taken", { prefix });
  } else {
    const drawn = randomPrefix(opts.randomBytes, others);
    if (drawn === null) return fail("prefix_taken", { prefix: "" });
    prefix = drawn;
  }

  const usedIds = new Set(opts.existingIds ?? []);
  let id = `b_${hexOf(opts.randomBytes(6))}`;
  while (usedIds.has(id)) id = `b_${hexOf(opts.randomBytes(6))}`;

  const otherCodes = [...new Set((opts.otherCodes ?? []).map((code) => code.trim().toUpperCase()).filter((code) => code !== ""))];
  const otherHashes = new Set(otherCodes.map(codeHash));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const batch: CodeBatch = { id, prefix, count: spec.count, seed: hexOf(opts.randomBytes(16)), length, alphabet, ...(middle ? { middle } : {}), ...(suffix ? { suffix } : {}) };
    const codes = generateBatchCodes(batch);
    if (codes.length !== spec.count) continue;
    const read = readCodeBatch(codeBatchPayload(batch));
    if (!read) continue;
    const own = new Set(codes);
    const clash =
      codes.some((code) => otherHashes.has(codeHash(code))) ||
      otherCodes.some((code) => !own.has(code) && /^[\x20-\x7e]*$/.test(code) && matchesCodeBatch(read, code));
    if (!clash) return { ok: true, batch, codes };
  }
  return fail("collision");
}

/** A batch uses a Pro pattern option (anything but the default random part behind a prefix). */
export function isProCodeBatch(batch: Pick<CodeBatch, "length" | "alphabet" | "middle" | "suffix">): boolean {
  return Boolean(batch.middle) || Boolean(batch.suffix) || batch.alphabet !== CODE_BATCH_DEFAULTS.alphabet || batch.length !== CODE_BATCH_DEFAULTS.length;
}
