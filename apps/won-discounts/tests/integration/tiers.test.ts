import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { overviewData } from "../../app/lib/integration/pages.server.ts";
import { loadTiersOverview, loadTiersScreen, saveTiers, tiersAction } from "../../app/lib/integration/tiers.server.ts";
import { createSync, syncIdle } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { TIERS_FIELD as F } from "../../app/components/model/tiers.ts";
import type { TierSetView } from "../../app/components/model/types.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, formOf, quiet, testCtx } from "./helpers.ts";

// Množstevní slevy, the server side of the admin module (MVP 3, Task 5):
//   loadTiersScreen   the sets as stored (Shopify titles for their products and
//                     collections, never an id), the plan's gate notes (BILL-1,
//                     core explainGate), margin on, product rules that compete,
//                     the table on the product page (read_themes), the storefront
//                     config's state (K5 `cv` vs. the config version), the preview
//                     (theme tokens, the look, a real product);
//   tiersAction/saveTiers  the form parsed on the server (SEC-1), saved like
//                     every admin change (lock, F12, unreadable guard, saveAndSync);
//   loadTiersOverview the Přehled card (what the PLAN runs, §17c).

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-tiers");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `tiers-${seq}.myshopify.com`;
  clearSignalCache();
});

const SCOPES = "write_discounts,read_products,write_products,read_themes";
const P1 = "gid://shopify/Product/1";
const C5 = "gid://shopify/Collection/5";

function ctxFor(store: FakeStore, plan: "free" | "pro" = "free"): ShopCtx {
  return {
    ...testCtx(db.prisma, shop, store),
    createSync: (client: AdminClient, prisma: PrismaClient) =>
      createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => plan }),
    lockWaitMs: 200,
  };
}

const HORIZON = JSON.stringify({ current: { type_body_font: "inter_n4", color_palette: { background: "#ffffff", foreground: "#000000" }, page_text_color: "{{ settings.color_palette.foreground }}" } });
const WITH_BLOCK = JSON.stringify({
  sections: { main: { type: "product-information", blocks: { d: { type: "_product-details", blocks: { t: { type: "shopify://apps/won-discounts/blocks/quantity_tiers/abc" } } } } } },
});

/** A shop: Horizon with the block, a product, titles for P1/C5, the storefront config metafield (cv = `cv()`). */
function storeFor(opts: { cv?: () => string | null; block?: boolean } = {}): FakeStore {
  const store = new FakeStore();
  store.overrides.set("WonTiersThemeLook", () => ({
    data: {
      themes: {
        nodes: [
          {
            id: "gid://shopify/OnlineStoreTheme/1",
            name: "Horizon",
            files: {
              nodes: [
                { filename: "config/settings_data.json", body: { content: HORIZON } },
                { filename: "templates/product.json", body: { content: opts.block === false ? '{"sections":{"main":{"type":"x"}}}' : WITH_BLOCK } },
              ],
            },
          },
        ],
      },
    },
  }));
  store.overrides.set("WonTiersStorefrontConfig", () => {
    const cv = opts.cv?.() ?? null;
    return { data: { currentAppInstallation: { metafield: cv === null ? null : { jsonValue: { v: 1, cv }, updatedAt: "2026-09-30T08:00:00Z" } } } };
  });
  store.overrides.set("WonTiersPreviewProduct", () => ({
    data: {
      shop: { currencyCode: "CZK", currencyFormats: { moneyFormat: "{{amount_with_comma_separator}} Kč" } },
      products: { nodes: [{ id: P1, title: "Mikina Won", handle: "mikina", onlineStoreUrl: "https://won.example/products/mikina", variants: { nodes: [{ price: "200.00" }] } }] },
    },
  }));
  store.overrides.set("WonTiersPreviewProductById", () => ({
    data: {
      shop: { currencyCode: "CZK", currencyFormats: { moneyFormat: null } },
      product: { id: P1, title: "Mikina Won", handle: "mikina", onlineStoreUrl: null, variants: { nodes: [{ price: "200.00" }] } },
    },
  }));
  const titles = new Map([
    [P1, { __typename: "Product", id: P1, title: "Mikina Won" }],
    [C5, { __typename: "Collection", id: C5, title: "Zimní" }],
  ]);
  store.overrides.set("WonTiersTitles", (variables) => ({ data: { nodes: ((variables.ids as string[]) ?? []).map((id) => titles.get(id) ?? null) } }));
  return store;
}

async function store(config: (c: WonDiscountsConfig) => WonDiscountsConfig) {
  const base = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, config(base));
}

