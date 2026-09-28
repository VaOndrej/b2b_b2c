#!/usr/bin/env node
// The app's unit gate (`npm run test:unit`, audit P3-7): runs BOTH suites and
// fails if EITHER fails.
//   1. node tests   — tests/**/*.test.ts (node:test via tsx, files in parallel)
//   2. engine tests — `npm test -w won-discounts-engine` (vitest: every function
//                     fixture validated against the input query and the
//                     function schema, then run through the Wasm)
// Sequential on purpose: the engine suite rebuilds dist/function.wasm, which
// the node suite's function.contract runs fixtures against (see
// tests/lib/build-lock.ts). The second suite runs even when the first failed,
// so one run reports every failure.

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const UNIT_STEPS = [
  // The glob is passed to tsx as ONE argument (no shell), so node's own test
  // runner expands `**` — sh would narrow it to one directory level.
  { name: "node tests (tests/**/*.test.ts)", command: "npx", args: ["tsx", "--test", "tests/**/*.test.ts"] },
  { name: "engine tests (npm test -w won-discounts-engine)", command: "npm", args: ["test", "-w", "won-discounts-engine"] },
];

/**
 * Run every step in order (never stopping early) and report.
 * @param {{ name: string, command: string, args: string[] }[]} steps
 * @param {{ cwd?: string, log?: (line: string) => void }} [options]
 * @returns {{ ok: boolean, results: { name: string, status: number | null }[] }}
 */
export function runSteps(steps, { cwd = appRoot, log = (line) => console.log(line) } = {}) {
  const results = [];
  for (const step of steps) {
    log(`\n▶ ${step.name}`);
    const run = spawnSync(step.command, step.args, { cwd, stdio: "inherit", env: process.env });
    const status = run.error ? null : run.status;
    results.push({ name: step.name, status });
  }
  const ok = results.every((result) => result.status === 0);
  log("\nUnit gate:");
  for (const result of results) log(`  ${result.status === 0 ? "✔" : "✖"} ${result.name} (exit ${result.status})`);
  return { ok, results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { ok } = runSteps(UNIT_STEPS);
  process.exitCode = ok ? 0 : 1;
}
