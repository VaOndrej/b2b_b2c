// Překlady (feedback 2026-10-06, body 11, 12, 14) — the page end to end: the texts stored today show in the
// tables without a loss, a save reaches the storefront one metafield a language, the plan's limit and the
// Pro-only CSV hold on the server, and an import saves nothing until it is confirmed.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { PrismaClient } from "../../app/generated/prisma/client.ts";
import type { AdminClient } from "../../app/lib/admin-client.server.ts";
import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { loadTranslationsScreen, recordGrantedScopes, translationsAction } from "../../app/lib/integration/translations.server.ts";
import { createSync } from "../../app/lib/sync/sync.server.ts";
import { productionSyncDeps } from "../../app/lib/sync/wiring.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { parseCsv, type ImportPlan } from "../../app/components/model/translations.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, formOf, quiet, testCtx } from "./helpers.ts";

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-translations");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `translations-${seq}.myshopify.com`;
  clearSignalCache();
});

type Plan = "free" | "pro";
const SCOPES = "read_themes,read_markets,read_locales";

function ctxFor(store: FakeStore, plan: Plan, scopes = SCOPES): ShopCtx {
  return {
    ...testCtx(db.prisma, shop, store),
    scopes,
    createSync: (client: AdminClient, prisma: PrismaClient) => createSync({ ...productionSyncDeps(client, prisma, quiet), sleep: async () => {}, plan: async () => plan }),
    lockWaitMs: 200,
  };
}

function storeWith(...locales: string[]): FakeStore {
  const store = new FakeStore();
  store.shopLocales = locales.map((locale, i) => ({ locale, primary: i === 0 }));
  return store;
}

/** The shape every shop has stored today: three fixed languages, no list of them. */
const STORED_TODAY = { cs: { "tiers.heading": "Kup víc, plať míň", "cart.saved": "Ušetříte celkem {amount}" }, sk: {}, en: { "cards.pct": "From {min} pcs −{pct} %" } };

async function storeToday() {
  const base = (await loadConfig(db.prisma, shop)).config;
  await saveConfig(db.prisma, shop, { ...base, locales: STORED_TODAY });
}

const save = (version: string | null, more: [string, string][]) => formOf([["intent", "save"], ["configVersion", version ?? ""], ...more]);

test("the texts stored today show in the tables without a loss; saving the page unchanged keeps them and puts each language on the storefront", async () => {
  const store = storeWith("cs", "sk", "en");
  await storeToday();
  const ctx = ctxFor(store, "pro");
  const screen = await loadTranslationsScreen(ctx);
  assert.deepEqual(screen.languages, ["cs", "en"], "the shop's default first, then every language with a text");
  assert.deepEqual(screen.shopLanguages, ["cs", "sk", "en"]);
  assert.deepEqual(screen.values, { cs: STORED_TODAY.cs, en: STORED_TODAY.en });
  assert.equal(screen.limit, null);

  // The page posts every field of every table, as the browser does.
  const fields = screen.languages.flatMap((locale) => screen.rows.map((row): [string, string] => [`tx.${locale}.${row.key}`, screen.values[locale]?.[row.key] ?? ""]));
  const r = await translationsAction(ctx, save(screen.configVersion, [...screen.languages.map((l): [string, string] => ["lang", l]), ...fields]));
  assert.ok(r.ok, JSON.stringify(r));
  const stored = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(stored.locales, { cs: STORED_TODAY.cs, en: STORED_TODAY.en });
  assert.deepEqual(stored.storefront.languages, ["cs", "en"]);
  assert.deepEqual(store.sync.storefrontTexts(), { cs: STORED_TODAY.cs, en: STORED_TODAY.en });
  assert.deepEqual((await loadTranslationsScreen(ctx)).values, screen.values, "load → save → load: the same tables");
});

