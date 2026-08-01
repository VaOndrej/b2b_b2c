import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const DASHBOARD_ROUTE_PATH = "app/routes/app._index.tsx";

test("dashboard no longer renders the Next actions section", async () => {
  const source = await readFile(DASHBOARD_ROUTE_PATH, "utf8");

  assert.doesNotMatch(
    source,
    /<s-section heading="Next actions">/,
    "Dashboard must not render the Next actions card.",
  );
  assert.doesNotMatch(
    source,
    /Configure floors and rules/,
    "Dashboard must not keep the settings shortcut inside a removed Next actions card.",
  );
  assert.doesNotMatch(
    source,
    /Open violation log/,
    "Dashboard must not keep the violations shortcut inside a removed Next actions card.",
  );
});
