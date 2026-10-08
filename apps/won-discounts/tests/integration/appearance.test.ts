import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import { appearanceAction, loadAppearanceScreen, saveAppearance } from "../../app/lib/integration/appearance.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { createSync, syncIdle } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, formOf, quiet, testCtx } from "./helpers.ts";

// Vzhled (MVP 3, K7): one of the four ready-made looks, saved like every admin
// change (lock, F12, unreadable guard, saveAndSync); the page shows each look on
// the shop's own theme tokens, the saved set (or an example) and a real product.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-appearance");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `appearance-${seq}.myshopify.com`;
  clearSignalCache();
});

function ctxFor(store: FakeStore): ShopCtx {
  return {
    ...testCtx(db.prisma, shop, store),
    createSync: (client: AdminClient, prisma: PrismaClient) =>
      createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => "free" }),
    lockWaitMs: 200,
  };
}

const SETTINGS = JSON.stringify({ current: { type_body_font: "assistant_n4", inputs_radius: 6, color_schemes: { "scheme-1": { settings: { background: "#ffffff", text: "#121212" } } } } });

function storeWithTheme(): FakeStore {
  const store = new FakeStore();
  store.overrides.set("WonTiersThemeLook", () => ({
    data: {
      themes: {
        nodes: [
          {
            id: "gid://shopify/OnlineStoreTheme/1",
            name: "Dawn",
            files: { nodes: [{ filename: "config/settings_data.json", body: { content: SETTINGS } }, { filename: "templates/product.json", body: { content: '{"sections":{"main":{"type":"main-product","blocks":{}}}}' } }] },
          },
        ],
      },
    },
  }));
  store.overrides.set("WonTiersPreviewProduct", () => ({
    data: {
      shop: { currencyCode: "CZK", currencyFormats: { moneyFormat: "{{amount_with_comma_separator}} Kč" } },
      products: { nodes: [{ id: "gid://shopify/Product/7", title: "Mikina Won", handle: "mikina", onlineStoreUrl: "https://won.example/products/mikina", variants: { nodes: [{ price: "790.00" }] } }] },
    },
  }));
  return store;
}

test("load: the stored look (highlight on a new shop), the theme's tokens, the table's state, a real product, no set yet → an example", async () => {
  const store = storeWithTheme();
  const data = await loadAppearanceScreen(ctxFor(store), { scopes: "write_discounts,read_themes" });
  assert.equal(data.plan, "free");
  assert.equal(data.configVersion, null);
  assert.equal(data.preset, "highlight");
  assert.equal(data.tokens?.themeName, "Dawn");
  assert.equal(data.tokens?.radius, 6);
  assert.deepEqual(data.block, {
    state: "off",
    addUrl: `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=won-discounts-test-key/quantity_tiers&target=mainSection`,
  });
  assert.equal(data.sample, null);
  assert.deepEqual(data.product, {
    productId: "gid://shopify/Product/7",
    title: "Mikina Won",
    unitPrice: 79000,
    currency: "CZK",
    url: "https://won.example/products/mikina",
    moneyFormat: "{{amount_with_comma_separator}} Kč",
  });
  assert.equal(data.embed.state, "unknown", "the fake has no themes for the embed check");
});

test("load: the global set is the sample; a shop that never chose a look has the new-shop one (highlight)", async () => {
  const store = storeWithTheme();
  const base = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, {
    ...base,
    modules: { ...base.modules, tiers: { sets: [{ id: "global", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10 }] }] } },
  });
  const data = await loadAppearanceScreen(ctxFor(store), { scopes: "read_themes" });
  assert.deepEqual(data.sample?.breaks, [{ minQty: 3, kind: "percent", percent: 10, amount: {} }]);
  assert.equal(data.preset, "highlight");
});

test("save: a preset goes into the config (storefront.appearancePreset); a value that is not one of the four is refused", async () => {
  const store = storeWithTheme();
  const ctx = ctxFor(store);
  const saved = await saveAppearance(ctx, "chips", { configVersion: null });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  await syncIdle(shop);
  assert.equal((await loadConfig(db.prisma, shop)).config.storefront.appearancePreset, "chips");
  const version = (await loadConfig(db.prisma, shop)).version!;
  const refused = await appearanceAction(ctx, formOf([["intent", "save"], ["configVersion", version], ["preset", "neon"]]));
  assert.deepEqual(refused, { ok: false, reason: "invalid", errors: [{ field: "preset", key: "appearance.error.preset" }] });
  assert.equal((await loadConfig(db.prisma, shop)).config.storefront.appearancePreset, "chips", "nothing saved");
  const tiles = await appearanceAction(ctx, formOf([["intent", "save"], ["configVersion", version], ["preset", "tiles"]]));
  assert.equal(tiles.ok, true, JSON.stringify(tiles));
  await syncIdle(shop);
  assert.equal((await loadConfig(db.prisma, shop)).config.storefront.appearancePreset, "tiles");
  assert.deepEqual(await appearanceAction(ctx, formOf([["intent", "delete"]])), { ok: false, reason: "bad_request" });
});

