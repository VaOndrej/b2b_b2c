import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  parseThemeJson,
  readThemeLook,
  storefrontSyncViewOf,
  blockSpotIn,
  themePlacementsIn,
  themeTokensFrom,
  tiersBlockIn,
} from "../../app/lib/integration/themes.server.ts";
import { editorOpenUrl, spotAdvice } from "../../app/components/model/embed.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { FakeStore } from "./helpers.ts";

// The live theme as the admin preview needs it (MVP 3, C5 fallback): the MAIN
// theme's config/settings_data.json → ThemeTokensView (Horizon: color palette +
// Liquid references; Dawn: color schemes), templates/product*.json → is the
// quantity_tiers app block there (Horizon nests blocks inside blocks), and the
// storefront config metafield's `cv` against the config version (K5).
// Fixtures are excerpts of the real Horizon / Dawn files (tmp/e2e-themes, the
// themes the live E2E runs on), header comment included.

const HEADER = `/*\n * ------------------------------------------------------------\n * IMPORTANT: The contents of this file are auto-generated.\n * ------------------------------------------------------------\n */\n`;

const HORIZON_SETTINGS =
  HEADER +
  JSON.stringify({
    current: {
      page_text_color: "{{ settings.color_palette.foreground }}",
      type_body_font: "inter_n4",
      type_heading_font: "inter_n7",
      type_size_paragraph: "14",
      page_background_color: "{{ settings.color_palette.background }}",
      button_border_radius_primary: 14,
      inputs_border_radius: 4,
      color_palette: { background: "#ffffff", foreground: "#000000" },
    },
    presets: { Horizon: {} },
  });

const DAWN_SETTINGS =
  HEADER +
  JSON.stringify({
    current: {
      type_header_font: "assistant_n4",
      type_body_font: "assistant_n4",
      body_scale: 100,
      buttons_radius: 0,
      inputs_radius: 0,
      color_schemes: {
        "scheme-1": { settings: { background: "#ffffff", text: "#121212", button: "#121212", button_label: "#ffffff" } },
        "scheme-2": { settings: { background: "#f3f3f3", text: "#121212" } },
      },
    },
  });

const APP_BLOCK = "shopify://apps/won-discounts/blocks/quantity_tiers/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

const HORIZON_PRODUCT =
  HEADER +
  JSON.stringify({
    sections: {
      main: {
        type: "product-information",
        blocks: {
          "product-details": {
            type: "_product-details",
            blocks: {
              group: { type: "group", blocks: { tiers_abc: { type: APP_BLOCK, settings: { accent: "#c0392b" } } } },
            },
          },
        },
      },
    },
    order: ["main"],
  });

const DAWN_PRODUCT = JSON.stringify({
  sections: {
    main: {
      type: "main-product",
      blocks: { title: { type: "title" }, tiers: { type: APP_BLOCK, settings: { accent: "" } } },
      block_order: ["title", "tiers"],
      settings: { color_scheme: "scheme-2" },
    },
  },
  order: ["main"],
});

test("parseThemeJson: Shopify's generated header comment is not JSON — stripped; junk → null", () => {
  assert.deepEqual(parseThemeJson(`${HEADER}{"a":1}`), { a: 1 });
  assert.equal(parseThemeJson("{nope"), null);
  assert.equal(parseThemeJson(""), null);
});

test("Horizon: fonts from the font handles, colors through the Liquid references to the palette, the input radius, paragraph size", () => {
  assert.deepEqual(themeTokensFrom({ themeName: "Horizon", settingsData: HORIZON_SETTINGS }), {
    themeName: "Horizon",
    fontBody: "Inter",
    fontHeading: "Inter",
    colorText: "#000000",
    colorBackground: "#ffffff",
    colorAccent: null,
    radius: 4,
    fontSize: 14,
  });
});

test("Dawn: colors of the product section's color scheme (the first scheme when the template names none)", () => {
  assert.deepEqual(themeTokensFrom({ themeName: "Dawn", settingsData: DAWN_SETTINGS, productTemplate: DAWN_PRODUCT }), {
    themeName: "Dawn",
    fontBody: "Assistant",
    fontHeading: "Assistant",
    colorText: "#121212",
    colorBackground: "#f3f3f3",
    colorAccent: null,
    radius: 0,
    fontSize: 16,
  });
  assert.equal(themeTokensFrom({ themeName: "Dawn", settingsData: DAWN_SETTINGS })?.colorBackground, "#ffffff");
});

