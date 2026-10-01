import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { sanitizeConfig, type GiftTier, type WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { loadRewardsScreen, rewardsAction, rewardsOverviewOf } from "../../app/lib/integration/rewards.server.ts";
import { createSync, syncIdle } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { REWARDS_FIELD as F } from "../../app/components/model/rewards.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, formOf, quiet, testCtx } from "./helpers.ts";

// Odměny (MVP 4, contracts R1–R7): the admin module saves the rewards the
// merchant typed (per market currency, MKT-1; amounts as minor units), parsed
// on the server (SEC-1), through the same saveConfigSection as every module;
// the sync then ships them compact to the function and with the gift's handle
// to the storefront. On Free a stored ladder stays as stored (§14a) and the
// gate keeps the first threshold only (BILL-1).

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-rewards");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `rewards-${seq}.myshopify.com`;
  clearSignalCache();
});

const SCOPES = "write_discounts,read_products,write_products,read_themes";

function ctxFor(store: FakeStore, plan: "free" | "pro" = "free"): ShopCtx {
  return {
    ...testCtx(db.prisma, shop, store),
    createSync: (client: AdminClient, prisma: PrismaClient) =>
      createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => plan }),
    lockWaitMs: 200,
  };
}

async function store(config: (c: WonDiscountsConfig) => WonDiscountsConfig) {
  const base = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, config(base));
}

const withMarkets = (c: WonDiscountsConfig): WonDiscountsConfig => ({
  ...c,
  markets: [
    { handle: "cesko", currency: "CZK", enabled: true },
    { handle: "slovensko", currency: "EUR", enabled: true },
  ],
});

