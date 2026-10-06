import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createElement } from "react";

import { codeHash } from "@won/core/discounts/code-hash";

import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import { configLockIdle } from "../../app/lib/integration/lock.server.ts";
import { cachedNativeCodes, clearDetectionCache } from "../../app/lib/integration/native.server.ts";
import {
  discountsPage,
  overviewAction,
  overviewPage,
  ruleEditorAction,
  ruleEditorPage,
  tryCartCompute,
  tryCartPage,
} from "../../app/lib/integration/pages.server.ts";
import { clearResyncDebounce, whenOverviewIdle } from "../../app/lib/integration/sync-status.server.ts";
import { clearMarketCountryCache } from "../../app/lib/integration/try-cart.server.ts";
import { CLAIM_STALE_MS } from "../../app/lib/native/move.server.ts";
import { makeSnapshot } from "../../app/lib/native/restore.server.ts";
import { loadShopSyncFacts, markTargetingStale } from "../../app/lib/sync/sync-state.server.ts";
import { syncIdle } from "../../app/lib/sync/sync.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { FIELD, ruleVersionToken } from "../../app/components/model/rule-form.ts";
import { DiscountsScreen } from "../../app/components/screens/DiscountsScreen.tsx";
import { OverviewScreen } from "../../app/components/screens/OverviewScreen.tsx";
import { RuleEditorScreen } from "../../app/components/screens/RuleEditorScreen.tsx";
import { TryCartScreen } from "../../app/components/screens/TryCartScreen.tsx";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { basicNode } from "../lib/native/fake-shopify.ts";
import { FakeStore, formOf, renderPage, testCtx, text } from "./helpers.ts";

// F2 (MVP 1 audit fixes) through the REAL admin paths (pages + ui-actions +
// sync + native) against a fake Shopify and a throwaway database:
//   item 1  what the Free plan does not run is said on Přehled, Slevy a kódy
//           and in the editor; such a rule is "Neběží";
//   item 2  Try Cart reads the refs checkout reads; stale targeting is said;
//           "Obnovit cílení"; Přehled refreshes a targeting older than 24 h;
//   item 4  a config no applying run synced: "Synchronizovat znovu";
//   item 5  "Běží" needs the automatic node live and the product step through;
//   item 8  Try Cart shows checkout's amounts with its warnings;
//   item 10 a code rule's save reads native codes FRESH for the hash check;
//   item 13 a rule changed since the editor loaded it is refused (base_changed),
//           another instance's write to another rule is retried on top;
//   F3 addendum: the Přehled resync and the native stale-claim sweep share the
//           config lock without a deadlock.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-f2");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `f2-admin-${seq}.myshopify.com`;
  clearDetectionCache();
  clearSignalCache();
  clearResyncDebounce();
  clearMarketCountryCache();
});

const PAGE = { scopes: "write_discounts,read_products,write_products,read_themes,read_markets" };

const auto = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  enabled: true,
  name: `Sleva ${id}`,
  method: "automatic",
  value: { kind: "percentage", percent: 10 },
  target: { kind: "order" },
  ...extra,
});

async function seed(input: unknown) {
  const saved = await saveConfig(db.prisma, shop, input);
  assert.equal(saved.ok, true, JSON.stringify(saved));
}

async function settle() {
  await whenOverviewIdle(shop);
  await configLockIdle(shop);
  await syncIdle(shop);
}

// --- item 1: BILL-1 in the admin ------------------------------------------------------------------

const proSetup = {
  markets: [
    { handle: "cz", currency: "CZK", enabled: true },
    { handle: "sk", currency: "EUR", enabled: true },
  ],
  modules: {
    codes: {
      rules: [auto("base"), auto("sk-only", { name: "Jen Slovensko", targeting: { markets: ["sk"] } }), auto("stack", { name: "Sčítaná", combinesWith: { ruleIds: ["base"] } })],
    },
  },
};

