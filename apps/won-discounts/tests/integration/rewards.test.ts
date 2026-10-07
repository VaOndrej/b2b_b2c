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
import { rewardsGiftStatus, rewardsShippingStatus, rewardsStatus } from "../../app/components/model/module-status.ts";
import type { SyncView } from "../../app/components/model/types.ts";
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
  // No market configured: only the shop currency is asked for. `missing` names what that currency does not get (N2).
  assert.deepEqual(rewardsOverviewOf(config, "pro", "CZK"), { shipping: 1000_00, gifts: [500_00, null], currency: "CZK", missing: { shipping: [], gifts: [[], ["CZK"]] } });
  assert.deepEqual(rewardsOverviewOf(config, "free", "CZK"), { shipping: 1000_00, gifts: [500_00], currency: "CZK" });
  assert.deepEqual(rewardsOverviewOf(config, "pro", "EUR"), { shipping: null, gifts: [null, 20_00], currency: "EUR", missing: { shipping: ["EUR"], gifts: [["EUR"], []] } });
});

test("N2: a reward without an amount for an enabled market is something to resolve, on the tile and on the page", () => {
  const { config } = sanitizeConfig({
    markets: [
      { handle: "cz", currency: "CZK", enabled: true },
      { handle: "sk", currency: "EUR", enabled: true },
      { handle: "hu", currency: "HUF", enabled: false },
    ],
    modules: {
      rewards: {
        freeShipping: { threshold: { CZK: 1000_00, EUR: 40_00 } },
        gifts: [{ id: "g1", threshold: { CZK: 1500_00 }, choices: ["gid://shopify/ProductVariant/1"] }],
      },
    },
  });
  const overview = rewardsOverviewOf(config, "free", "CZK");
  assert.deepEqual(overview.missing, { shipping: [], gifts: [["EUR"]] }, "the switched-off market (HUF) is not asked for");
  const ok: SyncView = { state: "ok", at: "2026-09-28T16:20:00" };
  assert.deepEqual(rewardsShippingStatus(overview, ok), { state: "active", issues: 0 });
  assert.deepEqual(rewardsGiftStatus(overview, ok), { state: "active", issues: 1 }, "it runs in Czechia; Slovakia is one thing to resolve");
  assert.deepEqual(rewardsStatus(overview, ok), { state: "active", issues: 1 });
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
  // The plan signal is amber only (doctrine §16b): the stored Pro threshold sits in the Pro frame, never in the attention red.
  const freeHtml = await renderPage(createElement(RewardsScreen, devRewardsScreen({ plan: "free", state: null, locale: "cs" })));
  const keptAt = freeHtml.indexOf("Uložený další práh");
  const { WON_AMBER, WON_ATTENTION } = await import("../../app/components/shell/tokens.ts");
  const around = freeHtml.slice(Math.max(0, keptAt - 600), keptAt);
  assert.ok(around.includes(WON_AMBER), "inside the amber Pro frame");
  assert.ok(!around.slice(around.lastIndexOf("<div")).includes(WON_ATTENTION), "not the attention colour");
  // Proposal 3: the market by name, the currency in brackets. A stored gift says it at once (N2).
  assert.match(free, /Slovensko \(EUR\): částka chybí, v tomto trhu se odměna nenabízí/);
  assert.match(free, /Slovensko: dárek se nenabízí · /, "the tile names the market too");
  assert.match(free, /V Pro nastavíte víc prahů a u každého výběr až ze 3 dárků/);
  assert.match(freeHtml, /href="\/app\/plan"/, "the Pro note leads to the plan");
  // P5: the state lines say the real values.
  assert.match(free, /Doprava zdarma od 1 000 Kč \/ 40 €/);
  assert.match(free, /Ponožky Won — M od 1 500 Kč/);
  // The green label is the stored state the loader hands over (the same as the home tile); without it there is none.
  assert.match(free, /Aktivní/);
  const noStatus = { ...devRewardsScreen({ plan: "free", state: null, locale: "cs" }), status: undefined };
  assert.doesNotMatch(text(await renderPage(createElement(RewardsScreen, noStatus))), /Aktivní/, "never a green pill from this page's own form");
  const pro = text(await renderPage(createElement(RewardsScreen, devRewardsScreen({ plan: "pro", state: null, locale: "cs" }))));
  assert.match(pro, /2\. práh/);
  assert.match(pro, /Dárek \(na výběr až 3\)/);
  assert.match(pro, /Hrnek Won/);
  assert.match(pro, /Přidat další práh/);
  assert.match(pro, /Kšiltovka Won, Plátěná taška Won nebo Hrnek Won od 3 000 Kč \/ 120 €/);
  const empty = text(await renderPage(createElement(RewardsScreen, devRewardsScreen({ plan: "free", state: "empty", locale: "cs" }))));
  assert.match(empty, /Přidat dárek/);
  assert.match(empty, /Zapnout v tématu/);
  assert.match(empty, /Košík odměny neukazuje\. Won není v tématu zapnutý/);
  assert.match(empty, /Doprava zdarma vypnutá/);
  assert.match(empty, /Žádný dárek/);
  // Every state of the app embed check has its own sentence and action.
  const embed = async (state: string) => text(await renderPage(createElement(RewardsScreen, devRewardsScreen({ plan: "free", state, locale: "cs" }))));
  assert.match(await embed("embed-draft"), /Chybí v tématu.*Won je zapnutý jen v nepublikovaném tématu.*Zapnout v tématu.*Zapněte Won i v živém tématu/);
  assert.match(await embed("embed-unknown"), /Nepodařilo se ověřit, jestli je Won v tématu zapnutý.*Otevřít editor tématu/);
  assert.match(await embed("embed-no-scope"), /Won nemá přístup k tématu.*Otevřít editor tématu/);
  // B12: the limit of thresholds is said, and the server's refusal is rendered.
  const tooMany = text(await renderPage(createElement(RewardsScreen, { ...devRewardsScreen({ plan: "pro", state: null, locale: "cs" }), result: devRewardsResult("too-many") })));
  assert.match(tooMany, /Prahů může být nejvýš 5\./);
  const invalid = text(
    await renderPage(createElement(RewardsScreen, { ...devRewardsScreen({ plan: "free", state: null, locale: "cs" }), result: devRewardsResult("invalid") })),
  );
  assert.match(invalid, /Vyberte dárek\./);
});

