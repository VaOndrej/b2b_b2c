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
//      1 000; CZK / EUR / JPY / KWD / HUF / BHD / USD; entitled minimums.
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

import { roundingTiePossible } from "@won/core/discounts/function-output";

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

function generator(seed) {
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
      : large && chance(0.5)
        ? pick([{ CZK: 1e12, EUR: 999999999, HUF: 5e11 }, { CZK: pick([123456789, 99999999999]), KWD: 1e12 }, { USD: 1e12, BHD: 7654321 }])
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
    return { config: c, ids, codeRules: rules.filter((r) => r && r.method === "code") };
  }

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
        ? { __typename: "ProductVariant", id: vid(variant), product: { wonProduct: product.won } }
        : { __typename: "CustomProduct" },
    };
  }

  /**
   * A big cart for the output budget: 150–260 lines of distinct prices, rules
   * with 200-character names. "stacks": two combinable rules, every line a
   * different stack amount (exact output far over the budget → the stacks
   * degrade to their top rule). "ties": a percent on prices ending in 5
   * haléřů / cents — every line a rounding tie emitted as its own exact amount,
   * nothing to degrade → the smallest candidates are dropped.
   */
  function bigCase() {
    const ties = chance(0.5);
    const ids = ["big1", "big2", "big3"];
    const rules = [
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
    const lines = Array.from({ length: count }, (_, i) => ({
      id: `gid://shopify/CartLine/${i + 1}`,
      quantity: pick([1, 1, 1, 2]),
      cost: { amountPerQuantity: { amount: `${10 + int(990)}.${pick(cents)}` } },
      gift: null,
      merchandise: {
        __typename: "ProductVariant",
        id: vid(10000 + i),
        product: { wonProduct: { jsonValue: { ruleIds: ties ? [pick(["big1", "big2"])] : ["big1", "big2"] } } },
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
          config: { jsonValue: { schemaVersion: 1, campaignId: null, campaignVarsVersion: null, marketCountries: {}, modules: { codes: { rules } }, campaigns: [] } },
          localTime: { date: "2026-10-01", campaignActive: false },
        },
        localization: { country: { isoCode: "CZ" }, language: { isoCode: pick(["CS", "EN"]) } },
        cart: { cost: { subtotalAmount: { currencyCode: pick(["CZK", "CZK", "EUR", "USD"]) } }, lines },
      },
      ids,
    };
  }

  return function nextCase() {
    if (chance(0.07)) {
      hostile = false;
      large = false;
      return bigCase();
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
      cart,
    };
    return { exportName, input, tie: built.tie === true };
  };
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
  if (mapped.degradedStacks.length > 0) hits.add("over the budget: Pro stacks as their top rule");
  if (mapped.droppedCandidates.length > 0) hits.add("over the budget: candidates dropped");
  if (exportName === LINES && input.cart.lines.length > 200 && ops.length > 0) hits.add("200+ line cart emits");
  const tieLine = emission.productCandidates.some((c) => {
    const line = plan.lines.find((l) => l.lineId === c.lineId);
    return c.percent !== undefined && line !== undefined && roundingTiePossible(line.subtotal, c.percent);
  });
  if (exportName === LINES && tieLine && ops.length > 0) hits.add("rounding tie emitted as its exact amount");
  if (plan.rules.some((r) => r.missing?.scope === "entitled")) hits.add("entitled minimum not reached");
  if (plan.totals.subtotal >= 1e12 && ops.length > 0) hits.add("amounts ≥ 10^12 minor units emit");
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

  test("every fixture: the runner's output text = the expected output text", async () => {
    const failures = [];
    for (const file of fixtureFiles) {
      const { payload } = readFixture(file);
      const result = await runWasm(runnerPath, wasmPath, payload.export, payload.input);
      const got = rawOutputText(result.stdout);
      if (got !== sortedJson(payload.output)) failures.push(`${file}\n${got.slice(0, 400)}\n≠\n${sortedJson(payload.output).slice(0, 400)}`);
    }
    expect(failures).toEqual([]);
  }, 300_000);

  test(`random carts and configs, seeds ${SEEDS.join(", ")} × ${CASES}: Wasm = TS reference, every branch hit`, async () => {
    const failures = [];
    /** @type {Map<string, number>} */
    const hits = new Map();
    let nonEmpty = 0;
    let maxBytes = 0;
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
    console.info(`random parity: ${CASES * SEEDS.length} cases, ${nonEmpty} with operations, 0 differ, largest output ${maxBytes} B\n${table}`);
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
      "amounts ≥ 10^12 minor units emit",
      "HUF / BHD / USD cart emits",
      "lower-case, padded or invalid country",
      "padded / astral / case-mapped code matched",
      "a priority above 3 owns a stack",
    ];
    const thin = BRANCHES.filter((b) => (hits.get(b) ?? 0) < MIN_HITS);
    expect(thin, `branches hit fewer than ${MIN_HITS} times:\n${table}`).toEqual([]);
    expect(overBudget).toEqual([]);
  }, 900_000);
});
