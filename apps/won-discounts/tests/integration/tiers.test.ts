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
  // Passed through UNCHANGED (review fix 16): the engine decides — junk is no tier, like checkout.
  assert.equal(parseProductRefs(JSON.stringify({ ruleIds: [], tierRef: 7 })).tierRef, 7);
  assert.equal(parseProductRefs(JSON.stringify({ ruleIds: [] })).tierRef, undefined);
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
  // A junk or empty tierRef gives NO tier (never the global set) — what the function does.
  for (const junk of [7, ""]) {
    const junkPlan = planTryCart(config, {
      lines: [{ variantId: "gid://shopify/ProductVariant/31", productId: "gid://shopify/Product/3", title: "Šála", quantity: 6, unitPrice: 300_00, collectionIds: [] }],
      currency: "CZK",
      countryCode: "CZ",
      codes: [],
      date: "2026-09-30",
      time: "12:00:00",
      shopTimezone: "Europe/Prague",
      locale: "cs",
      productRefs: new Map([["gid://shopify/Product/3", { ruleIds: [], variantRuleIds: {}, tierRef: junk }]]),
    });
    assert.equal(junkPlan.lines[0]!.discount, 0, `tierRef ${JSON.stringify(junk)}`);
  }
  const text = plan.explain.map((e) => e.text).join(" | ");
  assert.match(text, /Množstevní sleva \(od 3 ks −10\u00a0%\)/, text);
  assert.match(text, /Přidej 1 ks a dostaneš −15\u00a0%/, text);
  assert.doesNotMatch(text, /tier:|t_scoped|\bglobal\b/, "never an id");
});

// --- The sync's MVP 3 steps in words (review fix 17) ---------------------------------------------------------

