// PARITY (DATA-4, one brain): the Rust function must give exactly the output of
// the TS engine (@won/core planCart + emitForNode through the reference adapter
// tests/reference-adapter.js).
//
//   1. fixtures, TS: the TS reference reproduces every committed fixture's output;
//   2. fixtures, Wasm text: the output text function-runner prints for the Wasm
//      equals the fixture's expected output rendered the same way (sorted keys,
//      2-space indent) — so even the number form the Wasm wrote (an integer 10,
//      not a float 10.0) must match, not only the parsed value;
//   3. output size: every output stays within the function's budget, under
//      Shopify's 20 kB output limit; the Wasm stays under the 256 kB size limit;
//   4. random: seeded random carts (up to 260 lines) and configs — junk included,
//      since the shop config and product metafields are data the function must
//      read tolerantly, and rule ids with non-ASCII, astral and long text so the
//      UTF-16 tie order is compared — through the compiled Wasm and through the
//      TS reference; the outputs must be deep-equal, AND every engine branch must
//      have been hit a minimum number of times (thin coverage fails loudly).
//      Besides ordinary carts the generator makes "big" carts (150–260 lines,
//      200-character names, distinct Pro stack amounts or rounding ties: the
//      output goes over the budget, stacks degrade and candidates are dropped)
//      and "large" carts (quantities up to 5 000, prices up to 99 999 999.99,
//      amounts at the money cap); codes padded with NBSP / BOM / tab, astral and
//      case-mapping codes; lower-case and padded countries; priorities up to
//      1 000; CZK / EUR / JPY / KWD / HUF / BHD / USD; entitled minimums;
//      margin protection (MVP 2): on / off / legacy / junk payloads, collection
//      overrides, cost prices in the shop currency and others, junk costs,
//      presentmentCurrencyRate values (decimal strings, numbers, junk) in carts
//      of exponent 0 / 2 / 3, big over-budget carts with capped and tight lines;
//   5. memory: the Wasm uses a bump allocator (src/alloc.rs), so every run's
//      linear memory is checked against a bound far below Shopify's 10 000 kB.
//
// PARITY_CASES (per seed, default 400) and PARITY_SEEDS (comma-separated) override
// the random run.

import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { buildFunction, getFunctionInfo } from "@shopify/shopify-function-test-helpers";
import { codeHash } from "@won/core/discounts/code-hash";
import { beforeAll, describe, expect, test } from "vitest";

import { normalizeCart } from "@won/core/discounts/cart";
import { roundingTiePossible } from "@won/core/discounts/function-output";
import { costMinorUnits, MAX_MARGIN_REFS, marginFloorUnit, readMarginPayload, resolveProductMargin } from "@won/core/discounts/margin";
import { readMaxCodeLength } from "@won/core/discounts/plan";
import { orderSetLimit, searchOrderSets } from "@won/core/discounts/plan-margin";

import {
  adaptInput,
  emissionFor,
  mapOutput,
  OUTPUT_BUDGET_BYTES,
  OUTPUT_LIMIT_BYTES,
  outputBudget,
  outputBytes,
  runCartLines,
  runDelivery,
} from "./reference-adapter.js";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(testsDir, "fixtures");
const LINES = "cart-lines-discounts-generate-run";
const DELIVERY = "cart-delivery-options-discounts-generate-run";
const CASES = Number(process.env.PARITY_CASES ?? 400);
const SEEDS = (process.env.PARITY_SEEDS ?? "20260928,1,2,3,5,8").split(",").map(Number);
/** Every branch below must be hit at least this often over the whole random run. */
const MIN_HITS = 20;
/** Shopify's compiled binary size limit (shopify.dev/docs/api/functions/2026-04, "Fixed limits": 256 kB, 1 kB = 1000 B). */
const WASM_LIMIT_BYTES = 256_000;
/**
 * Linear memory a run may use (function-runner `memory_usage`, KB). Shopify's
 * limit is 10 000 kB; the bump allocator (src/alloc.rs) never reuses memory, so
 * every run is checked against this much lower bound.
 */
const MEMORY_BOUND_KB = 4_000;

/** The TS reference output for a function input. */
export function referenceOutput(exportName, input) {
  return exportName === DELIVERY ? runDelivery(input) : runCartLines(input);
}

const fixtureFiles = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();
const readFixture = (file) => JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf8"));

describe("parity: the TS reference reproduces every fixture", () => {
  for (const file of fixtureFiles) {
    test(file, () => {
      const { payload } = readFixture(file);
      expect(referenceOutput(payload.export, payload.input)).toEqual(payload.output);
    });
  }
});

describe("output size: every fixture output fits the budget", () => {
  test("budget < Shopify's limit, and the worst-case output fixtures exist", () => {
    expect(OUTPUT_BUDGET_BYTES).toBeLessThan(OUTPUT_LIMIT_BYTES);
    for (const name of ["lines-pro-stack-output-percent", "lines-pro-stack-output-degraded", "lines-output-truncated"]) {
      expect(fixtureFiles).toContain(`${name}.json`);
    }
  });
  for (const file of fixtureFiles) {
    test(file, () => {
      const { payload } = readFixture(file);
      // The budget scales with the line count above 200, like Shopify's limit.
      const bytes = outputBytes(payload.output);
      expect(bytes).toBeLessThanOrEqual(outputBudget(payload.input.cart.lines.length));
    });
  }
});

// --- Random cases ---------------------------------------------------------------------------

/** mulberry32: a small seeded PRNG (deterministic cases for a given seed). */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Rule ids: ASCII, Latin and Greek letters, CJK, an astral emoji and U+FF61 (which
 * sort differently by UTF-16 unit than by code point), a 64-character id, and ids
 * with "@" (a ref splits at the first "@") and a line break.
 */
const RULE_IDS = ["r0", "r1", "ř2", "Ω3", "日本4", "😀5", "｡6", `long-${"x".repeat(59)}`, "a@b", "n\nl"];
const CODES = [
  "SAVE10",
  "VIP",
  "Léto",
  "straße",
  "  spaced ",
  "X1",
  // Padding String.prototype.trim removes (NBSP, BOM, tab), an astral code,
  // and full case mappings (ligature ﬁ → FI, dotless ı → I, ß → SS).
  "\u00a0NBSP10\u00a0",
  "\ufeffBOM5",
  "\tTAB\t",
  "😀EMOJI",
  "ﬁx",
  "ıstanbul",
];
/** A 200-character rule name (big carts: long messages make the output large). */
const longName = (id) => `${id} ${"Velmi dlouhý název slevy ".repeat(9)}`.slice(0, 200);
const vid = (n) => `gid://shopify/ProductVariant/${n}`;

/**
 * @param {number} seed
 * @param {boolean | "mesh" | "tied" | "many" | "long"} [onlySearch] true: only margin order-search carts (searchCase); "mesh": only Pro mesh carts (meshCase); "tied": only order-search carts with many tied lines (tiedCase); "many": many markets and entered codes (manyCase); "long": entered codes of any length against the longest Won code (longCase)
 */
