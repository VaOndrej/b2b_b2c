import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The frontend map in the app's README (between <!-- map:start --> and <!-- map:end -->) names, for every menu
// item and tab, its route, screen, model, integration and tests. A path that no longer exists sends an agent
// searching, so every one of them must exist: app paths from app/, test paths from tests/.

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readme = readFileSync(path.join(appRoot, "README.md"), "utf8");

function mapRows(): string[][] {
  const start = readme.indexOf("<!-- map:start -->");
  const end = readme.indexOf("<!-- map:end -->");
  assert.ok(start >= 0 && end > start, "README has the map markers");
  return readme
    .slice(start, end)
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Obrazovka") && !line.startsWith("|---"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
}

const paths = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

test("the README starts as Won Discounts, not as the app template", () => {
  assert.match(readme, /^# Won Discounts\n/);
});

test("every menu item and tab is in the map", () => {
  const names = mapRows().map((row) => row[0]);
  for (const name of ["Přehled", "Onboarding", "Slevy a kódy", "Editor slevy", "Množstevní slevy", "Milníky", "Výprodej", "Kampaně",
    "Umístění na webu", "Ochrana marže", "Vyzkoušet košík", "Přehledy", "Překlady", "Nastavení"]) {
    assert.ok(names.includes(name), `${name} is in the map`);
  }
});

test("every path in the map exists: route, screen, model and integration from app/, tests from tests/", () => {
  const missing: string[] = [];
  for (const row of mapRows()) {
    const [, , route, screen, model, integration, tests] = row;
    for (const file of [...paths(route), ...paths(screen), ...paths(model), ...paths(integration)]) {
      if (!existsSync(path.join(appRoot, "app", file))) missing.push(`app/${file}`);
    }
    for (const file of paths(tests)) if (!existsSync(path.join(appRoot, "tests", file))) missing.push(`tests/${file}`);
  }
  assert.deepEqual(missing, []);
});
