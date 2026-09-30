// Replays the dev store's logged function runs (`shopify app dev` writes each
// to apps/won-discounts/.shopify/logs/*.json: export, input, output, status)
// through one or more Wasm builds with function-runner, and compares each
// build's output with the logged one as JSON text: both parsed and serialized
// again, so key order and values count, but not how a number was written (the
// log and function-runner give parsed JSON: 10.0 and 10 read alike; the
// fixtures' text comparison, tests/parity.test.js, checks the number form). It
// shows that a new build gives the live checkout what the build it replaces
// gave on every real run (MVP 2 audit round 4: the engine changed while the
// live E2E gate ran). Not a test: the logs are local.
//
//   node tests/replay-logs.mjs [--logs <dir>] [--out <file.json>] <wasm> [<wasm> …]
//
// Prints, per build: runs, identical to the log, different, runner failures;
// and, for two or more builds, the runs where the builds differ from each
// other. --out writes every differing run (file, time, which builds differ).

import { spawn } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../../../../..");
const RUNNER = path.join(ROOT, "node_modules/@shopify/cli/bin/function-runner-9.1.2");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  if (at < 0) return fallback;
  const [, value] = args.splice(at, 2);
  return value;
};
const logsDir = option("--logs", path.resolve(here, "../../../.shopify/logs"));
const outFile = option("--out", null);
const wasms = args;
if (wasms.length === 0) throw new Error("usage: node tests/replay-logs.mjs [--logs <dir>] [--out <file>] <wasm> [<wasm> …]");

/** One run through function-runner: { success, text } (text = JSON of its output). */
function run(wasm, exportName, input) {
  return new Promise((resolve) => {
    const child = spawn(RUNNER, ["-f", wasm, "--export", exportName, "--json"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.on("close", () => {
      try {
        const r = JSON.parse(stdout);
        resolve({ success: r.success === true, text: JSON.stringify(r.output ?? null), instructions: r.instructions });
      } catch {
        resolve({ success: false, text: null, instructions: null });
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

const files = readdirSync(logsDir)
  .filter((f) => f.endsWith(".json"))
  .sort();
const runs = files
  .map((file) => ({ file, log: JSON.parse(readFileSync(path.join(logsDir, file), "utf8")) }))
  .filter(({ log }) => log.logType === "function_run" && log.payload?.input && log.payload?.export);

const stats = wasms.map(() => ({ identical: 0, different: 0, loggedFailure: 0, runnerFailure: 0 }));
const differing = [];
const PARALLEL = 6;
for (let i = 0; i < runs.length; i += PARALLEL) {
  const batch = runs.slice(i, i + PARALLEL);
  await Promise.all(
    batch.map(async ({ file, log }) => {
      const logged = log.status === "success" ? JSON.stringify(log.payload.output ?? null) : null;
      const results = await Promise.all(wasms.map((w) => run(w, log.payload.export, log.payload.input)));
      const verdicts = results.map((r, k) => {
        if (!r.success) stats[k].runnerFailure += 1;
        if (logged === null) {
          stats[k].loggedFailure += 1;
          return r.success ? "logged failure, runs now" : "failed, as logged";
        }
        if (r.text === logged) {
          stats[k].identical += 1;
          return "identical";
        }
        stats[k].different += 1;
        return "different";
      });
      const buildsDiffer = results.some((r) => r.text !== results[0].text || r.success !== results[0].success);
      if (verdicts.some((v) => v !== "identical") || buildsDiffer) {
        differing.push({ file, time: log.logTimestamp, export: log.payload.export, status: log.status, verdicts, buildsDiffer, fuel: log.payload.fuelConsumed, instructions: results.map((r) => r.instructions) });
      }
    }),
  );
}

console.log(`${runs.length} logged runs (${files.length} log files) in ${logsDir}`);
wasms.forEach((w, k) => {
  const s = stats[k];
  console.log(`${path.basename(w)}: identical to the log ${s.identical}, different ${s.different}, logged as failures ${s.loggedFailure}, runner failures ${s.runnerFailure}`);
});
if (wasms.length > 1) console.log(`runs where the builds' outputs differ from each other: ${differing.filter((d) => d.buildsDiffer).length}`);
if (outFile) writeFileSync(outFile, JSON.stringify(differing, null, 2));