test("a save: a new language from the shop's list gets its table; an emptied field goes back to the default; a text without its {amount} is refused and nothing is saved", async () => {
  const store = storeWith("cs", "sk", "de");
  await storeToday();
  const ctx = ctxFor(store, "pro");
  const version = (await loadTranslationsScreen(ctx)).configVersion;
  const bad = await translationsAction(ctx, save(version, [["lang", "cs"], ["tx.cs.cart.saved", "Ušetříte hodně"]]));
  assert.deepEqual(bad, { ok: false, reason: "invalid", errors: [{ field: "tx.cs.cart.saved", key: "translations.error.missing", params: { parts: "{amount}" } }] });
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.locales, STORED_TODAY);

  const r = await translationsAction(ctx, save(version, [["lang", "cs"], ["lang", "de"], ["tx.cs.tiers.heading", ""], ["tx.de.tiers.heading", "Mehr kaufen"], ["tx.de.cart.ms_name.nope", "x"]]));
  assert.ok(r.ok, JSON.stringify(r));
  const stored = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(stored.locales, { cs: { "cart.saved": "Ušetříte celkem {amount}" }, de: { "tiers.heading": "Mehr kaufen" } }, "en is no longer a table: its texts went with it");
  assert.deepEqual(store.sync.storefrontTexts(), { cs: { "cart.saved": "Ušetříte celkem {amount}" }, de: { "tiers.heading": "Mehr kaufen" } });

  const notOn = await translationsAction(ctx, save((await loadTranslationsScreen(ctx)).configVersion, [["lang", "cs"], ["lang", "de"], ["lang", "hu"]]));
  assert.deepEqual(notOn, { ok: false, reason: "invalid", errors: [{ field: "lang", key: "translations.error.notInShop" }] });
});

test("Free: the server refuses a third language; languages stored on Pro stay editable but only two reach the storefront", async () => {
  const store = storeWith("cs", "sk", "de", "hu");
  const free = ctxFor(store, "free");
  const first = await loadTranslationsScreen(free);
  assert.equal(first.limit, 2);
  assert.deepEqual(first.languages, ["cs"]);
  const two = await translationsAction(free, save(first.configVersion, [["lang", "cs"], ["lang", "sk"], ["tx.cs.tiers.heading", "A"], ["tx.sk.tiers.heading", "B"]]));
  assert.ok(two.ok, JSON.stringify(two));
  const three = await translationsAction(free, save((await loadTranslationsScreen(free)).configVersion, [["lang", "cs"], ["lang", "sk"], ["lang", "de"], ["tx.de.tiers.heading", "C"]]));
  assert.deepEqual(three, { ok: false, reason: "invalid", errors: [{ field: "lang", key: "translations.error.limit", params: { max: 2 } }] });
  assert.deepEqual(Object.keys((await loadConfig(db.prisma, shop)).config.locales), ["cs", "sk"]);

  // On Pro a third language is saved; back on Free it stays stored and editable, the storefront gets two.
  const pro = ctxFor(store, "pro");
  const added = await translationsAction(pro, save((await loadTranslationsScreen(pro)).configVersion, [["lang", "cs"], ["lang", "sk"], ["lang", "de"], ["tx.de.tiers.heading", "C"]]));
  assert.ok(added.ok, JSON.stringify(added));
  assert.deepEqual(Object.keys(store.sync.storefrontTexts()).sort(), ["cs", "de", "sk"]);
  const edited = await translationsAction(free, save((await loadTranslationsScreen(free)).configVersion, [["lang", "cs"], ["lang", "sk"], ["lang", "de"], ["tx.de.tiers.heading", "C2"]]));
  assert.ok(edited.ok, JSON.stringify(edited));
  assert.equal((await loadConfig(db.prisma, shop)).config.locales.de?.["tiers.heading"], "C2");
  assert.deepEqual(Object.keys(store.sync.storefrontTexts()).sort(), ["cs", "sk"]);
});

test("without the permission to read the shop's languages the page works with what is stored and makes no request for them", async () => {
  const store = storeWith("de", "cs");
  await storeToday();
  const ctx = ctxFor(store, "pro", "read_themes,read_markets");
  const screen = await loadTranslationsScreen(ctx);
  assert.equal(screen.shopLanguages, null);
  assert.deepEqual(screen.languages, ["cs", "en"]);
  assert.equal(store.ops.includes("WonDiscountsShopLocales"), false);
  const edit = await translationsAction(ctx, save(screen.configVersion, [["lang", "cs"], ["lang", "en"], ["tx.cs.tiers.heading", "Jinak"]]));
  assert.ok(edit.ok, JSON.stringify(edit));
  const add = await translationsAction(ctx, save((await loadTranslationsScreen(ctx)).configVersion, [["lang", "cs"], ["lang", "en"], ["lang", "de"]]));
  assert.deepEqual(add, { ok: false, reason: "invalid", errors: [{ field: "lang", key: "translations.error.notInShop" }] });
});