const GLOBAL: TierSetView = {
  id: "global",
  scope: { kind: "global" },
  countAcross: "product",
  breaks: [
    { minQty: 3, kind: "percent", percent: 10, amount: {} },
    { minQty: 5, kind: "percent", percent: 15, amount: {} },
  ],
};

test("a new shop: no sets, the market currencies, the table on the product page, the storefront config not written yet, a real product for the preview", async () => {
  const data = await loadTiersScreen(ctxFor(storeFor()), { scopes: SCOPES });
  assert.equal(data.plan, "free");
  assert.equal(data.shopCurrency, "CZK");
  assert.equal(data.configVersion, null);
  assert.deepEqual(data.currencies, [{ code: "CZK", markets: [] }]);
  assert.deepEqual(data.sets, []);
  assert.deepEqual(data.gateNotes, []);
  assert.equal(data.marginOn, false);
  assert.equal(data.competingRules, 0);
  assert.deepEqual(data.block, { state: "on", themeName: "Horizon" });
  assert.deepEqual(data.storefront, { state: "missing" });
  assert.equal(data.preview.preset, "default");
  assert.equal(data.preview.tokens?.fontBody, "Inter");
  assert.equal(data.preview.product?.title, "Mikina Won");
  assert.equal(data.preview.product?.unitPrice, 20000);
});

