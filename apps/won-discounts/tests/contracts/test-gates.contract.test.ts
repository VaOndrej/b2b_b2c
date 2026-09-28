import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// The app's own gates must actually run what they claim:
//   - audit P3-7: `test:unit` runs the node tests AND the engine's vitest suite
//     (fixtures validated against the input query + schema) and fails if either fails;
//   - audit P3-4: `test:e2e:local:all` refuses to start the live matrix with a
//     stale settings_data overlay (it would reset the shared remote themes to
//     outdated settings).

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scripts = (JSON.parse(readFileSync(path.join(APP_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> })
  .scripts;

let scratch = "";
before(() => {
  scratch = mkdtempSync(path.join(tmpdir(), "won-discounts-gates-"));
});
after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

// --- P3-7: unit gate --------------------------------------------------------------------------

test("test:unit runs the unit gate runner (node tests + engine vitest)", async () => {
  assert.equal(scripts["test:unit"], "node ./scripts/run-unit-tests.mjs");
  const { UNIT_STEPS } = await import("../../scripts/run-unit-tests.mjs");
  assert.deepEqual(
    UNIT_STEPS.map((step: { command: string; args: string[] }) => [step.command, ...step.args].join(" ")),
    ["npx tsx --test tests/**/*.test.ts", "npm test -w won-discounts-engine"],
  );
});

test("the unit gate runs every suite and fails if either fails", async () => {
  const { runSteps } = await import("../../scripts/run-unit-tests.mjs");
  const step = (name: string, code: number) => ({ name, command: process.execPath, args: ["-e", `process.exit(${code})`] });
  const quiet = { log: () => {} };

  const firstFails = runSteps([step("node", 1), step("engine", 0)], quiet);
  assert.equal(firstFails.ok, false);
  assert.deepEqual(firstFails.results.map((r: { status: number | null }) => r.status), [1, 0], "the engine suite still ran");

  const secondFails = runSteps([step("node", 0), step("engine", 3)], quiet);
  assert.equal(secondFails.ok, false);

  assert.equal(runSteps([step("node", 0), step("engine", 0)], quiet).ok, true);
});

// --- P3-4: overlay drift check before the live E2E matrix ---------------------------------------

test("test:e2e:local:all checks the overlays first and stops on a stale one", () => {
  const script = scripts["test:e2e:local:all"];
  assert.match(script, /^node \.\/scripts\/make-e2e-overlay\.mjs --check && node \.\/scripts\/require-e2e-contract\.mjs --local-matrix$/);
});

/** `make-e2e-overlay.mjs --check` against canonical themes in `dirs` (read-only: never writes an overlay). */
function overlayCheck(dirs: { horizon: string; dawn: string }) {
  try {
    const stdout = execFileSync(process.execPath, ["scripts/make-e2e-overlay.mjs", "--check"], {
      cwd: APP_ROOT,
      env: { ...process.env, SHOPIFY_E2E_THEME_DIR_HORIZON: dirs.horizon, SHOPIFY_E2E_THEME_DIR_DAWN: dirs.dawn },
      stdio: "pipe",
      encoding: "utf8",
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

function themeWithSettings(name: string, settings: string) {
  const dir = path.join(scratch, name);
  mkdirSync(path.join(dir, "config"), { recursive: true });
  writeFileSync(path.join(dir, "config/settings_data.json"), settings);
  return dir;
}

test("make-e2e-overlay --check passes when the committed overlays match the canonical themes", () => {
  // A canonical theme equal to the committed overlay regenerates to exactly that overlay.
  const committed = (key: string) => readFileSync(path.join(APP_ROOT, `e2e/settings_data.${key}.json`), "utf8");
  const result = overlayCheck({
    horizon: themeWithSettings("fresh-horizon", committed("horizon")),
    dawn: themeWithSettings("fresh-dawn", committed("dawn")),
  });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /up to date/);
});

test("make-e2e-overlay --check exits non-zero when the canonical theme changed (stale overlay)", () => {
  const committed = (key: string) => readFileSync(path.join(APP_ROOT, `e2e/settings_data.${key}.json`), "utf8");
  const changed = JSON.parse(committed("horizon").replace(/^\uFEFF?\s*\/\*[\s\S]*?\*\/\s*/u, "")) as {
    current: Record<string, unknown>;
  };
  changed.current.won_test_drift = true;
  const result = overlayCheck({
    horizon: themeWithSettings("stale-horizon", JSON.stringify(changed, null, 2)),
    dawn: themeWithSettings("fresh-dawn-2", committed("dawn")),
  });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /settings_data\.horizon\.json is missing or stale/);
});
