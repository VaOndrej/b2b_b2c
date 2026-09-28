import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { verifyShopFunctionConfig } from "@won/core/discounts/function-payload";

import type { AppAdminGraphql } from "../../../app/lib/admin-client.server.ts";
import { MAX_ACTIVE_CODE_RULES } from "../../../app/lib/config-guards.server.ts";
import { loadSyncStatus, resyncShop, saveAndSync } from "../../../app/lib/sync/save-and-sync.server.ts";
import type { Sync } from "../../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../../app/lib/sync/wiring.server.ts";
import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, codeRule } from "./helpers.ts";

// The admin hook: save first (sanitize, guards, budget, history), and only a
// successful save is written into Shopify.

let db: TestDatabase;
before(() => {
  db = createTestDatabase("save-and-sync");
});
after(async () => {
  await db.drop();
});

/** The app's `admin` object backed by the fake store (same Response shape as the library). */
function adminFor(fake: FakeShopify): AppAdminGraphql {
  return {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) =>
      new Response(JSON.stringify(await fake.graphql(query, options?.variables))),
  } as unknown as AppAdminGraphql;
}

const quietLogger = { info: () => {}, warn: () => {}, error: () => {} };

test("a refused save never reaches Shopify", async () => {
  const fake = new FakeShopify();
  let created = 0;
  const result = await saveAndSync(
    adminFor(fake),
    "refused.myshopify.com",
    { modules: { codes: { rules: Array.from({ length: MAX_ACTIVE_CODE_RULES + 1 }, (_, i) => codeRule(`r${i}`)) } } },
    {
      db: db.prisma,
      createSync: () => {
        created += 1;
        return { syncShop: async () => assert.fail("must not sync") } as Sync;
      },
    },
  );
  assert.equal(result.save.ok, false);
  assert.equal(result.sync, null);
  assert.equal(created, 0);
  assert.equal(fake.calls.length, 0);
});

test("a successful save syncs exactly the sanitized, saved config through the app's admin client", async () => {
  const fake = new FakeShopify();
  const seen: unknown[] = [];
  const result = await saveAndSync(
    adminFor(fake),
    "saved.myshopify.com",
    { modules: { codes: { rules: [codeRule("c", { codes: [" lower "] })] } } },
    {
      db: db.prisma,
      createSync: (client) => ({
        async syncShop(shop, config) {
          seen.push({ shop, codes: config.modules.codes.rules[0]!.codes });
          await client.graphql("query WonSyncShop { shop { id } }");
          return { ok: true, steps: [], errors: [], runId: null };
        },
      }),
    },
  );
  assert.equal(result.save.ok, true);
  assert.deepEqual(seen, [{ shop: "saved.myshopify.com", codes: ["LOWER"] }]);
  assert.equal(fake.callsOf("WonSyncShop").length, 1, "the client goes through the app's admin object");
  assert.deepEqual(result.sync, { ok: true, steps: [], errors: [], runId: null });
});

test("integration with the REAL engine builders: the shop payload verifies and every node is in place", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  const shop = "real-builders.myshopify.com";
  const result = await saveAndSync(
    adminFor(fake),
    shop,
    {
      modules: {
        codes: {
          rules: [
            autoRule("auto10", { target: { kind: "products", productIds: [product.id], variantIds: [] } }),
            codeRule("news", { codes: ["NEWS10", "NEWS-B"] }),
          ],
        },
      },
    },
    {
      db: db.prisma,
      createSync: (client, prisma) => createSync({ ...productionSyncDeps(client, prisma, quietLogger), sleep: async () => {} }),
    },
  );
  assert.equal(result.save.ok, true);
  assert.equal(result.sync?.ok, true, JSON.stringify(result.sync?.errors));

  const stored = fake.shopMetafieldValue("function_config")!;
  assert.deepEqual(verifyShopFunctionConfig(stored), { ok: true, bytes: Buffer.byteLength(stored) });
  assert.deepEqual(
    JSON.parse(stored).modules.codes.rules.map((rule: { id: string }) => rule.id),
    ["auto10", "news"],
  );
  const nodes = fake.wonNodes();
  assert.equal(nodes.length, 2);
  for (const node of nodes) {
    const vars = JSON.parse(node.metafields.get("$app:won_discounts/function_vars")!.value);
    assert.equal(typeof vars.campaignStart, "string", "C4: campaignStart always present");
    assert.equal(typeof vars.campaignEnd, "string", "C4: campaignEnd always present");
  }
  assert.deepEqual(fake.productMetafield(product.id), { ruleIds: ["auto10"], variantRuleIds: {} });

  const status = await loadSyncStatus(db.prisma, shop);
  assert.equal(status?.ok, true);
  assert.deepEqual(status?.steps, result.sync?.steps);

  // "Sync again" with nothing changed: no mutation.
  const before = fake.mutations().length;
  const again = await resyncShop(adminFor(fake), shop, {
    db: db.prisma,
    createSync: (client, prisma) => createSync({ ...productionSyncDeps(client, prisma, quietLogger), sleep: async () => {} }),
  });
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  assert.equal(fake.mutations().length, before);
});

test("loadSyncStatus: null before the first sync", async () => {
  assert.equal(await loadSyncStatus(db.prisma, "never-synced.myshopify.com"), null);
});