test("save through the form: the global set stored (breaks ascending), synced; the page reads it back; the storefront config current → synced", async () => {
  let cv: string | null = null;
  const st = storeFor({ cv: () => cv });
  const ctx = ctxFor(st);
  const result = await tiersAction(
    ctx,
    formOf([
      [F.intent, "save"],
      [F.set, "global"],
      [F.scope("global"), "global"],
      [F.count("global"), "product"],
      [F.kind("global"), "percent"],
      [F.row("global"), "r0"],
      [F.row("global"), "r1"],
      [F.min("global", "r0"), "5"],
      [F.percent("global", "r0"), "15"],
      [F.min("global", "r1"), "3"],
      [F.percent("global", "r1"), "10"],
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.ok && result.sync?.ok, true, JSON.stringify(result));
  await syncIdle(shop);
  const loaded = await loadConfig(db.prisma, shop);
  assert.deepEqual(loaded.config.modules.tiers.sets, [
    {
      id: "global",
      scope: "global",
      countAcross: "product",
      breaks: [
        { minQty: 3, percent: 10 },
        { minQty: 5, percent: 15 },
      ],
    },
  ]);
  cv = loaded.version;
  clearSignalCache();
  const data = await loadTiersScreen(ctx, { scopes: SCOPES });
  assert.deepEqual(data.sets, [GLOBAL]);
  assert.equal(data.configVersion, loaded.version);
  assert.deepEqual(data.storefront, { state: "synced", at: "2026-09-30T10:00:00" });
  cv = "an-older-version";
  assert.deepEqual((await loadTiersScreen(ctx, { scopes: SCOPES })).storefront, { state: "pending" });
});

test("a wrong form is refused at its fields (SEC-1) and nothing is saved; an unknown intent → bad_request", async () => {
  const ctx = ctxFor(storeFor());
  const refused = await tiersAction(
    ctx,
    formOf([
      [F.intent, "save"],
      [F.set, "global"],
      [F.scope("global"), "global"],
      [F.count("global"), "line"],
      [F.kind("global"), "percent"],
      [F.row("global"), "r0"],
      [F.min("global", "r0"), "3"],
      [F.percent("global", "r0"), "150"],
    ]),
  );
  assert.deepEqual(refused, { ok: false, reason: "invalid", errors: [{ field: F.percent("global", "r0"), key: "tiers.error.percent" }] });
  assert.equal((await loadConfig(db.prisma, shop)).exists, false);
  assert.deepEqual(await tiersAction(ctx, formOf([[F.intent, "remove"]])), { ok: false, reason: "bad_request" });
});

test("Free with Pro sets stored: titles from Shopify, the global set first, the plan's gate notes; nothing stored is dropped by a save (§14a)", async () => {
  const st = storeFor();
  const ctx = ctxFor(st, "free");
  await store((c) => ({
    ...c,
    modules: {
      ...c.modules,
      tiers: {
        sets: [
          { id: "t_scoped", scope: { productIds: [P1], collectionIds: [C5] }, countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] },
          { id: "global", scope: "global", countAcross: "cart", breaks: [{ minQty: 3, percent: 10 }] },
        ],
      },
    },
  }));
  const data = await loadTiersScreen(ctx, { scopes: SCOPES });
  assert.deepEqual(
    data.sets.map((s) => s.id),
    ["global", "t_scoped"],
  );
  assert.deepEqual(data.sets[1]!.scope, { kind: "selection", products: [{ id: P1, title: "Mikina Won" }], collections: [{ id: C5, title: "Zimní" }] });
  const notes = data.gateNotes.map((n) => n.text).join(" | ");
  assert.match(notes, /pro vybrané produkty nebo kolekce ve Free neplatí/);
  assert.match(notes, /po produktech, ne napříč celým košíkem/);

  // Saving the page as it is (Free: the Pro set travels as hidden fields) keeps both sets.
  const version = (await loadConfig(db.prisma, shop)).version;
  const saved = await saveTiers(ctx, data.sets, { configVersion: version });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  await syncIdle(shop);
  assert.deepEqual(
    (await loadConfig(db.prisma, shop)).config.modules.tiers.sets.map((s) => s.id),
    ["global", "t_scoped"],
  );
  // Pro: no gate notes.
  clearSignalCache();
  assert.deepEqual((await loadTiersScreen(ctxFor(st, "pro"), { scopes: SCOPES })).gateNotes, []);
});

test("honest sentences' facts: margin protection on, active product rules that compete (not order rules, not switched off)", async () => {
  await store((c) => ({
    ...c,
    modules: {
      ...c.modules,
      margin: { enabled: true, global: { maxDiscountPercent: 40 }, perCollection: [] },
      codes: {
        rules: [
          { id: "p1", enabled: true, name: "Mikiny −20 %", method: "automatic", value: { kind: "percentage", percent: 20 }, target: { kind: "products", productIds: [P1], variantIds: [] } },
          { id: "c1", enabled: true, name: "Zimní", method: "code", codes: ["ZIMA"], value: { kind: "fixed", amount: { CZK: 5000 } }, target: { kind: "collections", ids: [C5] } },
          { id: "o1", enabled: true, name: "Objednávka", method: "automatic", value: { kind: "percentage", percent: 10 }, target: { kind: "order" } },
          { id: "p2", enabled: false, name: "Vypnutá", method: "automatic", value: { kind: "percentage", percent: 5 }, target: { kind: "products", productIds: [P1], variantIds: [] } },
        ],
      },
    },
  }));
  const data = await loadTiersScreen(ctxFor(storeFor()), { scopes: SCOPES });
  assert.equal(data.marginOn, true);
  assert.equal(data.competingRules, 2);
});

test("an empty whole-store set is not stored; a value kept for a market that is off stays (§14a); F12 on the tiers only", async () => {
  const st = storeFor();
  const ctx = ctxFor(st);
  await store((c) => ({
    ...c,
    markets: [
      { handle: "cz", currency: "CZK", enabled: true },
      { handle: "hu", currency: "HUF", enabled: false },
    ],
    modules: { ...c.modules, tiers: { sets: [{ id: "global", scope: "global", countAcross: "line", breaks: [{ minQty: 3, amountOff: { CZK: 1000, HUF: 30000 } }] }] } },
  }));
  const version = (await loadConfig(db.prisma, shop)).version!;
  // The page posts the kept HUF value as a hidden field; the server reads it because the config holds it.
  const kept = await tiersAction(
    ctx,
    formOf([
      [F.intent, "save"],
      [F.configVersion, version],
      [F.set, "global"],
      [F.scope("global"), "global"],
      [F.count("global"), "line"],
      [F.row("global"), "r0"],
      [F.kind("global"), "amount"],
      [F.min("global", "r0"), "4"],
      [F.amount("global", "r0", "CZK"), "12"],
      [F.amount("global", "r0", "HUF"), "300"],
    ]),
  );
  assert.equal(kept.ok, true, JSON.stringify(kept));
  await syncIdle(shop);
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.modules.tiers.sets[0]!.breaks, [{ minQty: 4, amountOff: { CZK: 1200, HUF: 30000 } }]);

  // Another tab changed the tiers → base_changed; the rules → applied on top.
  const v2 = (await loadConfig(db.prisma, shop)).version;
  await store((c) => ({ ...c, modules: { ...c.modules, tiers: { sets: [{ ...c.modules.tiers.sets[0]!, countAcross: "product" }] } } }));
  assert.deepEqual(await saveTiers(ctx, [GLOBAL], { configVersion: v2 }), { ok: false, reason: "base_changed" });
  const v3 = (await loadConfig(db.prisma, shop)).version;
  await store((c) => ({ ...c, onboarding: { goals: ["tiers"], step: 2 } }));
  const onTop = await saveTiers(ctx, [{ ...GLOBAL, breaks: [] }], { configVersion: v3 });
  assert.equal(onTop.ok, true, JSON.stringify(onTop));
  await syncIdle(shop);
  const after = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(after.modules.tiers.sets, [], "a whole-store set without tiers is not stored");
  assert.deepEqual(after.onboarding.goals, ["tiers"]);
});

