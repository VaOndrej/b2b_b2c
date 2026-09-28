import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
  payload: { export: string; target: string; input: unknown; output: unknown };
};

function shopify(args: string[]) {
  return exec("npx", ["shopify", ...args], {
    cwd: APP_DIR,
    env: { ...process.env, SHOPIFY_CLI_NO_ANALYTICS: "1", NO_COLOR: "1" },
    maxBuffer: 16 * 1024 * 1024,
  });
}

function parseRunOutput(stdout: string) {
  const start = stdout.indexOf("{");
  assert.notEqual(start, -1, `no JSON in function run output:\n${stdout}`);
  return JSON.parse(stdout.slice(start)) as { success: boolean; output: unknown; logs: string };
}

const fixtureFiles = readdirSync(FIXTURES_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort();

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
  assert.match(query, /triggeringDiscountCode/);
  assert.match(query, /enteredDiscountCodes/);
});

test("fixtures exist for every prototype mode and for missing/corrupt config", () => {
  const names = fixtureFiles.join(" ");
  for (const needle of [
    "echo-codes",
    "percent-all",
    "campaign-active",
    "campaign-inactive",
    "product-metafield",
    "config-missing",
    "config-corrupt",
    "delivery-options",
  ]) {
    assert.match(names, new RegExp(needle), `missing fixture for ${needle}`);
  }
});

describe("shopify app function run over every fixture", { concurrency: 6 }, () => {
  let workDir = "";

  before(async () => {
    workDir = mkdtempSync(path.join(tmpdir(), "won-discounts-fn-"));
    await shopify(["app", "function", "build", "--path", EXT_REL]);
  }, { timeout: 180_000 });

  after(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  for (const file of fixtureFiles) {
    test(file, { timeout: 90_000 }, async () => {
      const fixture = JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), "utf8")) as Fixture;
      const inputPath = path.join(workDir, file);
      writeFileSync(inputPath, JSON.stringify(fixture.payload.input));

      let stdout: string;
      try {
        ({ stdout } = await shopify([
          "app",
          "function",
          "run",
          "--path",
          EXT_REL,
          "--input",
          inputPath,
          "--export",
          fixture.payload.export,
          "--json",
        ]));
      } catch (error) {
        // A failed run exits non-zero but still prints the JSON result (with logs).
        stdout = String((error as { stdout?: string }).stdout ?? "");
      }
      const result = parseRunOutput(stdout);

      assert.equal(result.success, true, `function run failed: ${result.logs}`);
      assert.deepEqual(result.output, fixture.payload.output);
    });
  }
});
