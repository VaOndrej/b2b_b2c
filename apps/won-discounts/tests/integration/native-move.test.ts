import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createElement } from "react";

import { codeHash } from "@won/core/discounts/code-hash";

import { loadConfig, saveConfig } from "../../app/lib/config.server.ts";
import { blockingSteps, changedRuleIds, clearDetectionCache, createSaveAndSync } from "../../app/lib/integration/native.server.ts";
import { onboardingAction, overviewAction, overviewPage } from "../../app/lib/integration/pages.server.ts";
import { clearSignalCache } from "../../app/lib/ui-actions.server.ts";
import { MoveDialogBody, UndoDialogBody, type UndoableBackup } from "../../app/components/MoveDialog.tsx";
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
  // F11 / audit P2-7: moved discounts live in Won, uninstalling ends them — said next to them.
  assert.match(html, /Když aplikaci odinstalujete, přestanou platit/);
  // F11: what the undo changes is known BEFORE its confirmation (the dialog body).
  const listed = props.signals.native.moved[0] as UndoableBackup;
  assert.ok(listed.undoCosts?.some((c) => /s novým ID/.test(c)), JSON.stringify(listed));
  assert.ok(listed.undoCosts?.some((c) => /zbývá/.test(c)), "a limited discount: the remaining uses are kept");
  const undoHtml = text(await renderPage(createElement(UndoDialogBody, { backup: listed })));
  assert.match(undoHtml, /Co se změní/);
  assert.match(undoHtml, /s novým ID/);
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
  assert.match(result.messages[0], /Sleva „LETO15“ se do Shopify nezapsala/);
  // F1: a restore is a new discount, never "as before".
  assert.match(result.messages[0], /Slevu jsme hned vrátili do Shopify\. Je to nová sleva s novým ID\. Počítadlo použití začíná od nuly\./);
  assert.doesNotMatch(result.messages[0], /funguje jako dřív/);
  assert.equal(store.native.holderOf("LETO15")?.discount.__typename, "DiscountCodeBasic", "the native discount is back");
  assert.deepEqual((await loadConfig(db.prisma, shop)).config.modules.codes.rules, [], "no Won rule left behind");

  const html = text(await renderPage(createElement(Notice, { result })));
  assert.match(html, /Přesun se nepovedl\./);
  assert.match(html, /Slevu jsme hned vrátili do Shopify/);
});