test("the permission just granted on the page: the session learns it from Shopify at once, so the reload that follows lists the shop's languages (the scopes webhook comes later)", async () => {
  const store = storeWith("cs", "sk");
  const sessionId = `offline_${shop}`;
  await db.prisma.session.create({ data: { id: sessionId, shop, state: "", accessToken: "t", scope: "read_themes,read_markets" } });
  const scopeOf = async () => (await db.prisma.session.findUnique({ where: { id: sessionId } }))?.scope ?? "";
  const load = async () => loadTranslationsScreen(ctxFor(store, "free", await scopeOf()));
  assert.equal((await load()).shopLanguages, null, "before the grant");
  // The merchant confirmed Shopify's dialog; the page asks the app to look, and the app asks Shopify.
  const answer = await recordGrantedScopes(db.prisma, sessionId, async () => ({ granted: ["read_themes", "read_markets", "read_locales"] }));
  assert.deepEqual(answer, { ok: true, message: "scopes" });
  assert.equal(await scopeOf(), "read_themes,read_markets,read_locales");
  assert.deepEqual((await load()).shopLanguages, ["cs", "sk"], "the page's own reload, no manual one");
  // Shopify does not answer: nothing is written, and the page is told.
  await db.prisma.session.update({ where: { id: sessionId }, data: { scope: "read_themes" } });
  const failed = await recordGrantedScopes(db.prisma, sessionId, async () => {
    throw new Error("503");
  });
  assert.equal(failed.ok, false);
  assert.equal(await scopeOf(), "read_themes");
});

test("a shop with nothing stored: one table, the shop's default language (the admin's own when the shop's cannot be read)", async () => {
  assert.deepEqual((await loadTranslationsScreen(ctxFor(storeWith("de", "cs"), "free"))).languages, ["de"]);
  clearSignalCache();
  assert.deepEqual((await loadTranslationsScreen(ctxFor(storeWith("de"), "free", "read_themes"))).languages, ["cs"]);
});

test("CSV is Pro on the server: Free gets neither an export nor an import", async () => {
  const store = storeWith("cs", "sk");
  await storeToday();
  const free = ctxFor(store, "free");
  for (const intent of ["export", "import-preview", "import-apply"]) {
    const r = await translationsAction(free, formOf([["intent", intent], ["csv", "key,cs\ntiers.heading,X"]]));
    assert.deepEqual(r, { ok: false, reason: "invalid", errors: [{ field: "csv", key: "translations.error.pro" }] }, intent);
  }
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.locales, STORED_TODAY);
});

test("CSV on Pro: the export holds the stored texts; an import is only a plan until it is confirmed, then the passing rows are saved", async () => {
  const store = storeWith("cs", "en");
  await storeToday();
  const ctx = ctxFor(store, "pro");
  const exported = await translationsAction(ctx, formOf([["intent", "export"]]));
  assert.ok(exported.ok && exported.message === "export");
  const table = parseCsv((exported as { csv: string }).csv);
  assert.deepEqual(table[0], ["key", "place", "default", "cs", "en"]);
  assert.deepEqual(table.find((l) => l[0] === "cart.saved")!.slice(2), ["Ušetříte {amount}.", "Ušetříte celkem {amount}", ""]);

  const csv = "key,cs,en\ntiers.heading,Nový nadpis,New heading\ncart.saved,Ušetříte,\ntiers.unknown,x,y\n";
  const preview = await translationsAction(ctx, formOf([["intent", "import-preview"], ["csv", csv]]));
  assert.ok(preview.ok && preview.message === "import-preview");
  const plan = (preview as { plan: ImportPlan }).plan;
  assert.deepEqual(plan.changes.map((c) => [c.key, c.locale, c.to]), [["tiers.heading", "cs", "Nový nadpis"], ["tiers.heading", "en", "New heading"]]);
  assert.deepEqual(plan.refused.map((r) => r.reason), ["text", "key"]);
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.locales, STORED_TODAY, "a preview saves nothing");
  assert.equal(store.ops.filter((op) => op.startsWith("WonSync")).length, 0, "and writes nothing to Shopify");

  const applied = await translationsAction(ctx, formOf([["intent", "import-apply"], ["configVersion", (await loadTranslationsScreen(ctx)).configVersion ?? ""], ["csv", csv]]));
  assert.ok(applied.ok, JSON.stringify(applied));
  const stored = (await loadConfig(db.prisma, shop)).config.locales;
  assert.deepEqual(stored, { cs: { "tiers.heading": "Nový nadpis", "cart.saved": "Ušetříte celkem {amount}" }, en: { "cards.pct": "From {min} pcs −{pct} %", "tiers.heading": "New heading" } }, "the refused rows changed nothing");
  assert.deepEqual(store.sync.storefrontTexts(), stored);

  const nothing = await translationsAction(ctx, formOf([["intent", "import-apply"], ["csv", "key,cs\ntiers.heading,Nový nadpis\n"]]));
  assert.deepEqual(nothing, { ok: false, reason: "invalid", errors: [{ field: "csv", key: "translations.error.nothingToImport" }] });
});
