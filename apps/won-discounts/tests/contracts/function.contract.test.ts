import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { sanitizeConfig } from "@won/core/discounts/config";
import { encodeFunctionConfig } from "@won/core/discounts/function-config";

// Contract for the `won-discounts-engine` discount function: the extension
// config matches what the app writes (metafield namespace/key, targets), and
// the compiled Wasm, run through the real Shopify CLI (`shopify app function
// run`), produces exactly the output recorded in every fixture.

const exec = promisify(execFile);

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXT_REL = "extensions/won-discounts-engine";
const EXT_DIR = path.join(APP_DIR, EXT_REL);
const FIXTURES_DIR = path.join(EXT_DIR, "tests/fixtures");
const LINES_QUERY = path.join(EXT_DIR, "src/cart_lines_discounts_generate_run.graphql");

type Fixture = {
  payload: { export: string; target: string; input: FixtureInput; output: unknown };
};
type FixtureInput = {
  discount?: { metafield?: { jsonValue?: unknown } | null };
  shop?: { localTime?: { campaignActive?: boolean; campaignStarted?: boolean } };
};
type RunResult = { success: boolean; output: unknown; logs: string };
type ExecFailure = { stdout?: string; stderr?: string; message?: string };

// Fixtures that document a function_config WITHOUT campaignStart/campaignEnd.
const NO_KEYS_PREFIX = "cart-lines-config-no-campaign-keys-";

