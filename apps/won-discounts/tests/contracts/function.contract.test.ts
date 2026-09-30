import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { sanitizeConfig } from "@won/core/discounts/config";
import { buildNodeVars } from "@won/core/discounts/function-payload";

import {
  GIFT_ATTRIBUTE,
  OUTPUT_LIMIT_BYTES,
  outputBytes,
  outputLimit,
  runCartLines,
  runDelivery,
} from "../../extensions/won-discounts-engine/tests/reference-adapter.js";
import { inputLimit, messagePackBytes } from "../../extensions/won-discounts-engine/tests/input-size.js";
import { acquireBuildLock } from "../lib/build-lock.ts";

// Contract for the `won-discounts-engine` discount function (MVP 1, the engine):
//   - the extension config and input queries match what the app writes
//     (node variables `function_vars`, shared SHOP config `function_config`,
//     product metafield `product`) and bind the C4 campaign variables;
//   - the compiled Wasm (Rust, extensions/won-discounts-engine/README.md), run
//     through the real Shopify CLI (`shopify app function run`), produces
//     exactly the output recorded in every fixture;
//   - PARITY (DATA-4, one engine): that output equals the TS engine computed
//     directly in node — the reference adapter (tests/reference-adapter.js):
//     adaptInput → planCart → emitForNode → output mapping — so the Rust port
//     cannot drift from @won/core;
//   - every output fits Shopify's 20 kB output limit (same page, "Resource limits");
//   - the instruction budget (Shopify: 11 M instructions for carts up to 200
//     lines, shopify.dev/docs/api/functions/2026-04 "Resource limits", scaled
//     with the line count above that): ≥ 10 % headroom for the budget carts
//     filled to Shopify's input limit (the Pro and order-search worst cases), ≥ 30 % for every
//     other fixture, the other budget carts included — each budget cart within
//     the limits a real input has: input ≤ 128 kB of MessagePack (what Shopify
//     counts, tests/input-size.js), scaled with the lines; shared config ≤ 9 000 B.

const exec = promisify(execFile);

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXT_REL = "extensions/won-discounts-engine";
const EXT_DIR = path.join(APP_DIR, EXT_REL);
const FIXTURES_DIR = path.join(EXT_DIR, "tests/fixtures");
const QUERIES = {
  lines: path.join(EXT_DIR, "src/cart_lines_discounts_generate_run.graphql"),
  delivery: path.join(EXT_DIR, "src/cart_delivery_options_discounts_generate_run.graphql"),
};
const DELIVERY_TARGET = "cart.delivery-options.discounts.generate.run";

/** Shopify's compiled binary size limit (same page, "Fixed limits": 256 kB, 1 kB = 1000 B). */
const WASM_LIMIT_BYTES = 256_000;
/** Shopify's limit for carts up to 200 lines. */
const INSTRUCTION_LIMIT = 11_000_000;
/** Every ordinary fixture keeps ≥ 30 % headroom (and so does every budget cart not at the input limit). */
const INSTRUCTION_BUDGET = (INSTRUCTION_LIMIT / 10) * 7;
/**
 * The budget carts filled to Shopify's input limit (`AT_INPUT_LIMIT`: the Pro
 * and order-search worst cases, measured with the ids the checkout sends — app
 * rule ids, Shopify's cart line ids) keep ≥ 10 % headroom: 9.9 M up to 200
 * lines. This gates the realistic worst cases, not every shape: with the
 * searches bounded (the Pro stack cap, the order search's 16 exact lines) no
 * shape the audits found reaches the limit with the data the app writes (max
 * 93.7 %, 12 rule refs on every line), and legacy data with 16–30 marginRefs a
 * product reaches 103–105 % (README "Instruction budget", MVP 2 audit round 4).
 */
const WORST_CASE_BUDGET = (INSTRUCTION_LIMIT / 100) * 90;
/** The shared config's budget (C7), bytes of its JSON. */
const CONFIG_BUDGET_BYTES = 9_000;
/**
 * Above 200 lines Shopify's limit scales with the line count (like its output
 * limit), and so do the budgets: 500 lines → 27.5 M limit, 24.75 M (90 %) for
 * a budget cart at the input limit, 19.25 M (70 %) for any other.
 */