// --- Vyzkoušet košík: the gift line the cart on the website would add (Task 6) --------------------------------

test("Vyzkoušet košík: a reached gift tier gets the gift line the cart on the website adds (1 item, free, tagged); below the threshold or without a priced candidate it does not", async () => {
  const { planTryCart } = await import("../../app/lib/integration/try-cart-plan.ts");
  const { config } = sanitizeConfig({
    markets: [{ handle: "cesko", currency: "CZK", enabled: true }],
    modules: {
      rewards: {
        gifts: [
          { id: "g1", threshold: { CZK: 500_00 }, choices: ["gid://shopify/ProductVariant/91"] },
          { id: "g2", threshold: { CZK: 900_00 }, choices: ["gid://shopify/ProductVariant/92", "gid://shopify/ProductVariant/93"] },
        ],
      },
    },
  });
  const hoodie = (quantity: number) => ({ variantId: "gid://shopify/ProductVariant/11", productId: "gid://shopify/Product/1", title: "Mikina Won", quantity, unitPrice: 300_00, collectionIds: [] });
  const candidate = (tierId: string, variant: number, choices: number) => ({
    variantId: `gid://shopify/ProductVariant/${variant}`,
    productId: `gid://shopify/Product/${variant}`,
    title: `Dárek ${variant}`,
    quantity: 1,
    unitPrice: 99_00,
    collectionIds: [],
    giftTierId: tierId,
    choices,
  });
  const run = (quantity: number, candidates: ReturnType<typeof candidate>[]) =>
    planTryCart(config, {
      lines: [hoodie(quantity)],
      currency: "CZK",
      countryCode: "CZ",
      codes: [],
      date: "2026-10-01",
      time: "12:00:00",
      shopTimezone: "Europe/Prague",
      locale: "cs",
      productRefs: new Map([["gid://shopify/Product/1", { ruleIds: [], variantRuleIds: {} }]]),
      giftCandidates: new Map(candidates.map((c) => [c.giftTierId, c])),
    });
  const both = [candidate("g1", 91, 1), candidate("g2", 92, 2)];

  const reached = run(2, both); // 600 Kč: g1 reached, g2 not
  const gift = reached.lines.find((l) => l.gift);
  assert.ok(gift, JSON.stringify(reached.lines));
  assert.deepEqual(
    { title: gift.title, quantity: gift.quantity, subtotal: gift.subtotal, discount: gift.discount, total: gift.total, choices: gift.giftChoices },
    { title: "Dárek 91", quantity: 1, subtotal: 99_00, discount: 99_00, total: 0, choices: 1 },
  );
  assert.equal(reached.lines.filter((l) => l.gift).length, 1, "only the reached tier");
  assert.equal(reached.totals.total, 600_00, "the gift is free: the total is the paid lines");
  const text = reached.explain.map((e) => e.text).join(" | ");
  assert.match(text, /Dárek zdarma: nákup od 500/, text);
  assert.doesNotMatch(text, /v košíku ale dárek není/, text);

  const ladder = run(4, both); // 1 200 Kč: both tiers, the second offers a choice of 2
  assert.deepEqual(
    ladder.lines.filter((l) => l.gift).map((l) => [l.title, l.total, l.giftChoices]),
    [
      ["Dárek 91", 0, 1],
      ["Dárek 92", 0, 2],
    ],
  );

  const below = run(1, both); // 300 Kč
  assert.equal(below.lines.some((l) => l.gift), false);
  assert.match(below.explain.map((e) => e.text).join(" | "), /Do dárku zdarma zbývá 200/);

  const unpriced = run(2, []); // no candidate (not readable / no price in the currency): said, not invented
  assert.equal(unpriced.lines.some((l) => l.gift), false);
  assert.match(unpriced.explain.map((e) => e.text).join(" | "), /v košíku ale dárek není/);
});

