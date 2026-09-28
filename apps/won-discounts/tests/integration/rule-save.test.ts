import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createElement } from "react";

import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import { MAX_ACTIVE_CODE_RULES } from "../../app/lib/config-guards.server.ts";
import { discountsPage, ruleEditorAction, ruleEditorPage } from "../../app/lib/integration/pages.server.ts";
import { loadRuleSync } from "../../app/lib/integration/sync-status.server.ts";
import { FIELD } from "../../app/components/model/rule-form.ts";
import type { UiResult } from "../../app/components/model/types.ts";
import { DiscountsScreen } from "../../app/components/screens/DiscountsScreen.tsx";
import { RuleEditorScreen } from "../../app/components/screens/RuleEditorScreen.tsx";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { FakeStore, formOf, renderPage, testCtx, text } from "./helpers.ts";

// Rule save / delete / enable → the canonical saveAndSync (integration step 1):
// a saved rule reaches Shopify in the same action, every refusal and every
// sync problem is rendered honestly, the unreadable-config confirm flow, and
// the per-rule "Běží" from real sync facts (step 3).

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-rule-save");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `rule-save-${seq}.myshopify.com`;
});

const PAGE = { scopes: "write_discounts,read_products,read_themes,read_markets" };

const automatic: [string, string][] = [
  ["intent", "save"],
  [FIELD.name, "Podzimní sleva"],
  [FIELD.enabled, "on"],
  [FIELD.valueKind, "percentage"],
  [FIELD.percent, "10"],
  [FIELD.target, "order"],
  [FIELD.method, "automatic"],
];
const withCode = (code: string, name = `Kód ${code}`): [string, string][] => [
  ...automatic.filter(([k]) => k !== FIELD.method && k !== FIELD.name),
  [FIELD.name, name],
  [FIELD.method, "code"],
  [FIELD.codes, code],
];

function shopConfigRules(store: FakeStore): string[] {
  const value = store.sync.shopMetafieldValue("function_config");
  return value ? JSON.parse(value).modules.codes.rules.map((r: { id: string }) => r.id) : [];
}

test("a new rule is saved AND written to Shopify in one action; the landing page says so and the rule 'Běží'", async () => {
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);

  const outcome = await ruleEditorAction(ctx, formOf(automatic), "new");
  assert.ok("redirect" in outcome, JSON.stringify(outcome));
  const id = /\/app\/discounts\/([^?]+)\?saved=1$/.exec(outcome.redirect)?.[1];
  assert.ok(id, outcome.redirect);

  // Shopify: the automatic Won node + the shop function config carrying the rule.
  assert.deepEqual(shopConfigRules(store), [id]);
  assert.equal(store.sync.wonNodes().filter((n) => n.kind === "automatic").length, 1);

  const page = await ruleEditorPage(ctx, { ...PAGE, ruleId: id, recipe: null, saved: true });
  assert.ok(page);
  assert.deepEqual(page.result, { ok: true, message: "saved", sync: { ok: true, problems: [], warnings: [] } });
  assert.deepEqual(page.ruleSync, { [id]: "synced" });
  assert.equal(page.sync.state, "ok");

  const html = text(await renderPage(createElement(RuleEditorScreen, page)));
  assert.match(html, /Uloženo a propsáno do Shopify/);
  assert.match(html, /Běží/);
});

