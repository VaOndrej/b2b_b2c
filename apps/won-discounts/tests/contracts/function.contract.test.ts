import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { sanitizeConfig } from "@won/core/discounts/config";
import { emitForNode, type NodeEmission } from "@won/core/discounts/emit";
import { buildNodeVars } from "@won/core/discounts/function-payload";
import { planCart } from "@won/core/discounts/plan";

import {
  adaptInput,
  GIFT_ATTRIBUTE,
  toCartLinesResult,
  toDeliveryResult,
} from "../../extensions/won-discounts-engine/tests/reference-adapter.js";
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
//   - the instruction budget (Shopify: 11 M instructions for carts up to 200
//     lines, shopify.dev/docs/api/functions/2026-04 "Resource limits"), with
//     ≥ 30 % headroom for every fixture, the 200-line carts included.

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

/** Shopify's limit for carts up to 200 lines; we keep ≥ 30 % headroom. */
const INSTRUCTION_LIMIT = 11_000_000;
const INSTRUCTION_BUDGET = (INSTRUCTION_LIMIT / 10) * 7;
/** The 200-line fixtures that measure the budget (their own tests below). */
const BUDGET_PREFIX = /-200-lines-budget\.json$/;

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

const NO_EMISSION: NodeEmission = { productCandidates: [], orderCandidates: [], deliveryCandidates: [] };

/** PARITY: the fixture's output computed by the engine in node (no Wasm). */
function engineOutput(fixture: Fixture) {
  const adapted = adaptInput(fixture.payload.input);
  const emission =
    adapted.role === null
      ? NO_EMISSION
      : emitForNode(planCart(adapted.cart, adapted.config as Parameters<typeof planCart>[1]), adapted.role, adapted.triggeringCode);
  return fixture.payload.target === DELIVERY_TARGET ? toDeliveryResult(emission, adapted) : toCartLinesResult(emission, adapted);
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

  for (const file of fixtureFiles) {
    test(file, { timeout: 120_000 }, async (t) => {
      const fixture = readFixture(file);
      const result = await runInput(workDir, file, fixture.payload.input, fixture.payload.export);
      assert.deepEqual(result.output, fixture.payload.output, "Wasm output = the fixture's expected output");
      assert.deepEqual(result.output, engineOutput(fixture), "PARITY: Wasm output = the engine run directly in node");
      assert.equal(typeof result.instructions, "number", "function-runner reports the instruction count");
      instructions.set(file, result.instructions as number);
      t.diagnostic(`${file}: ${result.instructions} instructions`);
      if (!BUDGET_PREFIX.test(file)) {
        assert.ok(
          (result.instructions as number) <= INSTRUCTION_BUDGET,
          `${file}: ${result.instructions} instructions > ${INSTRUCTION_BUDGET} (70 % of Shopify's ${INSTRUCTION_LIMIT})`,
        );
      }
    });
  }

  // The 200-line carts (37 rules, codes, a Pro stack, outlet lines): the JS
  // function needed ~96 M instructions here (task-2-report.md); the Rust port
  // must stay ≤ 70 % of Shopify's limit like every other fixture.
  for (const file of fixtureFiles.filter((f) => BUDGET_PREFIX.test(f))) {
    test(`${file}: ≤ ${INSTRUCTION_BUDGET} instructions (Shopify limit ${INSTRUCTION_LIMIT} − 30 %)`, {
      timeout: 120_000,
    }, async (t) => {
      let count = instructions.get(file);
      if (count === undefined) {
        const fixture = readFixture(file);
        count = (await runInput(workDir, `budget-${file}`, fixture.payload.input, fixture.payload.export)).instructions;
      }
      t.diagnostic(`${file}: ${count} instructions, limit ${INSTRUCTION_LIMIT}, budget ${INSTRUCTION_BUDGET}`);
      assert.ok(typeof count === "number" && count <= INSTRUCTION_BUDGET, `${file}: ${count} > ${INSTRUCTION_BUDGET}`);
    });
  }
});