function generator(seed, onlySearch = false) {
  const rnd = prng(seed);
  const int = (n) => Math.floor(rnd() * n);
  const chance = (p) => rnd() < p;
  const pick = (list) => list[int(list.length)];
  const some = (list, p = 0.5) => list.filter(() => chance(p));
  // Per case: a well-formed config and cart (like the sync writes them), or a
  // hostile one (junk in every place the function reads tolerantly).
  let hostile = false;
  const junk = (p) => hostile && chance(p);

  // "large" carts: huge quantities, prices and amounts (up to the money cap and past it).
  let large = false;
  const money = () =>
    junk(0.3)
      ? pick([{ CZK: -100 }, { CZK: "50" }, {}, null, { CZK: 150.5 }, { JPY: 500 }, { CZK: 5e12, HUF: 9e18 }])
      : large && chance(0.8)
        ? pick([
            // At the money cap (1e12) or over it, in every cart currency: both engines read the cap.
            { CZK: 1e12, EUR: 5e12, JPY: 1e12, KWD: 2e12, HUF: 9e18, BHD: 1e12, USD: 1e13 },
            { CZK: 3e15, EUR: 1e12, JPY: 4e12, KWD: 1e12, HUF: 1e12, BHD: 7e12, USD: 1e12 },
            { CZK: pick([123456789, 99999999999]), KWD: 1e12, EUR: 999999999 },
          ])
        : pick([
            { CZK: pick([5000, 10000, 2550, 999999]) },
            { CZK: 3000, EUR: 200 },
            { EUR: pick([100, 500]) },
            { CZK: 1500, JPY: 500, KWD: 1234 },
            { HUF: pick([150000, 99900]), USD: 999 },
            { BHD: pick([1250, 7005]), USD: 500, CZK: 4005 },
          ]);
  const value = () =>
    junk(0.25)
      ? pick([{ kind: "percentage", percent: pick([0, 120, -5, "10"]) }, { kind: "bogus" }, null, { kind: "fixed", amount: money() }])
      : pick([
          // Repeated percents make equal amounts (ties) common.
          { kind: "percentage", percent: pick([10, 10, 15, 15, 20, 25, 12.5, 33.333, 50, 100]) },
          { kind: "percentage", percent: pick([10, 15]) },
          { kind: "percentage", percent: pick([5, 30]) },
          { kind: "fixed", amount: money() },
          { kind: "fixed", amount: money() },
          { kind: "freeShipping" },
        ]);
  const target = () =>
    junk(0.2) ? pick([{ kind: "x" }, null, "products"]) : pick([{ kind: "products" }, { kind: "products" }, { kind: "products" }, { kind: "collections" }, { kind: "order" }, { kind: "shipping" }]);
  const schedule = () =>
    chance(0.8)
      ? undefined
      : junk(0.5)
        ? pick([{ invalid: true }, {}, null, "2026-10-01", { startsOn: "2026-09-01T00:00:00+02:00" }])
        : pick([{ startsOn: "2026-10-01" }, { startsOn: "2026-10-02" }, { endsOn: "2026-09-30" }, { startsOn: "2026-09-01", endsOn: "2026-10-01" }]);

  function rule(id, ids) {
    const method = junk(0.1) ? "other" : chance(0.35) ? "code" : "automatic";
    const r = { id: junk(0.1) ? pick(["", 5, undefined]) : id };
    r.enabled = junk(0.15) ? pick([false, "true", undefined]) : chance(0.93);
    if (!junk(0.2)) r.name = chance(0.85) ? pick([`Sleva ${id}`, "Sleva A", "Sleva B"]) : "";
    else r.name = pick([7, undefined]);
    r.method = method;
    if (method === "code") r.codeHashes = some(CODES, 0.4).map(codeHash).concat(junk(0.2) ? ["ZZZZZZZZ", 3] : []);
    r.value = value();
    r.target = target();
    if (chance(0.3)) r.priority = junk(0.3) ? pick([1.7, "5", -3, 1e20]) : pick([0, 1, 2, 3, 7, 999, 1000]);
    if (chance(0.35)) {
      r.minimum = junk(0.3)
        ? pick([{}, "x", { quantity: 2.5 }, { subtotal: { CZK: 1000 }, scope: "ENTITLED" }, { quantity: 2, scope: 5 }])
        : pick([
            { subtotal: money() },
            { quantity: pick([1, 2, 4]) },
            { subtotal: { CZK: 30000 }, quantity: 2 },
            { subtotal: pick([{ CZK: 30000 }, { EUR: 1500 }, { HUF: 900000 }]), scope: "entitled" },
            { subtotal: { CZK: 50000, EUR: 2000, JPY: 5000, KWD: 50000, HUF: 500000, BHD: 20000, USD: 2500 }, scope: "entitled" },
            { quantity: pick([2, 3]), scope: "entitled" },
            { quantity: pick([2, 4]), scope: "entitled" },
            { subtotal: { CZK: 50000, EUR: 2000, USD: 2500 }, quantity: 2, scope: pick(["entitled", "cart"]) },
          ]);
    }
    const s = schedule();
    if (s !== undefined) r.schedule = s;
    if (chance(0.15)) r.targeting = junk(0.4) ? pick([{ markets: ["us", 4] }, { markets: [] }, null]) : pick([{ markets: ["eu"] }, { markets: ["us"] }, { segments: ["vip"] }]);
    if (chance(0.35)) r.combinesWith = { ruleIds: some(ids, 0.4).concat(junk(0.3) ? ["ghost"] : []) };
    return r;
  }

  function patch(ids) {
    const p = {};
    if (chance(0.6)) p.value = value();
    if (chance(0.2)) p.target = target();
    if (chance(0.15)) p.enabled = junk(0.5) ? null : pick([true, false]);
    if (chance(0.15)) p.name = junk(0.5) ? null : pick(["Kampaň", ""]);
    if (chance(0.1)) p.minimum = junk(0.5) ? null : { subtotal: { CZK: 5000 } };
    if (chance(0.1)) p.targeting = junk(0.5) ? null : { markets: ["eu"] };
    if (chance(0.1)) p.combinesWith = { ruleIds: some(ids, 0.3) };
    if (junk(0.1)) p.id = "hijack";
    return p;
  }

  /**
   * UTF-16 tie mode: two rules of the same value on the same lines, whose ids
   * sort one way by UTF-16 unit (JS `<`) and the other way by byte / code point
   * (an astral character against one in U+E000–U+FFFF): only the id tie-break
   * picks the winner.
   */
  function tieConfig() {
    const [a, b] = pick([
      ["😀5", "\uFF616"],
      ["😎t", "\uFFFDt"],
      ["x😀", "x\uE000"],
    ]);
    const same = { enabled: true, method: "automatic", value: { kind: "percentage", percent: pick([10, 15]) }, target: { kind: "products" } };
    const rules = [
      { id: a, name: `Sleva ${a}`, ...same },
      { id: b, name: `Sleva ${b}`, ...same },
    ];
    if (chance(0.5)) rules.reverse();
    return { config: { modules: { codes: { rules } }, marketCountries: {} }, ids: [a, b], codeRules: [], tie: true };
  }

  function config() {
    if (!hostile && chance(0.12)) return tieConfig();
    if (junk(0.15)) return { config: pick([null, { percent: 9 }, [], { modules: { codes: { rules: {} } } }]), ids: RULE_IDS, codeRules: [] };
    const ids = some(RULE_IDS, 0.6);
    if (ids.length < 2) ids.push("r0", "r1");
    const rules = ids.map((id) => rule(id, ids));
    if (junk(0.3)) rules.push(rule(pick(ids), ids), "junk", null);
    // A fixed shipping discount (on a split shipment it must go to one delivery group).
    if (chance(0.4)) {
      const amount = chance(0.8) ? { CZK: 5000, EUR: 300, JPY: 800, KWD: 1500, HUF: 150000, BHD: 1200, USD: 400 } : money();
      rules.push({ id: "ship-fixed", enabled: true, name: "Doprava fix", method: "automatic", value: { kind: "fixed", amount }, target: { kind: "shipping" } });
    }
    const campaignId = chance(0.45) ? "bf" : pick([null, "old"]);
    const c = {
      schemaVersion: 1,
      campaignId,
      campaignVarsVersion: campaignId ? pick(["v1", "v1", "v2"]) : null,
      engine: {
        combination: {
          outletWithAnything: chance(0.2),
          productWithOrder: chance(0.75),
          productWithShipping: chance(0.8),
          orderWithShipping: chance(0.85) ? true : junk(0.5) ? "no" : false,
        },
      },
      marketCountries: { eu: ["CZ", "sk"], us: ["US"], none: [] },
      modules: { codes: { rules } },
      campaigns: chance(campaignId === "bf" ? 0.85 : 0.3)
        ? [
            {
              id: pick(["bf", "bf", "other"]),
              killed: chance(0.1),
              overrides: Array.from({ length: 1 + int(3) }, () => ({ ruleId: pick(ids), patch: junk(0.2) ? "x" : patch(ids) })),
            },
          ]
        : [],
    };
    if (junk(0.2)) delete c.engine;
    if (chance(0.6)) c.modules.margin = marginPayload();
    return { config: c, ids, codeRules: rules.filter((r) => r && r.method === "code") };
  }

  // --- Margin protection (MVP 2) ---
  const MARGIN_COLLECTIONS = ["11", "22", "33", "44"];
  /** modules.margin as the shared config carries it (margin.ts FunctionMarginPayload), junk included. */
  function marginPayload() {
    if (junk(0.3)) {
      return pick([
        { enabled: "true", max: 20 },
        { enabled: true },
        { enabled: true, max: "20" },
        { global: { maxDiscountPercent: 10 }, perCollection: [] },
        [{ enabled: true, max: 20 }],
        { enabled: true, max: pick([140, -5]), min: pick([120, -3, "x", null]), cur: pick(["czk", "CZKK", 5, "EUR"]), col: pick([7, [1], { 11: [150, -1], 22: [5], 33: ["x", 2], 44: [null, null] }]) },
      ]);
    }
    if (chance(0.25)) return { enabled: false };
    // A 0 % ceiling (no discount at all without a cost price) makes floored orders common.
    const out = { enabled: true, max: pick([0, 0, 10, 20, 32, 35, 50, 70, 100]) };
    if (chance(0.7)) out.min = pick([0, 5, 10, 20, 40, 60, 95]);
    if (chance(0.9)) out.cur = "CZK";
    if (chance(0.4)) {
      out.col = {};
      for (const id of some(MARGIN_COLLECTIONS, 0.5)) out.col[id] = [chance(0.6) ? pick([0, 20, 50, 80]) : null, chance(0.6) ? pick([0, 5, 15, 40]) : null];
    }
    return out;
  }
  /** The variant metafield `{cost, cur}` (MAJOR units of the shop currency), junk included. */
  function variantCost() {
    if (chance(0.2)) return null;
    if (junk(0.25)) return { jsonValue: pick([{ cost: "5", cur: "CZK" }, { cost: -1, cur: "CZK" }, { cost: 0, cur: "CZK" }, [5], "x", { cur: "CZK" }, { cost: 5, cur: 5 }]) };
    return { jsonValue: { cost: pick([0.01, 1, 5, 12.34, 20, 45.5, 80, 99.99, 150, 700, 999.99, 9999]), cur: pick(["CZK", "CZK", "CZK", "CZK", "EUR", "czk"]) } };
  }
  /** presentmentCurrencyRate (shop → cart), as Shopify sends it (a decimal string), junk, long and missing included. */
  const longRate = () => `${pick(["0", "0", "1", "25", "0.0"])}.${Array.from({ length: 14 + int(12) }, () => int(10)).join("")}${int(9) + 1}`;
  const rate = () =>
    chance(0.15)
      ? longRate()
      : pick(["1.0", "1.0", "0.04", "0.0405", "25.3", "6.5", "0.0133", "0.0", "abc", " 0.04 ", 7, "1e3", "0.12345678901234567", null, undefined]);

  /**
   * The product metafields: one value per product, shared by every line of that
   * product (the sync writes one metafield per product). Variants of product p
   * are p·100 + 1…4.
   */
  function products(ids) {
    return Array.from({ length: 1 + int(10) }, (_, k) => {
      const p = k + 1;
      if (chance(0.08)) return { p, won: null };
      if (junk(0.1)) return { p, won: { jsonValue: pick([["r1"], "r1", 3]) } };
      const refs = () =>
        some(ids, 0.45)
          .map((id) => (chance(0.12) ? `${id}@${pick(["bf", "other"])}` : id))
          .concat(junk(0.3) ? ["ghost", 9] : []);
      const won = { ruleIds: refs() };
      if (chance(0.2)) {
        const v = p * 100 + 1 + int(4);
        won.variantRuleIds = chance(0.7) ? { [String(v)]: refs() } : { [vid(v)]: refs() };
      }
      if (chance(0.15)) won.outlet = chance(0.4) ? true : some([1, 2, 3, 4], 0.5).map((k2) => vid(p * 100 + k2));
      if (chance(0.4)) won.marginRefs = junk(0.3) ? pick(["11", [11, "22"], null]) : some([...MARGIN_COLLECTIONS, "99"], 0.4);
      // Every even product with 3+ refs lists 2 more (legacy data, more than MAX_MARGIN_REFS: the
      // payload's strictest setting), without a draw of its own (the cases after it stay as they were).
      if (Array.isArray(won.marginRefs) && won.marginRefs.length >= 3 && p % 2 === 0) won.marginRefs = [...won.marginRefs, "55", "66"];
      return { p, won: { jsonValue: won } };
    });
  }

  function line(n, catalog) {
    const product = pick(catalog);
    const variant = product.p * 100 + 1 + int(4);
    return {
      id: `gid://shopify/CartLine/${n}`,
      quantity: large ? pick([1, 7, 999, 5000, 5000]) : pick([1, 1, 2, 3, 5, 0]),
      cost: {
        amountPerQuantity: {
          amount: large
            ? pick(["99999999.99", "12345678", "0.01", "5000000.05", "77777.775"])
            : pick(["100.0", "249.9", "30.0", "0.5", "1000", "12.345", "10.05", "999.99", "0.0", "49.95", "27.5", "3.35"]),
        },
      },
      gift: chance(0.07) ? { value: pick(["tier-1", "", null]) } : null,
      merchandise: chance(0.93)
        ? { __typename: "ProductVariant", id: vid(variant), wonVariant: variantCost(), product: { wonProduct: product.won } }
        : { __typename: "CustomProduct" },
    };
  }

  /**
   * A big cart for the output budget: 150–260 lines of distinct prices, rules
   * with 200-character names. "stacks": two combinable rules, every line a
   * different stack amount (exact output far over the budget → the stacks
   * degrade to their top rule). "ties": a percent on prices ending in 5
   * haléřů / cents — every line a rounding tie emitted as its own exact amount
   * → the ties go back to their percent. "rules": 60–90 fixed rules, two values
   * each, nothing to degrade → the smallest candidates are dropped.
   */
  function bigCase() {
    const mode = pick(["stacks", "ties", "rules"]);
    const ties = mode === "ties";
    const ids = ["big1", "big2", "big3"];
    const ruleCount = 60 + int(31);
    const manyRules = Array.from({ length: ruleCount }, (_, k) => ({
      id: `m${k + 1}`,
      enabled: true,
      name: longName(`m${k + 1}`),
      method: "automatic",
      value: { kind: "fixed", amount: { CZK: 3000, EUR: 300, USD: 300 } },
      target: { kind: "products" },
    }));
    const rules = mode === "rules" ? manyRules : [
      { id: "big1", enabled: true, name: longName("big1"), method: "automatic", value: { kind: "percentage", percent: pick([10, 12.5, 30]) }, target: { kind: "products" } },
      {
        id: "big2",
        enabled: true,
        name: longName("big2"),
        method: "automatic",
        value: ties ? { kind: "percentage", percent: 10 } : { kind: "fixed", amount: { CZK: pick([999, 1500, 12345]), EUR: 99, USD: 250 } },
        target: { kind: "products" },
        ...(ties ? {} : { combinesWith: { ruleIds: ["big1"] } }),
      },
      { id: "big3", enabled: true, name: longName("big3"), method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "order" } },
    ];
    const cents = ties ? ["05", "15", "25", "35", "45", "55", "65", "75", "85", "95"] : ["00", "10", "20", "40", "50", "90"];
    const count = 150 + int(111);
    // Margin protection on half the big carts: capped lines (never relaxed) and tight lines (ties stay exact).
    const margin = chance(0.5) ? { enabled: true, max: pick([15, 20, 30, 100]), cur: "CZK" } : null;
    const lines = Array.from({ length: count }, (_, i) => ({
      id: `gid://shopify/CartLine/${i + 1}`,
      quantity: pick([1, 1, 1, 2]),
      cost: {
        amountPerQuantity: {
          // "rules": a cheap item (the fixed 30 is the whole price → 100 %) or a dearer one (30 per item).
          amount: mode === "rules" ? (chance(0.5) ? `${10 + int(17)}.50` : `${100 + int(23)}.00`) : `${10 + int(990)}.${pick(cents)}`,
        },
      },
      gift: null,
      merchandise: {
        __typename: "ProductVariant",
        id: vid(10000 + i),
        wonVariant: margin && chance(0.6) ? { jsonValue: { cost: pick([1, 5, 9.5, 20, 45, 300]), cur: "CZK" } } : null,
        product: {
          wonProduct: {
            jsonValue: { ruleIds: mode === "rules" ? [`m${(i % ruleCount) + 1}`] : ties ? [pick(["big1", "big2"])] : ["big1", "big2"] },
          },
        },
      },
    }));
    return {
      exportName: LINES,
      tie: false,
      input: {
        triggeringDiscountCode: null,
        enteredDiscountCodes: [],
        discount: {
          discountClasses: ["PRODUCT", "ORDER", "SHIPPING"],
          vars: { jsonValue: { role: "automatic", campaignId: null, campaignStart: "1970-01-01T00:00:00", campaignEnd: "1970-01-01T00:00:00", varsVersion: null } },
        },
        shop: {
          config: {
            jsonValue: {
              schemaVersion: 1,
              campaignId: null,
              campaignVarsVersion: null,
              marketCountries: {},
              modules: { codes: { rules }, ...(margin ? { margin } : {}) },
              campaigns: [],
            },
          },
          localTime: { date: "2026-10-01", campaignActive: false },
        },
        localization: { country: { isoCode: "CZ" }, language: { isoCode: pick(["CS", "EN"]) } },
        presentmentCurrencyRate: pick(["1.0", "0.04", "0.0405"]),
        cart: { cost: { subtotalAmount: { currencyCode: pick(["CZK", "CZK", "EUR", "USD"]) } }, lines },
      },
      ids,
    };
  }

  /**
   * A split shipment: 2–4 delivery groups and a fixed shipping amount that wins
   * (only shipping rule), so the "first group only" mapping is compared often.
   */
  function splitShipmentCase() {
    const currency = pick(["CZK", "EUR", "JPY", "KWD", "HUF", "BHD", "USD"]);
    const rules = [
      { id: "ship", enabled: true, name: pick(["Doprava fix", ""]), method: "automatic", value: { kind: "fixed", amount: { [currency]: pick([5000, 150, 99999]) } }, target: { kind: "shipping" } },
      { id: "r0", enabled: true, name: "Sleva r0", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "products" } },
    ];
    if (chance(0.3)) rules[0].minimum = { subtotal: { [currency]: pick([100, 1e9]) }, ...(chance(0.5) ? { scope: "entitled" } : {}) };
    return {
      exportName: DELIVERY,
      tie: false,
      input: {
        triggeringDiscountCode: null,
        enteredDiscountCodes: [],
        discount: {
          discountClasses: ["PRODUCT", "ORDER", "SHIPPING"],
          vars: { jsonValue: { role: "automatic", campaignId: null, campaignStart: "1970-01-01T00:00:00", campaignEnd: "1970-01-01T00:00:00", varsVersion: null } },
        },
        shop: {
          config: { jsonValue: { schemaVersion: 1, campaignId: null, campaignVarsVersion: null, marketCountries: {}, modules: { codes: { rules } }, campaigns: [] } },
          localTime: { date: "2026-10-01", campaignActive: false },
        },
        localization: { country: { isoCode: "CZ" }, language: { isoCode: pick(["CS", "EN"]) } },
        cart: {
          cost: { subtotalAmount: { currencyCode: currency } },
          deliveryGroups: Array.from({ length: 2 + int(3) }, (_, i) => ({ id: `gid://shopify/CartDeliveryGroup/${i + 1}` })),
          lines: Array.from({ length: 1 + int(5) }, (_, i) => ({
            id: `gid://shopify/CartLine/${i + 1}`,
            quantity: pick([1, 2, 3]),
            cost: { amountPerQuantity: { amount: pick(["100.0", "49.95", "1000"]) } },
            gift: null,
            merchandise: { __typename: "ProductVariant", id: vid(500 + i), product: { wonProduct: { jsonValue: { ruleIds: ["r0"] } } } },
          })),
        },
      },
    };
  }

  /**
   * Amounts at the money cap: unit prices of 2·10¹² minor units and fixed rule
   * amounts at or over 10¹² (up to 9·10¹⁸), so the cap binds (per item and on
   * the order) in both engines.
   */
  function capCase() {
    const currency = pick(["CZK", "EUR", "JPY", "KWD", "HUF", "BHD", "USD"]);
    const digits = currency === "JPY" ? 0 : currency === "KWD" || currency === "BHD" ? 3 : 2;
    const price = digits === 0 ? "2000000000000" : `${"2" + "0".repeat(12 - digits)}.${"0".repeat(digits)}`;
    const rules = [
      { id: "cap", enabled: true, name: pick(["Strop", ""]), method: "automatic", value: { kind: "fixed", amount: { [currency]: pick([1e12, 5e12, 9e18]) } }, target: { kind: "products" } },
      { id: "capo", enabled: true, name: "Strop objednávky", method: "automatic", value: { kind: "fixed", amount: { [currency]: pick([1e12, 3e15]) } }, target: { kind: "order" } },
    ];
    return {
      exportName: LINES,
      tie: false,
      input: {
        triggeringDiscountCode: null,
        enteredDiscountCodes: [],
        discount: {
          discountClasses: ["PRODUCT", "ORDER", "SHIPPING"],
          vars: { jsonValue: { role: "automatic", campaignId: null, campaignStart: "1970-01-01T00:00:00", campaignEnd: "1970-01-01T00:00:00", varsVersion: null } },
        },
        shop: {
          config: { jsonValue: { schemaVersion: 1, campaignId: null, campaignVarsVersion: null, marketCountries: {}, modules: { codes: { rules } }, campaigns: [] } },
          localTime: { date: "2026-10-01", campaignActive: false },
        },
        localization: { country: { isoCode: "CZ" }, language: { isoCode: pick(["CS", "EN"]) } },
        cart: {
          cost: { subtotalAmount: { currencyCode: currency } },
          lines: Array.from({ length: 1 + int(3) }, (_, i) => ({
            id: `gid://shopify/CartLine/${i + 1}`,
            quantity: pick([1, 2]),
            cost: { amountPerQuantity: { amount: chance(0.7) ? price : "100.00" } },
            gift: null,
            merchandise: { __typename: "ProductVariant", id: vid(700 + i), product: { wonProduct: { jsonValue: { ruleIds: ["cap"] } } } },
          })),
        },
      },
    };
  }

  /**
   * The margin order stage's search: 2–8 lines, some with a large product
   * discount (50–90 %) and a cost price well under what is left after it, some
   * without and with a cost price at 80–99 % of the price; an order discount (a
   * percent, or a fixed amount: equal D for sets of different sizes). Headrooms
   * per price before and after the product discount then order the lines
   * differently, so both orderings, their tie-breaks and the shortcut all occur
   * (tests/parity.test.js branch counts).
   */
  function searchCase() {
    const currency = pick(["CZK", "CZK", "EUR"]);
    const deep = [50, 70, 80, 90];
    const rules = [
      ...deep.map((percent) => ({ id: `d${percent}`, enabled: true, name: `D${percent}`, method: "automatic", value: { kind: "percentage", percent }, target: { kind: "products" } })),
      { id: "s2", enabled: true, name: "S2", method: "automatic", value: { kind: "percentage", percent: pick([5, 20, 40]) }, target: { kind: "products" }, combinesWith: { ruleIds: ["d50"] } },
      chance(0.15)
        ? { id: "o", enabled: true, name: "O", method: "automatic", value: { kind: "percentage", percent: pick([10, 20, 35, 50]) }, target: { kind: "order" } }
        : { id: "o", enabled: true, name: "O", method: "automatic", value: { kind: "fixed", amount: { [currency]: pick([2000, 5000, 20000, 50000]) } }, target: { kind: "order" } },
    ];
    const margin = { enabled: true, max: pick([100, 100, 60]), min: 0, cur: "CZK" };
    const lines = Array.from({ length: 2 + int(7) }, (_, i) => {
      const price = pick([100, 250, 1000, 1500, 2000]) + int(50);
      // Each discounted line its own percent (its own ratio of price after to price before).
      const percent = chance(0.5) ? pick(deep) : 0;
      const refs = percent === 0 ? (chance(0.15) ? ["s2"] : []) : percent === 50 && chance(0.3) ? ["d50", "s2"] : [`d${percent}`];
      const cost = percent > 0 ? price * (1 - percent / 100) * pick([0.2, 0.4, 0.6, 0.9]) : price * pick([0.8, 0.9, 0.95, 0.99, 1, 1.05]);
      return {
        id: `gid://shopify/CartLine/${i + 1}`,
        quantity: pick([1, 1, 1, 2]),
        cost: { amountPerQuantity: { amount: `${price}.00` } },
        gift: null,
        merchandise: {
          __typename: "ProductVariant",
          id: vid(900 + i),
          wonVariant: chance(0.9) ? { jsonValue: { cost: Math.round(cost * 100) / 100, cur: "CZK" } } : null,
          product: { wonProduct: { jsonValue: { ruleIds: refs } } },
        },
      };
    });
    return {
      exportName: LINES,
      tie: false,
      input: {
        triggeringDiscountCode: null,
        enteredDiscountCodes: [],
        discount: {
          discountClasses: ["PRODUCT", "ORDER", "SHIPPING"],
          vars: { jsonValue: { role: "automatic", campaignId: null, campaignStart: "1970-01-01T00:00:00", campaignEnd: "1970-01-01T00:00:00", varsVersion: null } },
        },
        shop: {
          config: { jsonValue: { schemaVersion: 1, campaignId: null, campaignVarsVersion: null, marketCountries: {}, modules: { codes: { rules }, margin }, campaigns: [] } },
          localTime: { date: "2026-10-01", campaignActive: false },
        },
        localization: { country: { isoCode: "CZ" }, language: { isoCode: "CS" } },
        ...(currency === "EUR" && chance(0.3) ? {} : { presentmentCurrencyRate: currency === "CZK" ? "1.0" : pick(["0.04", "0.0405", "0.0", "abc", null]) }),
        cart: { cost: { subtotalAmount: { currencyCode: currency } }, lines },
      },
    };
  }

  /**
   * The margin order search's bound (plan-margin.ts ORDER_SEARCH_EXACT_LINES,
   * audit round 4): 17–60 lines, most of them of 1–2 classes whose lines are
   * k × one price with a cost floor of k × (price − headroom) − 1 haléř, so a
   * class's rates h/s tie exactly (with a 10 or 20 % product discount too, which
   * keeps them proportional); k from ranges of 8, 16, 17 or 40 values, so a
   * class has fewer, exactly 16, or more distinct lines; a few ordinary lines;
   * an order discount of 5–90 % or a fixed amount.
   */
  function tiedCase() {
    const classes = Array.from({ length: 1 + int(2) }, () => {
      const unit = 100 * (10 + int(90));
      return { unit, headroom: Math.floor(unit * pick([0.05, 0.1, 0.2, 0.3])), rule: pick([null, null, "p10", "p20"]), ks: pick([8, 16, 17, 40]) };
    });
    const product = (id, percent) => ({ id, enabled: true, name: `P${percent}`, method: "automatic", value: { kind: "percentage", percent }, target: { kind: "products" } });
    const rules = [
      product("p10", 10),
      product("p20", 20),
      chance(0.8)
        ? { id: "o", enabled: true, name: "O", method: "automatic", value: { kind: "percentage", percent: pick([5, 10, 20, 30, 50, 90]) }, target: { kind: "order" } }
        : { id: "o", enabled: true, name: "O", method: "automatic", value: { kind: "fixed", amount: { CZK: pick([5_000, 50_000, 500_000, 5_000_000]) } }, target: { kind: "order" } },
    ];
    const kc = (minor) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
    const lines = Array.from({ length: 17 + int(44) }, (_, i) => {
      let price;
      let cost;
      let refs;
      let quantity = 1;
      if (chance(0.1)) {
        price = 100 * (1 + int(5_000));
        cost = chance(0.5) ? Math.round(price * pick([0.5, 0.8])) / 100 : null;
        refs = chance(0.5) ? ["p10"] : [];
        quantity = pick([1, 2]);
      } else {
        const c = pick(classes);
        const k = 1 + int(c.ks);
        price = k * c.unit;
        cost = (k * (c.unit - c.headroom) - 1) / 100;
        refs = c.rule ? [c.rule] : [];
      }
      return {
        id: `gid://shopify/CartLine/${i + 1}`,
        quantity,
        cost: { amountPerQuantity: { amount: kc(price) } },
        gift: null,
        merchandise: {
          __typename: "ProductVariant",
          id: vid(2000 + i),
          wonVariant: cost === null ? null : { jsonValue: { cost, cur: "CZK" } },
          product: { wonProduct: { jsonValue: { ruleIds: refs } } },
        },
      };
    });
    return {
      exportName: LINES,
      tie: false,
      input: {
        triggeringDiscountCode: null,
        enteredDiscountCodes: [],
        discount: {
          discountClasses: ["PRODUCT", "ORDER", "SHIPPING"],
          vars: { jsonValue: { role: "automatic", campaignId: null, campaignStart: "1970-01-01T00:00:00", campaignEnd: "1970-01-01T00:00:00", varsVersion: null } },
        },
        shop: {
          config: { jsonValue: { schemaVersion: 1, campaignId: null, campaignVarsVersion: null, marketCountries: {}, modules: { codes: { rules }, margin: { enabled: true, max: 100, min: 0, cur: "CZK" } }, campaigns: [] } },
          localTime: { date: "2026-10-01", campaignActive: false },
        },
        localization: { country: { isoCode: "CZ" }, language: { isoCode: "CS" } },
        presentmentCurrencyRate: "1.0",
        cart: { cost: { subtotalAmount: { currencyCode: "CZK" } }, lines },
      },
    };
  }

  /**
   * Many markets and many entered codes (audit round 5): 1–50 markets of 1–8
   * countries (lower case, duplicated handles, the cart's country anywhere or
   * nowhere), rules targeting some of them (unknown handles too); 0–250 entered
   * codes (the Storefront API's maximum), most foreign, some the code rules'
   * codes in any case and padding, repeated, non-ASCII and empty ones (only the
   * first 25 entered count: the cap binds on most of these carts).
   */
  function manyCase() {
    const countries = ["CZ", "SK", "DE", "AT", "PL", "HU", "FR", "IT", "ES", "PT", "NL", "BE", "US", "GB", "CH", "JP"];
    const handles = Array.from({ length: 1 + int(50) }, (_, m) => `m${m}`);
    const marketCountries = {};
    for (const h of handles) marketCountries[h] = Array.from({ length: 1 + int(8) }, () => (chance(0.2) ? pick(countries).toLowerCase() : pick(countries)));
    const codeWords = ["ALPHA", "Beta", "straße", "GAMMA", "ŽLUTÝ", "😀x"];
    const rules = Array.from({ length: 3 + int(8) }, (_, k) => {
      const isCode = chance(0.5);
      const markets = chance(0.6) ? Array.from({ length: 1 + int(handles.length) }, () => (chance(0.05) ? "nope" : pick(handles))) : null;
      return {
        id: `r${k}`,
        enabled: true,
        name: `R${k}`,
        method: isCode ? "code" : "automatic",
        ...(isCode ? { codeHashes: [codeHash(pick(codeWords)), ...(chance(0.2) ? ["ABCDEF12"] : [])] } : {}),
        value: { kind: "percentage", percent: pick([5, 10, 15, 20]) },
        target: chance(0.8) ? { kind: "products" } : { kind: "order" },
        ...(markets ? { targeting: { markets } } : {}),
      };
    });
    const n = pick([0, 3, 40, 100, 250]);
    const entered = Array.from({ length: n }, (_, k) => {
      const roll = rnd();
      if (roll < 0.05) return pick(["", "   ", "\ufeff"]);
      if (roll < 0.15) return `${pick([" ", "", "\u00a0"])}${chance(0.5) ? pick(codeWords).toLowerCase() : pick(codeWords)}${pick(["", " "])}`;
      return chance(0.3) ? `K${k}Ž${"ABCDEFGHIJ".repeat(int(4))}` : `CODE${int(60)}`;
    });
    const lines = Array.from({ length: 1 + int(6) }, (_, i) => ({
      id: `gid://shopify/CartLine/${i + 1}`,
      quantity: 1 + int(3),
      cost: { amountPerQuantity: { amount: `${100 + int(900)}.00` } },
      gift: null,
      merchandise: { __typename: "ProductVariant", id: vid(3000 + i), wonVariant: null, product: { wonProduct: { jsonValue: { ruleIds: rules.filter(() => chance(0.6)).map((r) => r.id) } } } },
    }));
    return {
      exportName: LINES,
      tie: false,
      input: {
        triggeringDiscountCode: null,
        enteredDiscountCodes: entered.map((code) => ({ code })),
        discount: {
          discountClasses: ["PRODUCT", "ORDER", "SHIPPING"],
          vars: { jsonValue: { role: "automatic", campaignId: null, campaignStart: "1970-01-01T00:00:00", campaignEnd: "1970-01-01T00:00:00", varsVersion: null } },
        },
        shop: {
          config: { jsonValue: { schemaVersion: 1, campaignId: null, campaignVarsVersion: null, marketCountries, modules: { codes: { rules } }, campaigns: [] } },
          localTime: { date: "2026-10-01", campaignActive: false },
        },
        localization: chance(0.9) ? { country: { isoCode: pick(countries) }, language: { isoCode: "CS" } } : { country: null, language: { isoCode: "CS" } },
        presentmentCurrencyRate: "1.0",
        cart: { cost: { subtotalAmount: { currencyCode: "CZK" } }, lines },
      },
    };
  }

  /**
   * Entered codes of any length against the longest Won code (audit round 6,
   * plan.ts `matchCodes`, hash.rs `normalized_hash_within`): code rules with
   * codes of 1–64 characters (ASCII, Czech, ß and ligatures whose upper case is
   * longer, Greek with a 2–3-character upper case, astral, CJK); the payload's
   * `maxCodeLength` the longest of them (as the sync ships it), missing, junk,
   * 0, over 64 or below the longest (hand-made). Entered: those codes in any
   * case with any padding, the same codes one character longer, foreign codes
   * of 1–300 characters, white-space-only ones, empty entries and entries
   * without a code string (`{}`, `{code: null}`, `{code: 7}`), repeats; a code
   * node triggered by one of them.
   */
  function longCase() {
    const alphabets = ["ABCDEFGHJK", "ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ", "ßﬁﬃĳ", "ᾀᾳΐΰ", "\u{10428}\u{10429}", "中文字", "ǅǈ", "0123456789"];
    const word = (len) => {
      const alphabet = [...pick(alphabets)];
      let out = "";
      while (out.length < len) out += alphabet[int(alphabet.length)];
      return out.slice(0, len).replace(/[\ud800-\udbff]$/, "X");
    };
    const pad = () => pick(["", "", " ", "\u00a0", "\u3000", "\t", "\ufeff", "  \u2003"]);
    const caseOf = (code) => pick([code, code.toLowerCase(), code.toUpperCase()]);
    const wonCodes = [];
    const rules = Array.from({ length: 1 + int(4) }, (_, k) => {
      const codes = Array.from({ length: 1 + int(4) }, () => word(pick([1, 5, 9, 20, 40, 63, 64])).toUpperCase().trim()).filter((c) => c && c.length <= 64);
      wonCodes.push(...codes);
      return {
        id: `c${k}`,
        enabled: true,
        name: `C${k}`,
        method: "code",
        codeHashes: codes.map(codeHash),
        value: { kind: "percentage", percent: pick([5, 10, 15, 20]) },
        target: chance(0.8) ? { kind: "products" } : { kind: "order" },
      };
    });
    rules.push({ id: "a0", enabled: true, name: "A0", method: "automatic", value: { kind: "percentage", percent: 7 }, target: { kind: "products" } });
    const longest = Math.max(0, ...wonCodes.map((c) => c.length));
    const lengthRoll = rnd();
    const codesModule = { rules };
    if (lengthRoll < 0.55) codesModule.maxCodeLength = longest;
    else if (lengthRoll < 0.65) codesModule.maxCodeLength = Math.max(0, longest - 1 - int(5));
    else if (lengthRoll < 0.8) codesModule.maxCodeLength = pick(["9", 9.5, -1, null, [64], 0, 64, 65, 300, 1e300]);
    const n = pick([1, 3, 10, 24, 25, 26, 30, 60]);
    const entered = Array.from({ length: n }, () => {
      const roll = rnd();
      if (roll < 0.35 && wonCodes.length > 0) return { code: `${pad()}${caseOf(pick(wonCodes))}${pad()}` };
      if (roll < 0.45 && wonCodes.length > 0) return { code: `${pick(wonCodes)}${pick(["X", "ž", "ß"])}` };
      if (roll < 0.7) return { code: `${pad()}${word(pick([1, 8, 64, 65, 66, 100, 192, 193, 255, 300]))}${pad()}` };
      if (roll < 0.8) return { code: pick([" ", "\u3000", "\u00a0\u2028"]).repeat(1 + int(120)) };
      if (roll < 0.9) return pick([{ code: "" }, {}, { code: null }, { code: 7 }]);
      return { code: `CODE${int(9)}` };
    });
    const trigger = chance(0.4) && entered.length > 0 ? entered[int(entered.length)].code : null;
    // The node of the rule that has the triggering code, when one has it (as Shopify runs it).
    const owner = typeof trigger === "string" ? rules.find((r) => (r.codeHashes ?? []).includes(codeHash(trigger))) : undefined;
    const role = typeof trigger === "string" && trigger !== "" ? { role: "code", ruleId: (owner ?? pick(rules)).id } : { role: "automatic" };
    const lines = Array.from({ length: 1 + int(4) }, (_, i) => ({
      id: `gid://shopify/CartLine/${i + 1}`,
      quantity: 1 + int(3),
      cost: { amountPerQuantity: { amount: `${100 + int(900)}.00` } },
      gift: null,
      merchandise: { __typename: "ProductVariant", id: vid(4000 + i), wonVariant: null, product: { wonProduct: { jsonValue: { ruleIds: rules.filter(() => chance(0.7)).map((r) => r.id) } } } },
    }));
    return {
      exportName: LINES,
      tie: false,
      input: {
        triggeringDiscountCode: role.role === "code" ? trigger : null,
        enteredDiscountCodes: entered,
        discount: {
          discountClasses: ["PRODUCT", "ORDER", "SHIPPING"],
          vars: { jsonValue: { ...role, campaignId: null, campaignStart: "1970-01-01T00:00:00", campaignEnd: "1970-01-01T00:00:00", varsVersion: null } },
        },
        shop: {
          config: { jsonValue: { schemaVersion: 1, campaignId: null, campaignVarsVersion: null, marketCountries: {}, modules: { codes: codesModule }, campaigns: [] } },
          localTime: { date: "2026-10-01", campaignActive: false },
        },
        localization: { country: { isoCode: "CZ" }, language: { isoCode: "CS" } },
        presentmentCurrencyRate: "1.0",
        cart: { cost: { subtotalAmount: { currencyCode: "CZK" } }, lines },
      },
    };
  }

  /**
   * The Pro stack cap (plan.ts MAX_STACK_CANDIDATES, audit round 3): 7–16
   * product rules combining at a random density (up to a full mesh), percents
   * with repeats (ties go to priority, then id) and fixed amounts, a few code
   * rules; 1–40 lines, each listing its own 5–14 of them, so most lines have
   * more than 6 candidates and the cap decides which can stack; half the carts
   * with 7–9 order rules in a mesh (the order stack's cap), 40 % with margin
   * protection and cost prices (the capped stack cut again).
   */
  function meshCase() {
    const currency = pick(["CZK", "CZK", "EUR"]);
    const count = 7 + int(10);
    const ids = Array.from({ length: count }, (_, k) => pick([`m${k}`, `m${k}`, `ř${k}`, `r_${k.toString(16).padStart(20, "a")}`]));
    const density = pick([0.3, 0.6, 0.9, 1, 1]);
    const entered = [];
    const product = ids.map((id, k) => {
      const partners = ids.slice(k + 1).filter(() => rnd() < density);
      const code = chance(0.12);
      if (code) entered.push(`MESH${k}`);
      return {
        id,
        enabled: true,
        name: chance(0.85) ? `Pro ${id}` : "",
        method: code ? "code" : "automatic",
        ...(code ? { codeHashes: [codeHash(`MESH${k}`)] } : {}),
        value: chance(0.8) ? { kind: "percentage", percent: pick([1, 2, 2.5, 5, 5, 7.5, 10, 10, 12, 15, 20]) } : { kind: "fixed", amount: { [currency]: pick([500, 1000, 1000, 2500, 9900]) } },
        target: { kind: "products" },
        ...(chance(0.3) ? { priority: pick([0, 1, 2, 5]) } : {}),
        ...(partners.length > 0 ? { combinesWith: { ruleIds: partners } } : {}),
      };
    });
    const orders = chance(0.5)
      ? Array.from({ length: 7 + int(3) }, (_, k) => ({
          id: `o${k}`,
          enabled: true,
          name: `Objednávka ${k}`,
          method: "automatic",
          value: chance(0.7) ? { kind: "percentage", percent: pick([1, 2, 3, 3, 5]) } : { kind: "fixed", amount: { [currency]: pick([1000, 2000, 5000]) } },
          target: { kind: "order" },
          combinesWith: { ruleIds: Array.from({ length: 9 }, (_, j) => `o${j}`).filter((o, j) => j > k && rnd() < 0.9) },
        }))
      : [];
    const margin = chance(0.4) ? { enabled: true, max: pick([20, 35, 60]), min: pick([10, 20, 30]), cur: "CZK" } : null;
    const lines = Array.from({ length: 1 + int(40) }, (_, i) => {
      const pool = [...ids];
      const refs = Array.from({ length: Math.min(pool.length, 5 + int(10)) }, () => pool.splice(int(pool.length), 1)[0]);
      const price = pick([100, 249, 1000, 1500, 4990]) + int(100);
      return {
        id: `gid://shopify/CartLine/${i + 1}`,
        quantity: pick([1, 1, 2, 3]),
        cost: { amountPerQuantity: { amount: `${price}.${pick(["00", "50", "05"])}` } },
        gift: null,
        merchandise: {
          __typename: "ProductVariant",
          id: vid(1200 + i),
          wonVariant: margin && chance(0.8) ? { jsonValue: { cost: Math.round(price * pick([0.3, 0.5, 0.7]) * 100) / 100, cur: "CZK" } } : null,
          product: { wonProduct: { jsonValue: { ruleIds: refs } } },
        },
      };
    });
    const codeRule = entered.length > 0 && chance(0.3) ? product.find((r) => r.method === "code") : null;
    return {
      exportName: LINES,
      tie: false,
      input: {
        triggeringDiscountCode: codeRule ? pick(entered) : null,
        enteredDiscountCodes: entered.filter(() => chance(0.7)).map((code) => ({ code })),
        discount: {
          discountClasses: ["PRODUCT", "ORDER", "SHIPPING"],
          vars: {
            jsonValue: { role: codeRule ? "code" : "automatic", ...(codeRule ? { ruleId: codeRule.id } : {}), campaignId: null, campaignStart: "1970-01-01T00:00:00", campaignEnd: "1970-01-01T00:00:00", varsVersion: null },
          },
        },
        shop: {
          config: { jsonValue: { schemaVersion: 1, campaignId: null, campaignVarsVersion: null, marketCountries: {}, modules: { codes: { rules: [...product, ...orders] }, ...(margin ? { margin } : {}) }, campaigns: [] } },
          localTime: { date: "2026-10-01", campaignActive: false },
        },
        localization: { country: { isoCode: "CZ" }, language: { isoCode: pick(["CS", "EN"]) } },
        presentmentCurrencyRate: currency === "CZK" ? "1.0" : "0.04",
        cart: { cost: { subtotalAmount: { currencyCode: currency } }, lines },
      },
    };
  }

  return function nextCase() {
    if (onlySearch === "mesh") {
      hostile = false;
      large = false;
      return meshCase();
    }
    if (onlySearch === "tied") {
      hostile = false;
      large = false;
      return tiedCase();
    }
    if (onlySearch === "many") {
      hostile = false;
      large = false;
      return manyCase();
    }
    if (onlySearch === "long") {
      hostile = false;
      large = false;
      return longCase();
    }
    if (onlySearch || chance(0.2)) {
      hostile = false;
      large = false;
      return searchCase();
    }
    if (chance(0.03)) {
      hostile = false;
      large = false;
      return capCase();
    }
    if (chance(0.07)) {
      hostile = false;
      large = false;
      return bigCase();
    }
    if (chance(0.04)) {
      hostile = false;
      large = false;
      return splitShipmentCase();
    }
    hostile = chance(0.25);
    large = chance(0.1);
    const exportName = chance(0.65) ? LINES : DELIVERY;
    const built = config();
    const entered = some(CODES, 0.5)
      .map((c) => (chance(0.3) ? c.toLowerCase() : c))
      .concat(junk(0.3) ? ["UNKNOWN"] : []);
    const codeRule = built.codeRules.length > 0 && chance(0.55) ? pick(built.codeRules) : null;
    const role = junk(0.1) ? "other" : codeRule ? "code" : "automatic";
    const vars = junk(0.1)
      ? null
      : {
          role,
          ...(role === "code" ? { ruleId: junk(0.2) ? "" : codeRule.id } : junk(0.1) ? { ruleId: "r1" } : {}),
          campaignId: pick(["bf", "bf", "bf", null, "old"]),
          campaignStart: "2026-09-30T00:00:00",
          campaignEnd: "2026-10-05T23:59:59",
          varsVersion: pick(["v1", "v1", "v1", "v2", null]),
        };
    const triggering = role === "code" ? (entered.length > 0 && chance(0.85) ? pick(entered) : pick([null, "nope"])) : junk(0.2) ? "SAVE10" : null;
    const cart = {
      cost: { subtotalAmount: { currencyCode: pick(["CZK", "CZK", "CZK", "CZK", "EUR", "EUR", "JPY", "KWD", "HUF", "BHD", "USD", "czk"]) } },
    };
    if (exportName === DELIVERY) {
      cart.deliveryGroups = Array.from({ length: chance(0.9) ? 1 + int(3) : 0 }, (_, i) => ({ id: `gid://shopify/CartDeliveryGroup/${i + 1}` }));
    }
    const catalog = products(built.ids);
    // Large amounts stay on small carts: the cart total must stay exact in a JS number (< 2^53).
    const lineCount = large ? 1 + int(4) : chance(0.45) ? int(9) : chance(0.75) ? 9 + int(42) : 51 + int(210);
    cart.lines = Array.from({ length: lineCount }, (_, i) => line(i + 1, catalog));
    const input = {
      triggeringDiscountCode: triggering,
      enteredDiscountCodes: entered.map((code) => ({ code })),
      discount: {
        discountClasses: hostile ? some(["PRODUCT", "ORDER", "SHIPPING"], 0.6) : ["PRODUCT", "ORDER", "SHIPPING"],
        vars: vars === null ? null : { jsonValue: vars },
      },
      shop: {
        config: built.config === null ? null : { jsonValue: built.config },
        localTime: { date: pick(["2026-10-01", "2026-10-01", "2026-10-01", "2026-09-15"]), campaignActive: chance(0.6) },
      },
      localization: {
        country: { isoCode: pick(["CZ", "CZ", "SK", "US", "DE", "cz", " sk ", "XX", "", "CZE"]) },
        language: { isoCode: pick(["CS", "CS", "EN", "SK", "DE"]) },
      },
      presentmentCurrencyRate: rate(),
      cart,
    };
    return { exportName, input, tie: built.tie === true };
  };
}

