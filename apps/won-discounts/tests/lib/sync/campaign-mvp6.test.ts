import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { loadShopSyncFacts } from "../../../app/lib/sync/sync-state.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { autoRule, campaignVersion, codeRule, configWith, makeDeps } from "./helpers.ts";

// MVP 6 (plan docs/plans/2026-10-02-won-discounts-mvp6.md): K5 — the campaign switch's phase 1 is the LIVE shop
// config without its campaign (MVP 2 debt: it used to ship the NEW rules before the final write); K4 — the sync
// records when the selected campaign changes (the scheduler resyncs then); K3 — a downgrade lets the campaigns
// running at that moment finish.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("sync-campaign-mvp6");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `campaign6-${seq}.myshopify.com`;
});

// NOW = 2026-09-28T14:00:00 in the shop's zone (Europe/Prague, UTC+2).
const bf = {
  id: "bf",
  name: "Black Friday",
  window: { start: "2026-09-28T00:00:00", end: "2026-09-29T00:00:00" },
  overrides: [{ ruleId: "c", patch: { value: { kind: "percentage", percent: 30 } } }],
  killed: false,
};
const later = { ...bf, id: "later", name: "Later", window: { start: "2026-10-05T00:00:00", end: "2026-10-06T00:00:00" } };

/** Every shop function_config write in order, parsed. */
function configWrites(fake: FakeShopify): Record<string, unknown>[] {
  return fake
    .callsOf("WonSyncMetafieldsSet")
    .map((call) => (call.variables as { metafields: { key: string; value: string }[] }).metafields[0]!)
    .filter((m) => m.key === "function_config")
    .map((m) => JSON.parse(m.value) as Record<string, unknown>);
}
/** Rule ids of a payload (the test builders' shape: top-level `rules`, helpers.ts fakeBuilders). */
const ruleIds = (payload: Record<string, unknown>) => (payload.rules as { id: string }[]).map((r) => r.id);

test("K5: phase 1 is the LIVE config without its campaign — a new rule value never ships before the final write", async () => {
  const fake = new FakeShopify();
  const sync = createSync(makeDeps(fake, db.prisma));
  await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [bf] }));
  fake.calls = [];

  const moved = { ...bf, window: { start: "2026-09-28T06:00:00", end: "2026-09-30T00:00:00" } };
  const result = await sync.syncShop(shop, configWith([codeRule("c"), autoRule("d")], { campaigns: [moved] }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const [phase1, final] = configWrites(fake);
  assert.equal(phase1!.campaignVarsVersion, null);
  assert.equal(phase1!.campaignId, null);
  assert.deepEqual(phase1!.campaigns, []);
  assert.deepEqual(ruleIds(phase1!), ["c"], "phase 1 still runs the live rules: the new rule d is not out yet");
  assert.deepEqual(ruleIds(final!), ["c", "d"]);
  assert.equal(final!.campaignVarsVersion, campaignVersion(moved));
});

test("K5: a held switch stays at the live rules without a campaign", async () => {
  const fake = new FakeShopify();
  const sync = createSync(makeDeps(fake, db.prisma));
  await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [bf] }));
  const original = fake.graphql.bind(fake);
  let sets = 0;
  fake.graphql = async (query, variables) => {
    if (query.includes("WonSyncMetafieldsSet") && ++sets === 2) {
      return { data: { metafieldsSet: { metafields: [], userErrors: [{ message: "vars write failed" }] } } };
    }
    return original(query, variables);
  };
  const moved = { ...bf, window: { start: "2026-09-28T06:00:00", end: "2026-09-30T00:00:00" } };
  const result = await sync.syncShop(shop, configWith([codeRule("c"), autoRule("d")], { campaigns: [moved] }));
  assert.equal(result.ok, false);
  const live = JSON.parse(fake.shopMetafieldValue("function_config")!) as Record<string, unknown>;
  assert.equal(live.campaignVarsVersion, null);
  assert.deepEqual(ruleIds(live), ["c"], "held: the new rule is not live (MVP 2 debt)");
});

test("K4: the sync records the boundary (the selected campaign's end, UTC); none without a campaign", async () => {
  const fake = new FakeShopify();
  const sync = createSync(makeDeps(fake, db.prisma));
  await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [bf, later] }));
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).campaignBoundaryAt?.toISOString(), "2026-09-28T22:00:00.000Z", "bf ends at 00:00 Prague");
  await sync.syncShop(shop, configWith([codeRule("c")]));
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).campaignBoundaryAt, null);
});

test("K3: a downgrade lets the running campaign finish; a later one does not ship; back on Pro the list is cleared", async () => {
  const fake = new FakeShopify();
  let plan: "free" | "pro" = "pro";
  const sync = createSync(makeDeps(fake, db.prisma, { plan: async () => plan }));
  const config = configWith([codeRule("c"), autoRule("a")], { campaigns: [bf, later] });
  await sync.syncShop(shop, config);
  plan = "free";
  const free = await sync.syncShop(shop, config);
  assert.equal(free.ok, true, JSON.stringify(free.errors));
  const live = JSON.parse(fake.shopMetafieldValue("function_config")!) as { campaignId: string | null; campaigns: { id: string }[] };
  assert.equal(live.campaignId, "bf", "bf was running at the downgrade: it finishes");
  assert.deepEqual((await loadShopSyncFacts(db.prisma, shop)).campaignsFinishing, ["bf"]);
  const again = await sync.syncShop(shop, config);
  assert.equal(again.ok, true);
  assert.equal((JSON.parse(fake.shopMetafieldValue("function_config")!) as { campaignId: string | null }).campaignId, "bf", "still finishing on the next sync");
  plan = "pro";
  await sync.syncShop(shop, config);
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).campaignsFinishing, null);
});

test("K3: a Free shop that never ran Pro gets no campaign at all", async () => {
  const fake = new FakeShopify();
  const sync = createSync(makeDeps(fake, db.prisma, { plan: async () => "free" }));
  const result = await sync.syncShop(shop, configWith([codeRule("c")], { campaigns: [bf] }));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal((JSON.parse(fake.shopMetafieldValue("function_config")!) as { campaignId: string | null }).campaignId, null);
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).campaignsFinishing, null);
});