test("F12: the look changed in another tab meanwhile → base_changed, nothing overwritten", async () => {
  const store = storeWithTheme();
  const ctx = ctxFor(store);
  await saveAppearance(ctx, "highlight", { configVersion: null });
  await syncIdle(shop);
  const version = (await loadConfig(db.prisma, shop)).version;
  const other = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, { ...other, storefront: { ...other.storefront, appearancePreset: "tiles" } });
  assert.deepEqual(await saveAppearance(ctx, "chips", { configVersion: version }), { ok: false, reason: "base_changed" });
  assert.equal((await loadConfig(db.prisma, shop)).config.storefront.appearancePreset, "tiles");
});

test("BILL-1 (review fix 2): a downgraded Free shop's inert Pro set is never the looks' sample; the product shown gets the set shown", async () => {
  const store = storeWithTheme();
  // Two recent products: the first carries a Pro tierRef (its own set / no tier) → never the whole-store preview product.
  store.overrides.set("WonTiersPreviewProduct", () => ({
    data: {
      shop: { currencyCode: "CZK", currencyFormats: { moneyFormat: "{{amount}} Kč" } },
      products: {
        nodes: [
          { id: "gid://shopify/Product/8", title: "Mikina v Pro sadě", onlineStoreUrl: "https://won.example/products/a", variants: { nodes: [{ price: "500.00" }] }, wonRefs: { value: '{"ruleIds":[],"tierRef":"t_pro"}' } },
          { id: "gid://shopify/Product/9", title: "Čepice", onlineStoreUrl: "https://won.example/products/b", variants: { nodes: [{ price: "300.00" }] }, wonRefs: { value: '{"ruleIds":["r1"]}' } },
        ],
      },
    },
  }));
  const base = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, {
    ...base,
    modules: { ...base.modules, tiers: { sets: [{ id: "t_pro", scope: { productIds: ["gid://shopify/Product/8"] }, countAcross: "line", breaks: [{ minQty: 2, percent: 30 }] }] } },
  });
  const free = await loadAppearanceScreen(ctxFor(store), { scopes: "read_themes" });
  assert.equal(free.sample, null, "on Free the Pro set is inert: the looks show the labelled example");
  assert.equal(free.product?.title, "Čepice", "a product without a Pro tierRef — it would get the whole-store set");
});

// --- MVP 7 (contracts M7, M8): the custom look (Pro), card prices (BETA), storefront texts ---------------------

function proCtx(store: FakeStore): ShopCtx {
  return { ...ctxFor(store), createSync: (client: AdminClient, prisma: PrismaClient) => createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => "pro" }) };
}
const extras = (version: string | null, more: [string, string][]): [string, string][] => [["intent", "save"], ["configVersion", version ?? ""], ["preset", "chips"], ["extras", "1"], ...more];

