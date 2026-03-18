import test from "node:test";
import assert from "node:assert/strict";
import { getViolationsSyncMode } from "../../app/services/violations-sync-mode.server.ts";

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