test("a code rule gets its own Won node with the code; switching it off DEACTIVATES the node and it no longer 'Běží'", async () => {
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  const created = await ruleEditorAction(ctx, formOf(withCode("VIP10")), "new");
  assert.ok("redirect" in created);
  const id = /discounts\/([^?]+)/.exec(created.redirect)![1];
  const node = store.sync.wonNodes().find((n) => n.kind === "code");
  assert.deepEqual(node?.codes.map((c) => c.code), ["VIP10"]);
  assert.equal((await loadRuleSync(ctx, (await loadConfig(db.prisma, shop)).config))[id], "synced");

  // Switch off (the form without `enabled`): saved + synced, the node deactivated, not deleted.
  const off = await ruleEditorAction(ctx, formOf(withCode("VIP10").filter(([k]) => k !== FIELD.enabled)), id);
  assert.ok("result" in off && off.result.ok, JSON.stringify(off));
  assert.equal(store.sync.statusOf(store.sync.nodes.get(node!.id)!), "EXPIRED");
  const page = await discountsPage(ctx, { ...PAGE, deleted: false });
  assert.equal(page.ruleSync?.[id], "pending", "a deactivated node is not a live code");
  assert.match(text(await renderPage(createElement(DiscountsScreen, page))), /Vypnuto/);
});

test("refusals are rendered with their reason and fix: 21st code rule, colliding codes — nothing reaches Shopify", async () => {
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  const rules = Array.from({ length: MAX_ACTIVE_CODE_RULES }, (_, i) => ({
    id: `c${i}`,
    enabled: true,
    name: `Kód ${i}`,
    method: "code",
    codes: [`CODE${i}`],
    value: { kind: "percentage", percent: 5 },
    target: { kind: "order" },
  }));
  assert.equal((await saveConfig(db.prisma, shop, { modules: { codes: { rules } } })).ok, true);
  const opsBefore = store.ops.length;

  const outcome = await ruleEditorAction(ctx, formOf(withCode("ONE-TOO-MANY")), "new");
  assert.ok("result" in outcome);
  assert.equal(outcome.result.ok, false);
  assert.ok(!outcome.result.ok && outcome.result.reason === "too_many_code_rules");
  assert.equal(
    store.ops.slice(opsBefore).filter((op) => op.startsWith("WonSync") && op !== "WonSyncShop").length,
    0,
    "no sync write for a refused save",
  );

  const page = await ruleEditorPage(ctx, { ...PAGE, ruleId: "new", recipe: null, saved: false });
  const html = text(await renderPage(createElement(RuleEditorScreen, { ...page!, result: outcome.result })));
  assert.match(html, /Aktivních slev s kódem může být nejvýš 20, po uložení by jich bylo 21/);
  assert.match(html, /Zobrazit slevy/);
});

test("unreadable stored config: refused with 'Nahradit neplatnou konfiguraci'; the confirmed re-submit replaces it and syncs", async () => {
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  await db.prisma.shopConfig.create({ data: { shop, schemaVersion: 1, data: "{corrupted" } });

  const refused = await ruleEditorAction(ctx, formOf(automatic), "new");
  assert.deepEqual(refused, { result: { ok: false, reason: "unreadable_config" } });
  assert.equal((await db.prisma.shopConfig.findUnique({ where: { shop } }))?.data, "{corrupted", "the row is untouched");
  assert.equal(store.ops.filter((op) => op.startsWith("WonSync")).length, 0, "nothing sent to Shopify");

  const page = await ruleEditorPage(ctx, { ...PAGE, ruleId: "new", recipe: null, saved: false });
  assert.equal(page?.sync.state, "blocked");
  const refusal: UiResult = { ok: false, reason: "unreadable_config" };
  const html = text(await renderPage(createElement(RuleEditorScreen, { ...page!, result: refusal })));
  assert.match(html, /Uložené nastavení se nepodařilo přečíst/);
  assert.match(html, /Nahradit neplatnou konfiguraci/);

  // The button re-submits the same form with replaceUnreadable=1.
  const confirmed = await ruleEditorAction(ctx, formOf([...automatic, ["replaceUnreadable", "1"]]), "new");
  assert.ok("redirect" in confirmed, JSON.stringify(confirmed));
  const loaded = await loadConfig(db.prisma, shop);
  assert.equal(loaded.unreadable, false);
  assert.deepEqual(loaded.config.modules.codes.rules.map((r) => r.name), ["Podzimní sleva"]);
  assert.equal(shopConfigRules(store).length, 1, "synced after the replacement");
});