test("otherCodes: a code whose hash collides with another native discount's code is refused BEFORE the delete (F1), and the discount stays", async () => {
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
  assert.match(result.messages[0], /Nic se nezměnilo/);
  assert.ok(store.native.nodes.has(moving), "never deleted: the same discount, same id");
  assert.equal(store.ops.filter((op) => op === "WonNativeCodeDelete").length, 0);
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

test("F11: the move dialog tells the true order (delete first, a short window), the uninstall risk and the undo's cost", async () => {
  const html = text(
    await renderPage(
      createElement(MoveDialogBody, {
        discounts: [{ id: "gid://shopify/DiscountCodeNode/1", title: "LETO15", method: "code", movable: true, losses: [], warnings: [] }],
      }),
    ),
  );
  const backup = html.indexOf("Uložíme zálohu");
  const remove = html.indexOf("Slevu v Shopify smažeme");
  const create = html.indexOf("Hned vytvoříme stejné pravidlo");
  assert.ok(backup >= 0 && backup < remove && remove < create, html);
  assert.match(html, /sleva chvíli neplatí/);
  assert.match(html, /Nic\./, "no losses → 'Nic.' (reachable now)");
  assert.match(html, /Když aplikaci odinstalujete, přestanou platit/);
  assert.match(html, /nové ID, počítadlo od nuly, limit na zbývající použití/);
  assert.doesNotMatch(html, /zůstane v Shopify/);
});

test("F1: Přesunout vše stops after the first limit refusal: the rest is skipped, unchanged, and said", async () => {
  const store = new FakeStore();
  const a = store.native.add(basicNode({ title: "A10", codes: ["A10"], percentage: 0.1 }));
  const big = store.native.add(basicNode({ title: "Tisíc", codes: Array.from({ length: 900 }, (_, i) => `T${String(i).padStart(4, "0")}`) }));
  const c = store.native.add(basicNode({ title: "C30", codes: ["C30"], percentage: 0.3 }));
  const ctx = testCtx(db.prisma, shop, store);

  const result = await overviewAction(ctx, formOf([["intent", "move"], ["nativeId", a], ["nativeId", big], ["nativeId", c]]));
  assert.ok(result.ok && result.count === 1, JSON.stringify(result));
  assert.equal(result.failures?.length, 2);
  assert.match(result.failures![0], /^Tisíc: Won pravidla by se s touhle slevou nevešla do limitu Shopify/);
  assert.match(result.failures![0], /Nic se nezměnilo/);
  assert.match(result.failures![1], /^C30: Nepřesunuli jsme ji: předchozí sleva narazila na limit Won/);
  assert.ok(store.native.nodes.has(big) && store.native.nodes.has(c), "neither was deleted");
  assert.equal(store.native.nodes.has(a), false);
  const deletes = store.calls.filter((call) => call.op === "WonNativeCodeDelete").map((call) => call.variables.id);
  assert.deepEqual(deletes, [a]);
});

test("F3 follow-up: an automatic discount's dialog tells the create-first order; a mixed dialog shows both, titled", async () => {
  const auto = { id: "gid://shopify/DiscountAutomaticNode/2", title: "Auto 10 %", method: "automatic" as const, movable: true, losses: [], warnings: [] };
  const code = { id: "gid://shopify/DiscountCodeNode/1", title: "LETO15", method: "code" as const, movable: true, losses: [], warnings: [] };
  const html = text(await renderPage(createElement(MoveDialogBody, { discounts: [auto] })));
  const create = html.indexOf("Vytvoříme stejné pravidlo ve Won");
  const remove = html.indexOf("Potom původní slevu v Shopify smažeme");
  assert.ok(html.indexOf("Uložíme zálohu") < create && create < remove, html);
  assert.match(html, /Krátce mohou platit obě slevy, pak smažeme původní/);
  assert.doesNotMatch(html, /sleva chvíli neplatí/, "no gap without the discount for an automatic one");
  assert.doesNotMatch(html, /Automatické slevy|Slevy s kódem/, "one kind: no titles");

  const mixed = text(await renderPage(createElement(MoveDialogBody, { discounts: [code, auto] })));
  assert.match(mixed, /Automatické slevy/);
  assert.match(mixed, /Slevy s kódem/);
  assert.match(mixed, /Shopify nepustí stejný kód ke dvěma slevám, ani když je jedna ukončená/);
});

test("F4 remainder: the dialog says how a discount stacks with one that stays in Shopify, not with one moved in the same batch", async () => {
  const a = {
    id: "gid://shopify/DiscountAutomaticNode/1",
    title: "A",
    method: "automatic" as const,
    movable: true,
    losses: [],
    warnings: [],
    stacking: [{ nativeId: "gid://shopify/DiscountAutomaticNode/2", text: "V Shopify se nesčítala s „B“. Po přesunu se sečtou." }],
  };
  const b = { id: "gid://shopify/DiscountAutomaticNode/2", title: "B", method: "automatic" as const, movable: true, losses: [], warnings: [] };
  const alone = text(await renderPage(createElement(MoveDialogBody, { discounts: [a] })));
  assert.match(alone, /Po přesunu se sečtou/, "B stays in Shopify");
  const both = text(await renderPage(createElement(MoveDialogBody, { discounts: [a, b] })));
  assert.doesNotMatch(both, /Po přesunu se sečtou/, "B moves too");
});