test("MVP 7 save (Pro): card prices and the custom look are stored and reach the storefront config — the CSS scoped under the block roots", async () => {
  const store = storeWithTheme();
  const ctx = proCtx(store);
  const version = (await loadAppearanceScreen(ctx, { scopes: "read_themes" })).configVersion;
  const r = await appearanceAction(
    ctx,
    formOf(
      extras(version, [
        ["cardPrices", "on"],
        ["look.accent", "#0A7D4F"],
        ["look.radius", "4"],
        ["look.css", ".won-tiers__row { font-weight: 700 }"],
        // The texts are the Překlady page's: a text field posted here is not taken.
        ["tx.cs.tiers.heading", "Kup víc, plať míň"],
      ]),
    ),
  );
  assert.ok(r.ok, JSON.stringify(r));
  const stored = (await loadConfig(db.prisma, shop)).config;
  assert.equal(stored.storefront.cardPricesEnabled, true);
  assert.deepEqual(stored.storefront.custom, { vars: { accent: "#0a7d4f", radius: 4 }, css: ".won-tiers__row { font-weight: 700 }" });
  assert.deepEqual(stored.locales, {}, "Vzhled saves no text");
  const live = store.sync.storefrontConfig() as { cards?: number; appearance: { preset: string; css?: string } };
  assert.equal(live.cards, 1);
  assert.equal(live.appearance.preset, "chips");
  assert.match(live.appearance.css ?? "", /^:is\(\.won-tiers,\.won-cart,\.won-cart-slot,\.won-outlet,\.won-progress,\.won-campaign,\.won-topbar\)\{--won-tiers-accent:#0a7d4f;--won-tiers-radius:4px\}:is\([^)]*\) \.won-tiers__row\{font-weight: 700\}$/);
  assert.deepEqual(store.sync.storefrontTexts(), {});

  const screen = await loadAppearanceScreen(ctx, { scopes: "read_themes" });
  assert.equal(screen.cardPrices, true);
  assert.deepEqual(screen.custom, { accent: "#0a7d4f", line: "", tint: "", radius: "4", css: ".won-tiers__row { font-weight: 700 }" });
  assert.match(screen.aiPrompt, /--won-tiers-accent/);
  assert.match(screen.aiPrompt, /\.won-tiers__row/);
});

test("MVP 7 save (Free): the custom look fields are not taken (BILL-1) and a stored look is kept as it is; card prices save on any plan", async () => {
  const store = storeWithTheme();
  const base = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, { ...base, storefront: { ...base.storefront, custom: { vars: { accent: "#111111" }, css: "" } } });
  const ctx = ctxFor(store);
  const version = (await loadAppearanceScreen(ctx, { scopes: "read_themes" })).configVersion;
  const r = await appearanceAction(ctx, formOf(extras(version, [["cardPrices", "on"], ["look.accent", "#ff0000"], ["look.css", ".a{b:c}"]])));
  assert.ok(r.ok, JSON.stringify(r));
  const stored = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(stored.storefront.custom, { vars: { accent: "#111111" }, css: "" }, "the Pro setup stays saved, untouched");
  assert.equal(stored.storefront.cardPricesEnabled, true);
  const live = store.sync.storefrontConfig() as { appearance: { css?: string }; cards?: number };
  assert.equal(live.appearance.css, undefined, "Free ships no custom look");
  assert.equal(live.cards, 1);
});

test("MVP 7 save: a colour that is not #rgb / #rrggbb, a radius out of range and CSS that cannot be scoped are refused on their fields; nothing is saved", async () => {
  const store = storeWithTheme();
  const ctx = proCtx(store);
  const version = (await loadAppearanceScreen(ctx, { scopes: "read_themes" })).configVersion;
  const errors = async (more: [string, string][]) => {
    const r = await appearanceAction(ctx, formOf(extras(version, more)));
    return !r.ok && r.reason === "invalid" ? r.errors : r;
  };
  assert.deepEqual(await errors([["look.accent", "red"]]), [{ field: "look.accent", key: "appearance.error.color" }]);
  assert.deepEqual(await errors([["look.radius", "99"]]), [{ field: "look.radius", key: "appearance.error.radius", params: { max: 32 } }]);
  assert.deepEqual(await errors([["look.css", ".a{background:url(https://x)}"]]), [{ field: "look.css", key: "appearance.error.css.forbidden", params: { detail: "url(" } }]);
  assert.deepEqual(await errors([["look.css", ".a{b:c"]]), [{ field: "look.css", key: "appearance.error.css.unbalanced", params: { detail: "" } }]);
  const stored = (await loadConfig(db.prisma, shop)).config;
  assert.equal(stored.storefront.custom, undefined);
  assert.equal(stored.storefront.appearancePreset, "highlight");
});

test("MVP 7 save: a storefront config over Shopify's metafield limit is refused before the save (not left to a failed sync step)", async () => {
  const store = storeWithTheme();
  const ctx = proCtx(store);
  const version = (await loadAppearanceScreen(ctx, { scopes: "read_themes" })).configVersion;
  const r = await appearanceAction(ctx, formOf(extras(version, [["look.css", ".won-tiers__row { font-weight: 700 }"]])), { maxStorefrontBytes: 100 });
  assert.ok(!r.ok && r.reason === "invalid", JSON.stringify(r));
  assert.equal(r.errors![0]!.key, "appearance.error.tooLarge");
  assert.equal((await loadConfig(db.prisma, shop)).config.storefront.custom, undefined);
});

test("MVP 7: a form without the extras marker (an older client) changes the look only", async () => {
  const store = storeWithTheme();
  const base = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, { ...base, storefront: { ...base.storefront, cardPricesEnabled: true }, locales: { ...base.locales, cs: { "tiers.heading": "A" } } });
  const ctx = proCtx(store);
  const version = (await loadAppearanceScreen(ctx, { scopes: "read_themes" })).configVersion;
  assert.ok((await appearanceAction(ctx, formOf([["intent", "save"], ["configVersion", version ?? ""], ["preset", "tiles"]]))).ok);
  const stored = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual({ preset: stored.storefront.appearancePreset, cards: stored.storefront.cardPricesEnabled, cs: stored.locales.cs }, { preset: "tiles", cards: true, cs: { "tiers.heading": "A" } });
});