test("sync steps of MVP 3 are worded (cs + en) — never a product GID or a set id", async () => {
  const { stepProblem } = await import("../../app/lib/integration/sync-copy.ts");
  const { t } = await import("../../app/i18n/index.ts");
  const names = new Map<string, string>();
  const say = (step: Parameters<typeof stepProblem>[0], locale: "cs" | "en" = "cs") => {
    const text = stepProblem(step, names);
    return { key: text.key, text: t(locale, text.key, text.params) };
  };
  const write = say({ step: "storefront_config.write", ok: false, detail: "metafieldsSet: Throttled" });
  assert.equal(write.key, "sync.problem.storefrontConfig");
  // Audit P2-4: the site may show older (even higher) tiers until fixed; checkout applies the new ones.
  assert.match(write.text, /Nastavení tabulky na stránce produktu se na web nepropsalo \(metafieldsSet: Throttled\)\. Do opravy může web ukazovat starší \(i vyšší\) úrovně, pokladna platí nové\./);
  assert.equal(say({ step: "storefront_config.verify", ok: false, detail: "differs" }).key, "sync.problem.storefrontConfig");
  const refused = say({ step: "products.tiers", ok: false, detail: "gid://shopify/Product/9 refused", params: { refused: 3 } });
  assert.equal(refused.key, "sync.problem.productsTiersRefused");
  assert.doesNotMatch(refused.text, /gid:\/\//);
  const tiersFailed = say({ step: "products.tiers", ok: false, detail: "gid://shopify/Product/9: boom" }, "en");
  assert.equal(tiersFailed.key, "sync.problem.productsTiers");
  assert.doesNotMatch(tiersFailed.text, /gid:\/\/|boom/);
  const tooLarge = say({ step: "tiers.too_large:t_devautumn", ok: false, detail: "…", params: { collection: "Podzimní kolekce", count: 1 } });
  assert.match(tooLarge.text, /Sada množstevních slev nedosáhne na produkty kolekce „Podzimní kolekce“: vybrané kolekce mají dohromady víc než 10\u00a0000 produktů/);
  assert.doesNotMatch(tooLarge.text, /t_devautumn/);
  assert.equal(say({ step: "tiers.too_large:t_x", ok: false, detail: "", params: { collection: "Zimní", count: 3 } }).key, "sync.problem.tiersTooLargeMany");
  assert.equal(say({ step: "tiers.too_large:t_x", ok: false, detail: "", params: { collection: "", count: 1 } }).key, "sync.problem.tiersTooLargeUntitled");
});

test("Pro (review fix 18): how many products each Pro set reaches, from the index the sync wrote; Free: nothing (BILL-1)", async () => {
  const st = storeFor();
  await store((c) => ({
    ...c,
    modules: { ...c.modules, tiers: { sets: [{ id: "t_scoped", scope: { collectionIds: [C5] }, countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }] } },
  }));
  for (const [i, value] of [
    '{"ruleIds":[],"tierRef":"t_scoped"}',
    '{"ruleIds":[],"tierRef":"t_scoped"}',
    '{"ruleIds":[],"tierRef":"t_other"}',
    '{"ruleIds":["r1"]}',
  ].entries()) {
    await db.prisma.productTargetIndex.create({ data: { shop, productId: `gid://shopify/Product/${100 + i}`, value } });
  }
  const pro = await loadTiersScreen(ctxFor(st, "pro"), { scopes: SCOPES });
  assert.deepEqual(pro.productsWithSets, { t_scoped: 2, t_other: 1 });
  clearSignalCache();
  assert.equal((await loadTiersScreen(ctxFor(st, "free"), { scopes: SCOPES })).productsWithSets, null);
});

test("the preview product is one the whole-store set applies to (review fix 2): products with a Pro tierRef are skipped; none → the labelled sample", async () => {
  const st = storeFor();
  st.overrides.set("WonTiersPreviewProduct", () => ({
    data: {
      shop: { currencyCode: "CZK", currencyFormats: { moneyFormat: null } },
      products: {
        nodes: [
          { id: P1, title: "V Pro sadě", onlineStoreUrl: null, variants: { nodes: [{ price: "100.00" }] }, wonRefs: { value: '{"tierRef":"t_scoped"}' } },
          { id: "gid://shopify/Product/2", title: "Junk ref", onlineStoreUrl: null, variants: { nodes: [{ price: "100.00" }] }, wonRefs: { value: '{"tierRef":7}' } },
        ],
      },
    },
  }));
  const data = await loadTiersScreen(ctxFor(st), { scopes: SCOPES });
  assert.equal(data.preview.product, null, "every product has a tierRef: no real product to show");
  assert.equal(data.outletWithAnything, false);
});

// --- Audit fix (audit-mvp3.md P3-4, P3-2, P2-3) -----------------------------------------------------------------

test("P3-4: on Free a stored Pro set outside the form's grammar (0 %, 3 decimals, non-GID ids) round-trips UNCHANGED — kept by id, never re-parsed", async () => {
  const ctx = ctxFor(storeFor(), "free");
  const odd = {
    id: "t_import",
    scope: { productIds: ["legacy-sku-42", "gid://shopify/Product/1"], collectionIds: ["not-a-gid"] },
    countAcross: "cart" as const,
    breaks: [
      { minQty: 2, percent: 0 },
      { minQty: 4, percent: 12.345 },
    ],
  };
  await store((c) => ({
    ...c,
    modules: { ...c.modules, tiers: { sets: [{ id: "global", scope: "global", countAcross: "product", breaks: [{ minQty: 3, percent: 10 }] }, odd] } },
  }));
  const before = (await loadConfig(db.prisma, shop)).config.modules.tiers.sets[1]!;
  const version = (await loadConfig(db.prisma, shop)).version!;
  // The Free page posts the global set's fields and only the id + "kept" for the Pro set.
  const result = await tiersAction(
    ctx,
    formOf([
      [F.intent, "save"],
      [F.configVersion, version],
      [F.set, "global"],
      [F.scope("global"), "global"],
      [F.count("global"), "product"],
      [F.kind("global"), "percent"],
      [F.row("global"), "r0"],
      [F.min("global", "r0"), "3"],
      [F.percent("global", "r0"), "11"],
      [F.set, "t_import"],
      [F.kept("t_import"), "1"],
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  await syncIdle(shop);
  const sets = (await loadConfig(db.prisma, shop)).config.modules.tiers.sets;
  assert.deepEqual(sets[0]!.breaks, [{ minQty: 3, percent: 11 }], "the edited set saved");
  assert.deepEqual(sets[1], before, "the kept set exactly as stored");
  // A "kept" id the config does not have is a stale or tampered form: refused.
  const tampered = await tiersAction(ctx, formOf([[F.intent, "save"], [F.configVersion, (await loadConfig(db.prisma, shop)).version!], [F.set, "t_ghost"], [F.kept("t_ghost"), "1"]]));
  assert.deepEqual(tampered, { ok: false, reason: "invalid", errors: [{ field: F.set, key: "tiers.error.set" }] });
});

test("P3-2: emptying the first whole-store set keeps it as a set WITHOUT tiers when a dormant second one follows — the second never wakes up", async () => {
  const ctx = ctxFor(storeFor(), "pro");
  await store((c) => ({
    ...c,
    modules: {
      ...c.modules,
      tiers: {
        sets: [
          { id: "global", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10 }] },
          { id: "t_dormant", scope: "global", countAcross: "line", breaks: [{ minQty: 2, percent: 50 }] },
        ],
      },
    },
  }));
  const version = (await loadConfig(db.prisma, shop)).version!;
  const result = await tiersAction(
    ctx,
    formOf([
      [F.intent, "save"],
      [F.configVersion, version],
      [F.set, "global"],
      [F.scope("global"), "global"],
      [F.count("global"), "line"],
      [F.kind("global"), "percent"],
      [F.set, "t_dormant"],
      [F.kept("t_dormant"), "1"],
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  await syncIdle(shop);
  const sets = (await loadConfig(db.prisma, shop)).config.modules.tiers.sets;
  assert.deepEqual(
    sets.map((s) => [s.id, s.breaks.length]),
    [
      ["global", 0],
      ["t_dormant", 1],
    ],
    "the first whole-store set stays (no tiers) ahead of the dormant one",
  );
});

test("P2-3: a Pro set may not pick a collection the sync cannot read (> 10 000 products, or together) — refused with the title; a read failure refuses too", async () => {
  const st = storeFor();
  const sizes = new Map<string, { title: string; count: number; precision: string }>([
    ["gid://shopify/Collection/5", { title: "Zimní", count: 120, precision: "EXACT" }],
    ["gid://shopify/Collection/6", { title: "Celý sklad", count: 10000, precision: "AT_LEAST" }],
    ["gid://shopify/Collection/7", { title: "Velká A", count: 6000, precision: "EXACT" }],
    ["gid://shopify/Collection/8", { title: "Velká B", count: 5000, precision: "EXACT" }],
  ]);
  st.overrides.set("WonTiersCollectionSizes", (variables) => ({
    data: {
      nodes: ((variables.ids as string[]) ?? []).map((id) => {
        const size = sizes.get(id);
        return size ? { __typename: "Collection", id, title: size.title, productsCount: { count: size.count, precision: size.precision } } : null;
      }),
    },
  }));
  const ctx = ctxFor(st, "pro");
  const post = (collections: string[]) =>
    tiersAction(
      ctx,
      formOf([
        [F.intent, "save"],
        [F.set, "t_new"],
        [F.scope("t_new"), "selection"],
        ...collections.map((c): [string, string] => [F.collection("t_new"), c]),
        [F.count("t_new"), "line"],
        [F.kind("t_new"), "percent"],
        [F.row("t_new"), "r0"],
        [F.min("t_new", "r0"), "2"],
        [F.percent("t_new", "r0"), "5"],
      ]),
    );
  assert.deepEqual(await post(["gid://shopify/Collection/6"]), {
    ok: false,
    reason: "invalid",
    errors: [{ field: F.collection("t_new"), key: "tiers.error.collectionTooLarge", params: { collection: "Celý sklad", limit: 10000 } }],
  });
  assert.deepEqual(await post(["gid://shopify/Collection/7", "gid://shopify/Collection/8"]), {
    ok: false,
    reason: "invalid",
    errors: [{ field: F.collection("t_new"), key: "tiers.error.collectionsTooLarge", params: { limit: 10000 } }],
  });
  assert.equal((await loadConfig(db.prisma, shop)).exists, false, "nothing saved");
  st.overrides.set("WonTiersCollectionSizes", () => {
    throw new Error("Throttled");
  });
  assert.deepEqual(await post(["gid://shopify/Collection/5"]), {
    ok: false,
    reason: "invalid",
    errors: [{ field: F.collection("t_new"), key: "tiers.error.collectionSizeUnknown" }],
  });
  st.overrides.delete("WonTiersCollectionSizes");
  st.overrides.set("WonTiersCollectionSizes", (variables) => ({
    data: { nodes: ((variables.ids as string[]) ?? []).map((id) => ({ __typename: "Collection", id, title: "Zimní", productsCount: { count: 120, precision: "EXACT" } })) },
  }));
  const ok = await post(["gid://shopify/Collection/5"]);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  await syncIdle(shop);
});

// --- Audit fix: the tier cap (CONFIG_LIMITS.tierPayloadBytes 550 B) and the new core codes ---------------------

test("the checkout's room for tiers: the admin's measure IS core's (stored and Free-gated, +3 B for a whole-cart set on Free)", async () => {
  const { tierPayloadUse } = await import("../../app/components/model/tiers.ts");
  const { buildShopFunctionConfigWorstCase } = await import("@won/core/discounts/function-payload");
  const { readStoredConfig, CONFIG_LIMITS } = await import("@won/core/discounts/config");
  assert.equal(CONFIG_LIMITS.tierPayloadBytes, 550);
  const cases = [
    [{ id: "global", scope: "global", countAcross: "cart", breaks: [{ minQty: 3, percent: 10 }, { minQty: 5, percent: 15 }] }],
    [
      { id: "global", scope: "global", countAcross: "line", breaks: [{ minQty: 2, amountOff: { CZK: 3000, EUR: 120 } }, { minQty: 6, amountOff: { CZK: 6000, EUR: 250 } }] },
      { id: "t_a", scope: { productIds: [P1] }, countAcross: "cart", breaks: [{ minQty: 2, percent: 5 }] },
      { id: "t_b", scope: { collectionIds: [C5] }, countAcross: "product", breaks: [] },
    ],
    [],
  ];
  for (const sets of cases) {
    const config = readStoredConfig({ modules: { tiers: { sets } } });
    const core = buildShopFunctionConfigWorstCase(config).tiers;
    const ours = tierPayloadUse(config.modules.tiers.sets);
    assert.equal(ours.bytes, core.bytes, JSON.stringify(sets));
    assert.equal(ours.budget, core.budget);
    assert.equal(ours.fits, core.fits);
  }
});

test("a save over the room for tiers is refused with what to do (a share of the room, never bytes); nothing saved", async () => {
  const ctx = ctxFor(storeFor(), "free");
  const entries: [string, string][] = [
    [F.intent, "save"],
    [F.set, "global"],
    [F.scope("global"), "global"],
    [F.count("global"), "line"],
    [F.kind("global"), "amount"],
  ];
  // 10 amount breaks in 8 currencies: far over 550 B.
  const currencies = ["CZK", "EUR", "HUF", "PLN", "USD", "GBP", "SEK", "DKK"];
  await store((c) => ({ ...c, markets: currencies.map((currency, i) => ({ handle: `m${i}`, currency, enabled: true })) }));
  const version = (await loadConfig(db.prisma, shop)).version!;
  entries.push([F.configVersion, version]);
  for (let i = 0; i < 10; i += 1) {
    entries.push([F.row("global"), `r${i}`], [F.min("global", `r${i}`), String(i + 2)]);
    for (const c of currencies) entries.push([F.amount("global", `r${i}`, c), String(1000 + i * 100)]);
  }
  const refused = await tiersAction(ctx, formOf(entries));
  assert.equal(refused.ok, false);
  assert.ok(!refused.ok && refused.reason === "invalid");
  const error = !refused.ok && refused.reason === "invalid" ? refused.errors[0]! : null;
  assert.equal(error?.field, F.set);
  assert.equal(error?.key, "tiers.error.tooLarge");
  assert.ok(typeof error?.params?.percent === "number" && error.params.percent > 100, JSON.stringify(error));
  const { t } = await import("../../app/i18n/index.ts");
  const sentence = t("cs", error!.key, error!.params);
  assert.match(sentence, /Úrovně by se do pokladny nevešly \(zabraly by \d+\u00a0% místa/);
  assert.doesNotMatch(sentence, /\bB\b|bajt|byte/i, "no bytes jargon");
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.modules.tiers.sets, [], "nothing saved");
});

test("the sync's over-cap refusal and the new core issue codes are worded (cs + en)", async () => {
  const { stepProblem } = await import("../../app/lib/integration/sync-copy.ts");
  const { wordIssues } = await import("../../app/lib/integration/issue-copy.ts");
  const { sanitizeConfig } = await import("@won/core/discounts/config");
  const { t } = await import("../../app/i18n/index.ts");
  const names = new Map<string, string>();
  const over = stepProblem({ step: "shop_config.build", ok: false, detail: "tiers 612 B over 550 B", params: { tiersBytes: 612, tiersBudget: 550 } }, names);
  assert.equal(over.key, "sync.problem.tiersOverCapPercent");
  assert.equal(t("cs", over.key, over.params), "Množstevní slevy se do pokladny nevejdou (zabraly by 112\u00a0% místa), nic se nezapsalo a platí předchozí nastavení. V Množstevních slevách odeber sadu nebo úroveň.");
  assert.equal(stepProblem({ step: "shop_config.build", ok: false, detail: "the quantity tiers are over their cap" }, names).key, "sync.problem.tiersOverCap");
  assert.equal(stepProblem({ step: "shop_config.build", ok: false, detail: "9500 B over the 9000 B budget" }, names).key, "sync.problem.tooLarge");

  const { issues } = sanitizeConfig({
    modules: {
      tiers: { sets: [{ id: "t_x", scope: 5, countAcross: "line", breaks: [{ minQty: 2, percent: 5 }] }] },
      margin: {
        enabled: true,
        global: { maxDiscountPercent: 40 },
        perCollection: Array.from({ length: 52 }, (_, i) => ({ collectionId: `gid://shopify/Collection/${i + 1}`, maxDiscountPercent: i === 51 ? 5 : 30 })),
      },
    },
  });
  const cs = wordIssues(issues, "cs", (m) => assert.fail(`unworded: ${m}`));
  assert.ok(cs.includes("Sada úrovní neměla platný rozsah. Uložila se jako sada bez vybraných produktů, takže se na nic neuplatní."), cs.join(" | "));
  assert.ok(cs.some((x) => /Vlastní nastavení marže může mít nejvýš 50 kolekcí\. Zbývající kolekce \(2\) jsme sloučili do nastavení pro celý obchod, platí to přísnější: min\. marže 0\u00a0%, bez nákupní ceny sleva nejvýš 5\u00a0%\./.test(x)), cs.join(" | "));
  assert.ok(wordIssues(issues, "en", () => assert.fail("unworded")).every((x) => !/t_x|gid:\/\//.test(x)));
});