test("saved but NOT in Shopify: the result says what did not get through, 'Synchronizovat znovu', and the rule is 'Nepropsáno'", async () => {
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  // Every shop-config write fails (GraphQL error, not retried).
  store.sync.fail("WonSyncMetafieldsSet", { graphqlError: "Internal error. Looks like something went wrong on our end." }, 50);

  const outcome = await ruleEditorAction(ctx, formOf(automatic), "new");
  assert.ok("redirect" in outcome, "the rule is saved (redirected to its page)");
  const id = /discounts\/([^?]+)/.exec(outcome.redirect)![1];
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 1);

  const page = await ruleEditorPage(ctx, { ...PAGE, ruleId: id, recipe: null, saved: true });
  assert.ok(page?.result && page.result.ok && page.result.sync && !page.result.sync.ok);
  assert.ok(page.result.sync.problems.some((p) => p.key === "sync.problem.config"), JSON.stringify(page.result.sync.problems));
  assert.equal(page.ruleSync?.[id], "failed");
  const html = text(await renderPage(createElement(RuleEditorScreen, page)));
  assert.match(html, /Uloženo, ale do Shopify se zatím nepropsalo/);
  assert.match(html, /Nové nastavení slev se do pokladny zatím nezapsalo, platí předchozí/);
  assert.match(html, /Synchronizovat znovu/);
  assert.match(html, /Nepropsáno/);
  assert.doesNotMatch(html, />Běží</);

  // Editing an existing rule answers in place (no redirect) with the same honest result.
  const edited = await ruleEditorAction(ctx, formOf(automatic.map(([k, v]) => [k, k === FIELD.percent ? "15" : v])), id);
  assert.ok("result" in edited && edited.result.ok && edited.result.sync && !edited.result.sync.ok);
});

test("delete: the rule's Won node is deleted in Shopify; the list lands with 'Sleva smazána' and the sync outcome", async () => {
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  const created = await ruleEditorAction(ctx, formOf(withCode("LETO")), "new");
  assert.ok("redirect" in created);
  const id = /discounts\/([^?]+)/.exec(created.redirect)![1];
  assert.equal(store.sync.wonNodes().filter((n) => n.kind === "code").length, 1);

  const deleted = await ruleEditorAction(ctx, formOf([["intent", "delete"]]), id);
  assert.deepEqual(deleted, { redirect: "/app/discounts?deleted=1" });
  assert.equal(store.sync.wonNodes().filter((n) => n.kind === "code").length, 0, "the code node is gone");
  const page = await discountsPage(ctx, { ...PAGE, deleted: true });
  assert.deepEqual(page.result, { ok: true, message: "deleted", sync: { ok: true, problems: [], warnings: [] } });
  assert.match(text(await renderPage(createElement(DiscountsScreen, page))), /Sleva smazána/);

  // Another shop's rule id is not found here (SEC-2).
  assert.deepEqual(await ruleEditorAction(ctx, formOf([["intent", "delete"]]), "r_other"), { result: { ok: false, reason: "not_found" } });
});

test("'Běží' per rule: a rule changed after the last applied sync is 'čeká na propsání', the untouched one still runs", async () => {
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  const a = await ruleEditorAction(ctx, formOf(automatic), "new");
  const b = await ruleEditorAction(ctx, formOf(automatic.map(([k, v]) => [k, k === FIELD.name ? "Druhá" : v])), "new");
  assert.ok("redirect" in a && "redirect" in b);
  const idA = /discounts\/([^?]+)/.exec(a.redirect)![1];
  const idB = /discounts\/([^?]+)/.exec(b.redirect)![1];

  // B changes in the stored config without a sync (e.g. a save whose sync died with the process).
  await new Promise((resolve) => setTimeout(resolve, 5));
  const { config } = await loadConfig(db.prisma, shop);
  const next = { ...config, modules: { ...config.modules, codes: { rules: config.modules.codes.rules.map((r) => (r.id === idB ? { ...r, name: "Druhá (upravená)" } : r)) } } };
  assert.equal((await saveConfig(db.prisma, shop, next)).ok, true);

  const facts = await loadRuleSync(ctx, (await loadConfig(db.prisma, shop)).config);
  assert.deepEqual(facts, { [idA]: "synced", [idB]: "pending" });
  const page = await discountsPage(ctx, { ...PAGE, deleted: false });
  assert.match(text(await renderPage(createElement(DiscountsScreen, page))), /2 slevy · 1 běží · 1 čeká na propsání/);
});