test("harness: Vyzkoušet košík with rewards — Free adds the socks (free), says the Pro threshold; Pro adds both gifts, the second from a choice of 3", async () => {
  const { createElement } = await import("react");
  const { renderPage } = await import("./helpers.ts");
  const { TryCartScreen, buildTryCartProps } = await import("../../app/components/screens/TryCartScreen.tsx");
  const { devTryCartPlanRewards, devTryCartRewardLines, DEV_REWARDS_FIXTURE } = await import("../../app/lib/dev-harness.server.ts");
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const free = devTryCartPlanRewards("cs", "free");
  assert.deepEqual(free.lines.filter((l) => l.gift).map((l) => [l.title, l.total]), [["Ponožky Won — M", 0]]);
  const pro = devTryCartPlanRewards("cs", "pro");
  assert.deepEqual(pro.lines.filter((l) => l.gift).map((l) => [l.title, l.total, l.giftChoices]), [
    ["Ponožky Won — M", 0, 1],
    ["Kšiltovka Won", 0, 3],
  ]);
  const base = buildTryCartProps(DEV_REWARDS_FIXTURE, { timezone: "Europe/Prague", pro: true });
  const html = text(await renderPage(createElement(TryCartScreen, { ...base, lines: devTryCartRewardLines("pro"), currency: "CZK:cz", plan: pro, result: null })));
  assert.match(html, /Zákazník si v košíku vybere ze 3 dárků/);
  assert.match(html, /Doprava zdarma: nákup od 1/);
});
