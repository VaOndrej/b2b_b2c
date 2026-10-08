// The look of each storefront element (feedback 2026-10-06, bod 13), end to end: every module's section saves its
// own element through /app/looks — the ready-made look and colour on every plan, the custom look on Pro only —
// and the storefront gets one stylesheet where each element's part is confined to that element. A config stored
// before the split keeps the storefront as it was.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { LOOK_PRESET_CSS, MILESTONE_BLINK_CSS } from "@won/core/discounts/looks";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { aiPrompt, LOOK_CLASSES, looksAction, lookView } from "../../app/lib/integration/looks.server.ts";
import { createSync, syncIdle } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, formOf, quiet, testCtx } from "./helpers.ts";

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-looks");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `looks-${seq}.myshopify.com`;
  clearSignalCache();
});

type Plan = "free" | "pro";

function ctxFor(store: FakeStore, plan: Plan): ShopCtx {
  return {
    ...testCtx(db.prisma, shop, store),
    createSync: (client: AdminClient, prisma: PrismaClient) => createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => plan }),
    lockWaitMs: 200,
  };
}

const version = async () => (await loadConfig(db.prisma, shop)).version ?? "";
const look = async (element: string, more: [string, string][]) => formOf([["intent", "save"], ["configVersion", await version()], ["element", element], ...more]);
const liveCss = (store: FakeStore) => (store.sync.storefrontConfig() as { appearance: { css?: string; oc?: 1 } }).appearance;
const stored = async () => (await loadConfig(db.prisma, shop)).config.storefront;

test("Free: an element's ready-made look, colour and flash are saved and reach the storefront; its custom look fields are not taken (BILL-1)", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store, "free");
  const r = await looksAction(ctx, await look("milestones", [["preset", "checklist"], ["accent", "violet"], ["blink", "on"], ["look.accent", "#ff0000"], ["look.css", ".won-ms__text{color:red}"]]));
  assert.ok(r.ok, JSON.stringify(r));
  await syncIdle(shop);
  assert.deepEqual((await stored()).looks, { milestones: { preset: "checklist", accent: "violet", blink: true } });
  assert.equal(liveCss(store).css, `${LOOK_PRESET_CSS.milestones.checklist}${MILESTONE_BLINK_CSS}.won-ms{--won-tiers-accent:#6d28d9}`);
  // Back to the first look, the theme's colour, no flash: nothing is stored and nothing is sent.
  const back = await looksAction(ctx, await look("milestones", [["preset", "track"], ["accent", "theme"]]));
  assert.ok(back.ok, JSON.stringify(back));
  await syncIdle(shop);
  assert.deepEqual((await stored()).looks, {});
  assert.equal(liveCss(store).css, undefined);
});

test("Free keeps a custom look stored on Pro exactly as it is, and ships none of it", async () => {
  const store = new FakeStore();
  const base = (await loadConfig(db.prisma, shop)).config;
  const custom = { vars: { accent: "#111111" }, css: ".won-outlet__badge{font-weight:800}" };
  await saveConfig(db.prisma, shop, { ...base, storefront: { ...base.storefront, looks: { outlet: { custom } } } });
  const r = await looksAction(ctxFor(store, "free"), await look("outlet", [["preset", "strip"], ["look.accent", "#ff0000"], ["look.css", ""]]));
  assert.ok(r.ok, JSON.stringify(r));
  await syncIdle(shop);
  assert.deepEqual((await stored()).looks, { outlet: { preset: "strip", custom } });
  assert.deepEqual(liveCss(store), { preset: "highlight", css: LOOK_PRESET_CSS.outlet.strip, oc: 1 });
});