const scaled = (amount: number, lines: number) => Math.floor((amount * Math.max(200, lines)) / 200);
function instructionLimit(lines: number) {
  return scaled(INSTRUCTION_LIMIT, lines);
}
function instructionBudget(lines: number) {
  return scaled(INSTRUCTION_BUDGET, lines);
}
function worstCaseBudget(lines: number) {
  return scaled(WORST_CASE_BUDGET, lines);
}
/**
 * The fixtures that measure the budget (their own tests below): the 200-line
 * MVP 1 carts, the margin carts (fast path, full order search, most lines
 * capped with an over-budget output), the 500-line capped cart, and the Pro
 * worst cases at Shopify's input limit (200 and 500 lines, with 4 marginRefs,
 * with 64-character rule ids, and the Pro mesh of distinct 12-of-18 subsets),
 * and the margin order search's worst case there (200 and 500 lines whose rates
 * all lie within 10⁻¹¹ of each other).
 */
const BUDGET_PREFIX = /-\d+-lines-budget\.json$/;
/**
 * The budget carts filled to Shopify's input limit: only these get the 90 %
 * gate (each is checked to be ≥ 99 % of the limit). Every other budget cart —
 * 55–75 kB of input, 44–58 % of the limit — keeps the ordinary 70 % gate, so the
 * 90 % allowance never hides a regression on them.
 */
const AT_INPUT_LIMIT = /^lines-margin-(pro|near-min)-/;
/** The instruction gate of a budget cart. */
function budgetOf(file: string, lines: number) {
  return AT_INPUT_LIMIT.test(file) ? worstCaseBudget(lines) : instructionBudget(lines);
}

type Fixture = {
  scenario?: string;
  payload: { export: string; target: string; input: FixtureInput; output: unknown };
};
type FixtureInput = {
  discount?: { vars?: { jsonValue?: unknown } | null };
  cart?: { lines?: unknown[] };
};
type RunResult = { success: boolean; output: unknown; logs: string; instructions?: number };
type ExecFailure = { stdout?: string; stderr?: string; message?: string };

/** The function builds with cargo (Rust); rustup installs it user-level, off the default PATH. */
const CARGO_PATH = `${path.join(homedir(), ".cargo", "bin")}${path.delimiter}${process.env.PATH ?? ""}`;