// --- Fix round 1, item 2: "Běží" from the version link, not from timestamps --------------------

test("'Běží' follows the synced ConfigVersion, not clocks: a sync run stamped in the future cannot cover a later save", async () => {
  const store = new FakeStore();
  const { createSync } = await import("../../app/lib/sync/sync.server.ts");
  const { productionSyncDeps } = await import("../../app/lib/sync/wiring.server.ts");
  const future = new Date(Date.now() + 60 * 60_000);
  const ctx = {
    ...testCtx(db.prisma, shop, store),
    // A sync whose clock runs an hour ahead (another instance, a skewed host).
    createSync: (client: never, prisma: never) =>
      createSync({ ...productionSyncDeps(client, prisma, { info() {}, warn() {}, error() {} }), now: () => future, sleep: async () => {} }),
  };
  const created = await ruleEditorAction(ctx as never, formOf(automatic), "new");
  assert.ok("redirect" in created);
  const id = /discounts\/([^?]+)/.exec(created.redirect)![1];
  const { config } = await loadConfig(db.prisma, shop);
  // Changed after that run, never synced.
  const next = { ...config, modules: { ...config.modules, codes: { rules: config.modules.codes.rules.map((r) => ({ ...r, name: "Přejmenovaná" })) } } };
  assert.equal((await saveConfig(db.prisma, shop, next)).ok, true);
  assert.deepEqual(await loadRuleSync(ctx as never, (await loadConfig(db.prisma, shop)).config), { [id]: "pending" });
});

test("'Běží' compares the whole config version: an engine setting change leaves every rule 'čeká na propsání' until synced", async () => {
  const store = new FakeStore();
  const ctx = testCtx(db.prisma, shop, store);
  const a = await ruleEditorAction(ctx, formOf(automatic), "new");
  const b = await ruleEditorAction(ctx, formOf(withCode("VIP20")), "new");
  assert.ok("redirect" in a && "redirect" in b);
  const idA = /discounts\/([^?]+)/.exec(a.redirect)![1];
  const idB = /discounts\/([^?]+)/.exec(b.redirect)![1];
  assert.deepEqual(await loadRuleSync(ctx, (await loadConfig(db.prisma, shop)).config), { [idA]: "synced", [idB]: "synced" });

  const { config } = await loadConfig(db.prisma, shop);
  const engine = { ...config.engine, combination: { ...config.engine.combination, productWithOrder: !config.engine.combination.productWithOrder } };
  assert.equal((await saveConfig(db.prisma, shop, { ...config, engine })).ok, true);
  assert.deepEqual(await loadRuleSync(ctx, (await loadConfig(db.prisma, shop)).config), { [idA]: "pending", [idB]: "pending" });

  // An onboarding-only save does not touch what runs.
  const again = await loadConfig(db.prisma, shop);
  const { overviewAction } = await import("../../app/lib/integration/pages.server.ts");
  assert.equal((await overviewAction(ctx, formOf([["intent", "resync"]]))).ok, true);
  assert.equal((await saveConfig(db.prisma, shop, { ...(await loadConfig(db.prisma, shop)).config, onboarding: { goals: ["rewards"], step: 3 } })).ok, true);
  void again;
  assert.deepEqual(await loadRuleSync(ctx, (await loadConfig(db.prisma, shop)).config), { [idA]: "synced", [idB]: "synced" });
});