/** `amountIn` (plan.ts) of a fixed rule amount in the cart currency. */
const amountIn = (money, currency) => {
  const v = money && typeof money === "object" ? money[currency] : undefined;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(Math.min(v, 1e12)) : null;
};

/**
 * The margin order search's branches (the Rust function's shortcut, its skipped
 * h/a search, the orderings' tie-breaks): its input rebuilt from the TS plan and
 * the exported margin arithmetic, then `searchOrderSets` (plan-margin.ts).
 */
function orderSearchBranches(adapted, plan, hits) {
  const config = adapted.config && typeof adapted.config === "object" ? adapted.config : {};
  const payload = readMarginPayload(config.modules?.margin);
  if (!payload.enabled || !plan.order?.marginProtected) return;
  const cart = normalizeCart(adapted.cart);
  const exclusive = config.engine?.combination?.productWithOrder === false;
  const lines = [];
  plan.lines.forEach((pl, i) => {
    if (pl.excluded !== null) return;
    const nl = cart.lines[i];
    const settings = resolveProductMargin(payload, nl.marginRefs, nl.marginRefCount);
    const costMinor = costMinorUnits(nl.unitCost ?? undefined, nl.unitCostCurrency ?? undefined, cart.shopToCartRate ?? undefined, cart.currency, payload.cur);
    const { floorUnit } = marginFloorUnit({ unitPrice: nl.unitPrice, costMinor, ...settings });
    const after = exclusive ? pl.subtotal : pl.subtotal - (pl.product?.amount ?? 0);
    if (after > 0) lines.push({ after, before: pl.subtotal, headroom: Math.max(0, after - floorUnit * pl.quantity - 1) });
  });
  // The picked order stack: what is left of it, and the rules margin protection floored.
  const ids = new Set([...plan.order.components.map((c) => c.ruleId), ...plan.rules.filter((r) => r.discountClass === "order" && r.state === "margin_floor").map((r) => r.ruleId)]);
  const values = plan.rules.filter((r) => ids.has(r.ruleId)).map((r) => r.describable.value);
  const wantedAt = (base) => {
    let sum = 0;
    for (const v of values) sum += v.kind === "percentage" ? Math.round((base * v.percent) / 100) : Math.min(amountIn(v.amount, plan.currency) ?? 0, base);
    return Math.min(sum, base);
  };
  const giving = lines.filter((l) => l.headroom > 0);
  const S = giving.reduce((sum, l) => sum + l.after, 0);
  const S0 = giving.reduce((sum, l) => sum + l.before, 0);
  const w = wantedAt(S);
  // The set of every line that can give carries the whole wanted amount (its D_max, bound included).
  const whole = orderSetLimit(giving, S, S0);
  const shortcut = giving.length > 0 && w > 0 && whole.limit >= w;
  hits.add(shortcut ? "margin order search: shortcut (every line that can give carries its share)" : "margin order search: full search");
  if (shortcut && whole.bounded) hits.add("margin order search: shortcut over 16+ tied lines (their bound)");
  if (shortcut || giving.length === 0) return;
  if (searchOrderSets(giving, wantedAt).bounded) hits.add("margin order search: a bound (16+ distinct lines tied for a minimum)");
  const keyS = giving.map((l) => l.headroom / l.before);
  const keyA = giving.map((l) => l.headroom / l.after);
  const byS = giving.map((_, i) => i).sort((x, y) => (keyS[x] !== keyS[y] ? keyS[y] - keyS[x] : x - y));
  const same = byS.every((y, k) => k === 0 || (keyS[byS[k - 1]] === keyS[y] ? keyA[byS[k - 1]] === keyA[y] : keyA[byS[k - 1]] > keyA[y]));
  hits.add(same ? "margin order search: h/a ordering skipped (the h/s one)" : "margin order search: both orderings searched");
  if (same) return;
  const { byBefore, byAfter, best } = searchOrderSets(giving, wantedAt);
  if (best === byAfter) hits.add("margin order search: the h/a ordering wins");
  // Ties between DIFFERENT sets only (the same set found by both orderings decides nothing).
  if (byAfter.amount === byBefore.amount && byAfter.members.join() !== byBefore.members.join()) {
    hits.add(byAfter.members.length !== byBefore.members.length ? "margin order search: tie → the larger set" : "margin order search: tie → the h/s set");
  }
}

