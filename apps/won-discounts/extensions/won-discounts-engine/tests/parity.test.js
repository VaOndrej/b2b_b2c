// PARITY (DATA-4, one brain): the Rust function must give exactly the output of
// the TS engine (@won/core planCart + emitForNode through the reference adapter
// tests/reference-adapter.js, i.e. what the JS function did).
//
//   1. fixtures: the TS reference reproduces every committed fixture's output
//      (tests/default.test.js runs the same fixtures through the Wasm, so the
//      two together pin Wasm = TS on all of them);
//   2. random: seeded random carts and configs — junk included, since the shop
//      config and product metafields are data the function must read
//      tolerantly — through the compiled Wasm (function-runner) and through the
//      TS reference; the outputs must be deep-equal.
//
// PARITY_CASES (default 1000) and PARITY_SEED override the random run.

import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { buildFunction, getFunctionInfo } from "@shopify/shopify-function-test-helpers";
import { codeHash } from "@won/core/discounts/code-hash";
import { beforeAll, describe, expect, test } from "vitest";

import { runCartLines, runDelivery } from "./reference-adapter.js";

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(testsDir, "fixtures");
const LINES = "cart-lines-discounts-generate-run";
const DELIVERY = "cart-delivery-options-discounts-generate-run";
const CASES = Number(process.env.PARITY_CASES ?? 1000);
const SEED = Number(process.env.PARITY_SEED ?? 20260928);

/** The TS reference output for a function input. */
export function referenceOutput(exportName, input) {
  return exportName === DELIVERY ? runDelivery(input) : runCartLines(input);
}

