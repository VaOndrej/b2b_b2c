import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { sanitizeConfig, type WonDiscountsConfig } from "@won/core/discounts/config";

import { STOREFRONT_CAMPAIGN_OFF_STEP } from "../../../app/lib/sync/storefront.ts";
import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { loadShopSyncFacts } from "../../../app/lib/sync/sync-state.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { codeRule, makeDeps } from "./helpers.ts";

// MVP 6.1 (plan docs/plans/2026-10-04-won-discounts-mvp6-1.md, L7): a campaign with tier sets. The storefront config
// shows the campaign's sets from a minute after the start until 7 minutes before the end (the scheduler resyncs at
// both times: the recorded boundary), and BEFORE any shop config write that changes or removes the campaign the
// sync puts the base sets back on the page (`storefront_config.campaign_off`), so the page never promises more
// than checkout gives.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("sync-campaign-tiers");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `campaign-tiers-${seq}.myshopify.com`;
});

// The fake shop's zone is Europe/Prague (UTC+2 on these dates); the campaign runs 14:00–18:00 shop time.
const at = (local: string) => new Date(`2026-09-28T${local}+02:00`);
const BASE = { id: "g", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 10 }] };
const bf = (extra: Record<string, unknown> = {}) => ({
  id: "bf",
  name: "Black Friday",
  window: { start: "2026-09-28T14:00:00", end: "2026-09-28T18:00:00" },
  overrides: [{ ruleId: "g", patch: { breaks: [{ minQty: 2, percent: 20 }] } }],
  killed: false,
  ...extra,
});
function configWith(campaigns: unknown[]): WonDiscountsConfig {
  return sanitizeConfig({ modules: { codes: { rules: [codeRule("c")] }, tiers: { sets: [BASE] } }, campaigns }).config;
}

type Shown = { tiers: { sets: Record<string, { breaks: { min: number; pct: number }[] }> }; bt?: unknown; tc?: string };
const shown = (fake: FakeShopify) => fake.storefrontConfig() as Shown;
const percent = (fake: FakeShopify) => shown(fake).tiers.sets.g!.breaks[0]!.pct;
const boundary = async () => (await loadShopSyncFacts(db.prisma, shop)).campaignBoundaryAt?.toISOString() ?? null;
/** Operation names in call order, a function_config write named apart from the other metafield writes. */
const ops = (fake: FakeShopify) =>
  fake.calls.map((c) => (c.op === "WonSyncMetafieldsSet" && JSON.stringify(c.variables).includes('"function_config"') ? "function_config.set" : c.op));

function syncAt(fake: FakeShopify, clock: { now: Date }) {
  return createSync(makeDeps(fake, db.prisma, { now: () => clock.now }));
}

test("before the start and in the first minute the page shows the base sets; the boundary is a minute after the start", async () => {
  const fake = new FakeShopify();
  const clock = { now: at("12:00:00") };
  const sync = syncAt(fake, clock);
  assert.equal((await sync.syncShop(shop, configWith([bf()]))).ok, true);
  assert.equal(percent(fake), 10);
  assert.equal("bt" in shown(fake), false);
  assert.equal(await boundary(), at("14:01:00").toISOString());

  clock.now = at("14:00:30");
  await sync.syncShop(shop, configWith([bf()]));
  assert.equal(percent(fake), 10, "the campaign runs at checkout, the page waits a minute");
  assert.equal(await boundary(), at("14:01:00").toISOString());
});

