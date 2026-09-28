// Writes tests/fixtures/*.json from tests/scenarios.js (the fixture directory is
// owned by this script: stale files are removed). Run after changing a scenario
// or when the engine's config encoding changed:
//
//   npm run fixtures -w won-discounts-engine
//
// tests/fixtures.drift.test.js fails while the committed files differ.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { buildFixture, fixtureFileName } from "./fixture-builder.js";
import scenarios from "./scenarios.js";

export const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/** @param {import("./fixture-builder.js").Scenario} scenario */
export function renderFixture(scenario) {
  return `${JSON.stringify(buildFixture(scenario), null, 2)}\n`;
}

function main() {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const wanted = new Set(scenarios.map(fixtureFileName));
  for (const file of readdirSync(FIXTURES_DIR)) {
    if (file.endsWith(".json") && !wanted.has(file)) rmSync(path.join(FIXTURES_DIR, file));
  }
  for (const scenario of scenarios) writeFileSync(path.join(FIXTURES_DIR, fixtureFileName(scenario)), renderFixture(scenario));
  console.log(`wrote ${scenarios.length} fixtures to ${path.relative(process.cwd(), FIXTURES_DIR) || "."}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
