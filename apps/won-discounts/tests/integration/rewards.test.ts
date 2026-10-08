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
import { MS_FIELD as F } from "../../app/components/model/milestones.ts";
import { rewardsDiscountStatus, rewardsGiftStatus, rewardsShippingStatus, rewardsStatus } from "../../app/components/model/module-status.ts";
import type { SyncView } from "../../app/components/model/types.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, formOf, quiet, testCtx } from "./helpers.ts";

// Milníky (dřív Odměny; MVP 4 contracts R1–R7, feedback 6 Oct 2026 bod 9): the admin module saves the ladder the
// merchant typed (an amount per market, MKT-1; amounts as minor units), parsed on the server (SEC-1), through
// the same saveConfigSection as every module; the sync then ships free shipping and the gifts compact to the
// function and with the gift's handle to the storefront, and a discount step as an order rule with the "ms-"
// prefix. Limits are checked on the server (Free 2 steps, Pro 6); a stored ladder stays as stored (§14a) and the
// gate keeps what the plan runs (BILL-1).

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

test("save: all three kinds of step (major units typed → minor units), countOtherDiscounts; the sync ships them where the checkout and the storefront read them", async () => {
  const fake = new FakeStore();
  const gift = fake.sync.addProduct(7);
  gift.handle = "darek";
  const ctx = ctxFor(fake, "pro");
  await store(withMarkets);
  const result = await rewardsAction(
    ctx,
    formOf([
      [F.intent, "save"],
      [F.step, "new-ship0001"],
      [F.kind("new-ship0001"), "shipping"],
      [F.amount("new-ship0001", "CZK"), "1 000"],
      [F.amount("new-ship0001", "EUR"), "40,5"],
      [F.step, "new-gift0001"],
      [F.kind("new-gift0001"), "gift"],
      [F.amount("new-gift0001", "CZK"), "1500"],
      [F.choice("new-gift0001"), gift.variantIds[0]!],
      [F.step, "new-pct00001"],
      [F.kind("new-pct00001"), "discount"],
      [F.valueKind("new-pct00001"), "percentage"],
      [F.percent("new-pct00001"), "5"],
      [F.amount("new-pct00001", "CZK"), "2000"],
      [F.amount("new-pct00001", "EUR"), "80"],
      [F.step, "new-fix00001"],
      [F.kind("new-fix00001"), "discount"],
      [F.valueKind("new-fix00001"), "fixed"],
      [F.amount("new-fix00001", "CZK"), "5000"],
      [F.amount("new-fix00001", "EUR"), "200"],
      [F.off("new-fix00001", "CZK"), "500"],
      [F.off("new-fix00001", "EUR"), "20"],
      [F.other, "1"],
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  await syncIdle(shop);
  const config = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(config.modules.rewards, {
    freeShipping: { threshold: { CZK: 1000_00, EUR: 40_50 } },
    gifts: [{ id: "gift-gift0001", threshold: { CZK: 1500_00 }, choices: [gift.variantIds[0]] }],
    countOtherDiscounts: true,
    giftDeclinable: true,
  });
  // A discount step is an automatic order rule with the "ms-" prefix and a minimum subtotal of the whole cart.
  assert.deepEqual(config.modules.codes.rules, [
    { id: "ms-pct00001", enabled: true, name: "", method: "automatic", value: { kind: "percentage", percent: 5 }, target: { kind: "order" }, minimum: { subtotal: { CZK: 2000_00, EUR: 80_00 }, scope: "cart" } },
    { id: "ms-fix00001", enabled: true, name: "", method: "automatic", value: { kind: "fixed", amount: { CZK: 500_00, EUR: 20_00 } }, target: { kind: "order" }, minimum: { subtotal: { CZK: 5000_00, EUR: 200_00 }, scope: "cart" } },
  ]);
  // …and it loads back as the ladder, in ladder order.
  const screen = await loadRewardsScreen(ctx, { scopes: SCOPES });
  assert.deepEqual(
    screen.steps.map((s) => [s.kind, s.id, s.threshold, s.value, s.percent, s.off]),
    [
      ["shipping", "shipping", { CZK: 1000_00, EUR: 40_50 }, "percentage", null, {}],
      ["gift", "gift-gift0001", { CZK: 1500_00 }, "percentage", null, {}],
      ["discount", "ms-pct00001", { CZK: 2000_00, EUR: 80_00 }, "percentage", 5, {}],
      ["discount", "ms-fix00001", { CZK: 5000_00, EUR: 200_00 }, "fixed", null, { CZK: 500_00, EUR: 20_00 }],
    ],
  );
  assert.deepEqual([screen.limit, screen.limitPro, screen.countOther], [6, 6, true]);
  const payload = JSON.parse(fake.sync.shopMetafieldValue("function_config")!) as { modules: { rewards: unknown; codes: { rules: { id: string }[] } } };
  const n = Number(gift.variantIds[0]!.split("/").pop());
  assert.deepEqual(payload.modules.rewards, { s: { CZK: 1000_00, EUR: 40_50 }, g: [["gift-gift0001", { CZK: 1500_00 }, [n]]], o: 1 });
  assert.deepEqual(payload.modules.codes.rules.map((r) => r.id), ["ms-pct00001", "ms-fix00001"]);
  const sf = fake.sync.storefrontConfig() as { rewards: unknown };
  assert.deepEqual(sf.rewards, {
    ship: { CZK: 1000_00, EUR: 40_50 },
    gifts: [{ id: "gift-gift0001", t: { CZK: 1500_00 }, c: [{ v: n, h: "darek" }] }],
    other: true,
    disc: [
      { id: "ms-pct00001", t: { CZK: 2000_00, EUR: 80_00 }, pct: 5 },
      { id: "ms-fix00001", t: { CZK: 5000_00, EUR: 200_00 }, off: { CZK: 500_00, EUR: 20_00 } },
    ],
  });
  // Saving the page as it loaded changes nothing; switching a step's kind keeps the row and re-ids it for the new kind.
  const again = await rewardsAction(
    ctx,
    formOf([
      [F.intent, "save"],
      ["configVersion", screen.configVersion!],
      [F.step, "shipping"],
      [F.kind("shipping"), "shipping"],
      [F.amount("shipping", "CZK"), "1000"],
      [F.amount("shipping", "EUR"), "40,5"],
      [F.step, "gift-gift0001"],
      [F.kind("gift-gift0001"), "gift"],
      [F.amount("gift-gift0001", "CZK"), "1500"],
      [F.choice("gift-gift0001"), gift.variantIds[0]!],
      [F.step, "ms-pct00001"],
      [F.kind("ms-pct00001"), "gift"],
      [F.amount("ms-pct00001", "CZK"), "2000"],
      [F.choice("ms-pct00001"), gift.variantIds[0]!],
      [F.other, "1"],
    ]),
  );
  assert.equal(again.ok, true, JSON.stringify(again));
  const after = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(after.modules.rewards.gifts.map((g) => [g.id, g.threshold]), [["gift-gift0001", { CZK: 1500_00 }], ["gift-pct00001", { CZK: 2000_00 }]]);
  assert.deepEqual(after.modules.codes.rules, [], "the removed fixed step and the step that became a gift are gone from the rules");
});

test("rewards stored BEFORE Milníky load as steps and save back unchanged; the shop's own discounts are never touched", async () => {
  const ctx = ctxFor(new FakeStore(), "pro");
  const own = { id: "r_summer", enabled: true, name: "Léto", method: "automatic" as const, value: { kind: "percentage" as const, percent: 15 }, target: { kind: "order" as const }, minimum: { subtotal: { CZK: 3000_00 }, scope: "cart" as const } };
  const rewards: WonDiscountsConfig["modules"]["rewards"] = {
    freeShipping: { threshold: { CZK: 1500_00, EUR: 60_00 } },
    gifts: [
      { id: "gift-a", threshold: { CZK: 1000_00, EUR: 40_00 }, choices: ["gid://shopify/ProductVariant/1"], fallbackVariantId: "gid://shopify/ProductVariant/2" },
      { id: "gift-b", threshold: { CZK: 3000_00 }, choices: ["gid://shopify/ProductVariant/3", "gid://shopify/ProductVariant/4", "gid://shopify/ProductVariant/5"] },
    ],
    countOtherDiscounts: true,
    giftDeclinable: true,
  };
  await store((c) => ({ ...withMarkets(c), modules: { ...c.modules, codes: { rules: [own] }, rewards } }));
  const before = (await loadConfig(db.prisma, shop)).config;
  const screen = await loadRewardsScreen(ctx, { scopes: SCOPES });
  assert.deepEqual(screen.steps.map((s) => [s.kind, s.id]), [["gift", "gift-a"], ["shipping", "shipping"], ["gift", "gift-b"]]);
  assert.deepEqual(screen.steps[0]!.fallback?.id, "gid://shopify/ProductVariant/2");
  assert.deepEqual(screen.steps[2]!.choices.map((c) => c.id), rewards.gifts[1]!.choices);
  // The form the page renders for those steps, submitted as it is.
  const fields: [string, string][] = [[F.intent, "save"], ["configVersion", screen.configVersion!], [F.other, "1"]];
  for (const step of screen.steps) {
    fields.push([F.step, step.id], [F.kind(step.id), step.kind]);
    for (const [key, minor] of Object.entries(step.threshold)) fields.push([F.amount(step.id, key), String(minor / 100)]);
    for (const choice of step.choices) fields.push([F.choice(step.id), choice.id]);
    if (step.fallback) fields.push([F.fallback(step.id), step.fallback.id]);
  }
  const result = await rewardsAction(ctx, formOf(fields));
  assert.equal(result.ok, true, JSON.stringify(result));
  const after = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(after.modules.rewards, before.modules.rewards, "nothing lost, nothing renamed");
  assert.deepEqual(after.modules.codes.rules, before.modules.codes.rules, "an ordinary discount is not a step");
});

test("refused (nothing stored): an amount of 0, a gift without an amount or without a gift, a discount without a value, free shipping twice", async () => {
  const ctx = ctxFor(new FakeStore());
  await store(withMarkets);
  const refused = await rewardsAction(
    ctx,
    formOf([
      [F.intent, "save"],
      [F.step, "g"],
      [F.kind("g"), "gift"],
      [F.amount("g", "CZK"), "0"],
      [F.step, "new-d"],
      [F.kind("new-d"), "discount"],
      [F.valueKind("new-d"), "fixed"],
      [F.amount("new-d", "CZK"), "100"],
      [F.off("new-d", "CZK"), "100"],
    ]),
  );
  assert.equal(refused.ok, false);
  const keysOf = (r: unknown) => ((r as { errors?: { key: string; field: string }[] }).errors ?? []).map((e) => `${e.field} ${e.key}`).sort();
  assert.deepEqual(keysOf(refused), [
    "ms.g.amount.CZK milestones.error.amount",
    "ms.g.amount.CZK rewards.error.amount",
    "ms.g.choice rewards.error.giftChoice",
    "ms.new-d.off.CZK milestones.error.offTooHigh",
  ]);
  const twice = await rewardsAction(
    ctx,
    formOf([
      [F.intent, "save"],
      [F.step, "new-a"],
      [F.kind("new-a"), "shipping"],
      [F.amount("new-a", "CZK"), "1000"],
      [F.step, "new-b"],
      [F.kind("new-b"), "shipping"],
      [F.amount("new-b", "CZK"), "2000"],
      [F.step, "new-c"],
      [F.kind("new-c"), "discount"],
      [F.amount("new-c", "CZK"), "3000"],
    ]),
  );
  assert.deepEqual(keysOf(twice), ["ms.new-b.kind milestones.error.shippingTwice", "ms.new-c.percent editor.error.percent"]);
  const config = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual([config.modules.rewards.gifts, config.modules.rewards.freeShipping, config.modules.codes.rules], [[], undefined, []]);
  assert.deepEqual(await rewardsAction(ctx, formOf([[F.intent, "remove"]])), { ok: false, reason: "bad_request" });
});

test("limits on the SERVER, per market: Free saves 2 steps a market and refuses a third, Pro 6 and refuses a seventh", async () => {
  const stepFields = (n: number, key = "CZK", tag = "step"): [string, string][] =>
    Array.from({ length: n }, (_, i) => `new-${tag}${i}`).flatMap((uid, i) => [
      [F.step, uid],
      [F.kind(uid), "discount"],
      [F.percent(uid), String(i + 1)],
      [F.amount(uid, key), String((i + 1) * 1000)],
    ] as [string, string][]);
  const post = async (plan: "free" | "pro", fields: [string, string][], fake = new FakeStore()) => {
    const version = (await loadConfig(db.prisma, shop)).version;
    return rewardsAction(ctxFor(fake, plan), formOf([[F.intent, "save"], ...(version ? ([["configVersion", version]] as [string, string][]) : []), ...fields]));
  };
  const errors = (r: unknown) => ((r as { errors?: { key: string; params?: unknown }[] }).errors ?? []).map((e) => [e.key, e.params]);
  await store(withMarkets);
  assert.deepEqual(errors(await post("free", stepFields(3))), [["milestones.error.limitFree", { max: 2, pro: 6 }]]);
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.modules.codes.rules, [], "nothing was saved");
  // Two markets on Free: two steps in EACH — the same two, or two for Czechia and two others for Slovakia (2 × 2).
  const fake = new FakeStore();
  const four = await post("free", [...stepFields(2, "CZK", "cz"), ...stepFields(2, "EUR", "sk")], fake);
  assert.equal(four.ok, true, JSON.stringify(four));
  await syncIdle(shop);
  const shipped = JSON.parse(fake.sync.shopMetafieldValue("function_config")!) as { modules: { codes: { rules: { id: string; enabled: boolean }[] } } };
  assert.deepEqual(shipped.modules.codes.rules.filter((r) => r.enabled).map((r) => r.id), ["ms-cz0", "ms-cz1", "ms-sk0", "ms-sk1"], "all four run: two in each market");
  assert.deepEqual((await loadRewardsScreen(ctxFor(new FakeStore(), "free"), { scopes: SCOPES })).gateNotes, [], "nothing is past a limit");
  // …but not a third one in a market.
  assert.deepEqual(errors(await post("free", [...stepFields(2, "CZK", "cz"), ...stepFields(3, "EUR", "sk")])), [["milestones.error.limitFree", { max: 2, pro: 6 }]]);
  assert.deepEqual(errors(await post("pro", stepFields(7))), [["milestones.error.limit", { max: 6, pro: 6 }]]);
  const six = await post("pro", stepFields(6));
  assert.equal(six.ok, true, JSON.stringify(six));
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 6);
  // After a downgrade the six stay stored and editable; the gate note says so, and the checkout gets two.
  const down = new FakeStore();
  const free = ctxFor(down, "free");
  const screen = await loadRewardsScreen(free, { scopes: SCOPES });
  assert.deepEqual([screen.steps.length, screen.limit], [6, 2]);
  assert.match(screen.gateNotes[0]!.text, /Ve Free platí v každém trhu 2 stupně Milníků s nejnižší částkou\. 4 stupně se proto někde nenabízejí/);
  // Saving the stored steps again (two of them edited) is not "more steps": it saves, and nothing is lost.
  const same: [string, string][] = screen.steps.flatMap((step, i) => [[F.step, step.id], [F.kind(step.id), "discount"], [F.percent(step.id), String(step.percent)], [F.amount(step.id, "CZK"), String(step.threshold.CZK! / 100 + (i < 2 ? 50 : 0))]] as [string, string][]);
  const result = await post("free", same, down);
  assert.equal(result.ok, true, JSON.stringify(result));
  await syncIdle(shop);
  const rules = (await loadConfig(db.prisma, shop)).config.modules.codes.rules;
  assert.deepEqual(rules.map((r) => [r.id, r.minimum?.subtotal?.CZK]), [["ms-step0", 1050_00], ["ms-step1", 2050_00], ["ms-step2", 3000_00], ["ms-step3", 4000_00], ["ms-step4", 5000_00], ["ms-step5", 6000_00]]);
  // (a rule the plan does not run ships switched off, like every rule the gate turns off)
  const gated = JSON.parse(down.sync.shopMetafieldValue("function_config")!) as { modules: { codes: { rules: { id: string; enabled: boolean }[] } } };
  assert.deepEqual(gated.modules.codes.rules.filter((r) => r.enabled).map((r) => r.id), ["ms-step0", "ms-step1"], "a Free shop's checkout runs two steps");
  // …but a Free shop cannot ADD one on top of them.
  assert.deepEqual(errors(await post("free", [...same, [F.step, "new-x"], [F.kind("new-x"), "shipping"], [F.amount("new-x", "CZK"), "100"]])), [["milestones.error.limitFree", { max: 2, pro: 6 }]]);
});

test("Free with a stored ladder: a step past the limit stays stored and editable, the gate note says so; amounts in a disabled market stay (§14a)", async () => {
  const fake = new FakeStore();
  const ctx = ctxFor(fake, "free");
  const ladder: GiftTier[] = [
    { id: "g1", threshold: { CZK: 500_00, HUF: 9000_00 }, choices: ["gid://shopify/ProductVariant/11"] },
    { id: "g2", threshold: { CZK: 900_00 }, choices: ["gid://shopify/ProductVariant/21", "gid://shopify/ProductVariant/22"] },
    { id: "g3", threshold: { CZK: 1900_00, EUR: 70_00 }, choices: ["gid://shopify/ProductVariant/31"] },
  ];
  await store((c) => ({ ...withMarkets(c), modules: { ...c.modules, rewards: { ...c.modules.rewards, gifts: ladder } } }));
  const screen = await loadRewardsScreen(ctx, { scopes: SCOPES });
  assert.deepEqual(screen.steps.map((g) => g.id), ["g1", "g2", "g3"]);
  assert.ok(screen.gateNotes.length >= 1, JSON.stringify(screen.gateNotes));
  assert.equal(screen.cartBlockAddUrl?.includes("template=cart"), true);
  const result = await rewardsAction(
    ctx,
    formOf([
      [F.intent, "save"],
      ["configVersion", screen.configVersion!],
      [F.step, "g1"],
      [F.kind("g1"), "gift"],
      [F.amount("g1", "CZK"), "600"],
      [F.choice("g1"), "gid://shopify/ProductVariant/11"],
      [F.step, "g2"],
      [F.kind("g2"), "gift"],
      [F.amount("g2", "CZK"), "900"],
      [F.choice("g2"), "gid://shopify/ProductVariant/21"],
      [F.choice("g2"), "gid://shopify/ProductVariant/22"],
      [F.step, "g3"],
      [F.kind("g3"), "gift"],
      [F.amount("g3", "CZK"), "1900"],
      [F.amount("g3", "EUR"), "70"],
      [F.choice("g3"), "gid://shopify/ProductVariant/31"],
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  await syncIdle(shop);
  const gifts = (await loadConfig(db.prisma, shop)).config.modules.rewards.gifts;
  assert.deepEqual(gifts[0], { id: "g1", threshold: { HUF: 9000_00, CZK: 600_00 }, choices: ["gid://shopify/ProductVariant/11"] }, "HUF (no enabled market) kept");
  assert.deepEqual(gifts[1], ladder[1], "a stored choice of two stays stored on Free (the gate offers the first)");
  assert.deepEqual(gifts[2], ladder[2], "the third step exactly as stored");
  // What a Free shop's checkout gets: g3 is the third step in Czechia (left out there) and the only one in Slovakia (it runs there).
  const payload = JSON.parse(fake.sync.shopMetafieldValue("function_config")!) as { modules: { rewards: { g: [string, Record<string, number>, number[]][] } } };
  assert.deepEqual(payload.modules.rewards.g.map((g) => [g[0], g[1]]), [["g1", { HUF: 9000_00, CZK: 600_00 }], ["g2", { CZK: 900_00 }], ["g3", { EUR: 70_00 }]]);
});

test("Přehled card: the steps the PLAN runs in the shop currency (Free: the first two of the ladder)", () => {
  const { config } = sanitizeConfig({
    modules: {
      codes: { rules: [{ id: "ms-a", name: "", method: "automatic", value: { kind: "percentage", percent: 5 }, target: { kind: "order" }, minimum: { subtotal: { CZK: 2000_00 }, scope: "cart" } }] },
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
  assert.deepEqual(rewardsOverviewOf(config, "pro", "CZK"), {
    shipping: 1000_00,
    gifts: [500_00, null],
    currency: "CZK",
    discounts: [{ amount: 2000_00, percent: 5 }],
    missing: { shipping: [], gifts: [[], ["CZK"]], discounts: [[]] },
  });
  // Free, per market: in CZK the two lowest are g1 (500) and shipping (1 000) — the 5 % step is left out there, which
  // is the plan's limit, not a missing amount. g2 has no CZK amount at all (it runs in EUR): that IS something to say.
  assert.deepEqual(rewardsOverviewOf(config, "free", "CZK"), { shipping: 1000_00, gifts: [500_00, null], currency: "CZK", missing: { shipping: [], gifts: [[], ["CZK"]], discounts: [] } });
  assert.deepEqual(rewardsOverviewOf(config, "pro", "EUR").missing, { shipping: ["EUR"], gifts: [["EUR"], []], discounts: [["EUR"]] });
});

test("N2: a step without an amount for an enabled market is something to resolve, on the tile and on the page", () => {
  const { config } = sanitizeConfig({
    markets: [
      { handle: "cz", currency: "CZK", enabled: true },
      { handle: "sk", currency: "EUR", enabled: true },
      { handle: "hu", currency: "HUF", enabled: false },
    ],
    modules: {
      codes: { rules: [{ id: "ms-fix", name: "", method: "automatic", value: { kind: "fixed", amount: { CZK: 100_00 } }, target: { kind: "order" }, minimum: { subtotal: { CZK: 2000_00, EUR: 80_00 }, scope: "cart" } }] },
      rewards: {
        freeShipping: { threshold: { CZK: 1000_00, EUR: 40_00 } },
        gifts: [{ id: "g1", threshold: { CZK: 1500_00 }, choices: ["gid://shopify/ProductVariant/1"] }],
      },
    },
  });
  const overview = rewardsOverviewOf(config, "pro", "CZK");
  assert.deepEqual(overview.missing, { shipping: [], gifts: [["EUR"]], discounts: [["EUR"]] }, "the switched-off market (HUF) is not asked for; a fixed discount needs its amount there too");
  const ok: SyncView = { state: "ok", at: "2026-09-28T16:20:00" };
  assert.deepEqual(rewardsShippingStatus(overview, ok), { state: "active", issues: 0 });
  assert.deepEqual(rewardsGiftStatus(overview, ok), { state: "active", issues: 1 }, "it runs in Czechia; Slovakia is one thing to resolve");
  assert.deepEqual(rewardsDiscountStatus(overview, ok), { state: "active", issues: 1 });
  assert.deepEqual(rewardsStatus(overview, ok), { state: "active", issues: 2 });
  // A shop with discount steps only is "active" as well.
  const only = sanitizeConfig({ modules: { codes: { rules: config.modules.codes.rules } } }).config;
  assert.deepEqual(rewardsStatus(rewardsOverviewOf(only, "free", "CZK"), ok), { state: "active", issues: 0 });
});

// --- The screen (dev harness data = loadRewardsScreen's pure part) -----------------------------------------

test("screen: the stored rewards as a ladder; Free shows the step past its limit as stored (not in force); Pro edits every step; discount steps; an empty shop asks for the app embed", async () => {
  const { createElement } = await import("react");
  const { renderPage } = await import("./helpers.ts");
  const { MilestonesScreen } = await import("../../app/components/screens/MilestonesScreen.tsx");
  const { devRewardsScreen, devRewardsResult } = await import("../../app/lib/dev-harness.server.ts");
  const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const freeHtml = await renderPage(createElement(MilestonesScreen, devRewardsScreen({ plan: "free", state: null, locale: "cs" })));
  const free = text(freeHtml);
  assert.match(freeHtml, /<s-page heading="Milníky"/);
  // Three stored rewards = three steps, in ladder order. Per market on Free: in Czechia the third (the choice of
  // gifts) is past the limit; in Slovakia it is the second step (the socks have no amount there), so it runs.
  assert.deepEqual([...freeHtml.matchAll(/data-won-ms-step="([^"]+)"/g)].map((m) => m[1]), ["shipping", "gift-socks", "gift-choice"]);
  assert.deepEqual([...freeHtml.matchAll(/data-won-ms-row="([^"]+)"[\s\S]*?(?=data-won-ms-row=|data-won-ms-suggest|$)/g)].map((m) => [m[1], /data-won-ms-over="([^"]*)"/.exec(m[0])?.[1] ?? null]), [["shipping", null], ["gift-socks", null], ["gift-choice", "CZK"]]);
  assert.doesNotMatch(freeHtml, /name="ms\.kept"/, "every stored step stays editable");
  assert.match(freeHtml, /<s-number-field name="ms\.gift-choice\.amount\.CZK"[^>]* value="3000"/);
  assert.match(free, /Česko: ve Free tu tento stupeň neplatí\. V každém trhu platí 2 stupně s nejnižší částkou, v Pro 6\. Zůstane uložený\./);
  assert.match(free, /Ve Free platí v každém trhu 2 stupně Milníků s nejnižší částkou\. Jeden stupeň se proto někde nenabízí/, "the gate note");
  assert.match(free, /Stupňů: 3 z 4/, "two markets on Free: room for two steps in each");
  assert.match(freeHtml, /href="\/app\/plan"/, "the Pro note leads to the plan");
  // The amounts table: a row per step, a column per market, the market by name with its currency.
  assert.match(freeHtml, /data-won-ms-table="2"/);
  assert.deepEqual([...freeHtml.matchAll(/data-won-ms-column="([^"]+)"[^>]*>([^<]+)</g)].map((m) => `${m[1]}=${m[2]}`), ["CZK=Česko (CZK)", "EUR=Slovensko (EUR)"]);
  assert.match(freeHtml, /<s-number-field name="ms\.shipping\.amount\.CZK" label="1\. stupeň, Česko \(CZK\)" labelAccessibilityVisibility="exclusive" value="1000"/);
  assert.match(freeHtml, /<s-number-field name="ms\.gift-socks\.amount\.EUR" label="2\. stupeň, Slovensko \(EUR\)" labelAccessibilityVisibility="exclusive" value=""/);
  // A stored step says at once where it is not offered (N2), by the market's name.
  assert.match(free, /Slovensko \(EUR\): částka chybí, v tomto trhu se stupeň nenabízí/);
  assert.match(free, /Slovensko: některý stupeň se nenabízí · /, "the tile names the market too");
  // The state lines say the real values.
  assert.match(free, /Doprava zdarma od 1 000 Kč \/ 40 € · Dárek: Ponožky Won — M od 1 500 Kč/);
  // The preview: the ladder as the customer sees it.
  assert.match(freeHtml, /data-won-ms-preview=""/);
  assert.match(free, /Ještě .* a získáte: /);
  // The green label is the stored state the loader hands over (the same as the home tile); without it there is none.
  assert.match(free, /Aktivní/);
  const noStatus = { ...devRewardsScreen({ plan: "free", state: null, locale: "cs" }), status: undefined };
  assert.doesNotMatch(text(await renderPage(createElement(MilestonesScreen, noStatus))), /Aktivní/, "never a green pill from this page's own form");
  const proHtml = await renderPage(createElement(MilestonesScreen, devRewardsScreen({ plan: "pro", state: null, locale: "cs" })));
  const pro = text(proHtml);
  assert.doesNotMatch(proHtml, /data-won-ms-over/);
  assert.match(pro, /3\. stupeň/);
  assert.match(pro, /Dárek \(na výběr až 3\)/);
  assert.match(pro, /Dárek: Kšiltovka Won, Plátěná taška Won nebo Hrnek Won od 3 000 Kč \/ 120 €/);
  assert.match(pro, /Přidat stupeň/);
  assert.match(pro, /Stupňů: 3 z 12/);
  // Discount steps: a percent and an amount per market, with the sentence on how they differ from a gift.
  const discHtml = await renderPage(createElement(MilestonesScreen, devRewardsScreen({ plan: "pro", state: "discounts", locale: "cs" })));
  const disc = text(discHtml);
  assert.deepEqual([...discHtml.matchAll(/data-won-ms-step="([^"]+)"/g)].map((m) => m[1]), ["shipping", "gift-socks", "ms-five", "gift-choice", "ms-fixed"]);
  assert.match(disc, /Sleva 5 % od 2 000 Kč \/ 80 €/);
  assert.match(disc, /Sleva 500 Kč \/ 20 € od 5 000 Kč \/ 200 €/);
  assert.match(discHtml, /<s-number-field name="ms\.ms-fixed\.off\.EUR" label="Sleva: Slovensko \(EUR\)" value="20"/);
  assert.match(disc, /Na rozdíl od dárku se sleva počítá ze zboží po slevách na produkty/);
  const empty = text(await renderPage(createElement(MilestonesScreen, devRewardsScreen({ plan: "free", state: "empty", locale: "cs" }))));
  assert.match(empty, /Přidat první stupeň/);
  assert.match(empty, /Zapnout na webu/);
  assert.match(empty, /Košík žebříček neukazuje\. Won není na webu zapnutý/);
  assert.match(empty, /Žádný stupeň/);
  // The setup guide's first step: free shipping with its amounts prefilled, nothing stored yet.
  const startHtml = await renderPage(createElement(MilestonesScreen, { ...devRewardsScreen({ plan: "free", state: "empty", locale: "cs" }), start: "shipping" as const }));
  assert.match(startHtml, /<s-number-field name="ms\.shipping\.amount\.CZK"[^>]* value="1500"/);
  // Every state of the app embed check has its own sentence and action.
  const embed = async (state: string) => text(await renderPage(createElement(MilestonesScreen, devRewardsScreen({ plan: "free", state, locale: "cs" }))));
  assert.match(await embed("embed-draft"), /Na webu chybí.*Won je zapnutý jen v nepublikovaném vzhledu obchodu.*Zapněte Won i ve vzhledu, který zákazníci vidí.*Zapnout na webu/);
  assert.match(await embed("embed-unknown"), /Nepodařilo se zjistit, jestli je Won na webu zapnutý.*Otevřít úpravu vzhledu obchodu/);
  assert.match(await embed("embed-no-scope"), /Won nemá přístup ke vzhledu obchodu.*Otevřít úpravu vzhledu obchodu/);
  // The limit is said, and the server's refusal is rendered.
  const render = async (plan: "free" | "pro", result: string) => text(await renderPage(createElement(MilestonesScreen, { ...devRewardsScreen({ plan, state: null, locale: "cs" }), result: devRewardsResult(result) })));
  assert.match(await render("pro", "too-many"), /V jednom trhu může platit nejvýš 6 stupňů\./);
  assert.match(await render("free", "limit-free"), /Free má v každém trhu 2 stupně\. Odeberte stupeň, nechte u něj pole trhu prázdné, nebo přejděte na Pro, kde jich je 6\./);
  assert.match(await render("free", "invalid"), /Vyberte dárek\./);
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
