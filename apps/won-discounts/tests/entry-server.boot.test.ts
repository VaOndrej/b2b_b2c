import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createTestDatabase, type TestDatabase } from "./lib/test-db.ts";

// Fix round 1 (MVP 2 review, Important 1): the daily reconcile of the margin
// cost mirror is started on server BOOT (app/entry.server.tsx, next to the
// stale-claim sweep), once per process — not only after a webhook queued work.
// The module is imported once with a non-test NODE_ENV (the jobs never start
// under NODE_ENV=test), then both jobs are stopped again.

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let db: TestDatabase;

before(() => {
  db = createTestDatabase("entry-boot");
  process.env.DATABASE_URL = db.url;
  process.env.SHOPIFY_API_KEY = "test-api-key";
  process.env.SHOPIFY_API_SECRET = "won-discounts-test-secret";
  process.env.SHOPIFY_APP_URL = "https://won-discounts.test";
  process.env.SCOPES = "read_products";
});

after(async () => {
  await (globalThis as { prismaGlobal?: { $disconnect(): Promise<void> } }).prismaGlobal?.$disconnect();
  await db.drop();
});

test("entry.server.tsx starts the cost reconcile once on boot (and the stale-claim sweep beside it)", async () => {
  const reconcile = await import("../app/lib/jobs/cost-reconcile.server.ts");
  const stale = await import("../app/lib/jobs/stale-claims.server.ts");
  reconcile.stopCostReconcileJob();
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    await import("../app/entry.server.tsx");
    assert.equal(reconcile.costReconcileJobStarted(), true, "started on boot");
    assert.equal(stale.staleClaimJobStarted(), true);
    reconcile.stopCostReconcileJob();
    await import("../app/entry.server.tsx");
    assert.equal(reconcile.costReconcileJobStarted(), false, "a module evaluates once per process: no second start");
  } finally {
    process.env.NODE_ENV = env;
    reconcile.stopCostReconcileJob();
    stale.stopStaleClaimJob();
  }
  const source = readFileSync(path.join(APP_ROOT, "app/entry.server.tsx"), "utf8");
  assert.equal(source.match(/ensureCostReconcileJob\(db, \{ clientFor: offlineClient \}\)/g)?.length, 1);
});