test("BILL-1: on Free, Přehled / Slevy a kódy / the editor say which Pro settings do not apply; the market rule 'Neběží'", async () => {
  await seed(proSetup);
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  const overview = await overviewPage(ctx, PAGE);
  assert.ok(overview.gate && overview.gate.length === 2, JSON.stringify(overview.gate));
  assert.deepEqual(overview.gateOff, ["sk-only"]);
  const html = text(await renderPage(createElement(OverviewScreen, overview)));
  assert.match(html, /Pro funkce není aktivní — v pokladně se neuplatní/);
  assert.match(html, /Sleva „Jen Slovensko“ cílí na vybrané trhy/);
  assert.match(html, /Neaktivní: používá funkci Pro, kterou váš tarif v pokladně nespouští/);
  // The shop config Shopify runs has the market rule off and no per-rule combination.
  const shipped = JSON.parse(store.sync.shopMetafieldValue("function_config")!);
  assert.doesNotMatch(JSON.stringify(shipped), /combinesWith/);

  const discounts = await discountsPage(ctx, { ...PAGE, deleted: false });
  assert.match(text(await renderPage(createElement(DiscountsScreen, discounts))), /Pro funkce není aktivní/);

  const editor = await ruleEditorPage(ctx, { ...PAGE, ruleId: "sk-only", recipe: null, saved: false });
  assert.ok(editor);
  assert.equal(editor.gate?.length, 1, "only this rule's sentence");
  assert.equal(editor.gateOff, true);
  const editorHtml = text(await renderPage(createElement(RuleEditorScreen, editor)));
  assert.match(editorHtml, /Pro funkce není aktivní — v pokladně se neuplatní/);
  assert.match(editorHtml, /Neaktivní/);
});

