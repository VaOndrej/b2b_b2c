import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getViolationsSyncMode } from "../../app/services/violations-sync-mode.server.ts";

const APP_SHELL_ROUTE_PATH = "app/routes/app.tsx";
const APP_HEALTH_ROUTE_PATH = "app/routes/app.health.tsx";
const VIOLATIONS_ROUTE_PATH = "app/routes/app.violations.tsx";

test("violations route documents dev and production sync modes explicitly", async () => {
  const development = getViolationsSyncMode(false);
  const production = getViolationsSyncMode(true);

  assert.equal(
    development.usesLocalDevLogSync,
    true,
    "Development mode must opt into local Shopify Function log sync.",
  );
  assert.match(
    development.sourceMessage,
    /Development mode: this page also syncs local Shopify Function logs from \.shopify\/logs\./,
    "Development mode must explicitly describe dev-only local log sync behavior.",
  );
  assert.equal(
    production.usesLocalDevLogSync,
    false,
    "Production mode must avoid local dev log sync.",
  );
  assert.match(
    production.sourceMessage,
    /Production mode: this page reads persisted violations only\./,
    "Production mode must explicitly describe persisted-log behavior.",
  );
});

test("app shell navigation exposes global settings, catalog rules, discounts, storefront UX, and app health", async () => {
  const source = await readFile(APP_SHELL_ROUTE_PATH, "utf8");

  assert.match(source, /Global Settings/);
  assert.match(source, /Catalog Rules/);
  assert.match(source, /Discounts/);
  assert.match(source, /Storefront UX/);
  assert.match(source, /App Health/);
});

test("app health route combines runtime status and violations while legacy violations route redirects", async () => {
  const [healthSource, violationsSource] = await Promise.all([
    readFile(APP_HEALTH_ROUTE_PATH, "utf8"),
    readFile(VIOLATIONS_ROUTE_PATH, "utf8"),
  ]);

  assert.match(
    healthSource,
    /Runtime status/,
    "App Health must render runtime status for function activation and sync health.",
  );
  assert.match(
    healthSource,
    /Violation log/,
    "App Health must render the merged violation log view.",
  );
  assert.match(
    violationsSource,
    /url\.pathname = "\/app\/health"/,
    "Legacy violations route must redirect to the unified App Health page.",
  );
});