test("Přehled card: the whole-store set and the Pro sets IN FORCE on the plan (§17c), the table's state", async () => {
  const st = storeFor({ block: false });
  await store((c) => ({
    ...c,
    modules: {
      ...c.modules,
      tiers: {
        sets: [
          { id: "global", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10 }] },
          { id: "t_scoped", scope: { collectionIds: [C5] }, countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] },
        ],
      },
    },
  }));
  const loaded = await loadConfig(db.prisma, shop);
  const free = await loadTiersOverview(ctxFor(st, "free"), loaded, { scopes: SCOPES });
  assert.equal(free.sets, 0, "Free runs no Pro set");
  assert.deepEqual(free.global?.breaks, [{ minQty: 3, kind: "percent", percent: 10, amount: {} }]);
  assert.equal(free.block.state, "off");
  const pro = await loadTiersOverview(ctxFor(st, "pro"), loaded, { scopes: SCOPES });
  assert.equal(pro.sets, 1);

  // Přehled carries the card (AdminSignals.tiers).
  const { options } = await overviewData(ctxFor(st, "free"), { scopes: SCOPES });
  assert.equal(options.signals.tiers?.global?.id, "global");
  await syncIdle(shop);
});

// --- Vyzkoušet košík (the engine's tiers in the explanation) --------------------------------------------------

test("Vyzkoušet košík: the tier on the line (tagged, no raw id), the engine's own sentences, and a Pro set through the product's tierRef (K1/K3)", async () => {
  const { parseProductRefs, planTryCart } = await import("../../app/lib/integration/try-cart-plan.ts");
  const { readStoredConfig } = await import("@won/core/discounts/config");
  assert.deepEqual(parseProductRefs(JSON.stringify({ ruleIds: [], tierRef: "t_scoped" })).tierRef, "t_scoped");
  assert.equal(parseProductRefs(JSON.stringify({ ruleIds: [], tierRef: 7 })).tierRef, undefined);
  const config = readStoredConfig({
    modules: {
      tiers: {
        sets: [
          { id: "global", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10 }, { minQty: 5, percent: 15 }] },
          { id: "t_scoped", scope: { productIds: [P1] }, countAcross: "line", breaks: [{ minQty: 2, percent: 30 }] },
        ],
      },
    },
  });
  const plan = planTryCart(config, {
    lines: [
      { variantId: "gid://shopify/ProductVariant/11", productId: P1, title: "Mikina Won", quantity: 2, unitPrice: 1000_00, collectionIds: [] },
      { variantId: "gid://shopify/ProductVariant/21", productId: "gid://shopify/Product/2", title: "Čepice", quantity: 4, unitPrice: 200_00, collectionIds: [] },
    ],
    currency: "CZK",
    countryCode: "CZ",
    codes: [],
    date: "2026-09-30",
    time: "12:00:00",
    shopTimezone: "Europe/Prague",
    locale: "cs",
    productRefs: new Map([
      [P1, { ruleIds: [], variantRuleIds: {}, tierRef: "t_scoped" }],
      ["gid://shopify/Product/2", { ruleIds: [], variantRuleIds: {} }],
    ]),
  });
  const hoodie = plan.lines.find((l) => l.title === "Mikina Won")!;
  const cap = plan.lines.find((l) => l.title === "Čepice")!;
  assert.equal(hoodie.discount, 2 * 300_00, "the Pro set of the product (tierRef), not the global one");
  assert.equal(hoodie.tier, true);
  assert.equal(cap.discount, Math.round(4 * 200_00 * 0.1), "the global set: 4 items reach 'od 3 ks −10 %'");
  assert.equal(cap.tier, true);
  const text = plan.explain.map((e) => e.text).join(" | ");
  assert.match(text, /Množstevní sleva \(od 3 ks −10\u00a0%\)/, text);
  assert.match(text, /Přidej 1 ks a dostaneš −15\u00a0%/, text);
  assert.doesNotMatch(text, /tier:|t_scoped|\bglobal\b/, "never an id");
});