test("tokens: the block's own accent (the only accent the storefront CSS uses); unsafe values never reach a style", () => {
  const tokens = themeTokensFrom({ themeName: "Horizon", settingsData: HORIZON_SETTINGS, blockAccent: "#c0392b" });
  assert.equal(tokens?.colorAccent, "#c0392b");
  const hostile = HEADER + JSON.stringify({ current: { type_body_font: "x;}</style>_n4", color_palette: { background: "red;background:url(x)", foreground: "#000" }, page_text_color: "{{ settings.color_palette.foreground }}" } });
  const t = themeTokensFrom({ themeName: "X", settingsData: hostile, blockAccent: "expression(alert(1))" });
  assert.equal(t?.fontBody, null);
  assert.equal(t?.colorBackground, null);
  assert.equal(t?.colorAccent, null);
  assert.equal(t?.colorText, "#000");
  assert.equal(themeTokensFrom({ themeName: "X", settingsData: "not json" }), null);
  // `current` as a preset name (a theme never customised) reads the preset.
  const preset = HEADER + JSON.stringify({ current: "Dawn", presets: { Dawn: { type_body_font: "assistant_n4", inputs_radius: 6 } } });
  assert.equal(themeTokensFrom({ themeName: "Dawn", settingsData: preset })?.radius, 6);
});

test("the quantity_tiers block in a product template, nested (Horizon) or in the section (Dawn); disabled = not there", () => {
  assert.deepEqual(tiersBlockIn([{ filename: "templates/product.json", content: HORIZON_PRODUCT }]), { on: true, accent: "#c0392b", template: "templates/product.json", alternates: [] });
  assert.deepEqual(tiersBlockIn([{ filename: "templates/product.json", content: DAWN_PRODUCT }]), { on: true, accent: null, template: "templates/product.json", alternates: [] });
  const disabled = DAWN_PRODUCT.replace('"settings":{"accent":""}', '"settings":{"accent":""},"disabled":true');
  assert.deepEqual(tiersBlockIn([{ filename: "templates/product.json", content: disabled }]), { on: false, accent: null, template: null, alternates: [] });
  const sectionOff = DAWN_PRODUCT.replace('"type":"main-product"', '"type":"main-product","disabled":true');
  assert.equal(tiersBlockIn([{ filename: "templates/product.json", content: sectionOff }]).on, false);
  const other = DAWN_PRODUCT.replace("/blocks/quantity_tiers/", "/blocks/reviews/");
  assert.equal(tiersBlockIn([{ filename: "templates/product.json", content: other }]).on, false);
  // Audit P3-8: "on the product page" = templates/product.json (what most products use); an alternate template
  // with the block is listed by name, on its own it is NOT "on".
  assert.deepEqual(tiersBlockIn([{ filename: "templates/product.json", content: other }, { filename: "templates/product.bundle.json", content: DAWN_PRODUCT }]), {
    on: false,
    accent: null,
    template: "templates/product.bundle.json",
    alternates: ["product.bundle"],
  });
  assert.deepEqual(tiersBlockIn([{ filename: "templates/product.json", content: HORIZON_PRODUCT }, { filename: "templates/product.gift.json", content: DAWN_PRODUCT }]).alternates, ["product.gift"]);
});

test("storefront config state (K5): missing / synced (cv = the config version) / pending / failed with the sync's problems", () => {
  const ok = { state: "ok" as const, at: "2026-09-30T10:00:00" };
  const failed = { state: "error" as const, at: "2026-09-30T11:00:00", problems: [{ key: "sync.problem.tooLarge" as const }] };
  assert.deepEqual(storefrontSyncViewOf({ metafield: null, configVersion: "v1", sync: ok, timezone: "Europe/Prague" }), { state: "missing" });
  assert.deepEqual(storefrontSyncViewOf({ metafield: { cv: "v1", updatedAt: "2026-09-30T08:15:00Z" }, configVersion: "v1", sync: ok, timezone: "Europe/Prague" }), {
    state: "synced",
    at: "2026-09-30T10:15:00",
  });
  assert.deepEqual(storefrontSyncViewOf({ metafield: { cv: "v0", updatedAt: "2026-09-30T08:15:00Z" }, configVersion: "v1", sync: ok, timezone: "Europe/Prague" }), { state: "pending" });
  assert.deepEqual(storefrontSyncViewOf({ metafield: { cv: "v0", updatedAt: null }, configVersion: "v1", sync: failed, timezone: null }), {
    state: "failed",
    at: "2026-09-30T11:00:00",
    problems: [{ key: "sync.problem.tooLarge" }],
    previous: true,
  });
  // Never written and the last sync failed: it failed (it is not "nothing saved yet") — and there is NO previous table (fix 7).
  assert.deepEqual(storefrontSyncViewOf({ metafield: null, configVersion: "v1", sync: failed, timezone: null }), {
    state: "failed",
    at: "2026-09-30T11:00:00",
    problems: [{ key: "sync.problem.tooLarge" }],
    previous: false,
  });
  // Current even after a failed later run of something else: synced.
  assert.equal(storefrontSyncViewOf({ metafield: { cv: "v1", updatedAt: "2026-09-30T08:15:00Z" }, configVersion: "v1", sync: failed, timezone: "UTC" }).state, "synced");
});

