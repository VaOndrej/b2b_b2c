import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createElement } from "react";

import { codeHash } from "@won/core/discounts/code-hash";

import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import { blockingSteps, changedRuleIds, clearDetectionCache, createSaveAndSync } from "../../app/lib/integration/native.server.ts";
import { onboardingAction, overviewAction, overviewPage } from "../../app/lib/integration/pages.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { Notice } from "../../app/components/shell/Notice.tsx";
import { OverviewScreen } from "../../app/components/screens/OverviewScreen.tsx";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { basicNode } from "../lib/native/fake-shopify.ts";
import { FakeStore, formOf, realSync, renderPage, testCtx, text } from "./helpers.ts";

// Move / undo of native discounts (integration step 4): app/lib/native
// moveNative / undoMove through the CANONICAL saveAndSync (the Won rule is
// saved AND its Won node + shop config are in Shopify before the move counts),
// the shop's native codes passed for the hash-collision check, results mapped
// to honest copy, the undo reachable from Přehled.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("int-native");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `native-${seq}.myshopify.com`;
  clearDetectionCache();
  clearSignalCache();
});

const PAGE = { scopes: "write_discounts,read_products,read_themes,read_markets" };

function wonCodeNodes(store: FakeStore) {
  return store.sync.wonNodes().filter((n) => n.kind === "code");
}

test("Přesunout: backup → native deleted → Won rule saved AND live in Shopify; Přehled lists it with 'Vrátit zpět'", async () => {
  const store = new FakeStore();
  const nativeId = store.native.add(basicNode({ title: "LETO15", codes: ["LETO15"], percentage: 0.15, used: 3, usageLimit: 50 }));
  const ctx = testCtx(db.prisma, shop, store);

  const result = await overviewAction(ctx, formOf([["intent", "move"], ["nativeId", nativeId], ["locale", "cs"]]));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok && result.message === "moved" && result.count === 1);
  assert.ok(result.notes?.some((n) => /zbývajících 47/.test(n)), "what to keep in mind after the move");

  assert.equal(store.native.nodes.has(nativeId), false, "the native discount is deleted");
  const rules = (await loadConfig(db.prisma, shop)).config.modules.codes.rules;
  assert.deepEqual(rules.map((r) => [r.method, r.codes, r.origin?.nativeId]), [["code", ["LETO15"], nativeId]]);
  assert.deepEqual(wonCodeNodes(store).map((n) => n.codes.map((c) => c.code)), [["LETO15"]], "the Won code node carries the code");
  const backup = await db.prisma.nativeDiscountBackup.findFirst({ where: { shop, nativeId } });
  assert.equal(backup?.status, "moved");

  const props = await overviewPage(ctx, PAGE);
  assert.ok(props.signals?.native.state === "ok");
  assert.deepEqual(props.signals.native.moved.map((m) => [m.backupId, m.state]), [[backup!.id, "moved"]]);
  assert.equal(props.ruleSync?.[rules[0].id], "synced", "the moved rule runs");
  const html = text(await renderPage(createElement(OverviewScreen, props)));
  assert.match(html, /Přesunuté do Won/);
  assert.match(html, /Vrátit zpět/);
  assert.match(text(await renderPage(createElement(Notice, { result }))), /1 sleva přesunuta do Won/);
});

test("Vrátit zpět: the Won rule and its node go, the native discount is back with its code; what did not come back is said", async () => {
  const store = new FakeStore();
  const nativeId = store.native.add(basicNode({ title: "LETO15", codes: ["LETO15"], percentage: 0.15, oncePerCustomer: true }));
  const ctx = testCtx(db.prisma, shop, store);
  assert.equal((await overviewAction(ctx, formOf([["intent", "move"], ["nativeId", nativeId]]))).ok, true);
  const backup = await db.prisma.nativeDiscountBackup.findFirst({ where: { shop, nativeId } });

  const undone = await overviewAction(ctx, formOf([["intent", "undo"], ["backupId", backup!.id]]));
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.ok(undone.ok && undone.message === "undone");
  assert.ok(undone.notes?.some((n) => /1× na zákazníka/.test(n)), JSON.stringify(undone));
  assert.equal(store.native.holderOf("LETO15")?.discount.__typename, "DiscountCodeBasic", "the native discount holds the code again");
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.modules.codes.rules, []);
  assert.equal(wonCodeNodes(store).length, 0, "the Won node is deleted");
  assert.match(text(await renderPage(createElement(Notice, { result: undone }))), /Přesun vrácen, sleva je zpět v Shopify/);

  // SEC-2: another shop cannot undo this shop's backup.
  const foreign = await overviewAction(testCtx(db.prisma, "other.myshopify.com", new FakeStore()), formOf([["intent", "undo"], ["backupId", backup!.id]]));
  assert.ok(!foreign.ok && foreign.reason === "native_failed");
});

test("a move whose Won node does not reach Shopify is rolled back and the discount restored at once — and the page says so", async () => {
  const store = new FakeStore();
  const nativeId = store.native.add(basicNode({ title: "LETO15", codes: ["LETO15"], percentage: 0.15 }));
  store.sync.fail("WonSyncCodeCreate", { graphqlError: "Internal error" }, 5);
  const ctx = testCtx(db.prisma, shop, store);

  const result = await overviewAction(ctx, formOf([["intent", "move"], ["nativeId", nativeId]]));
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "native_failed");
  assert.match(result.messages[0], /Přesun se nepovedl/);
  assert.match(result.messages[0], /Sleva „LETO15“ se do Shopify nepropsala/);
  assert.match(result.messages[0], /Slevu jsme hned vrátili do Shopify, funguje jako dřív/);
  assert.equal(store.native.holderOf("LETO15")?.discount.__typename, "DiscountCodeBasic", "the native discount is back");
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.modules.codes.rules, [], "no Won rule left behind");

  const html = text(await renderPage(createElement(Notice, { result })));
  assert.match(html, /Přesun se nepovedl\./);
  assert.match(html, /Slevu jsme hned vrátili do Shopify/);
});