test("save: free shipping and a gift per currency (major units typed → minor units), countOtherDiscounts; the sync ships both shapes", async () => {
  const fake = new FakeStore();
  const gift = fake.sync.addProduct(7);
  gift.handle = "darek";
  const ctx = ctxFor(fake, "free");
  await store(withMarkets);
  const result = await rewardsAction(
    ctx,
    formOf([
      [F.intent, "save"],
      [F.shipOn, "1"],
      [F.shipAmount("CZK"), "1 000"],
      [F.shipAmount("EUR"), "40,5"],
      [F.tier, "gift-1"],
      [F.tierAmount("gift-1", "CZK"), "1500"],
      [F.choice("gift-1"), gift.variantIds[0]!],
      [F.other, "1"],
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  await syncIdle(shop);
  const rewards = (await loadConfig(db.prisma, shop)).config.modules.rewards;
  assert.deepEqual(rewards, {
    freeShipping: { threshold: { CZK: 1000_00, EUR: 40_50 } },
    gifts: [{ id: "gift-1", threshold: { CZK: 1500_00 }, choices: [gift.variantIds[0]] }],
    countOtherDiscounts: true,
    giftDeclinable: true,
  });
  const payload = JSON.parse(fake.sync.shopMetafieldValue("function_config")!) as { modules: { rewards: unknown } };
  const n = Number(gift.variantIds[0]!.split("/").pop());
  assert.deepEqual(payload.modules.rewards, { s: { CZK: 1000_00, EUR: 40_50 }, g: [["gift-1", { CZK: 1500_00 }, [n]]], o: 1 });
  const sf = fake.sync.storefrontConfig() as { rewards: unknown };
  assert.deepEqual(sf.rewards, { ship: { CZK: 1000_00, EUR: 40_50 }, gifts: [{ id: "gift-1", t: { CZK: 1500_00 }, c: [{ v: n, h: "darek" }] }], other: true });
});

test("refused (nothing stored): an amount of 0, a gift without a threshold or without a gift, free shipping on without an amount", async () => {
  const ctx = ctxFor(new FakeStore());
  await store(withMarkets);
  const refused = await rewardsAction(
    ctx,
    formOf([
      [F.intent, "save"],
      [F.shipOn, "1"],
      [F.tier, "g"],
      [F.tierAmount("g", "CZK"), "0"],
    ]),
  );
  assert.equal(refused.ok, false);
  const keys = refused.ok ? [] : (refused as { errors?: { key: string; field: string }[] }).errors!.map((e) => `${e.field} ${e.key}`).sort();
  assert.deepEqual(keys, [
    "rw.g.amount.CZK rewards.error.amount",
    "rw.g.amount.CZK rewards.error.giftAmount",
    "rw.g.choice rewards.error.giftChoice",
    "rw.ship.CZK rewards.error.shippingAmount",
  ]);
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.modules.rewards.gifts, []);
  assert.deepEqual(await rewardsAction(ctx, formOf([[F.intent, "remove"]])), { ok: false, reason: "bad_request" });
});

test("Free with a stored Pro ladder: the second threshold is kept as stored by id, the gate note says so; amounts in a disabled market stay (§14a)", async () => {
  const fake = new FakeStore();
  const ctx = ctxFor(fake, "free");
  const ladder: GiftTier[] = [
    { id: "g1", threshold: { CZK: 500_00, HUF: 9000_00 }, choices: ["gid://shopify/ProductVariant/11"] },
    { id: "g2", threshold: { CZK: 900_00 }, choices: ["gid://shopify/ProductVariant/21", "gid://shopify/ProductVariant/22"] },
  ];
  await store((c) => ({ ...withMarkets(c), modules: { ...c.modules, rewards: { ...c.modules.rewards, gifts: ladder } } }));
  const screen = await loadRewardsScreen(ctx, { scopes: SCOPES });
  assert.deepEqual(screen.gifts.map((g) => g.id), ["g1", "g2"]);
  assert.ok(screen.gateNotes.length >= 1, JSON.stringify(screen.gateNotes));
  assert.equal(screen.cartBlockAddUrl?.includes("template=cart"), true);
  const result = await rewardsAction(
    ctx,
    formOf([
      [F.intent, "save"],
      ["configVersion", screen.configVersion!],
      [F.tier, "g1"],
      [F.tierAmount("g1", "CZK"), "600"],
      [F.choice("g1"), "gid://shopify/ProductVariant/11"],
      [F.tier, "g2"],
      [F.kept, "g2"],
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  await syncIdle(shop);
  const gifts = (await loadConfig(db.prisma, shop)).config.modules.rewards.gifts;
  assert.deepEqual(gifts[0], { id: "g1", threshold: { HUF: 9000_00, CZK: 600_00 }, choices: ["gid://shopify/ProductVariant/11"] }, "HUF (no enabled market) kept");
  assert.deepEqual(gifts[1], ladder[1], "the kept tier exactly as stored");
});

test("Přehled card: the thresholds the PLAN runs in the shop currency (Free: the first gift threshold only)", () => {
  const { config } = sanitizeConfig({
    modules: {
      rewards: {
        freeShipping: { threshold: { CZK: 1000_00 } },
        gifts: [
          { id: "g1", threshold: { CZK: 500_00 }, choices: ["gid://shopify/ProductVariant/1"] },
          { id: "g2", threshold: { EUR: 20_00 }, choices: ["gid://shopify/ProductVariant/2"] },
        ],
      },
    },
  });
  assert.deepEqual(rewardsOverviewOf(config, "pro", "CZK"), { shipping: 1000_00, gifts: [500_00, null], currency: "CZK" });
  assert.deepEqual(rewardsOverviewOf(config, "free", "CZK"), { shipping: 1000_00, gifts: [500_00], currency: "CZK" });
  assert.deepEqual(rewardsOverviewOf(config, "pro", "EUR"), { shipping: null, gifts: [null, 20_00], currency: "EUR" });
});

// --- The screen (dev harness data = loadRewardsScreen's pure part) -----------------------------------------

test("screen: Free shows the first gift editable and the Pro threshold as stored (not in force); Pro edits the ladder and the choice; the MKT-1 note; an empty shop asks for the app embed", async () => {
  const { createElement } = await import("react");
  const { renderPage } = await import("./helpers.ts");
  const { RewardsScreen } = await import("../../app/components/screens/RewardsScreen.tsx");
  const { devRewardsScreen, devRewardsResult } = await import("../../app/lib/dev-harness.server.ts");
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const free = text(await renderPage(createElement(RewardsScreen, devRewardsScreen({ plan: "free", state: null, locale: "cs" }))));
  assert.match(free, /Doprava zdarma/);
  assert.match(free, /Ponožky Won — M/);
  assert.match(free, /Uložený další práh \(Kšiltovka Won, Plátěná taška Won, Hrnek Won\) ve Free neplatí/);
  assert.match(free, /V měně EUR \(.*\) není částka, v tomto trhu se odměna nenabízí/);
  assert.match(free, /Víc prahů a výběr ze 3 dárků je v tarifu Pro/);
  const pro = text(await renderPage(createElement(RewardsScreen, devRewardsScreen({ plan: "pro", state: null, locale: "cs" }))));
  assert.match(pro, /2\. práh/);
  assert.match(pro, /Dárek \(na výběr až 3\)/);
  assert.match(pro, /Hrnek Won/);
  assert.match(pro, /Přidat další práh/);
  const empty = text(await renderPage(createElement(RewardsScreen, devRewardsScreen({ plan: "free", state: "empty", locale: "cs" }))));
  assert.match(empty, /Přidat dárek/);
  assert.match(empty, /Zapnout v tématu/);
  const invalid = text(
    await renderPage(createElement(RewardsScreen, { ...devRewardsScreen({ plan: "free", state: null, locale: "cs" }), result: devRewardsResult("invalid") })),
  );
  assert.match(invalid, /Vyber dárek\./);
});