function shopify(args: string[]) {
  return exec("npx", ["shopify", ...args], {
    cwd: APP_DIR,
    env: { ...process.env, PATH: CARGO_PATH, SHOPIFY_CLI_NO_ANALYTICS: "1", NO_COLOR: "1" },
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * The run result is the last top-level JSON object in stdout. Anything the CLI
 * prints around it (banners, notices, even ones containing braces) is skipped.
 */
function parseLastJsonObject(stdout: string): RunResult | null {
  const end = stdout.lastIndexOf("}");
  if (end === -1) return null;
  for (let start = stdout.indexOf("{"); start !== -1 && start < end; start = stdout.indexOf("{", start + 1)) {
    try {
      const parsed = JSON.parse(stdout.slice(start, end + 1)) as unknown;
      if (parsed && typeof parsed === "object" && "success" in parsed) return parsed as RunResult;
    } catch {
      // not the outermost object yet; try the next opening brace
    }
  }
  return null;
}

async function runInput(workDir: string, file: string, input: unknown, exportName: string) {
  const inputPath = path.join(workDir, file);
  writeFileSync(inputPath, JSON.stringify(input));

  let stdout = "";
  let stderr = "";
  let failure = "";
  try {
    ({ stdout, stderr } = await shopify([
      "app",
      "function",
      "run",
      "--path",
      EXT_REL,
      "--input",
      inputPath,
      "--export",
      exportName,
      "--json",
    ]));
  } catch (error) {
    // A failed run exits non-zero; keep everything it printed for the assertion.
    const e = error as ExecFailure;
    stdout = String(e.stdout ?? "");
    stderr = String(e.stderr ?? "");
    failure = String(e.message ?? error);
  }

  const context = `\n--- stdout (tail) ---\n${stdout.slice(-4000)}\n--- stderr ---\n${stderr}\n--- error ---\n${failure}`;
  const result = parseLastJsonObject(stdout);
  assert.ok(result, `no function run JSON result in CLI output${context}`);
  assert.equal(result.success, true, `function run failed: ${result.logs}${context}`);
  return result;
}

const fixtureFiles = readdirSync(FIXTURES_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort();

function readFixture(file: string) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf8")) as Fixture;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** PARITY: the fixture's output computed by the TS engine in node through the reference adapter (no Wasm). */
function engineOutput(fixture: Fixture) {
  return fixture.payload.target === DELIVERY_TARGET ? runDelivery(fixture.payload.input) : runCartLines(fixture.payload.input);
}

test("extension toml: api version, both run targets, node variables metafield function_vars", () => {
  const toml = readFileSync(path.join(EXT_DIR, "shopify.extension.toml"), "utf8");
  assert.match(toml, /^api_version = "2026-04"$/m);
  assert.match(toml, /^handle = "won-discounts-engine"$/m);
  assert.match(toml, /target = "cart\.lines\.discounts\.generate\.run"/);
  assert.match(toml, /export = "cart-lines-discounts-generate-run"/);
  assert.match(toml, /target = "cart\.delivery-options\.discounts\.generate\.run"/);
  assert.match(toml, /export = "cart-delivery-options-discounts-generate-run"/);
  const variables = toml.split("[extensions.input.variables]")[1] ?? "";
  assert.match(variables, /^\s*namespace = "\$app:won_discounts"$/m);
  assert.match(variables, /^\s*key = "function_vars"$/m);
});

for (const [target, file] of Object.entries(QUERIES)) {
  test(`${target} input query reads node vars, the shared shop config, product targeting and the campaign variables`, () => {
    const query = readFileSync(file, "utf8");
    const body = query.replace(/^\s*#.*$/gm, "");
    assert.match(body, /discount \{[^}]*vars: metafield\(namespace: "\$app:won_discounts", key: "function_vars"\)/);
    assert.match(body, /shop \{\s*config: metafield\(namespace: "\$app:won_discounts", key: "function_config"\)/);
    assert.match(body, /wonProduct: metafield\(namespace: "\$app:won_discounts", key: "product"\)/);
    // Required, and no defaults: the platform does not apply query defaults (C4).
    assert.match(body, /\$campaignStart: DateTimeWithoutTimezone!\s*\n/);
    assert.match(body, /\$campaignEnd: DateTimeWithoutTimezone!\s*\n/);
    assert.match(body, /campaignActive: dateTimeBetween\(\s*startDateTime: \$campaignStart\s*endDateTime: \$campaignEnd\s*\)/);
    assert.match(body, /\n\s*date\n/);
    assert.match(body, /triggeringDiscountCode/);
    assert.match(body, /enteredDiscountCodes \{\s*code\s*\}/);
    assert.match(body, /country \{\s*isoCode\s*\}/);
    assert.ok(body.includes(`gift: attribute(key: "${GIFT_ATTRIBUTE}")`), "gift lines are read from the adapter's attribute");
    assert.doesNotMatch(body, /\bmarket\b/, "localization.market is deprecated; markets are matched by country");
    if (target === "delivery") assert.match(body, /deliveryGroups \{\s*id\s*\}/);
    // The comment states the real contract, not a default.
    assert.match(query, /MUST (?:contain top-level `campaignStart` and|be top-level keys)/);
  });
}

const SHOP_LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** `$name` of every variable a query declares, e.g. ["campaignStart", "campaignEnd"]. */
function declaredQueryVariables(file: string): string[] {
  const query = readFileSync(file, "utf8").replace(/^#.*$/gm, "");
  const header = /query\s+\w+\s*\(([^)]*)\)/.exec(query)?.[1] ?? "";
  return [...header.matchAll(/\$(\w+)\s*:/g)].map((m) => m[1]);
}

// C4 (platform): a variable missing from the node's function_vars fails the
// whole run with InvalidVariableValueError. The sync writes buildNodeVars, so
// its output must bind every variable either query declares — for both roles,
// with or without a campaign.
test("buildNodeVars binds every variable both input queries declare (C4)", () => {
  const now = "2026-10-01T12:00:00";
  const withCampaign = sanitizeConfig({
    campaigns: [
      { id: "bf", name: "BF", window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:59" }, overrides: [], killed: false },
    ],
  }).config;
  for (const file of Object.values(QUERIES)) {
    const variables = declaredQueryVariables(file).sort();
    assert.deepEqual(variables, ["campaignEnd", "campaignStart"], file);
    for (const config of [sanitizeConfig({}).config, withCampaign]) {
      for (const role of [{ kind: "automatic" as const }, { kind: "code" as const, ruleId: "welcome" }]) {
        const vars = buildNodeVars(role, config, now) as unknown as Record<string, unknown>;
        for (const name of variables) {
          assert.equal(typeof vars[name], "string", `function_vars must carry top-level ${name}`);
          assert.match(String(vars[name]), SHOP_LOCAL_DATETIME, `${name} must be a DateTimeWithoutTimezone`);
        }
      }
    }
  }
});

test("fixtures cover every A1 scenario across roles", () => {
  const names = fixtureFiles.join(" ");
  for (const needle of [
    "lines-auto-alone",
    "lines-code-own-trigger",
    "lines-compete-code-wins-auto-node",
    "lines-compete-code-wins-code-node",
    "lines-compete-auto-wins-auto-node",
    "lines-compete-auto-wins-code-node",
    "lines-order-product-stack-auto",
    "lines-order-product-stack-code-node",
    "delivery-free-shipping-auto",
    "delivery-free-shipping-code",
    "lines-outlet-excluded",
    "lines-currency-missing",
    "lines-schedule-not-started",
    "lines-config-null",
    "delivery-config-null",
    "lines-campaign-version-mismatch",
    "lines-200-lines-budget",
  ]) {
    assert.match(names, new RegExp(`${needle}\\.json`), `missing fixture ${needle}`);
  }
});

test("every fixture's node variables carry campaignStart/campaignEnd (query contract)", () => {
  for (const file of fixtureFiles) {
    const vars = readFixture(file).payload.input.discount?.vars?.jsonValue;
    if (!isPlainObject(vars)) continue; // the missing-variables case is its own fixture
    assert.equal(typeof vars.campaignStart, "string", `${file}: campaignStart`);
    assert.equal(typeof vars.campaignEnd, "string", `${file}: campaignEnd`);
  }
});

// Audit P3-6: dev-harness.contract's `npm run build` rewrites the same Wasm
// (target/wasm32-unknown-unknown/release/won-discounts-engine.wasm). The build
// lock is held from this build until the last fixture ran, so no fixture ever
// runs against a half-written Wasm.
describe("shopify app function run", { concurrency: 6 }, () => {
  let workDir = "";
  let releaseBuildLock: () => void = () => {};
  const instructions = new Map<string, number>();

  before(async () => {
    releaseBuildLock = await acquireBuildLock();
    workDir = mkdtempSync(path.join(tmpdir(), "won-discounts-fn-"));
    await shopify(["app", "function", "build", "--path", EXT_REL]);
  }, { timeout: 15 * 60_000 });

  after(() => {
    releaseBuildLock();
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  test(`the built Wasm is under Shopify's ${WASM_LIMIT_BYTES} B binary size limit`, (t) => {
    const toml = readFileSync(path.join(EXT_DIR, "shopify.extension.toml"), "utf8");
    const wasm = /^\s*path = "([^"]+\.wasm)"$/m.exec(toml)?.[1];
    assert.ok(wasm, "shopify.extension.toml [extensions.build] path");
    const bytes = statSync(path.join(EXT_DIR, wasm)).size;
    t.diagnostic(`${wasm}: ${bytes} B of ${WASM_LIMIT_BYTES} B`);
    assert.ok(bytes < WASM_LIMIT_BYTES, `${bytes} B ≥ ${WASM_LIMIT_BYTES} B`);
  });

  for (const file of fixtureFiles) {
    test(file, { timeout: 120_000 }, async (t) => {
      const fixture = readFixture(file);
      const result = await runInput(workDir, file, fixture.payload.input, fixture.payload.export);
      assert.deepEqual(result.output, fixture.payload.output, "Wasm output = the fixture's expected output");
      assert.deepEqual(result.output, engineOutput(fixture), "PARITY: Wasm output = the engine run directly in node");
      // Shopify's output limit scales with the line count above 200 lines.
      const limit = outputLimit(fixture.payload.input.cart?.lines?.length ?? 0);
      assert.ok(limit >= OUTPUT_LIMIT_BYTES && outputBytes(result.output) < limit, `${file}: output ${outputBytes(result.output)} B ≥ Shopify's ${limit} B`);
      assert.equal(typeof result.instructions, "number", "function-runner reports the instruction count");
      instructions.set(file, result.instructions as number);
      t.diagnostic(`${file}: ${result.instructions} instructions`);
      if (!BUDGET_PREFIX.test(file)) {
        const lines = fixture.payload.input.cart?.lines?.length ?? 0;
        assert.ok(
          (result.instructions as number) <= instructionBudget(lines),
          `${file}: ${result.instructions} instructions > ${instructionBudget(lines)} (70 % of Shopify's ${instructionLimit(lines)})`,
        );
      }
    });
  }

  // The budget carts (37 rules, codes, a Pro stack, outlet lines; with margin
  // protection: the order stage's shortcut, its full search, most lines capped
  // with an over-budget output, 500 lines; the Pro worst cases: a Pro stack, a
  // cost price, 2 (or 4) collections with a margin setting and variant-level
  // refs on every line, or a Pro mesh of 18 rules with a different 12 on every
  // line; the order search over 200 or 500 lines of nearly equal rates; the
  // input filled to Shopify's limit), with the ids the checkout
  // sends: the JS function needed ~96 M instructions on the MVP 1 cart
  // (task-2-report.md of MVP 1); the Rust port must stay ≤ 90 % of Shopify's
  // (line-scaled) limit on the carts at the input limit, ≤ 70 % on the others.
  for (const file of fixtureFiles.filter((f) => BUDGET_PREFIX.test(f))) {
    const fixture = readFixture(file);
    const lines = fixture.payload.input.cart?.lines?.length ?? 0;
    const budget = budgetOf(file, lines);
    const limit = instructionLimit(lines);
    const atLimit = AT_INPUT_LIMIT.test(file);
    test(`${file}: a real input (≤ ${inputLimit(lines)} B of MessagePack, shared config ≤ ${CONFIG_BUDGET_BYTES} B)`, (t) => {
      const input = fixture.payload.input as { shop?: { config?: { jsonValue?: unknown } | null } };
      const inputBytes = messagePackBytes(fixture.payload.input);
      const configBytes = Buffer.byteLength(JSON.stringify(input.shop?.config?.jsonValue ?? null));
      t.diagnostic(`${file}: input ${inputBytes} B of MessagePack (${Buffer.byteLength(JSON.stringify(fixture.payload.input))} B of JSON)`);
      assert.ok(inputBytes <= inputLimit(lines), `${file}: input ${inputBytes} B`);
      assert.ok(configBytes <= CONFIG_BUDGET_BYTES, `${file}: shared config ${configBytes} B`);
      // The 90 % gate is only for carts really at the input limit.
      if (atLimit) assert.ok(inputBytes >= inputLimit(lines) * 0.99, `${file}: ${inputBytes} B is not at the input limit (${inputLimit(lines)} B)`);
    });
    test(`${file}: ≤ ${budget} instructions (Shopify limit ${limit} − ${atLimit ? 10 : 30} %)`, {
      timeout: 120_000,
    }, async (t) => {
      let count = instructions.get(file);
      if (count === undefined) {
        count = (await runInput(workDir, `budget-${file}`, fixture.payload.input, fixture.payload.export)).instructions;
      }
      t.diagnostic(`${file}: ${count} instructions, limit ${limit}, budget ${budget}`);
      assert.ok(typeof count === "number" && count <= budget, `${file}: ${count} > ${budget}`);
    });
  }
});