function shopify(args: string[]) {
  return exec("npx", ["shopify", ...args], {
    cwd: APP_DIR,
    env: { ...process.env, SHOPIFY_CLI_NO_ANALYTICS: "1", NO_COLOR: "1" },
    maxBuffer: 16 * 1024 * 1024,
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

async function runFixture(workDir: string, file: string) {
  const fixture = JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf8")) as Fixture;
  const result = await runInput(workDir, file, fixture.payload.input, fixture.payload.export);
  return { fixture, result };
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

  const context = `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n--- error ---\n${failure}`;
  const result = parseLastJsonObject(stdout);
  assert.ok(result, `no function run JSON result in CLI output${context}`);
  assert.equal(result.success, true, `function run failed: ${result.logs}${context}`);
  return result;
}

const fixtureFiles = readdirSync(FIXTURES_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort();
const noKeysFiles = fixtureFiles.filter((file) => file.startsWith(NO_KEYS_PREFIX));

function readFixture(file: string) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf8")) as Fixture;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("extension toml: api version, both run targets, input variables metafield", () => {
  const toml = readFileSync(path.join(EXT_DIR, "shopify.extension.toml"), "utf8");
  assert.match(toml, /^api_version = "2026-04"$/m);
  assert.match(toml, /^handle = "won-discounts-engine"$/m);
  assert.match(toml, /target = "cart\.lines\.discounts\.generate\.run"/);
  assert.match(toml, /export = "cart-lines-discounts-generate-run"/);
  assert.match(toml, /target = "cart\.delivery-options\.discounts\.generate\.run"/);
  assert.match(toml, /export = "cart-delivery-options-discounts-generate-run"/);
  const variables = toml.split("[extensions.input.variables]")[1] ?? "";
  assert.match(variables, /^\s*namespace = "\$app:won_discounts"$/m);
  assert.match(variables, /^\s*key = "function_config"$/m);
});

test("input query reads function_config + product metafields and the campaign variables", () => {
  const query = readFileSync(LINES_QUERY, "utf8");
  assert.match(query, /metafield\(namespace: "\$app:won_discounts", key: "function_config"\)/);
  assert.match(query, /wonProduct: metafield\(namespace: "\$app:won_discounts", key: "product"\)/);
  assert.match(query, /\$campaignStart: DateTimeWithoutTimezone!/);
  assert.match(query, /\$campaignEnd: DateTimeWithoutTimezone!/);
  assert.match(query, /campaignActive: dateTimeBetween\(/);
  assert.match(query, /campaignStarted: dateTimeAfter\(dateTime: \$campaignStart\)/);
  assert.match(query, /triggeringDiscountCode/);
  assert.match(query, /enteredDiscountCodes/);
  // The comment must state the real contract, not the unverified default.
  assert.match(query, /MUST contain top-level `campaignStart` and\s*\n#\s*`campaignEnd`/);
});

test("fixtures exist for every prototype mode and for missing/corrupt config", () => {
  const names = fixtureFiles.join(" ");
  for (const needle of [
    "echo-codes",
    "echo-automatic",
    "percent-all",
    "campaign-active",
    "campaign-inactive",
    "campaign-debug-active",
    "campaign-debug-started",
    "campaign-debug-not-started",
    "product-metafield",
    "config-missing",
    "config-corrupt",
    "config-no-campaign-keys",
    "delivery-options",
  ]) {
    assert.match(names, new RegExp(needle), `missing fixture for ${needle}`);
  }
});

const SHOP_LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** `$name` of every variable the input query declares, e.g. ["campaignStart", "campaignEnd"]. */
function declaredQueryVariables(): string[] {
  const query = readFileSync(LINES_QUERY, "utf8").replace(/^#.*$/gm, "");
  const header = /query\s+\w+\s*\(([^)]*)\)/.exec(query)?.[1] ?? "";
  return [...header.matchAll(/\$(\w+)\s*:/g)].map((m) => m[1]);
}

// C4 (platform): a variable missing from function_config fails the whole run
// with InvalidVariableValueError. The app writes the metafield from
// encodeFunctionConfig, so its output must bind every declared variable — with
// or without a campaign.
test("encodeFunctionConfig output binds every variable the input query declares (C4)", () => {
  const variables = declaredQueryVariables();
  assert.deepEqual(variables.sort(), ["campaignEnd", "campaignStart"]);
  const withCampaign = sanitizeConfig({
    campaigns: [
      { id: "bf", name: "BF", window: { start: "2026-11-27T00:00:00", end: "2026-11-30T23:59:59" }, overrides: [], killed: false },
    ],
  }).config;
  for (const config of [sanitizeConfig({}).config, withCampaign]) {
    const payload = JSON.parse(encodeFunctionConfig(config).json) as Record<string, unknown>;
    for (const name of variables) {
      assert.equal(typeof payload[name], "string", `function_config must carry top-level ${name}`);
      assert.match(String(payload[name]), SHOP_LOCAL_DATETIME, `${name} must be a DateTimeWithoutTimezone`);
    }
  }
});

test("every object function_config fixture carries campaignStart/campaignEnd (query contract)", () => {
  for (const file of fixtureFiles) {
    if (file.startsWith(NO_KEYS_PREFIX)) continue;
    const config = readFixture(file).payload.input.discount?.metafield?.jsonValue;
    if (!isPlainObject(config)) continue; // missing / corrupt configs are separate cases
    assert.equal(typeof config.campaignStart, "string", `${file}: campaignStart`);
    assert.equal(typeof config.campaignEnd, "string", `${file}: campaignEnd`);
  }
});

describe("shopify app function run", { concurrency: 6 }, () => {
  let workDir = "";

  before(async () => {
    workDir = mkdtempSync(path.join(tmpdir(), "won-discounts-fn-"));
    await shopify(["app", "function", "build", "--path", EXT_REL]);
  }, { timeout: 180_000 });

  after(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  for (const file of fixtureFiles.filter((f) => !f.startsWith(NO_KEYS_PREFIX))) {
    test(file, { timeout: 90_000 }, async () => {
      const { fixture, result } = await runFixture(workDir, file);
      assert.deepEqual(result.output, fixture.payload.output);
    });
  }

  // The real encoder payload (no MVP 0 prototype mode in it) runs through the
  // compiled Wasm without an error and without a discount.
  test("the encodeFunctionConfig payload runs cleanly through the Wasm", { timeout: 90_000 }, async () => {
    const base = readFixture("cart-lines-config-no-prototype.json").payload;
    const jsonValue = JSON.parse(encodeFunctionConfig(sanitizeConfig({}).config).json) as unknown;
    const input = { ...base.input, discount: { ...(base.input.discount ?? {}), metafield: { jsonValue } } };
    const result = await runInput(workDir, "encoder-payload.json", input, base.export);
    assert.deepEqual(result.output, { operations: [] });
  });

  // LOCAL-RUNNER-ONLY — this is NOT platform behaviour. C4 settled the platform
  // side (docs/won-discounts/evidence/mvp0/c4-campaign-window.json): a
  // function_config without campaignStart/campaignEnd fails with
  // InvalidVariableValueError before the JS runs, the query defaults are NOT
  // applied, and the node gives 0 %. The local runner (function-runner 9.1.2)
  // binds no variables (its only inputs are the Wasm, the input JSON, the export
  // and the schema/query used for limits), so it cannot reproduce that: these
  // fixtures carry the 1970 leaves by hand and only pin that the JS itself never
  // crashes without the keys. The app must always write both keys —
  // encodeFunctionConfig does (contract test above).
  for (const file of noKeysFiles) {
    test(`local-runner-only (platform fails, C4): config without campaign keys: ${file}`, { timeout: 90_000 }, async () => {
      const input = readFixture(file).payload.input;
      const config = input.discount?.metafield?.jsonValue;
      assert.ok(isPlainObject(config), `${file}: config must be an object`);
      assert.equal("campaignStart" in config, false, `${file}: must omit campaignStart`);
      assert.equal("campaignEnd" in config, false, `${file}: must omit campaignEnd`);
      assert.deepEqual(
        { active: input.shop?.localTime?.campaignActive, started: input.shop?.localTime?.campaignStarted },
        { active: false, started: true },
        `${file}: leaves must be the query-default values`,
      );

      const { fixture, result } = await runFixture(workDir, file);
      assert.deepEqual(result.output, fixture.payload.output);
      assert.notDeepEqual(
        result.output,
        { operations: [] },
        "local runner only: the JS does not read the keys (on the platform the run fails before it, C4)",
      );
    });
  }
});