describe("parity: the TS reference reproduces every fixture", () => {
  const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json")).sort();
  for (const file of files) {
    test(file, () => {
      const { payload } = JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf8"));
      expect(referenceOutput(payload.export, payload.input)).toEqual(payload.output);
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

const RULE_IDS = ["r0", "r1", "r2", "r3", "r4", "r5", "r6", "r7"];
const CODES = ["SAVE10", "VIP", "Léto", "X1", "  spaced "];
const VARIANTS = [1001, 1002, 1003, 1004];
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

  const money = () =>
    junk(0.3)
      ? pick([{ CZK: -100 }, { CZK: "50" }, {}, null, { CZK: 150.5 }, { JPY: 500 }])
      : pick([{ CZK: pick([5000, 10000, 2550, 999999]) }, { CZK: 3000, EUR: 200 }, { EUR: pick([100, 500]) }, { CZK: 1500, JPY: 500, KWD: 1234 }]);
  const value = () =>
    junk(0.25)
      ? pick([{ kind: "percentage", percent: pick([0, 120, -5, "10"]) }, { kind: "bogus" }, null, { kind: "fixed", amount: money() }])
      : pick([
          { kind: "percentage", percent: pick([5, 10, 10, 12.5, 15, 20, 33.333, 50, 100]) },
          { kind: "percentage", percent: pick([10, 25]) },
          { kind: "percentage", percent: pick([7, 30]) },
          { kind: "fixed", amount: money() },
          { kind: "fixed", amount: money() },
          { kind: "freeShipping" },
        ]);
  const target = () =>
    junk(0.2) ? pick([{ kind: "x" }, null, "products"]) : pick([{ kind: "products" }, { kind: "products" }, { kind: "products" }, { kind: "collections" }, { kind: "order" }, { kind: "shipping" }]);
  const schedule = () =>
    chance(0.85)
      ? undefined
      : junk(0.5)
        ? pick([{ invalid: true }, {}, null, "2026-10-01", { startsOn: "2026-09-01T00:00:00+02:00" }])
        : pick([{ startsOn: "2026-10-01" }, { startsOn: "2026-10-02" }, { endsOn: "2026-09-30" }, { startsOn: "2026-09-01", endsOn: "2026-10-01" }]);

  function rule(id) {
    const method = junk(0.1) ? "other" : chance(0.35) ? "code" : "automatic";
    const r = { id: junk(0.1) ? pick(["", 5, undefined]) : id };
    r.enabled = junk(0.15) ? pick([false, "true", undefined]) : chance(0.92);
    if (!junk(0.2)) r.name = chance(0.85) ? `Sleva ${id}` : "";
    else r.name = pick([7, undefined]);
    r.method = method;
    if (method === "code") r.codeHashes = some(CODES, 0.4).map(codeHash).concat(junk(0.2) ? ["ZZZZZZZZ", 3] : []);
    r.value = value();
    r.target = target();
    if (chance(0.3)) r.priority = junk(0.3) ? pick([1.7, "5"]) : pick([0, 1, 2, 3]);
    if (chance(0.2)) r.minimum = junk(0.3) ? pick([{}, "x", { quantity: 2.5 }]) : pick([{ subtotal: money() }, { quantity: pick([1, 2, 4]) }, { subtotal: { CZK: 30000 }, quantity: 2 }]);
    const s = schedule();
    if (s !== undefined) r.schedule = s;
    if (chance(0.15)) r.targeting = junk(0.4) ? pick([{ markets: ["us", 4] }, { markets: [] }, null]) : pick([{ markets: ["eu"] }, { markets: ["us"] }, { segments: ["vip"] }]);
    if (chance(0.3)) r.combinesWith = { ruleIds: some(RULE_IDS, 0.35).concat(junk(0.3) ? ["ghost"] : []) };
    return r;
  }

  function patch() {
    const p = {};
    if (chance(0.6)) p.value = value();
    if (chance(0.2)) p.target = target();
    if (chance(0.15)) p.enabled = junk(0.5) ? null : pick([true, false]);
    if (chance(0.15)) p.name = junk(0.5) ? null : pick(["Kampaň", ""]);
    if (chance(0.1)) p.minimum = junk(0.5) ? null : { subtotal: { CZK: 5000 } };
    if (chance(0.1)) p.targeting = junk(0.5) ? null : { markets: ["eu"] };
    if (chance(0.1)) p.combinesWith = { ruleIds: some(RULE_IDS, 0.3) };
    if (junk(0.1)) p.id = "hijack";
    return p;
  }

  function config() {
    if (junk(0.15)) return pick([null, { percent: 9 }, [], { modules: { codes: { rules: {} } } }]);
    const ids = RULE_IDS.slice(0, 2 + int(RULE_IDS.length - 1));
    const rules = ids.map(rule);
    if (junk(0.3)) rules.push(rule(pick(ids)), "junk", null);
    const campaignId = chance(0.4) ? "bf" : pick([null, "old"]);
    const c = {
      schemaVersion: 1,
      campaignId,
      campaignVarsVersion: campaignId ? pick(["v1", "v1", "v2"]) : null,
      engine: {
        combination: {
          outletWithAnything: chance(0.2),
          productWithOrder: chance(0.8),
          productWithShipping: chance(0.85),
          orderWithShipping: chance(0.85) ? true : junk(0.5) ? "no" : false,
        },
      },
      marketCountries: { eu: ["CZ", "sk"], us: ["US"], none: [] },
      modules: { codes: { rules } },
      campaigns: chance(0.5)
        ? [
            {
              id: pick(["bf", "bf", "other"]),
              killed: chance(0.1),
              overrides: Array.from({ length: 1 + int(3) }, () => ({ ruleId: pick(ids), patch: junk(0.2) ? "x" : patch() })),
            },
          ]
        : [],
    };
    if (junk(0.2)) delete c.engine;
    return { config: c, ids, codeRules: rules.filter((r) => r && r.method === "code") };
  }

  function wonProduct(variant, ids) {
    if (chance(0.08)) return null;
    const refs = () =>
      some(ids, 0.4)
        .map((id) => (chance(0.12) ? `${id}@${pick(["bf", "other"])}` : id))
        .concat(junk(0.3) ? ["ghost", 9] : []);
    const won = { ruleIds: refs() };
    if (chance(0.2)) won.variantRuleIds = { [String(pick(VARIANTS))]: refs(), ...(chance(0.3) ? { [vid(variant)]: refs() } : {}) };
    if (chance(0.12)) won.outlet = chance(0.5) ? true : [vid(pick(VARIANTS)), vid(variant)].slice(0, 1 + int(2));
    if (junk(0.1)) return { jsonValue: pick([["r1"], "r1", 3]) };
    return { jsonValue: won };
  }

  function line(n, ids) {
    const variant = pick(VARIANTS);
    return {
      id: `gid://shopify/CartLine/${n}`,
      quantity: pick([1, 1, 2, 3, 5, 0]),
      cost: { amountPerQuantity: { amount: pick(["100.0", "249.9", "30.0", "0.5", "1000", "12.345", "10.05", "999.99", "0.0"]) } },
      gift: chance(0.08) ? { value: pick(["tier-1", "", null]) } : null,
      merchandise: chance(0.92)
        ? { __typename: "ProductVariant", id: vid(variant), product: { wonProduct: wonProduct(variant, ids) } }
        : { __typename: "CustomProduct" },
    };
  }

  return function nextCase() {
    hostile = chance(0.3);
    const exportName = chance(0.65) ? LINES : DELIVERY;
    const built = config();
    const shopConfig = built && built.config ? built.config : built;
    const ids = built?.ids ?? RULE_IDS;
    const codeRules = built?.codeRules ?? [];
    const entered = some(CODES, 0.45)
      .map((c) => (chance(0.3) ? c.toLowerCase() : c))
      .concat(junk(0.3) ? ["UNKNOWN"] : []);
    const codeRule = codeRules.length > 0 && chance(0.4) ? pick(codeRules) : null;
    const role = junk(0.1) ? "other" : codeRule ? "code" : "automatic";
    const vars = junk(0.1)
      ? null
      : {
          role,
          ...(role === "code" ? { ruleId: junk(0.2) ? "" : codeRule.id } : junk(0.1) ? { ruleId: "r1" } : {}),
          campaignId: pick(["bf", "bf", null, "old"]),
          campaignStart: "2026-09-30T00:00:00",
          campaignEnd: "2026-10-05T23:59:59",
          varsVersion: pick(["v1", "v1", "v2", null]),
        };
    const triggering =
      role === "code" ? (entered.length > 0 && chance(0.8) ? pick(entered) : pick([null, "nope"])) : junk(0.2) ? "SAVE10" : null;
    const cart = { cost: { subtotalAmount: { currencyCode: pick(["CZK", "CZK", "CZK", "CZK", "CZK", "EUR", "EUR", "JPY", "KWD"]) } } };
    if (exportName === DELIVERY) {
      cart.deliveryGroups = Array.from({ length: chance(0.9) ? 1 + int(2) : 0 }, (_, i) => ({ id: `gid://shopify/CartDeliveryGroup/${i + 1}` }));
    }
    cart.lines = Array.from({ length: int(9) }, (_, i) => line(i + 1, ids));
    const input = {
      triggeringDiscountCode: triggering,
      enteredDiscountCodes: entered.map((code) => ({ code })),
      discount: {
        discountClasses: hostile ? some(["PRODUCT", "ORDER", "SHIPPING"], 0.6) : ["PRODUCT", "ORDER", "SHIPPING"],
        vars: vars === null ? null : { jsonValue: vars },
      },
      shop: {
        config: shopConfig === null ? null : { jsonValue: shopConfig },
        localTime: { date: pick(["2026-10-01", "2026-10-01", "2026-10-01", "2026-09-15"]), campaignActive: chance(0.6) },
      },
      localization: { country: { isoCode: pick(["CZ", "CZ", "SK", "US", "DE"]) }, language: { isoCode: pick(["CS", "CS", "EN", "SK", "DE"]) } },
      cart,
    };
    return { exportName, input };
  };
}

function runWasm(runnerPath, wasmPath, exportName, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(runnerPath, ["-f", wasmPath, "--export", exportName, "--json"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        const result = JSON.parse(stdout);
        resolve({ ...result, exitCode: code });
      } catch {
        reject(new Error(`function-runner exit ${code}: ${stderr || stdout}`));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

describe("parity: Wasm = TS reference on random carts and configs", () => {
  let runnerPath = "";
  let wasmPath = "";

  beforeAll(async () => {
    const functionDir = path.dirname(testsDir);
    await buildFunction(functionDir);
    ({ functionRunnerPath: runnerPath, wasmPath } = await getFunctionInfo(functionDir));
  }, 600_000);

  test(`${CASES} seeded cases (seed ${SEED})`, async () => {
    const next = generator(SEED);
    const cases = Array.from({ length: CASES }, next);
    const failures = [];
    let nonEmpty = 0;
    for (let i = 0; i < cases.length; i += 8) {
      const batch = cases.slice(i, i + 8);
      const results = await Promise.all(batch.map((c) => runWasm(runnerPath, wasmPath, c.exportName, c.input)));
      results.forEach((result, j) => {
        const c = batch[j];
        const expected = referenceOutput(c.exportName, c.input);
        if (expected.operations.length > 0) nonEmpty += 1;
        if (!result.success || !isDeepStrictEqual(result.output, expected)) {
          failures.push({ index: i + j, exportName: c.exportName, got: result.output, logs: result.logs, expected, input: c.input });
        }
      });
    }
    if (failures.length > 0) {
      const first = failures[0];
      throw new Error(
        `${failures.length}/${CASES} random cases differ (seed ${SEED}); first #${first.index} ${first.exportName}\n` +
          `got      ${JSON.stringify(first.got)}\nexpected ${JSON.stringify(first.expected)}\nlogs ${first.logs}\n` +
          `input    ${JSON.stringify(first.input)}`,
      );
    }
    console.info(`random parity: ${CASES} cases, ${nonEmpty} with operations, 0 differ (seed ${SEED})`);
    // The generator must actually exercise discounts, not only "no operations".
    expect(nonEmpty).toBeGreaterThan(CASES / 5);
  }, 600_000);
});