// --- Reading Shopify -------------------------------------------------------------------------------------

beforeEach(() => clearSignalCache());

function themeStore(files: { filename: string; content: string }[], name = "Horizon"): FakeStore {
  const store = new FakeStore();
  store.overrides.set("WonTiersThemeLook", () => ({
    data: { themes: { nodes: [{ id: "gid://shopify/OnlineStoreTheme/1", name, files: { nodes: files.map((f) => ({ filename: f.filename, body: { content: f.content } })) } }] } },
  }));
  return store;
}

test("readThemeLook: one read of the MAIN theme → tokens + block; cached per shop (60 s) like the embed check", async () => {
  const store = themeStore([
    { filename: "config/settings_data.json", content: HORIZON_SETTINGS },
    { filename: "templates/product.json", content: HORIZON_PRODUCT },
  ]);
  const ctx = { shop: "look-1.myshopify.com", client: store, apiKey: "key-1" };
  const look = await readThemeLook(ctx, { scopes: "write_discounts,read_themes" });
  assert.deepEqual(look.block, { state: "on", themeName: "Horizon", openUrl: "https://look-1.myshopify.com/admin/themes/current/editor?template=product" });
  assert.equal(look.tokens?.colorAccent, "#c0392b");
  assert.equal(look.tokens?.fontBody, "Inter");
  await readThemeLook(ctx, { scopes: "write_discounts,read_themes" });
  assert.equal(store.ops.filter((op) => op === "WonTiersThemeLook").length, 1, "second read within 60 s from the cache");
  await readThemeLook(ctx, { scopes: "write_discounts,read_themes", fresh: true });
  assert.equal(store.ops.filter((op) => op === "WonTiersThemeLook").length, 2, "fresh bypasses the cache");
});

test("readThemeLook: no block → off with the deep link; no read_themes → no_scope and nothing read; Shopify down → unknown", async () => {
  const off = themeStore(
    [
      { filename: "config/settings_data.json", content: DAWN_SETTINGS },
      { filename: "templates/product.json", content: DAWN_PRODUCT.replace("/blocks/quantity_tiers/", "/blocks/reviews/") },
    ],
    "Dawn",
  );
  const look = await readThemeLook({ shop: "look-2.myshopify.com", client: off, apiKey: "key-2" }, { scopes: "read_themes" });
  assert.deepEqual(look.block, {
    state: "off",
    addUrl: "https://look-2.myshopify.com/admin/themes/current/editor?template=product&addAppBlockId=key-2/quantity_tiers&target=mainSection",
  });
  assert.equal(look.tokens?.themeName, "Dawn");
  // No JSON product template read (a Liquid template, or the page of files cut short): not known, never "off".
  const liquid = themeStore([{ filename: "config/settings_data.json", content: DAWN_SETTINGS }], "Dawn");
  assert.equal((await readThemeLook({ shop: "look-2b.myshopify.com", client: liquid, apiKey: "key-2" }, { scopes: "read_themes" })).block.state, "unknown");

  const noScope = themeStore([]);
  const none = await readThemeLook({ shop: "look-3.myshopify.com", client: noScope, apiKey: "key-3" }, { scopes: "write_discounts" });
  assert.deepEqual(none, { tokens: null, block: { state: "no_scope" }, placements: {} });
  assert.equal(noScope.ops.length, 0);

  const down = new FakeStore();
  down.overrides.set("WonTiersThemeLook", () => {
    throw new Error("Throttled");
  });
  const unknown = await readThemeLook({ shop: "look-4.myshopify.com", client: down, apiKey: "key-4" }, { scopes: "read_themes" });
  assert.equal(unknown.block.state, "unknown");
  assert.equal(unknown.tokens, null);
});