test("from a minute after the start the page shows the campaign's sets (with the base beside them); the boundary is 7 minutes before the end", async () => {
  const fake = new FakeShopify();
  const clock = { now: at("14:01:00") };
  const sync = syncAt(fake, clock);
  const result = await sync.syncShop(shop, configWith([bf()]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(percent(fake), 20);
  assert.equal(shown(fake).tc, "bf");
  assert.deepEqual((shown(fake).bt as Shown["tiers"]).sets.g!.breaks, [{ min: 2, pct: 10 }]);
  assert.equal(await boundary(), at("17:53:00").toISOString());
  // Written behind the shop config, as ever.
  const order = ops(fake);
  assert.ok(order.indexOf("function_config.set") < order.indexOf("WonSyncStorefrontConfigSet"), order.join(", "));
  assert.equal(result.steps.some((s) => s.step === STOREFRONT_CAMPAIGN_OFF_STEP), false, "nothing to take back on a first sync");
});

test("7 minutes before the end the page goes back to the base sets; the boundary is the end, then none", async () => {
  const fake = new FakeShopify();
  const clock = { now: at("15:00:00") };
  const sync = syncAt(fake, clock);
  await sync.syncShop(shop, configWith([bf()]));
  assert.equal(percent(fake), 20);

  clock.now = at("17:53:00");
  fake.calls = [];
  const result = await sync.syncShop(shop, configWith([bf()]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(percent(fake), 10);
  assert.equal("bt" in shown(fake), false);
  assert.equal("tc" in shown(fake), false);
  assert.equal(await boundary(), at("18:00:00").toISOString());
  assert.equal(ops(fake).includes("function_config.set"), false, "the campaign still runs at checkout: the shop config is not touched");

  clock.now = at("18:00:00");
  await sync.syncShop(shop, configWith([bf()]));
  assert.equal(percent(fake), 10);
  assert.equal(await boundary(), null);
});

test("kill switch while the page shows the campaign's sets: the base sets go back on the page BEFORE the shop config drops the campaign", async () => {
  const fake = new FakeShopify();
  const clock = { now: at("15:00:00") };
  const sync = syncAt(fake, clock);
  await sync.syncShop(shop, configWith([bf()]));
  assert.equal(percent(fake), 20);

  clock.now = at("15:10:00");
  fake.calls = [];
  const result = await sync.syncShop(shop, configWith([bf({ killed: true })]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const order = ops(fake);
  const off = order.indexOf("WonSyncStorefrontConfigSet");
  const config = order.indexOf("function_config.set");
  assert.ok(off !== -1 && config !== -1 && off < config, order.join(", "));
  const offWrite = JSON.parse((fake.calls[off]!.variables as { metafields: { value: string }[] }).metafields[0]!.value) as Shown;
  assert.deepEqual(offWrite.tiers.sets.g!.breaks, [{ min: 2, pct: 10 }]);
  assert.equal("bt" in offWrite || "tc" in offWrite, false);
  assert.deepEqual(result.steps.filter((s) => s.step === STOREFRONT_CAMPAIGN_OFF_STEP).map((s) => s.ok), [true]);
  assert.equal(percent(fake), 10);
  assert.equal((JSON.parse(fake.shopMetafieldValue("function_config")!) as { campaignId: string | null }).campaignId, null);
});

test("other breaks in the running campaign: the base goes back first, the new campaign sets come behind the shop config", async () => {
  const fake = new FakeShopify();
  const clock = { now: at("15:00:00") };
  const sync = syncAt(fake, clock);
  await sync.syncShop(shop, configWith([bf()]));
  fake.calls = [];
  const edited = bf({ overrides: [{ ruleId: "g", patch: { breaks: [{ minQty: 2, percent: 15 }] } }] });
  const result = await sync.syncShop(shop, configWith([edited]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const writes = fake.callsOf("WonSyncStorefrontConfigSet").map((c) => (JSON.parse((c.variables as { metafields: { value: string }[] }).metafields[0]!.value) as Shown).tiers.sets.g!.breaks[0]!.pct);
  assert.deepEqual(writes, [10, 15]);
  assert.equal(percent(fake), 15);
});

test("an unchanged campaign on show takes nothing back; a config without campaign tier sets never reads the storefront config ahead of the shop config", async () => {
  const fake = new FakeShopify();
  const clock = { now: at("15:00:00") };
  const sync = syncAt(fake, clock);
  await sync.syncShop(shop, configWith([bf()]));
  fake.calls = [];
  const again = await sync.syncShop(shop, configWith([bf()]));
  assert.equal(again.ok, true);
  assert.equal(fake.callsOf("WonSyncStorefrontConfigSet").length, 0);
  assert.equal(again.steps.some((s) => s.step === STOREFRONT_CAMPAIGN_OFF_STEP), false);

  const plain = new FakeShopify();
  shop = `campaign-tiers-plain-${seq}.myshopify.com`;
  const plainSync = syncAt(plain, clock);
  await plainSync.syncShop(shop, configWith([]));
  plain.calls = [];
  await plainSync.syncShop(shop, sanitizeConfig({ modules: { codes: { rules: [codeRule("c"), codeRule("d")] }, tiers: { sets: [BASE] } } }).config);
  const order = ops(plain);
  const firstRead = order.indexOf("WonSyncStorefrontConfig");
  assert.ok(firstRead > order.indexOf("function_config.set"), order.join(", "));
});

test("a failed take-back never blocks the kill switch: the step is recorded as failed and the shop config still drops the campaign", async () => {
  const fake = new FakeShopify();
  const clock = { now: at("15:00:00") };
  const sync = syncAt(fake, clock);
  await sync.syncShop(shop, configWith([bf()]));
  const original = fake.graphql.bind(fake);
  let refused = 0;
  fake.graphql = async (query, variables) => {
    if (query.includes("WonSyncStorefrontConfigSet") && refused++ === 0) {
      return { data: { metafieldsSet: { metafields: [], userErrors: [{ message: "storefront write refused" }] } } };
    }
    return original(query, variables);
  };
  const result = await sync.syncShop(shop, configWith([bf({ killed: true })]));
  assert.deepEqual(result.steps.filter((s) => s.step === STOREFRONT_CAMPAIGN_OFF_STEP).map((s) => s.ok), [false]);
  assert.equal((JSON.parse(fake.shopMetafieldValue("function_config")!) as { campaignId: string | null }).campaignId, null, "killed at checkout all the same");
  assert.equal(percent(fake), 10, "the storefront config behind the shop config put the base back");
});

test("the admin words a failed take-back like any storefront config failure", async () => {
  const { syncProblems } = await import("../../../app/lib/integration/sync-copy.ts");
  const problems = syncProblems([{ step: STOREFRONT_CAMPAIGN_OFF_STEP, ok: false, detail: "refused" }], new Map());
  assert.deepEqual(problems.map((p) => p.key), ["sync.problem.storefrontConfig"]);
});
