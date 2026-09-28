// The committed fixtures are exactly what tests/scenarios.js + the public
// @won/core builders produce today. A red test here after an engine change
// (e.g. how the shared config encodes codes) means: regenerate with
// `npm run fixtures -w won-discounts-engine` and review the diff.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { buildFixture, fixtureFileName } from "./fixture-builder.js";
import { FIXTURES_DIR } from "./generate-fixtures.js";
import scenarios from "./scenarios.js";

describe("fixtures are generated from the scenarios", () => {
  test("one fixture file per scenario, nothing else", () => {
    const names = scenarios.map(fixtureFileName);
    expect(new Set(names).size).toBe(names.length);
    const files = readdirSync(FIXTURES_DIR).filter((file) => file.endsWith(".json"));
    expect(files.sort()).toEqual([...names].sort());
  });

  for (const scenario of scenarios) {
    test(`${fixtureFileName(scenario)} is up to date`, () => {
      const committed = JSON.parse(readFileSync(path.join(FIXTURES_DIR, fixtureFileName(scenario)), "utf8"));
      expect(committed).toEqual(buildFixture(scenario));
    });
  }
});