/** The stack cap's branches (MAX_STACK_CANDIDATES = 6) one case hit, from the TS plan. */
function stackCapBranches(input) {
  const hits = new Set();
  const adapted = adaptInput(input);
  const { plan } = emissionFor(adapted);
  if (!plan || plan.reason) return hits;
  // Pro combinesWith, symmetric (plan.ts partnersOf).
  const partners = new Map();
  const link = (a, b) => {
    if (a === b) return;
    if (!partners.has(a)) partners.set(a, new Set());
    partners.get(a).add(b);
  };
  for (const r of input.shop.config.jsonValue.modules.codes.rules) for (const o of r.combinesWith?.ruleIds ?? []) (link(r.id, o), link(o, r.id));
  const eligible = new Set(plan.rules.filter((r) => r.discountClass === "product" && ["applied", "combined", "outranked", "margin_floor"].includes(r.state)).map((r) => r.ruleId));
  adapted.cart.lines.forEach((line, i) => {
    const stack = plan.lines[i]?.product;
    const candidates = line.ruleIds.filter((id) => eligible.has(id));
    if (!stack || stack.components.length < 2 || candidates.length <= 6) return;
    hits.add("stack cap: a line with 7+ candidates stacks");
    if (stack.components.length === 6) hits.add("stack cap: a stack of the 6 best");
    const members = stack.components.map((c) => c.ruleId);
    if (candidates.some((id) => !members.includes(id) && members.every((m) => partners.get(m)?.has(id)))) {
      hits.add("stack cap: a partner of the whole stack left out");
    }
    if (plan.lines[i].marginCapped) hits.add("stack cap: margin cuts a capped stack");
  });
  if ((plan.order?.components.length ?? 0) === 6) hits.add("stack cap: an order stack of the 6 best");
  return hits;
}