test("BILL-1: the dev-only override WON_DEV_PLAN=pro (NODE_ENV test) runs Pro: nothing gated, the rule runs", async () => {
  const env = { NODE_ENV: process.env.NODE_ENV, WON_DEV_PLAN: process.env.WON_DEV_PLAN };
  process.env.NODE_ENV = "test";
  process.env.WON_DEV_PLAN = "pro";
  try {
    await seed(proSetup);
    const store = new FakeStore();
    const overview = await overviewPage(testCtx(db.prisma, shop, store), PAGE);
    assert.equal(overview.gate, undefined);
    assert.match(store.sync.shopMetafieldValue("function_config")!, /combinesWith/);
  } finally {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

// --- item 5: "Běží" --------------------------------------------------------------------------------

test("P2-3: the automatic node deleted or switched off in Shopify → automatic rules are not 'Běží', the sync line says why", async () => {
  await seed({ modules: { codes: { rules: [auto("a1")] } } });
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  const first = await overviewPage(ctx, PAGE);
  assert.deepEqual(first.ruleSync, { a1: "synced" });

  const node = store.sync.wonNodes().find((n) => n.kind === "automatic")!;
  node.endsAt = "2026-01-01T00:00:00Z"; // deactivated by the merchant
  clearResyncDebounce();
  const inactive = await overviewPage(ctx, PAGE);
  assert.deepEqual(inactive.ruleSync, { a1: "failed" });
  const html = text(await renderPage(createElement(OverviewScreen, inactive)));
  assert.match(html, /Automatická sleva „Won Discounts“ je v Shopify vypnutá/);
  assert.match(html, /Synchronizovat znovu/);

  store.sync.nodes.delete(node.id);
  clearResyncDebounce();
  const missing = await overviewPage(ctx, PAGE);
  assert.deepEqual(missing.ruleSync, { a1: "failed" });
  assert.match(text(await renderPage(createElement(OverviewScreen, missing))), /v Shopify chybí/);
});

test("P2-3: a product rule whose product step failed is not 'Běží' although the config was applied", async () => {
  const store = new FakeStore();
  const product = store.sync.addProduct(1);
  await seed({ modules: { codes: { rules: [auto("p", { target: { kind: "products", productIds: [product.id], variantIds: [] } })] } } });
  const original = store.sync.graphql.bind(store.sync);
  store.sync.graphql = async (query, variables) => {
    const mfs = (variables as { metafields?: { key: string }[] } | undefined)?.metafields;
    if (query.includes("WonSyncMetafieldsSet") && mfs?.[0]?.key === "product") {
      return { data: { metafieldsSet: { metafields: [], userErrors: [{ message: "boom" }] } } };
    }
    return original(query, variables);
  };
  const props = await overviewPage(testCtx(db.prisma, shop, store), PAGE);
  await settle();
  assert.ok(store.sync.shopMetafieldValue("function_config"), "the config went through (the product only gains a ref)");
  const again = await overviewPage(testCtx(db.prisma, shop, store), PAGE);
  void props;
  assert.equal(again.ruleSync?.p, "failed");
});

test("item 2: a targeting marked stale by a webhook → the product rule 'Propisuje se', the targeting line says it", async () => {
  const store = new FakeStore();
  const product = store.sync.addProduct(1);
  const collection = store.sync.addCollection(7, [product.id]);
  await seed({ modules: { codes: { rules: [auto("c", { target: { kind: "collections", ids: [collection] } })] } } });
  const ctx = testCtx(db.prisma, shop, store);
  await overviewPage(ctx, PAGE);
  await settle();
  await markTargetingStale(db.prisma, shop, `collections/update ${collection}`, new Date());
  clearResyncDebounce();
  const props = await overviewPage(ctx, PAGE);
  assert.equal(props.ruleSync?.c, "refreshing");
  assert.equal(props.signals?.targeting?.state, "refreshing");
  const html = text(await renderPage(createElement(OverviewScreen, props)));
  assert.match(html, /Propisuje se/);
  assert.match(html, /Cílení na produkty a kolekce/);
  assert.match(html, /Obnovit cílení/);
});

test("item 2: 'Obnovit cílení' re-reads the collection now; the Přehled refreshes a targeting older than 24 h by itself", async () => {
  const store = new FakeStore();
  const [a, b] = [store.sync.addProduct(1), store.sync.addProduct(2)];
  const collection = store.sync.addCollection(7, [a.id]);
  await seed({ modules: { codes: { rules: [auto("c", { target: { kind: "collections", ids: [collection] } })] } } });
  const ctx = testCtx(db.prisma, shop, store);
  await overviewPage(ctx, PAGE);
  await settle();
  assert.deepEqual(store.sync.productMetafield(a.id), { ruleIds: ["c"], variantRuleIds: {} });

  store.sync.collections.set(collection, [b.id]);
  const refreshed = await overviewAction(ctx, formOf([["intent", "refresh_targeting"]]));
  assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
  await settle();
  assert.equal(store.sync.productMetafield(a.id), undefined);
  assert.deepEqual(store.sync.productMetafield(b.id), { ruleIds: ["c"], variantRuleIds: {} });

  // 25 h later a Přehled load refreshes by itself.
  store.sync.collections.set(collection, [a.id, b.id]);
  await db.prisma.shopSyncState.update({ where: { shop }, data: { productsSyncedAt: new Date(Date.now() - 25 * 60 * 60_000) } });
  clearResyncDebounce();
  await overviewPage(ctx, PAGE);
  await settle();
  assert.deepEqual(store.sync.productMetafield(a.id), { ruleIds: ["c"], variantRuleIds: {} });
  assert.ok(Date.now() - (await loadShopSyncFacts(db.prisma, shop)).productsSyncedAt!.getTime() < 60_000);
});

// --- item 2 + 8: Vyzkoušet košík ---------------------------------------------------------------

const V1 = "gid://shopify/ProductVariant/101";

test("item 2: Try Cart uses the refs checkout reads — a product that left the collection keeps its discount until the refresh, and it says so", async () => {
  const store = new FakeStore();
  const product = store.sync.addProduct(1);
  const collection = store.sync.addCollection(7, [product.id]);
  store.prices.set(V1, { CZK: "1000.00" });
  await seed({ modules: { codes: { rules: [auto("c", { value: { kind: "percentage", percent: 20 }, target: { kind: "collections", ids: [collection] } })] } } });
  const ctx = testCtx(db.prisma, shop, store);
  const cart = formOf([["intent", "run"], ["variantId", V1], ["productId", product.id], ["quantity", "1"], ["currency", "CZK"]]);

  // Never synced: checkout has no refs yet — no discount, and the page says the settings are not in Shopify.
  const before = await tryCartCompute(ctx, cart, PAGE);
  assert.equal(before.plan?.lines[0]?.discount, 0);
  assert.ok(before.plan?.warnings?.some((w) => w.key === "tryCart.warning.notApplied"), JSON.stringify(before.plan?.warnings));

  await overviewPage(ctx, PAGE);
  await settle();
  // The product leaves the collection in Shopify; the webhook marked it, the refresh has not run yet.
  store.sync.collections.set(collection, []);
  await markTargetingStale(db.prisma, shop, "collections/update", new Date());
  const run = await tryCartCompute(ctx, cart, PAGE);
  assert.equal(run.plan?.lines[0]?.discount, 200_00, "checkout still has the ref: it still gives the 20 %");
  // The product left the collection: named as a membership change (live collections are read while stale).
  assert.ok(run.plan?.warnings?.some((w) => w.key === "tryCart.warning.membership"), JSON.stringify(run.plan?.warnings));
  const html = text(await renderPage(createElement(TryCartScreen, { ...(await tryCartPage(ctx, PAGE)), pro: true, lines: run.lines!, plan: run.plan, result: run.result })));
  assert.match(html, /Pokladna se může lišit/);
  assert.match(html, /změnilo členství v kolekci/);
  // Membership is read live only to warn, in the same variants query; the discount still follows the refs.
  assert.equal(store.calls.filter((c) => c.op === "WonTryCartVariants").at(-1)?.variables.withCollections, true);
  assert.ok(!store.calls.some((c) => c.op === "WonTryCartProductCollections"), "one page of collections was enough, no extra pages");
});

// --- item 4: Synchronizovat znovu when the stored config is not in Shopify --------------------------

test("P2-2: a stored config no applying run synced shows 'čeká na zápis' with 'Synchronizovat znovu' (debounced load)", async () => {
  await seed({ modules: { codes: { rules: [auto("a1")] } } });
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  await overviewPage(ctx, PAGE);
  await settle();
  const { config } = await loadConfig(db.prisma, shop);
  await saveConfig(db.prisma, shop, { ...config, modules: { ...config.modules, codes: { rules: [...config.modules.codes.rules, auto("a2")] } } });
  // Within the Přehled debounce: no resync on this load — the line must not say "Synchronizováno".
  const props = await overviewPage(ctx, PAGE);
  assert.equal(props.signals?.sync.state, "pending");
  const html = text(await renderPage(createElement(OverviewScreen, props)));
  assert.match(html, /Uloženo, čeká na zápis do Shopify/);
  assert.match(html, /Synchronizovat znovu/);
});

// --- item 10: fresh native codes at a code rule's save ---------------------------------------------

function collidingCodes(): [string, string] {
  const seen = new Map<string, string>();
  for (let i = 0; ; i++) {
    const code = `JARO${i}`;
    const other = seen.get(codeHash(code));
    if (other) return [other, code];
    seen.set(codeHash(code), code);
  }
}

test("item 10: a native code created after the last detection is caught at the code rule's save (fresh read, not the 60 s cache)", async () => {
  const [ours, theirs] = collidingCodes();
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  await seed({ modules: { codes: { rules: [] } } });
  await overviewPage(ctx, PAGE); // detection cached: no native codes
  await settle();
  assert.deepEqual(cachedNativeCodes(shop), []);
  store.native.add(basicNode({ title: "Nová nativní", codes: [theirs] }));

  const outcome = await ruleEditorAction(
    ctx,
    formOf([
      ["intent", "save"],
      [FIELD.name, "Jaro"],
      [FIELD.enabled, "on"],
      [FIELD.valueKind, "percentage"],
      [FIELD.percent, "10"],
      [FIELD.target, "order"],
      [FIELD.method, "code"],
      [FIELD.codes, ours],
    ]),
    "new",
  );
  assert.ok("result" in outcome, JSON.stringify(outcome));
  assert.equal(!outcome.result.ok && outcome.result.reason, "code_hash_collision");
});

// --- item 13: version tokens --------------------------------------------------------------------

const editForm = (percent: string, version: string | null): [string, string][] => [
  ["intent", "save"],
  [FIELD.name, "Sleva a1"],
  [FIELD.enabled, "on"],
  [FIELD.valueKind, "percentage"],
  [FIELD.percent, percent],
  [FIELD.target, "order"],
  [FIELD.method, "automatic"],
  ...(version ? ([[FIELD.ruleVersion, version]] as [string, string][]) : []),
];

test("F12: a rule changed since the editor loaded it is refused (base_changed, honest copy); the current version saves", async () => {
  await seed({ modules: { codes: { rules: [auto("a1")] } } });
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  const loaded = (await loadConfig(db.prisma, shop)).config.modules.codes.rules[0]!;
  const token = ruleVersionToken(loaded);
  // Someone else (another tab, another instance) changes the same rule.
  const { config } = await loadConfig(db.prisma, shop);
  await saveConfig(db.prisma, shop, { ...config, modules: { ...config.modules, codes: { rules: [{ ...loaded, value: { kind: "percentage", percent: 50 } }] } } });

  const refused = await ruleEditorAction(ctx, formOf(editForm("15", token)), "a1");
  assert.deepEqual(refused, { result: { ok: false, reason: "base_changed" } });
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.modules.codes.rules[0]!.value, { kind: "percentage", percent: 50 }, "their change is kept");
  const page = await ruleEditorPage(ctx, { ...PAGE, ruleId: "a1", recipe: null, saved: false });
  const html = text(await renderPage(createElement(RuleEditorScreen, { ...page!, result: { ok: false, reason: "base_changed" } })));
  assert.match(html, /Někdo mezitím změnil nastavení/);
  assert.match(html, /Načíst znovu/);

  const current = ruleVersionToken((await loadConfig(db.prisma, shop)).config.modules.codes.rules[0]!);
  const saved = await ruleEditorAction(ctx, formOf(editForm("15", current)), "a1");
  assert.ok("result" in saved && saved.result.ok, JSON.stringify(saved));
});

test("F12: another instance's write to ANOTHER rule between the read and the write is kept; the save is retried on top", async () => {
  await seed({ modules: { codes: { rules: [auto("a1"), auto("b1")] } } });
  const store = new FakeStore();
  let raced = false;
  store.overrides.set("WonSyncShop", async (variables) => {
    if (!raced) {
      raced = true; // the other instance saves while this save reads the shop
      const { config } = await loadConfig(db.prisma, shop);
      await saveConfig(db.prisma, shop, {
        ...config,
        modules: { ...config.modules, codes: { rules: config.modules.codes.rules.map((r) => (r.id === "b1" ? { ...r, name: "B přejmenovaná" } : r)) } },
      });
    }
    return store.sync.graphql("query WonSyncShop { shop { id } }", variables);
  });
  const ctx = testCtx(db.prisma, shop, store);
  const token = ruleVersionToken((await loadConfig(db.prisma, shop)).config.modules.codes.rules[0]!);
  const outcome = await ruleEditorAction(ctx, formOf(editForm("15", token)), "a1");
  assert.ok("result" in outcome && outcome.result.ok, JSON.stringify(outcome));
  const rules = (await loadConfig(db.prisma, shop)).config.modules.codes.rules;
  assert.deepEqual(rules.map((r) => [r.id, r.name, r.value]), [
    ["a1", "Sleva a1", { kind: "percentage", percent: 15 }],
    ["b1", "B přejmenovaná", { kind: "percentage", percent: 10 }],
  ]);
});

// --- F3 addendum: Přehled resync + the native stale-claim sweep ----------------------------------

test("the Přehled resync and the native stale-claim sweep share the config lock: both finish, no deadlock, no starvation", async () => {
  await seed({ modules: { codes: { rules: [auto("a1")] } } });
  const store = new FakeStore();
  const raw = basicNode({ method: "automatic", title: "Zaseknutý přesun" });
  const nativeId = store.native.add(raw);
  const row = await db.prisma.nativeDiscountBackup.create({
    data: { shop, nativeId, kind: "automatic_basic", title: "Zaseknutý přesun", snapshot: JSON.stringify(makeSnapshot(raw, store.native.shop)), status: "moving" },
  });
  await db.prisma.nativeDiscountBackup.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - CLAIM_STALE_MS - 60_000) } });
  const ctx = testCtx(db.prisma, shop, store);

  const props = await overviewPage(ctx, PAGE);
  assert.equal(props.signals?.sync.state, "ok", "the resync took the lock first (the sweep queued after it)");
  const done = Promise.all([settle(), (async () => {
    for (let i = 0; i < 200 && (await db.prisma.nativeDiscountBackup.findUnique({ where: { id: row.id } }))?.status === "moving"; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
  })()]);
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("deadlock: lock never released")), 10_000));
  await Promise.race([done, timeout]);
  await settle();
  assert.notEqual((await db.prisma.nativeDiscountBackup.findUnique({ where: { id: row.id } }))?.status, "moving", "the sweep ran after the resync");
  assert.equal(await db.prisma.syncRun.count({ where: { shop } }) >= 1, true);
  // A load while nobody holds the lock renders normally.
  clearResyncDebounce();
  const next = await overviewPage(ctx, PAGE);
  assert.equal(next.signals?.sync.state, "ok");
});