test("otherCodes: a code whose hash collides with another native discount's code is refused, and the discount stays", async () => {
  const seen = new Map<string, string>();
  let pair: [string, string] | null = null;
  for (let i = 0; !pair; i++) {
    const code = `LETO${i}`;
    const other = seen.get(codeHash(code));
    if (other) pair = [other, code];
    else seen.set(codeHash(code), code);
  }
  const store = new FakeStore();
  const moving = store.native.add(basicNode({ title: "Přesouvaná", codes: [pair[0]], percentage: 0.1 }));
  store.native.add(basicNode({ title: "Zůstává", codes: [pair[1]], percentage: 0.2 }));
  const ctx = testCtx(db.prisma, shop, store);

  const result = await overviewAction(ctx, formOf([["intent", "move"], ["nativeId", moving]]));
  assert.ok(!result.ok && result.reason === "native_failed", JSON.stringify(result));
  assert.match(result.messages[0], new RegExp(`Kódy .*${pair[0]}.*nejde použít zároveň`));
  assert.ok(store.native.holderOf(pair[0]), "the discount is in Shopify (restored)");
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.modules.codes.rules, []);
});

test("Přesunout vše: each discount on its own; one refused, the other moved — both said", async () => {
  const store = new FakeStore();
  const a = store.native.add(basicNode({ title: "A10", codes: ["A10"], percentage: 0.1 }));
  const b = store.native.add(basicNode({ title: "B20", codes: ["B20"], percentage: 0.2 }));
  // B's code is already a Won rule's: the move refuses it before deleting anything.
  assert.equal(
    (await saveConfig(db.prisma, shop, { modules: { codes: { rules: [{ id: "won-b", enabled: true, name: "Won B", method: "code", codes: ["B20"], value: { kind: "percentage", percent: 5 }, target: { kind: "order" } }] } } })).ok,
    true,
  );
  const ctx = testCtx(db.prisma, shop, store);
  const result = await onboardingAction(ctx, formOf([["intent", "move"], ["nativeId", a], ["nativeId", b]]));
  assert.ok(result.ok && result.message === "moved" && result.count === 1, JSON.stringify(result));
  assert.equal(result.failures?.length, 1);
  assert.match(result.failures![0], /^B20: Kód B20 už má Won pravidlo „Won B“/);
  assert.equal(store.native.nodes.has(a), false);
  assert.equal(store.native.nodes.has(b), true, "B is untouched");
  const html = text(await renderPage(createElement(Notice, { result })));
  assert.match(html, /1 sleva přesunuta do Won/);
  assert.match(html, /Tyhle slevy se přesunout nepodařilo/);
});

test("the adapter: ok only when the changed rules are live; an unrelated old failure does not block a move", async () => {
  const steps = [
    { step: "shop.read", ok: true, detail: "" },
    { step: "node.create:code:other", ok: false, detail: "Code must be unique" },
    { step: "node.create:code:moved", ok: true, detail: "created" },
    { step: "shop_config.write", ok: true, detail: "written" },
    { step: "shop_config.verify", ok: true, detail: "verified" },
  ];
  const before = { modules: { codes: { rules: [] } } } as never;
  const afterConfig = {
    modules: { codes: { rules: [{ id: "moved", method: "code", target: { kind: "order" }, codes: ["X"] }] } },
  } as never;
  const changed = changedRuleIds(before, afterConfig);
  assert.deepEqual([...changed], ["moved"]);
  assert.deepEqual(blockingSteps(steps, changed, [before, afterConfig]), []);
  // The moved rule's node failed → blocking; the shop config not applied → blocking.
  const nodeFailed = steps.map((s) => (s.step === "node.create:code:moved" ? { ...s, ok: false } : s));
  assert.deepEqual(blockingSteps(nodeFailed, changed, [before, afterConfig]).map((s) => s.step), ["node.create:code:moved"]);
  const held = steps.filter((s) => !s.step.startsWith("shop_config")).concat([{ step: "shop_config.write", ok: false, detail: "held" }]);
  assert.deepEqual(blockingSteps(held, changed, [before, afterConfig]).map((s) => s.step), ["shop_config.write"]);

  // And for real: an adapter call whose save is refused answers with the refusal's sentence, nothing synced.
  const store = new FakeStore();
  const adapter = createSaveAndSync({ client: store, db: db.prisma, createSync: realSync, locale: "en" });
  const rules = Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, enabled: true, name: `C${i}`, method: "code", codes: [`C${i}X`], value: { kind: "percentage", percent: 5 }, target: { kind: "order" } }));
  const refused = await adapter({ shop, config: { modules: { codes: { rules } } } as never });
  assert.equal(refused.ok, false);
  assert.match(!refused.ok ? refused.message : "", /at most 20 active code discounts|20/);
  assert.equal(store.sync.mutations().length, 0);
  const saved = await adapter({ shop, config: { modules: { codes: { rules: rules.slice(0, 1) } } } as never });
  assert.deepEqual(saved, { ok: true });
});