test("Pro: every element has its own custom look, confined to it — saving one never changes another, on the page or on the storefront", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store, "pro");
  const steps: [string, [string, string][]][] = [
    ["tiers", [["look.accent", "#0A7D4F"], ["look.radius", "4"], ["look.css", ".won-tiers__row { font-weight: 700 }"]]],
    ["milestones", [["preset", "sentence"], ["accent", "theme"], ["look.css", ".won-ms__text{letter-spacing:1px}"]]],
    ["outlet", [["preset", "countdown"], ["accent", "red"], ["look.tint", "#fff0f0"]]],
    ["campaign", [["preset", "card"], ["accent", "theme"], ["look.css", ":root{margin:0} .won-tiers{display:none}"]]],
  ];
  for (const [element, fields] of steps) {
    const r = await looksAction(ctx, await look(element, fields));
    assert.ok(r.ok, `${element}: ${JSON.stringify(r)}`);
    await syncIdle(shop);
  }
  const s = await stored();
  assert.deepEqual(s.custom, { vars: { accent: "#0a7d4f", radius: 4 }, css: ".won-tiers__row { font-weight: 700 }" });
  assert.equal(s.appearancePreset, "highlight", "the table's ready-made look is its page's, untouched here");
  assert.deepEqual(s.looks, {
    milestones: { preset: "sentence", custom: { vars: {}, css: ".won-ms__text{letter-spacing:1px}" } },
    outlet: { preset: "countdown", accent: "red", custom: { vars: { tint: "#fff0f0" }, css: "" } },
    campaign: { preset: "card", custom: { vars: {}, css: ":root{margin:0} .won-tiers{display:none}" } },
  });
  assert.deepEqual(liveCss(store), {
    preset: "highlight",
    css:
      ".won-tiers{--won-tiers-accent:#0a7d4f;--won-tiers-radius:4px}.won-tiers .won-tiers__row{font-weight: 700}" +
      `${LOOK_PRESET_CSS.milestones.sentence}.won-ms .won-ms__text{letter-spacing:1px}` +
      `${LOOK_PRESET_CSS.outlet.countdown}.won-outlet{--won-tiers-accent:#b42318}.won-outlet{--won-tiers-tint:#fff0f0}` +
      // The campaign's CSS names the table: it can only ever match a table INSIDE the banner — there is none.
      `${LOOK_PRESET_CSS.campaign.card}.won-campaign{margin:0}.won-campaign .won-tiers{display:none}`,
    oc: 1,
  });
  // Emptying one element's custom look removes that one alone.
  const cleared = await looksAction(ctx, await look("campaign", [["preset", "card"], ["accent", "theme"]]));
  assert.ok(cleared.ok, JSON.stringify(cleared));
  assert.deepEqual((await stored()).looks.campaign, { preset: "card" });
  assert.ok((await stored()).looks.milestones?.custom);
});

test("a config stored before the split: its looks show on their pages, and the storefront gets the same colours on the table and the ladder", async () => {
  const store = new FakeStore();
  const base = (await loadConfig(db.prisma, shop)).config;
  // The stored row as it was written before `looks` existed.
  const old = JSON.parse(JSON.stringify({ ...base, storefront: { appearancePreset: "chips", cardPricesEnabled: false, accent: "green", custom: { vars: { accent: "#0a7d4f", radius: 4 }, css: ".won-tiers__heading{text-transform:uppercase}" } } }));
  assert.equal("looks" in old.storefront, false);
  await saveConfig(db.prisma, shop, base);
  await db.prisma.shopConfig.update({ where: { shop }, data: { data: JSON.stringify(old) } });
  const loaded = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(lookView(loaded, "tiers").custom, { accent: "#0a7d4f", line: "", tint: "", radius: "4", css: ".won-tiers__heading{text-transform:uppercase}" });
  assert.deepEqual({ accent: lookView(loaded, "milestones").accent, custom: lookView(loaded, "milestones").custom.accent, preset: lookView(loaded, "milestones").preset }, { accent: "green", custom: "#0a7d4f", preset: "track" });
  assert.deepEqual(lookView(loaded, "outlet").custom, { accent: "", line: "", tint: "", radius: "", css: "" });
  // Saving something else (card prices) syncs the converted config: the table's rules under the table, the colours on the ladder too.
  const r = await looksAction(ctxFor(store, "pro"), formOf([["intent", "cards"], ["configVersion", await version()], ["cardPrices", "on"]]));
  assert.ok(r.ok, JSON.stringify(r));
  await syncIdle(shop);
  assert.equal(
    liveCss(store).css,
    ".won-tiers{--won-tiers-accent:#1a7f45}.won-tiers{--won-tiers-accent:#0a7d4f;--won-tiers-radius:4px}.won-tiers .won-tiers__heading{text-transform:uppercase}.won-ms{--won-tiers-accent:#1a7f45}.won-ms{--won-tiers-accent:#0a7d4f}",
  );
  assert.equal((store.sync.storefrontConfig() as { cards?: 1 }).cards, 1);
  // Converted once: a second load and save changes nothing more.
  const again = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(again.storefront.looks, { milestones: { accent: "green", custom: { vars: { accent: "#0a7d4f" }, css: "" } } });
});

test("refused on their fields, nothing saved: an unknown element, look or colour; a colour that is not a hex; a radius out of range; CSS that cannot be confined", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store, "pro");
  const errors = async (element: string, more: [string, string][]) => {
    const r = await looksAction(ctx, await look(element, more));
    return !r.ok && r.reason === "invalid" ? r.errors : r;
  };
  const ok: [string, string][] = [["preset", "badge"], ["accent", "theme"]];
  assert.deepEqual(await errors("cart", ok), [{ field: "element", key: "appearance.error.preset" }]);
  assert.deepEqual(await errors("outlet", [["preset", "checklist"], ["accent", "theme"]]), [{ field: "preset", key: "looks.error.preset" }]);
  assert.deepEqual(await errors("outlet", [["preset", "badge"], ["accent", "pink"]]), [{ field: "accent", key: "looks.error.accent" }]);
  assert.deepEqual(await errors("outlet", [...ok, ["look.accent", "red"]]), [{ field: "look.accent", key: "appearance.error.color" }]);
  assert.deepEqual(await errors("outlet", [...ok, ["look.radius", "99"]]), [{ field: "look.radius", key: "appearance.error.radius", params: { max: 32 } }]);
  assert.deepEqual(await errors("outlet", [...ok, ["look.css", ".a{background:url(https://x)}"]]), [{ field: "look.css", key: "appearance.error.css.forbidden", params: { detail: "url(" } }]);
  assert.deepEqual(await errors("tiers", [["look.css", ".a{b:c"]]), [{ field: "look.css", key: "appearance.error.css.unbalanced", params: { detail: "" } }]);
  assert.deepEqual(await looksAction(ctx, formOf([["intent", "nope"]])), { ok: false, reason: "bad_request" });
  const s = await stored();
  assert.deepEqual({ looks: s.looks, custom: s.custom }, { looks: {}, custom: undefined });
  assert.equal(store.ops.filter((op) => op.startsWith("WonSync")).length, 0, "nothing was sent to Shopify");
});