// --- item 7: a rule save waits for the config, the products follow in the background ------------

test("item 7: a rule on a collection saves with the shop config in place; the products follow in the background and Přehled never restarts them", async () => {
  const store = new FakeStore();
  const products = Array.from({ length: 40 }, (_, i) => store.sync.addProduct(200 + i).id);
  const collection = store.sync.addCollection(9, products);
  const ctx = testCtx(db.prisma, shop, store);
  await seed({ modules: { codes: { rules: [] } } });
  store.delayMs = 3;
  const outcome = await ruleEditorAction(
    ctx,
    formOf([
      ["intent", "save"],
      [FIELD.name, "Kolekce 15 %"],
      [FIELD.enabled, "on"],
      [FIELD.valueKind, "percentage"],
      [FIELD.percent, "15"],
      [FIELD.target, "collections"],
      [FIELD.collectionIds, collection],
      [FIELD.method, "automatic"],
    ]),
    "new",
  );
  assert.ok("redirect" in outcome, JSON.stringify(outcome));
  assert.ok(store.sync.shopMetafieldValue("function_config"), "the shop config is in place when the save answers");
  const runsAfterSave = await db.prisma.syncRun.count({ where: { shop } });

  // A Přehled load while the products are still being written: shown, never restarted.
  const id = /discounts\/([^?]+)/.exec(outcome.redirect)![1]!;
  const props = await overviewPage(ctx, PAGE);
  assert.notEqual(props.ruleSync?.[id], "synced", "not 'Aktivní' while its products are being written");
  await settle();
  assert.equal(await db.prisma.syncRun.count({ where: { shop } }), runsAfterSave + 1, "exactly one more run: the product lane itself");
  for (const p of products) assert.deepEqual(store.sync.productMetafield(p), { ruleIds: [id], variantRuleIds: {} });
  clearResyncDebounce();
  store.delayMs = 0;
  const after = await overviewPage(ctx, PAGE);
  assert.equal(after.ruleSync?.[id], "synced");
});

test("F12: an onboarding step saved while another instance writes the config is re-applied on top of it (nothing lost)", async () => {
  const { saveOnboarding } = await import("../../app/lib/ui-actions.server.ts");
  await seed({ modules: { codes: { rules: [auto("a1")] } } });
  let raced = false;
  // The other instance's write lands between this save's read and its write.
  const racingDb = new Proxy(db.prisma, {
    get(target, prop, receiver) {
      if (prop === "$transaction" && !raced) {
        return async (...args: unknown[]) => {
          raced = true;
          const { config } = await loadConfig(db.prisma, shop);
          await saveConfig(db.prisma, shop, { ...config, modules: { ...config.modules, codes: { rules: [...config.modules.codes.rules, auto("b1")] } } });
          return (target.$transaction as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  const result = await saveOnboarding({ db: racingDb, shop }, { goals: ["rewards"], step: 2 });
  assert.deepEqual(result, { ok: true, message: "saved" });
  const stored = (await loadConfig(db.prisma, shop)).config;
  assert.deepEqual(stored.modules.codes.rules.map((r) => r.id), ["a1", "b1"], "the other write is kept");
  assert.deepEqual(stored.onboarding, { goals: ["rewards"], step: 2 }, "and the step is saved on top of it");
});