/** The engine branches one case hit (from the TS plan, emission and output). */
function branchesOf(exportName, input, output, tie) {
  const hits = new Set();
  const ops = output.operations;
  if (
    exportName === DELIVERY &&
    (input.cart.deliveryGroups?.length ?? 0) >= 2 &&
    ops.some((op) => op.deliveryDiscountsAdd?.candidates.some((c) => c.value.fixedAmount))
  ) {
    hits.add("fixed shipping amount on a split shipment");
  }
  if (tie && ops.some((op) => op.productDiscountsAdd)) hits.add("UTF-16 id tie decides the winner");
  if (ops.some((op) => op.productDiscountsAdd)) hits.add("product candidates");
  if (ops.some((op) => op.orderDiscountsAdd)) hits.add("order candidates");
  if (ops.some((op) => op.deliveryDiscountsAdd)) hits.add("delivery candidates");
  const adapted = adaptInput(input);
  if (adapted.role?.kind === "code" && ops.length > 0) hits.add("code node emits (code triggered)");
  if (adapted.cart.currency !== "CZK" && ops.length > 0) hits.add("non-CZK currency emits");
  if (["HUF", "BHD", "USD"].includes(adapted.cart.currency) && ops.length > 0) hits.add("HUF / BHD / USD cart emits");
  const rawCountry = input.localization?.country?.isoCode;
  if (typeof rawCountry === "string" && rawCountry !== "" && !/^[A-Z]{2}$/.test(rawCountry) && ops.length > 0) hits.add("lower-case, padded or invalid country");
  const { plan, emission } = emissionFor(adapted);
  if (!plan || plan.reason) return hits;
  const mapped = mapOutput(emission, adapted, plan);
  if (mapped.relaxedTies.length > 0) hits.add("over the budget: rounding ties back to their percent");
  if (mapped.degradedStacks.length > 0) hits.add("over the budget: Pro stacks as their top rule");
  if (mapped.droppedCandidates.length > 0) hits.add("over the budget: candidates dropped");
  if (exportName === LINES && input.cart.lines.length > 200 && ops.length > 0) hits.add("200+ line cart emits");
  const tieLine = emission.productCandidates.some((c) => {
    const line = plan.lines.find((l) => l.lineId === c.lineId);
    return c.percent !== undefined && line !== undefined && roundingTiePossible(line.subtotal, c.percent);
  });
  if (exportName === LINES && tieLine && ops.length > 0) hits.add("rounding tie emitted as its exact amount");
  if (plan.rules.some((r) => r.missing?.scope === "entitled")) hits.add("entitled minimum not reached");
  // A CONFIG amount at or over the money cap (1e12 minor units) that some emitted stack uses.
  const rawRules = new Map();
  for (const r of input.shop?.config?.jsonValue?.modules?.codes?.rules ?? []) {
    if (r && typeof r.id === "string" && !rawRules.has(r.id)) rawRules.set(r.id, r);
  }
  const capped = (ruleId) => {
    const value = rawRules.get(ruleId)?.value;
    const amount = value?.kind === "fixed" && value.amount && typeof value.amount === "object" ? value.amount[adapted.cart.currency] : undefined;
    return typeof amount === "number" && amount >= 1e12;
  };
  const emitted = [...emission.productCandidates.map((c) => plan.lines.find((l) => l.lineId === c.lineId)?.product), ...(emission.orderCandidates.length > 0 ? [plan.order] : [])];
  if (plan.campaignId === null && ops.length > 0 && emitted.some((stack) => stack?.components.some((comp) => capped(comp.ruleId)))) {
    hits.add("a config amount at the money cap is applied");
  }
  const exotic = /[\u00a0\ufeff\t]|[\ud800-\udfff]|ﬁ|ı/;
  const matched = new Set(plan.codes.filter((c) => c.ruleId !== null).map((c) => c.code));
  if ((input.enteredDiscountCodes ?? []).some((e) => exotic.test(e.code) && matched.has(e.code.trim().toUpperCase()))) {
    hits.add("padded / astral / case-mapped code matched");
  }
  const priorities = new Map(
    (input.shop?.config?.jsonValue?.modules?.codes?.rules ?? []).filter((r) => r && typeof r.id === "string").map((r) => [r.id, r.priority]),
  );
  if (plan.lines.some((l) => l.product && typeof priorities.get(l.product.ownerRuleId) === "number" && priorities.get(l.product.ownerRuleId) > 3)) {
    hits.add("a priority above 3 owns a stack");
  }
  const state = (s) => plan.rules.some((r) => r.state === s);
  if (plan.lines.some((l) => l.excluded === "outlet")) hits.add("outlet line excluded");
  if (plan.lines.some((l) => l.excluded === "gift")) hits.add("gift line excluded");
  const stacks = plan.lines.filter((l) => l.product && l.product.components.length > 1);
  if (stacks.length > 0 && ops.length > 0) hits.add("Pro stack planned");
  if (stacks.some((l) => l.product.ownerMethod === "code")) hits.add("Pro stack owned by a code rule");
  if (plan.campaignId !== null) hits.add("campaign applied");
  if (adapted.cart.campaign?.active && adapted.cart.campaign.id && plan.campaignId === null) hits.add("campaign live but variables mismatch");
  if (state("currency_missing")) hits.add("currency missing");
  if (state("not_started") || state("ended") || state("schedule_unknown")) hits.add("schedule not live");
  if (state("market")) hits.add("market not matched");
  if (plan.rules.some((r) => r.state === "not_combinable" && r.discountClass === "product")) hits.add("exclusive order beats products");
  if (plan.rules.some((r) => r.state === "not_combinable" && r.discountClass === "shipping")) hits.add("shipping blocked by a switch");
  if (plan.lines.some((l) => l.product && plan.rules.find((r) => r.ruleId === l.product.ownerRuleId)?.name === "")) {
    hits.add("unnamed rule message");
  }
  if (plan.lines.some((l) => l.product && /[^\x20-\x7e]/.test(l.product.ownerRuleId))) hits.add("non-ASCII winner id");
  if (exportName === LINES && input.cart.lines.length >= 30 && ops.length > 0) hits.add("30+ line cart emits");
  // --- Margin protection (MVP 2) ---
  const marginRaw = input.shop?.config?.jsonValue?.modules?.margin;
  const marginOn = marginRaw && typeof marginRaw === "object" && marginRaw.enabled === true && Number.isFinite(marginRaw.max);
  const cappedLines = plan.lines.filter((l) => l.marginCapped);
  if (cappedLines.some((l) => l.product)) hits.add("margin: product line capped");
  if (cappedLines.some((l) => !l.product)) hits.add("margin: product line capped to 0");
  if (cappedLines.some((l) => l.product && l.product.components.length > 1)) hits.add("margin: capped Pro stack");
  if (plan.rules.some((r) => r.state === "margin_floor" && r.discountClass === "product")) hits.add("margin: product rule floored (margin_floor)");
  if (plan.order?.marginCapped) hits.add("margin: order lowered");
  if ((plan.order?.marginExcludedLineIds.length ?? 0) > 0) hits.add("margin: order leaves lines out");
  if (plan.rules.some((r) => r.state === "margin_floor" && r.discountClass === "order")) hits.add("margin: order floored to nothing");
  if (plan.order?.marginProtected && ops.some((op) => op.orderDiscountsAdd)) hits.add("margin: order emitted as its exact amount");
  if (marginOn && plan.order && input.shop.config.jsonValue.engine?.combination?.productWithOrder === false) hits.add("margin: exclusive order-only protected");
  if (cappedLines.some((l) => l.marginCapped.basis === "cost")) hits.add("margin: cost floor");
  if (cappedLines.some((l) => l.marginCapped.basis === "max_percent")) hits.add("margin: maximum-discount floor");
  if (cappedLines.some((l) => l.marginCapped.source === "collection")) hits.add("margin: collection setting applied");
  if (marginOn && cappedLines.some((l) => (normalizeCart(adapted.cart).lines.find((nl) => nl.id === l.lineId)?.marginRefCount ?? 0) > MAX_MARGIN_REFS)) {
    hits.add("margin: more than 4 marginRefs, the payload's strictest setting");
  }
  if (cappedLines.some((l) => l.marginCapped.basis === "cost") && adapted.cart.currency !== "CZK") hits.add("margin: cost converted into another cart currency");
  const usableRate = typeof adapted.cart.shopToCartRate === "number" && adapted.cart.shopToCartRate > 0;
  if (marginOn && cappedLines.length > 0 && adapted.cart.currency !== "CZK" && !usableRate) hits.add("margin: no usable rate (cost unknown)");
  if (["JPY", "KWD", "BHD"].includes(adapted.cart.currency) && cappedLines.some((l) => l.marginCapped.basis === "cost")) hits.add("margin: cost floor at exponent 0 / 3");
  if (plan.lines.some((l) => l.marginTight)) hits.add("margin: tight line");
  if (mapped.degraded && plan.lines.some((l) => l.marginCapped || l.marginTight)) hits.add("margin: capped or tight line in an over-budget output");
  if (!marginOn && adapted.cart.lines.some((l) => typeof l.unitCost === "number")) hits.add("margin: off, cost prices present");
  orderSearchBranches(adapted, plan, hits);
  return hits;
}

