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

test("load: the stored look (default on a new shop), the theme's tokens, the table's state, a real product, no set yet → an example", async () => {
  const store = storeWithTheme();
  const data = await loadAppearanceScreen(ctxFor(store), { scopes: "write_discounts,read_themes" });
  assert.equal(data.plan, "free");
  assert.equal(data.configVersion, null);
  assert.equal(data.preset, "default");
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

test("load: the global set is the sample; an unknown stored look reads as the default (K7)", async () => {
  const store = storeWithTheme();
  const base = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, {
    ...base,
    modules: { ...base.modules, tiers: { sets: [{ id: "global", scope: "global", countAcross: "line", breaks: [{ minQty: 3, percent: 10 }] }] } },
  });
  const data = await loadAppearanceScreen(ctxFor(store), { scopes: "read_themes" });
  assert.deepEqual(data.sample?.breaks, [{ minQty: 3, kind: "percent", percent: 10, amount: {} }]);
  assert.equal(data.preset, "default");
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