test("readThemeLook: an auth failure (a thrown Response) is never swallowed — the route re-authenticates", async () => {
  const store = new FakeStore();
  store.overrides.set("WonTiersThemeLook", () => {
    throw new Response(null, { status: 401 });
  });
  await assert.rejects(
    readThemeLook({ shop: "look-5.myshopify.com", client: store, apiKey: "k" }, { scopes: "read_themes" }),
    (e: unknown) => e instanceof Response,
  );
});

// --- Feedback 3, bod 5: every placement on the storefront, from the same one read --------------------------

const APP = "shopify://apps/won-discounts/blocks";
const template = (...types: string[]) =>
  JSON.stringify({ sections: { main: { type: "main", blocks: Object.fromEntries(types.map((type, i) => [`b${i}`, { type: `${APP}/${type}/019a` }])) } }, order: ["main"] });
const embedSettings = (settings: Record<string, unknown>, disabled = false) =>
  HEADER + JSON.stringify({ current: { blocks: { "123": { type: `${APP}/won_discounts_embed/019a`, disabled, settings } } } });

test("themePlacementsIn: each block by its template; the top bar from the embed's own settings; an unread file is 'not known', never 'missing'", () => {
  const all = themePlacementsIn([
    { filename: "config/settings_data.json", content: embedSettings({ top_bar_rewards: true, top_bar_campaign: false }) },
    { filename: "templates/product.json", content: template("quantity_tiers", "rewards_progress", "outlet_badge") },
    { filename: "templates/index.json", content: template("campaign_banner") },
    { filename: "templates/cart.json", content: template("cart_rewards") },
  ]);
  assert.deepEqual(all, {
    rewardsProduct: true,
    campaignProduct: false,
    outletBadge: true,
    rewardsHome: false,
    campaignHome: true,
    cartBlock: true,
    topBarRewards: true,
    topBarCampaign: false,
    // Where a block sits: the home page's by its section (here the only one); the product's only against buy buttons, which this template lacks.
    spots: { campaignHome: { at: "page", index: 1, of: 1 } },
  });
  // 9 Oct 2026, 4th round: Shopify adds a block at the END — of the page, of the product information. The spot is read, never assumed.
  const home = JSON.stringify({
    sections: { hero: { type: "hero" }, off: { type: "x", disabled: true }, list: { type: "product-list" }, apps: { type: "apps", blocks: { a: { type: `${APP}/campaign_banner/1` } }, block_order: ["a"] } },
    order: ["hero", "off", "list", "apps"],
  });
  assert.deepEqual(blockSpotIn(home, "campaign_banner", "page"), { at: "page", index: 3, of: 3 });
  assert.equal(blockSpotIn(home, "rewards_progress", "page"), null);
  const product = (order: string[]) =>
    JSON.stringify({
      sections: {
        main: {
          type: "main-product",
          blocks: { title: { type: "title" }, price: { type: "price" }, buy: { type: "buy_buttons" }, badge: { type: `${APP}/outlet_badge/1` }, tiers: { type: `${APP}/quantity_tiers/1` } },
          block_order: order,
        },
      },
      order: ["main"],
    });
  assert.deepEqual(blockSpotIn(product(["title", "price", "buy", "badge", "tiers"]), "outlet_badge", "product"), { at: "product", belowBuy: true });
  assert.deepEqual(blockSpotIn(product(["title", "price", "badge", "buy", "tiers"]), "outlet_badge", "product"), { at: "product", belowBuy: false });
  // Horizon nests the blocks of the product information in a group: the order is still the page's.
  const nested = JSON.stringify({
    sections: { main: { type: "product-information", blocks: { details: { type: "_product-details", blocks: { price: { type: "price" }, buy: { type: "buy-buttons" }, badge: { type: `${APP}/outlet_badge/1` } }, block_order: ["price", "badge", "buy"] } }, block_order: ["details"] } },
    order: ["main"],
  });
  assert.deepEqual(blockSpotIn(nested, "outlet_badge", "product"), { at: "product", belowBuy: false });
  const placedLow = themePlacementsIn([{ filename: "templates/product.json", content: product(["title", "price", "buy", "badge", "tiers"]) }]);
  assert.deepEqual(placedLow.spots, { outletBadge: { at: "product", belowBuy: true }, tiersBlock: { at: "product", belowBuy: true } });
  assert.deepEqual(spotAdvice(placedLow.spots?.outletBadge), { key: "placement.spot.belowBuy", params: {}, move: true });
  assert.deepEqual(spotAdvice({ at: "page", index: 3, of: 3 }), { key: "placement.spot.pageLow", params: { index: 3, of: 3 }, move: true });
  assert.deepEqual(spotAdvice({ at: "page", index: 2, of: 5 }), { key: "placement.spot.pageTop", params: { index: 2, of: 5 }, move: false });
  assert.equal(spotAdvice(undefined), null);
  // 10 Oct 2026, bod 6: a block that is in the theme is OPENED to be moved — never the link that adds one more.
  assert.equal(
    editorOpenUrl("https://x.myshopify.com/admin/themes/current/editor?template=product&addAppBlockId=key/outlet_badge&target=mainSection"),
    "https://x.myshopify.com/admin/themes/current/editor?template=product",
  );
  assert.equal(editorOpenUrl(null), null);
  // The "Top bar" block in the header group (9 Oct 2026, bod 4) counts like the embed's switches; its own switches decide what it shows.
  const headerGroup = (settings: Record<string, unknown>, disabled = false) =>
    JSON.stringify({ sections: { apps: { type: "apps", blocks: { a: { type: `${APP}/top_bar/019a`, disabled, settings } } } }, order: ["apps"] });
  assert.deepEqual(themePlacementsIn([{ filename: "sections/header-group.json", content: headerGroup({}) }]), { topBarRewards: true, topBarCampaign: true });
  assert.deepEqual(themePlacementsIn([{ filename: "sections/header-group.json", content: headerGroup({ show_campaign: false }) }]), { topBarRewards: true, topBarCampaign: false });
  assert.deepEqual(themePlacementsIn([{ filename: "sections/header-group.json", content: headerGroup({}, true) }]), { topBarRewards: false, topBarCampaign: false });
  assert.deepEqual(
    themePlacementsIn([
      { filename: "config/settings_data.json", content: embedSettings({ top_bar_rewards: false, top_bar_campaign: true }) },
      { filename: "sections/header-group.json", content: JSON.stringify({ sections: {} }) },
    ]),
    { topBarRewards: false, topBarCampaign: true },
  );
  // 7th round, bod 5: an announcement strip of one thing counts as that thing's strip, and only as that.
  const strip = (handle: string, disabled = false) => JSON.stringify({ sections: { apps: { type: "apps", blocks: { a: { type: `${APP}/${handle}/019a`, disabled } } } }, order: ["apps"] });
  assert.deepEqual(themePlacementsIn([{ filename: "sections/header-group.json", content: strip("announcement_milestones") }]), { topBarRewards: true, topBarCampaign: false });
  assert.deepEqual(themePlacementsIn([{ filename: "sections/header-group.json", content: strip("announcement_campaign") }]), { topBarRewards: false, topBarCampaign: true });
  assert.deepEqual(themePlacementsIn([{ filename: "sections/header-group.json", content: strip("announcement_campaign", true) }]), { topBarRewards: false, topBarCampaign: false });
  // A disabled block or a disabled embed does not count.
  const disabled = JSON.stringify({ sections: { main: { type: "main", blocks: { a: { type: `${APP}/outlet_badge/1`, disabled: true } } } } });
  assert.equal(themePlacementsIn([{ filename: "templates/product.json", content: disabled }]).outletBadge, false);
  assert.equal(themePlacementsIn([{ filename: "config/settings_data.json", content: embedSettings({ top_bar_rewards: true }, true) }]).topBarRewards, false);
  // Only what was read is answered: no cart template (a Liquid one) → the cart block is not known.
  const partial = themePlacementsIn([{ filename: "templates/product.json", content: template() }]);
  assert.deepEqual(partial, { rewardsProduct: false, campaignProduct: false, outletBadge: false });
  assert.equal("cartBlock" in partial, false);
  assert.deepEqual(themePlacementsIn([]), {});
});

test("readThemeLook hands the placements over with the same read (no extra request)", async () => {
  const store = themeStore([
    { filename: "config/settings_data.json", content: HORIZON_SETTINGS },
    { filename: "templates/product.json", content: HORIZON_PRODUCT },
    { filename: "templates/cart.json", content: template("cart_rewards") },
  ]);
  const look = await readThemeLook({ shop: "look-9.myshopify.com", client: store, apiKey: "key-9" }, { scopes: "read_themes" });
  assert.equal(look.placements.cartBlock, true);
  assert.equal(look.placements.rewardsProduct, false);
  assert.equal("rewardsHome" in look.placements, false, "templates/index.json was not read");
  assert.equal(store.ops.filter((op) => op === "WonTiersThemeLook").length, 1);
});
