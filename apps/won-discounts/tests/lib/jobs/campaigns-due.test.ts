import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { CAMPAIGNS_DUE_BATCH, CAMPAIGNS_RETRY_MS, runCampaignsDueOnce } from "../../../app/lib/jobs/scheduler.server.ts";
import { saveAndSync } from "../../../app/lib/sync/save-and-sync.server.ts";
import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { loadShopSyncFacts, recordCampaignBoundary } from "../../../app/lib/sync/sync-state.server.ts";
import { FakeShopify } from "../sync/fake-shopify.ts";
import { codeRule, configWith, makeDeps } from "../sync/helpers.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";

// MVP 6 contract K4: campaigns.due — at a campaign boundary (the selected campaign ended) the shop is resynced
// without anyone looking, so the next campaign's variables go out (3 phases) or the ended one is tidied away. The
// start and the end themselves are the function's (C4); this is never on the critical path.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("campaigns-due");
});
after(async () => {
  await db.drop();
});
beforeEach(async () => {
  seq += 1;
  shop = `campaigns-due-${seq}.myshopify.com`;
  await db.prisma.shopSyncState.deleteMany({});
});

const at = (iso: string) => new Date(iso);

test("only shops past their boundary are resynced; a success leaves the boundary to the sync, a failure or no session retries in 5 minutes", async () => {
  const now = at("2026-10-02T10:00:00Z");
  const shops = ["due-ok", "due-fail", "due-nosession", "not-due"].map((s) => `${s}-${seq}.myshopify.com`);
  await recordCampaignBoundary(db.prisma, shops[0]!, at("2026-10-02T09:59:00Z"));
  await recordCampaignBoundary(db.prisma, shops[1]!, at("2026-10-02T09:00:00Z"));
  await recordCampaignBoundary(db.prisma, shops[2]!, at("2026-10-02T10:00:00Z"));
  await recordCampaignBoundary(db.prisma, shops[3]!, at("2026-10-02T10:01:00Z"));
  const synced: string[] = [];
  const result = await runCampaignsDueOnce({
    db: db.prisma,
    now: () => now,
    clientFor: async (s) => (s === shops[2] ? null : new FakeShopify()),
    resync: async (_client, s) => {
      synced.push(s);
      return { ok: s === shops[0] };
    },
  });
  assert.deepEqual(synced.sort(), [shops[0], shops[1]].sort());
  assert.deepEqual(result, { synced: [shops[0]], failed: [shops[1]], skippedNoSession: 1 });
  const boundary = async (s: string) => (await loadShopSyncFacts(db.prisma, s)).campaignBoundaryAt?.toISOString();
  assert.equal(await boundary(shops[1]!), new Date(now.getTime() + CAMPAIGNS_RETRY_MS).toISOString());
  assert.equal(await boundary(shops[2]!), new Date(now.getTime() + CAMPAIGNS_RETRY_MS).toISOString());
  assert.equal(await boundary(shops[3]!), "2026-10-02T10:01:00.000Z", "not due: untouched");
  assert.equal(CAMPAIGNS_DUE_BATCH, 20);
});

test("a real boundary: the first campaign ended → the resync selects the next one and records its end", async () => {
  const fake = new FakeShopify();
  let clock = at("2026-09-28T12:00:00Z"); // 14:00 Prague, during "bf"
  const deps = () => makeDeps(fake, db.prisma, { now: () => clock });
  const bf = { id: "bf", name: "BF", window: { start: "2026-09-28T00:00:00", end: "2026-09-29T00:00:00" }, overrides: [{ ruleId: "c", patch: { enabled: true } }], killed: false };
  const next = { ...bf, id: "next", name: "Next", window: { start: "2026-10-05T00:00:00", end: "2026-10-06T00:00:00" } };
  const saved = await saveAndSync({ client: fake, db: db.prisma, shop, input: configWith([codeRule("c")], { campaigns: [bf, next] }), createSync: (c, d) => createSync({ ...deps(), client: c, db: d }) });
  assert.ok(saved.sync?.ok, JSON.stringify(saved.sync?.errors));
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).campaignBoundaryAt?.toISOString(), "2026-09-28T22:00:00.000Z");
  assert.equal(JSON.parse(fake.shopMetafieldValue("function_config")!).campaignId, "bf");

  clock = at("2026-09-28T22:00:30Z");
  const result = await runCampaignsDueOnce({ db: db.prisma, now: () => clock, clientFor: async () => fake, createSync: (c, d) => createSync({ ...deps(), client: c, db: d }) });
  assert.deepEqual(result.synced, [shop]);
  assert.equal(JSON.parse(fake.shopMetafieldValue("function_config")!).campaignId, "next", "the next campaign's variables and config are out");
  assert.equal((await loadShopSyncFacts(db.prisma, shop)).campaignBoundaryAt?.toISOString(), "2026-10-05T22:00:00.000Z");
});