function runWasm(runnerPath, wasmPath, exportName, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(runnerPath, ["-f", wasmPath, "--export", exportName, "--json"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    // Decode as a stream: a multi-byte character split across two pipe chunks
    // (outputs over 64 kB) must not turn into U+FFFD.
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        resolve({ ...JSON.parse(stdout), stdout, exitCode: code });
      } catch {
        reject(new Error(`function-runner exit ${code}: ${stderr || stdout}`));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

/** The raw text of the runner's top-level `"output"` value, dedented to the top level. */
function rawOutputText(stdout) {
  const marker = '\n  "output": ';
  const start = stdout.indexOf(marker) + marker.length;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < stdout.length; i += 1) {
    const c = stdout[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth += 1;
    else if (c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return stdout.slice(start, i + 1).replaceAll("\n  ", "\n");
    }
  }
  throw new Error("no output in the runner's result");
}

/** JSON.stringify with every object's keys sorted (how the runner prints JSON). */
function sortedJson(value) {
  const sort = (v) =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(value), null, 2);
}

describe("Wasm (function-runner)", () => {
  let runnerPath = "";
  let wasmPath = "";

  beforeAll(async () => {
    const functionDir = path.dirname(testsDir);
    await buildFunction(functionDir);
    ({ functionRunnerPath: runnerPath, wasmPath } = await getFunctionInfo(functionDir));
  }, 600_000);

  test(`the built Wasm is under Shopify's ${WASM_LIMIT_BYTES} B binary limit`, () => {
    expect(statSync(wasmPath).size).toBeLessThan(WASM_LIMIT_BYTES);
  });

  test("every fixture: the runner's output text = the expected output text, memory within the bound", async () => {
    const failures = [];
    let maxMemory = 0;
    for (const file of fixtureFiles) {
      const { payload } = readFixture(file);
      const result = await runWasm(runnerPath, wasmPath, payload.export, payload.input);
      const got = rawOutputText(result.stdout);
      if (got !== sortedJson(payload.output)) failures.push(`${file}\n${got.slice(0, 400)}\n≠\n${sortedJson(payload.output).slice(0, 400)}`);
      maxMemory = Math.max(maxMemory, result.memory_usage ?? Number.POSITIVE_INFINITY);
    }
    expect(failures).toEqual([]);
    expect(maxMemory).toBeLessThanOrEqual(MEMORY_BOUND_KB);
  }, 300_000);

  test(`random carts and configs, seeds ${SEEDS.join(", ")} × ${CASES}: Wasm = TS reference, every branch hit`, async () => {
    const failures = [];
    /** @type {Map<string, number>} */
    const hits = new Map();
    let nonEmpty = 0;
    let maxBytes = 0;
    let maxMemory = 0;
    const overBudget = [];
    for (const seed of SEEDS) {
      const next = generator(seed);
      const cases = Array.from({ length: CASES }, next);
      for (let i = 0; i < cases.length; i += 8) {
        const batch = cases.slice(i, i + 8);
        const results = await Promise.all(batch.map((c) => runWasm(runnerPath, wasmPath, c.exportName, c.input)));
        results.forEach((result, j) => {
          const c = batch[j];
          const expected = referenceOutput(c.exportName, c.input);
          if (expected.operations.length > 0) nonEmpty += 1;
          maxBytes = Math.max(maxBytes, outputBytes(expected));
          // The budget scales with the line count above 200, like Shopify's limit.
          if (outputBytes(expected) > outputBudget(c.input.cart.lines.length)) overBudget.push({ seed, index: i + j });
          for (const branch of branchesOf(c.exportName, c.input, expected, c.tie)) hits.set(branch, (hits.get(branch) ?? 0) + 1);
          if (!result.success || !isDeepStrictEqual(result.output, expected)) {
            failures.push({ seed, index: i + j, exportName: c.exportName, got: result.output, logs: result.logs, expected, input: c.input });
          }
          maxMemory = Math.max(maxMemory, result.memory_usage ?? Number.POSITIVE_INFINITY);
        });
      }
    }
    if (failures.length > 0) {
      const first = failures[0];
      throw new Error(
        `${failures.length}/${CASES * SEEDS.length} random cases differ; first: seed ${first.seed} #${first.index} ${first.exportName}\n` +
          `got      ${JSON.stringify(first.got)}\nexpected ${JSON.stringify(first.expected)}\nlogs ${first.logs}\n` +
          `input    ${JSON.stringify(first.input)}`,
      );
    }
    const table = [...hits].sort((a, b) => a[1] - b[1]).map(([b, n]) => `${n}\t${b}`).join("\n");
    console.info(
      `random parity: ${CASES * SEEDS.length} cases, ${nonEmpty} with operations, 0 differ, largest output ${maxBytes} B, largest memory ${maxMemory} KB\n${table}`,
    );
    const BRANCHES = [
      "product candidates",
      "order candidates",
      "delivery candidates",
      "code node emits (code triggered)",
      "non-CZK currency emits",
      "outlet line excluded",
      "gift line excluded",
      "Pro stack planned",
      "Pro stack owned by a code rule",
      "campaign applied",
      "campaign live but variables mismatch",
      "currency missing",
      "schedule not live",
      "market not matched",
      "exclusive order beats products",
      "shipping blocked by a switch",
      "unnamed rule message",
      "non-ASCII winner id",
      "UTF-16 id tie decides the winner",
      "30+ line cart emits",
      "200+ line cart emits",
      "over the budget: Pro stacks as their top rule",
      "over the budget: candidates dropped",
      "rounding tie emitted as its exact amount",
      "entitled minimum not reached",
      "fixed shipping amount on a split shipment",
      "a config amount at the money cap is applied",
      "over the budget: rounding ties back to their percent",
      "HUF / BHD / USD cart emits",
      "lower-case, padded or invalid country",
      "padded / astral / case-mapped code matched",
      "a priority above 3 owns a stack",
      "margin: product line capped",
      "margin: product line capped to 0",
      "margin: capped Pro stack",
      "margin: product rule floored (margin_floor)",
      "margin: order lowered",
      "margin: order leaves lines out",
      "margin: order floored to nothing",
      "margin: order emitted as its exact amount",
      "margin: exclusive order-only protected",
      "margin: cost floor",
      "margin: maximum-discount floor",
      "margin: collection setting applied",
      "margin: more than 4 marginRefs, the payload's strictest setting",
      "margin: cost converted into another cart currency",
      "margin: no usable rate (cost unknown)",
      "margin: cost floor at exponent 0 / 3",
      "margin: tight line",
      "margin: capped or tight line in an over-budget output",
      "margin: off, cost prices present",
    ];
    const thin = BRANCHES.filter((b) => (hits.get(b) ?? 0) < MIN_HITS);
    expect(thin, `branches hit fewer than ${MIN_HITS} times:\n${table}`).toEqual([]);
    expect(overBudget).toEqual([]);
    expect(maxMemory).toBeLessThanOrEqual(MEMORY_BOUND_KB);
  }, 900_000);

  // The Pro stack cap (plan.ts MAX_STACK_CANDIDATES, src/engine/plan.rs `pick`):
  // carts where most lines have more than 6 candidates in a Pro mesh, so the cap
  // decides what stacks — the stack of the 6 best, a partner of the whole stack
  // left out, the order stack, a capped stack cut by margin protection — each
  // compared between the Wasm and the TS reference ≥ MIN_HITS times.
  const MESH_CASES = Number(process.env.PARITY_MESH_CASES ?? 1500);
  test(`Pro stack cap, seed 20261001 × ${MESH_CASES}: Wasm = TS reference, every stack-cap branch hit`, async () => {
    const next = generator(20261001, "mesh");
    const cases = Array.from({ length: MESH_CASES }, next);
    const failures = [];
    /** @type {Map<string, number>} */
    const hits = new Map();
    let maxMemory = 0;
    for (let i = 0; i < cases.length; i += 8) {
      const batch = cases.slice(i, i + 8);
      const results = await Promise.all(batch.map((c) => runWasm(runnerPath, wasmPath, c.exportName, c.input)));
      results.forEach((result, j) => {
        const c = batch[j];
        const expected = referenceOutput(c.exportName, c.input);
        for (const branch of stackCapBranches(c.input)) hits.set(branch, (hits.get(branch) ?? 0) + 1);
        if (!result.success || !isDeepStrictEqual(result.output, expected)) failures.push({ index: i + j, got: result.output, expected, input: c.input });
        maxMemory = Math.max(maxMemory, result.memory_usage ?? Number.POSITIVE_INFINITY);
      });
    }
    if (failures.length > 0) {
      const first = failures[0];
      throw new Error(
        `${failures.length}/${MESH_CASES} stack-cap cases differ; first #${first.index}\ngot      ${JSON.stringify(first.got)}\nexpected ${JSON.stringify(first.expected)}\ninput    ${JSON.stringify(first.input)}`,
      );
    }
    const table = [...hits].sort((a, b) => a[1] - b[1]).map(([b, n]) => `${n}\t${b}`).join("\n");
    console.info(`stack cap parity: ${MESH_CASES} cases, 0 differ, largest memory ${maxMemory} KB\n${table}`);
    const BRANCHES = [
      "stack cap: a line with 7+ candidates stacks",
      "stack cap: a stack of the 6 best",
      "stack cap: a partner of the whole stack left out",
      "stack cap: margin cuts a capped stack",
      "stack cap: an order stack of the 6 best",
    ];
    const thin = BRANCHES.filter((b) => (hits.get(b) ?? 0) < MIN_HITS);
    expect(thin, `branches hit fewer than ${MIN_HITS} times:\n${table}`).toEqual([]);
    expect(maxMemory).toBeLessThanOrEqual(MEMORY_BOUND_KB);
  }, 900_000);

  // The margin order stage's search on its own (src/engine/order_search.rs + the
  // shortcut in plan.rs): carts built to make the two orderings differ, so every
  // reachable way the search can end — the shortcut, the h/a search skipped, the
  // h/a ordering winning, a tie between different sets going to the larger one —
  // is compared between the Wasm and the TS reference, each ≥ MIN_HITS times.
  const SEARCH_CASES = Number(process.env.PARITY_SEARCH_CASES ?? 2000);
  test(`margin order search, seed 20260930 × ${SEARCH_CASES}: Wasm = TS reference, every search branch hit`, async () => {
    const next = generator(20260930, true);
    const cases = Array.from({ length: SEARCH_CASES }, next);
    const failures = [];
    /** @type {Map<string, number>} */
    const hits = new Map();
    for (let i = 0; i < cases.length; i += 8) {
      const batch = cases.slice(i, i + 8);
      const results = await Promise.all(batch.map((c) => runWasm(runnerPath, wasmPath, c.exportName, c.input)));
      results.forEach((result, j) => {
        const c = batch[j];
        const expected = referenceOutput(c.exportName, c.input);
        for (const branch of branchesOf(c.exportName, c.input, expected, c.tie)) hits.set(branch, (hits.get(branch) ?? 0) + 1);
        if (!result.success || !isDeepStrictEqual(result.output, expected)) failures.push({ index: i + j, got: result.output, expected, input: c.input });
      });
    }
    if (failures.length > 0) {
      const first = failures[0];
      throw new Error(`${failures.length}/${SEARCH_CASES} search cases differ; first #${first.index}\ngot      ${JSON.stringify(first.got)}\nexpected ${JSON.stringify(first.expected)}\ninput    ${JSON.stringify(first.input)}`);
    }
    const SEARCH_BRANCHES = [
      "margin order search: shortcut (every line that can give carries its share)",
      "margin order search: full search",
      "margin order search: h/a ordering skipped (the h/s one)",
      "margin order search: both orderings searched",
      "margin order search: the h/a ordering wins",
      "margin order search: tie → the larger set",
    ];
    // "tie → the h/s set" (equal D, equal size, different sets) is counted and printed but not
    // required: with an order discount's wanted amount (never falling as the base grows) it did
    // not occur in T1's 2 million random cases either; the unit-test pair
    // `order_search_ties_go_to_the_larger_set_then_to_the_h_s_set` pins it with a synthetic wanted.
    const table = [...SEARCH_BRANCHES, "margin order search: tie → the h/s set"].map((b) => `${hits.get(b) ?? 0}\t${b}`).join("\n");
    console.info(`margin order search: ${SEARCH_CASES} cases, 0 differ\n${table}`);
    expect(SEARCH_BRANCHES.filter((b) => (hits.get(b) ?? 0) < MIN_HITS), table).toEqual([]);
  }, 900_000);

  // Many markets and entered codes (audit round 5: plan.rs `markets_here`; round
  // 5b: only the first 25 entered codes count, cart.ts MAX_ENTERED_CODES): the
  // Wasm = the TS reference, the cap binding and leaving a Won code out ≥ 20 times.
  const MANY_CASES = Number(process.env.PARITY_MANY_CASES ?? 400);
  test(`many markets and entered codes, seed 20261005 × ${MANY_CASES}: Wasm = TS reference`, async () => {
    const next = generator(20261005, "many");
    const cases = Array.from({ length: MANY_CASES }, next);
    const failures = [];
    const seen = { manyCodes: 0, matchedAmongMany: 0, capBinds: 0, wonCodePastCap: 0, manyMarkets: 0, marketGated: 0 };
    const wonWords = new Set(["ALPHA", "BETA", "STRASSE", "GAMMA", "ŽLUTÝ", "😀X"]);
    for (let i = 0; i < cases.length; i += 8) {
      const batch = cases.slice(i, i + 8);
      const results = await Promise.all(batch.map((c) => runWasm(runnerPath, wasmPath, c.exportName, c.input)));
      results.forEach((result, j) => {
        const c = batch[j];
        const expected = referenceOutput(c.exportName, c.input);
        if (!result.success || !isDeepStrictEqual(result.output, expected)) failures.push({ index: i + j, got: result.output, expected, input: c.input });
        const { plan } = emissionFor(adaptInput(c.input));
        if (c.input.enteredDiscountCodes.length >= 100) {
          seen.manyCodes += 1;
          if (plan?.rules.some((r) => r.enteredCodes.length > 0)) seen.matchedAmongMany += 1;
        }
        // The entered-codes cap (cart.ts MAX_ENTERED_CODES): codes past the first 25 entered,
        // and among them a Won code that would have matched a rule.
        const over = plan?.codes.filter((x) => x.state === "over_limit") ?? [];
        if (over.length > 0) seen.capBinds += 1;
        if (over.some((x) => wonWords.has(x.code))) seen.wonCodePastCap += 1;
        if (Object.keys(c.input.shop.config.jsonValue.marketCountries).length >= 20) seen.manyMarkets += 1;
        if (plan?.rules.some((r) => r.state === "market")) seen.marketGated += 1;
      });
    }
    if (failures.length > 0) {
      const first = failures[0];
      throw new Error(`${failures.length}/${MANY_CASES} cases differ; first #${first.index}\ngot      ${JSON.stringify(first.got)}\nexpected ${JSON.stringify(first.expected)}\ninput    ${JSON.stringify(first.input).slice(0, 2000)}`);
    }
    console.info(`many markets and codes: ${MANY_CASES} cases, 0 differ ${JSON.stringify(seen)}`);
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThanOrEqual(MIN_HITS);
  }, 900_000);

  // Entered codes of any length (audit round 6): an entered code whose trimmed
  // length is over the payload's longest Won code is never upper-cased or
  // matched, and still counts toward the 25 (cart.ts, plan.ts matchCodes;
  // hash.rs normalized_hash_within). Wasm = the TS reference, each way ≥ 20 times.
  const LONG_CASES = Number(process.env.PARITY_LONG_CASES ?? 600);
  test(`entered codes of any length, seed 20261006 × ${LONG_CASES}: Wasm = TS reference, every way hit`, async () => {
    const next = generator(20261006, "long");
    const cases = Array.from({ length: LONG_CASES }, next);
    const failures = [];
    const seen = {
      "a code over the longest Won code left out": 0,
      "a Won code entered longer (one character more) left out": 0,
      "a padded Won code longer than the longest as entered, matched": 0,
      "a code longer than 64 characters among the first 25": 0,
      "maxCodeLength missing or junk (64)": 0,
      "maxCodeLength below a Won code (hand-made): a Won code left out": 0,
      "an entry without a code string or empty among the first 25": 0,
      "a Won code past the cap behind left-out or empty entries": 0,
      "a code node that emits": 0,
      "a code node triggered by a left-out code, emitting nothing": 0,
    };
    const hit = (k) => (seen[k] += 1);
    for (let i = 0; i < cases.length; i += 8) {
      const batch = cases.slice(i, i + 8);
      const results = await Promise.all(batch.map((c) => runWasm(runnerPath, wasmPath, c.exportName, c.input)));
      results.forEach((result, j) => {
        const c = batch[j];
        const expected = referenceOutput(c.exportName, c.input);
        if (!result.success || !isDeepStrictEqual(result.output, expected)) failures.push({ index: i + j, got: result.output, expected, input: c.input });
        const codesModule = c.input.shop.config.jsonValue.modules.codes;
        const max = readMaxCodeLength(c.input.shop.config.jsonValue);
        const wonHashes = new Set(codesModule.rules.flatMap((r) => r.codeHashes ?? []));
        const entries = c.input.enteredDiscountCodes.map((e) => (typeof e.code === "string" ? e.code : null));
        const first = entries.slice(0, 25);
        const trimmed = (code) => (code === null ? "" : code.trim());
        const leftOut = (code) => trimmed(code) !== "" && trimmed(code).length > max;
        if (first.some(leftOut)) hit("a code over the longest Won code left out");
        if (first.some((code) => leftOut(code) && trimmed(code).length === max + 1 && wonHashes.has(codeHash(code.slice(0, -1))))) hit("a Won code entered longer (one character more) left out");
        if (first.some((code) => code !== null && !leftOut(code) && code.length > max && wonHashes.has(codeHash(code)))) hit("a padded Won code longer than the longest as entered, matched");
        if (first.some((code) => trimmed(code).length > 64)) hit("a code longer than 64 characters among the first 25");
        if (!Number.isInteger(codesModule.maxCodeLength) || codesModule.maxCodeLength < 0 || codesModule.maxCodeLength > 64) hit("maxCodeLength missing or junk (64)");
        if (first.some((code) => leftOut(code) && wonHashes.has(codeHash(code)))) hit("maxCodeLength below a Won code (hand-made): a Won code left out");
        if (first.some((code) => trimmed(code) === "")) hit("an entry without a code string or empty among the first 25");
        const beforeCap = first.filter((code) => trimmed(code) === "" || leftOut(code)).length;
        if (beforeCap > 0 && entries.slice(25).some((code) => code !== null && !leftOut(code) && trimmed(code) !== "" && wonHashes.has(codeHash(code)))) hit("a Won code past the cap behind left-out or empty entries");
        const trigger = c.input.triggeringDiscountCode;
        if (typeof trigger === "string" && trigger !== "") {
          const emits = (expected.operations ?? []).length > 0;
          if (emits) hit("a code node that emits");
          if (leftOut(trigger) && !emits) hit("a code node triggered by a left-out code, emitting nothing");
        }
      });
    }
    if (failures.length > 0) {
      const first = failures[0];
      throw new Error(`${failures.length}/${LONG_CASES} cases differ; first #${first.index}\ngot      ${JSON.stringify(first.got)}\nexpected ${JSON.stringify(first.expected)}\ninput    ${JSON.stringify(first.input).slice(0, 3000)}`);
    }
    const table = Object.entries(seen).map(([k, v]) => `${v}\t${k}`).join("\n");
    console.info(`entered codes of any length: ${LONG_CASES} cases, 0 differ\n${table}`);
    expect(Object.entries(seen).filter(([, v]) => v < MIN_HITS), table).toEqual([]);
  }, 900_000);

  // The order search's bound (plan-margin.ts orderSetLimit, order_search.rs
  // `NearMin`): carts of 17–60 lines whose rates tie exactly in classes, so a
  // candidate set has fewer than, exactly or more than 16 distinct lines tied
  // for its minimum — the exact limit, the bound, the shortcut checked against
  // the bound — compared between the Wasm and the TS reference.
  const TIED_CASES = Number(process.env.PARITY_TIED_CASES ?? 1000);
  test(`margin order search over tied lines, seed 20261002 × ${TIED_CASES}: Wasm = TS reference, the bound hit`, async () => {
    const next = generator(20261002, "tied");
    const cases = Array.from({ length: TIED_CASES }, next);
    const failures = [];
    /** @type {Map<string, number>} */
    const hits = new Map();
    let maxMemory = 0;
    for (let i = 0; i < cases.length; i += 8) {
      const batch = cases.slice(i, i + 8);
      const results = await Promise.all(batch.map((c) => runWasm(runnerPath, wasmPath, c.exportName, c.input)));
      results.forEach((result, j) => {
        const c = batch[j];
        const expected = referenceOutput(c.exportName, c.input);
        for (const branch of branchesOf(c.exportName, c.input, expected, c.tie)) hits.set(branch, (hits.get(branch) ?? 0) + 1);
        if (!result.success || !isDeepStrictEqual(result.output, expected)) failures.push({ index: i + j, got: result.output, expected, input: c.input });
        maxMemory = Math.max(maxMemory, result.memory_usage ?? Number.POSITIVE_INFINITY);
      });
    }
    if (failures.length > 0) {
      const first = failures[0];
      throw new Error(`${failures.length}/${TIED_CASES} tied cases differ; first #${first.index}\ngot      ${JSON.stringify(first.got)}\nexpected ${JSON.stringify(first.expected)}\ninput    ${JSON.stringify(first.input)}`);
    }
    const TIED_BRANCHES = [
      "margin order search: shortcut (every line that can give carries its share)",
      "margin order search: full search",
      "margin order search: a bound (16+ distinct lines tied for a minimum)",
      "margin order search: shortcut over 16+ tied lines (their bound)",
    ];
    const table = TIED_BRANCHES.map((b) => `${hits.get(b) ?? 0}\t${b}`).join("\n");
    console.info(`margin order search over tied lines: ${TIED_CASES} cases, 0 differ, largest memory ${maxMemory} KB\n${table}`);
    expect(TIED_BRANCHES.filter((b) => (hits.get(b) ?? 0) < MIN_HITS), table).toEqual([]);
    expect(maxMemory).toBeLessThanOrEqual(MEMORY_BOUND_KB);
  }, 900_000);
});
