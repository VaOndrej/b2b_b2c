import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { DryRunClient } from "../../../scripts/sync/dry-run-client.ts";
import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../../app/lib/sync/wiring.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { configWith } from "./helpers.ts";

// scripts/sync/live-sync.ts dry-run (E2E finding, MVP 3 audit item 7): every READ
// goes to the store, every MUTATION is printed and answered synthetically — the
// storefront config write included, and its read-back sees the value "written",
// so a dry-run of a correct config reports ok (exit 0) without writing anything.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("sync-dry-run-client");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `dry-run-${seq}.myshopify.com`;
});

const quiet = { info() {}, warn() {}, error() {} };

test("dry-run: the whole sync (storefront config included) plans its mutations, verifies its read-backs and writes nothing", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  const dry = new DryRunClient(fake, { log: () => {} });
  const config = configWith([], {
    modules: {
      codes: { rules: [] },
      tiers: { sets: [{ id: "g", scope: "global", countAcross: "product", breaks: [{ minQty: 2, percent: 10 }] }, { id: "t1", scope: { productIds: [product.id] }, countAcross: "product", breaks: [{ minQty: 2, percent: 5 }] }] },
    },
  });
  const result = await createSync({ ...productionSyncDeps(dry, db.prisma, quiet), sleep: async () => {} }).syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(
    result.steps.filter((s) => s.step.startsWith("storefront_config.")).map((s) => [s.step, s.ok]),
    [
      ["storefront_config.write", true],
      ["storefront_config.verify", true],
    ],
  );
  assert.ok(dry.planned.some((p) => p.op === "WonSyncStorefrontConfigSet"), dry.planned.map((p) => p.op).join(", "));
  assert.deepEqual(fake.mutations(), [], "nothing reached the store");
  assert.equal(fake.storefrontConfig(), undefined);
});
