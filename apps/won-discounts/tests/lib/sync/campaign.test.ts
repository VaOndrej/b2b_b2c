import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { activeCodeRules } from "../../../app/lib/config-guards.server.ts";
import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { campaignVersion, codeRule, configWith, makeDeps } from "./helpers.ts";

// Campaign switch protocol (T1 function-payload.ts "Sync sequences"): when the
// selected campaign or its window changes, (1) a NO-CAMPAIGN shop config,
// (2) every node's function_vars, (3) the final shop config — and never (3)
// over a partial (2). Steady state = one shop config write, last.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("sync-campaign");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `campaign-${seq}.myshopify.com`;
});

// NOW = 2026-09-28T14:00:00 in the shop's zone (helpers.ts).
const bf = {
  id: "bf",
  name: "Black Friday",
  window: { start: "2026-09-28T00:00:00", end: "2026-09-29T00:00:00" },
  overrides: [{ ruleId: "c", patch: { value: { kind: "percentage", percent: 30 } } }],
  killed: false,
};

/** metafieldsSet calls in order (one kind per call), as "key" or "function_config(<campaignVarsVersion>)". */
function writes(fake: FakeShopify): string[] {
  return fake.callsOf("WonSyncMetafieldsSet").map((call) => {
    const [m] = (call.variables as { metafields: { key: string; value: string }[] }).metafields;
    return m!.key === "function_config" ? `function_config(${JSON.parse(m!.value).campaignVarsVersion ?? "none"})` : m!.key;
  });
}

test("a campaign starts: no-campaign shop config → node vars → final shop config", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("c")]));
  fake.calls = [];

  const result = await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [bf] }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  // The no-campaign config equals the stored one (no campaign before) → phase 1 is "unchanged", no write.
  assert.deepEqual(writes(fake), ["function_vars", `function_config(${campaignVersion(bf)})`]);
  assert.ok(result.steps.some((s) => s.step === "shop_config.phase1.write" && s.ok && /unchanged/.test(s.detail)));
  for (const node of fake.wonNodes()) {
    assert.equal(JSON.parse(node.metafields.get("$app:won_discounts/function_vars")!.value).varsVersion, campaignVersion(bf));
  }
});

test("a campaign WINDOW changes: phase 1 writes a no-campaign config before any node var", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [bf] }));
  fake.calls = [];

  const moved = { ...bf, window: { start: "2026-09-28T06:00:00", end: "2026-09-30T00:00:00" } };
  const result = await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [moved] }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(writes(fake), ["function_config(none)", "function_vars", `function_config(${campaignVersion(moved)})`]);
});

test("phase 2 incomplete: the switch is held at 'no campaign', never a final config over stale node vars", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [bf] }));

  const moved = { ...bf, window: { start: "2026-09-28T06:00:00", end: "2026-09-30T00:00:00" } };
  // 1st metafieldsSet = phase 1 (ok), 2nd = the node vars (fails).
  const original = fake.graphql.bind(fake);
  let sets = 0;
  fake.graphql = async (query, variables) => {
    if (query.includes("WonSyncMetafieldsSet") && ++sets === 2) {
      return { data: { metafieldsSet: { metafields: [], userErrors: [{ message: "vars write failed" }] } } };
    }
    return original(query, variables);
  };
  const result = await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [moved] }));
  assert.equal(result.ok, false);
  assert.equal(JSON.parse(fake.shopMetafieldValue("function_config")!).campaignVarsVersion, null, "held at no campaign");
  assert.ok(result.steps.some((s) => s.step === "shop_config.write" && !s.ok && /held at 'no campaign'/.test(s.detail)));

  // Next sync finishes the switch.
  fake.graphql = original;
  const retry = await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [moved] }));
  assert.equal(retry.ok, true, JSON.stringify(retry.errors));
  assert.equal(JSON.parse(fake.shopMetafieldValue("function_config")!).campaignVarsVersion, campaignVersion(moved));
});

test("a campaign is killed: the shop config (no campaign) is written first, then the node vars", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [bf] }));
  fake.calls = [];

  const result = await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [{ ...bf, killed: true }] }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const order = writes(fake);
  assert.deepEqual(order, ["function_config(none)", "function_vars"]);
});

test("same campaign, only its overrides change: one shop config write, no node vars", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [bf] }));
  fake.calls = [];

  const deeper = { ...bf, overrides: [{ ruleId: "c", patch: { value: { kind: "percentage", percent: 40 } } }] };
  const result = await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [deeper] }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(writes(fake), [`function_config(${campaignVersion(bf)})`]);
});

test("a code rule a live campaign enables gets its node (and counts toward the limit)", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const config = configWith([codeRule("bfcode", { enabled: false, codes: ["BF30"] })], {
    campaigns: [{ ...bf, overrides: [{ ruleId: "bfcode", patch: { enabled: true } }] }],
  });
  assert.deepEqual(activeCodeRules(config).map((rule) => rule.id), ["bfcode"]);
  const result = await createSync(deps).syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(fake.wonNodes().some((node) => node.codes.some((c) => c.code === "BF30")));

  // A killed campaign enables nothing.
  const killed = configWith([codeRule("bfcode", { enabled: false, codes: ["BF30"] })], {
    campaigns: [{ ...bf, killed: true, overrides: [{ ruleId: "bfcode", patch: { enabled: true } }] }],
  });
  assert.deepEqual(activeCodeRules(killed), []);
});