test("a storefront config over Shopify's metafield limit is refused before the save (not left to a failed sync step)", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store, "pro");
  const r = await looksAction(ctx, await look("campaign", [["preset", "card"], ["accent", "theme"], ["look.css", ".won-campaign__title { font-weight: 700 }"]]), { maxStorefrontBytes: 100 });
  assert.ok(!r.ok && r.reason === "invalid", JSON.stringify(r));
  assert.equal(r.errors![0]!.key, "appearance.error.tooLarge");
  assert.deepEqual((await stored()).looks, {});
});

test("F12: an element's look changed in another tab meanwhile → base_changed, nothing overwritten; another element's save goes through", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store, "free");
  const opened = await version();
  const other = await looksAction(ctx, formOf([["intent", "save"], ["configVersion", opened], ["element", "outlet"], ["preset", "strip"], ["accent", "theme"]]));
  assert.ok(other.ok, JSON.stringify(other));
  await syncIdle(shop);
  const stale = await looksAction(ctx, formOf([["intent", "save"], ["configVersion", opened], ["element", "outlet"], ["preset", "countdown"], ["accent", "theme"]]));
  assert.deepEqual(stale, { ok: false, reason: "base_changed" });
  assert.deepEqual((await stored()).looks, { outlet: { preset: "strip" } });
  const elsewhere = await looksAction(ctx, formOf([["intent", "save"], ["configVersion", opened], ["element", "campaign"], ["preset", "strip"], ["accent", "theme"]]));
  assert.ok(elsewhere.ok, JSON.stringify(elsewhere));
  assert.deepEqual((await stored()).looks, { outlet: { preset: "strip" }, campaign: { preset: "strip" } });
});

test("card prices (BETA) are one switch saved on its own, on any plan", async () => {
  const store = new FakeStore();
  const ctx = ctxFor(store, "free");
  const on = await looksAction(ctx, formOf([["intent", "cards"], ["configVersion", await version()], ["cardPrices", "on"]]));
  assert.ok(on.ok, JSON.stringify(on));
  await syncIdle(shop);
  assert.equal((await stored()).cardPricesEnabled, true);
  assert.equal((store.sync.storefrontConfig() as { cards?: 1 }).cards, 1);
  const off = await looksAction(ctx, formOf([["intent", "cards"], ["configVersion", await version()]]));
  assert.ok(off.ok, JSON.stringify(off));
  await syncIdle(shop);
  assert.equal((await stored()).cardPricesEnabled, false);
  assert.equal("cards" in (store.sync.storefrontConfig() as object), false);
});

test("the look's view and the brief for an AI are the element's own: its looks, its classes, its variables", async () => {
  const config = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(lookView(config, "tiers").presets, [], "the table's look is picked in its preview");
  assert.deepEqual(lookView(config, "milestones").presets, ["track", "checklist", "sentence"]);
  assert.deepEqual(lookView(config, "outlet").presets, ["badge", "countdown", "strip"]);
  assert.deepEqual(lookView(config, "campaign").presets, ["countdown", "strip", "card"]);
  for (const element of ["tiers", "milestones", "outlet", "campaign"] as const) {
    const brief = aiPrompt(element);
    assert.equal(lookView(config, element).aiPrompt, brief);
    for (const cls of LOOK_CLASSES[element]) assert.ok(brief.includes(cls), `${element}: ${cls}`);
    for (const other of ["tiers", "milestones", "outlet", "campaign"] as const) {
      if (other !== element) for (const cls of LOOK_CLASSES[other]) assert.equal(brief.includes(`${cls},`) || brief.endsWith(`${cls}.`), false, `${element}'s brief names ${cls}`);
    }
    assert.match(brief, /--won-tiers-accent, --won-tiers-line, --won-tiers-tint, --won-tiers-radius/);
  }
  const bad = lookView({ ...config, storefront: { ...config.storefront, looks: { outlet: { custom: { vars: {}, css: ".a{background:url(x)}" } } } } }, "outlet");
  assert.equal(bad.customIssue, "forbidden");
});
