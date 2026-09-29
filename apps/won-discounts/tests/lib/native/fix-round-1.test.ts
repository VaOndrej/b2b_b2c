// Fix round 1 of Task 4 (review task-4-review.md). One block per finding; each
// test was written first and failed on commit 36c84dd (see task-4-report.md).

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createDefaultConfig } from "@won/core/discounts/config";

import { loadConfig, saveConfig } from "../../../app/lib/config.server.ts";
import { classifyNative } from "../../../app/lib/native/classify.ts";
import * as copy from "../../../app/lib/native/copy.ts";
import { detectNativeDiscounts } from "../../../app/lib/native/detect.server.ts";
import { planMove } from "../../../app/lib/native/map.server.ts";
import { DELETE_RECHECK_DELAYS_MS, moveNative, undoMove } from "../../../app/lib/native/move.server.ts";
import { normalizeNode } from "../../../app/lib/native/normalize.ts";
import { runGql } from "../../../app/lib/native/request.server.ts";
import { makeSnapshot, parseSnapshot } from "../../../app/lib/native/restore.server.ts";
import type { NativeDiscount } from "../../../app/lib/native/types.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { basicNode, FakeShopify, otherNode, scriptedClient } from "./fake-shopify.ts";
import { createFakeSync, type SyncFailure } from "./fake-sync.ts";

let db: TestDatabase;
let shopCounter = 0;

before(() => {
  db = createTestDatabase("native-fix1");
});

after(async () => {
  await db.drop();
});

const NOW = new Date("2026-09-28T12:00:00Z");
const SHOP_CONTEXT = { currencyCode: "CZK", ianaTimezone: "Europe/Prague" };
const fast = { sleep: async () => {}, bulkPolls: 2, now: () => NOW };

function setup(failures: SyncFailure[] = []) {
  shopCounter += 1;
  const shop = `fix1-${shopCounter}.myshopify.com`;
  const shopify = new FakeShopify();
  shopify.now = () => NOW;
  const sync = createFakeSync(db.prisma, shopify, failures);
  const common = { client: shopify, db: db.prisma, shop, saveAndSync: sync.saveAndSync, ...fast };
  return { shop, shopify, sync, common };
}

const rows = (shop: string) => db.prisma.nativeDiscountBackup.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });

function native(raw: { id: string; discount: unknown }): NativeDiscount {
  const node = normalizeNode(raw, SHOP_CONTEXT);
  assert.ok(node && node.movableType);
  return node.native;
}

/** The delete call fails in transport and every existence check afterwards fails too. */
function deleteOutcomeUnknown(shopify: FakeShopify, landed: boolean) {
  shopify.inject("WonNativeCodeDelete", landed ? { throwsAfterApply: "socket hang up" } : { throws: "socket hang up" });
  // Every re-check after the unanswered delete (DELETE_RECHECK_DELAYS_MS, 4 attempts per read) fails too.
  shopify.inject("WonNativeDiscountExists", ...Array.from({ length: 4 * DELETE_RECHECK_DELAYS_MS.length }, () => ({ throws: "ETIMEDOUT" })));
}

// --- Critical 1: unknown delete outcome ----------------------------------------------

for (const landed of [true, false]) {
  test(`Critical 1: delete ${landed ? "landed" : "did not land"}, check failed → honest 'unknown', backup kept, undo converges`, async () => {
    const { shop, shopify, common } = setup();
    const nativeId = shopify.add(basicNode({ title: "Nejistá", codes: ["NEJISTA"] }));
    deleteOutcomeUnknown(shopify, landed);

    const result = await moveNative({ ...common, nativeId });
    assert.ok(!result.ok);
    assert.equal(result.code, "outcome_unknown");
    assert.equal((result as { state?: string }).state, "unknown");
    assert.doesNotMatch(result.error, /Nic se nezměnilo/);
    assert.match(result.error, /Nevíme, jestli Shopify slevu smazal/);
    const [row] = await rows(shop);
    assert.equal(row.status, "backed_up");
    assert.equal(parseSnapshot(row.snapshot)?.restoredAs, undefined);
    assert.equal(shopify.nodes.has(nativeId), !landed);

    const undo = await undoMove({ ...common, backupId: row.id });
    assert.ok(undo.ok, JSON.stringify(undo));
    const holder = shopify.holderOf("NEJISTA");
    assert.equal(holder?.discount.__typename, "DiscountCodeBasic");
    assert.equal(holder?.discount.title, "Nejistá");
    assert.equal([...shopify.nodes.values()].filter((n) => n.discount.title === "Nejistá").length, 1);
    assert.equal((await rows(shop))[0].status, "restored");
  });

  test(`Critical 1: delete ${landed ? "landed" : "did not land"}, check failed → a retried move converges to 'moved'`, async () => {
    const { shop, shopify, sync, common } = setup();
    const nativeId = shopify.add(basicNode({ title: "Znovu", codes: ["ZNOVU"] }));
    deleteOutcomeUnknown(shopify, landed);
    const first = await moveNative({ ...common, nativeId });
    assert.ok(!first.ok);
    assert.equal(first.code, "outcome_unknown");

    const again = await moveNative({ ...common, nativeId });
    assert.ok(again.ok, JSON.stringify(again));
    assert.equal(shopify.nodes.has(nativeId), false);
    assert.equal(shopify.holderOf("ZNOVU")?.id, sync.nodeIds.get(again.ruleId));
    const all = await rows(shop);
    assert.equal(all.length, 1);
    assert.equal(all[0].status, "moved");
  });
}

// --- Important 1: refusals on the resume path restore at once --------------------------

async function resumeRow(shop: string, raw: { id: string; discount: unknown }, shopify: FakeShopify) {
  return db.prisma.nativeDiscountBackup.create({
    data: {
      shop,
      nativeId: raw.id,
      kind: "code_basic",
      title: "resume",
      snapshot: JSON.stringify(makeSnapshot(raw, shopify.shop)),
      wonRuleId: null,
      status: "backed_up",
    },
  });
}

test("Important 1: resumed move refused (code now on another Won rule) → the native is restored at once", async () => {
  const { shop, shopify, common } = setup();
  const raw = basicNode({ title: "Obnov mě", codes: ["OBNOV"] });
  await resumeRow(shop, raw, shopify); // native already deleted by an earlier attempt
  const config = createDefaultConfig();
  config.modules.codes.rules.push({
    id: "jine",
    enabled: true,
    name: "Jiné pravidlo",
    method: "code",
    codes: ["OBNOV"],
    value: { kind: "percentage", percent: 5 },
    target: { kind: "order" },
  });
  assert.ok((await saveConfig(db.prisma, shop, config)).ok);

  const result = await moveNative({ ...common, nativeId: raw.id });
  assert.ok(!result.ok);
  assert.equal(result.code, "code_taken");
  assert.equal(result.nativeRestored, true);
  assert.doesNotMatch(result.error, /Nic se nezměnilo/);
  assert.match(result.error, /Slevu jsme hned vrátili do Shopify/);
  assert.equal(shopify.holderOf("OBNOV")?.discount.title, "Obnov mě");
  const [row] = await rows(shop);
  assert.equal(row.status, "failed");
  assert.equal(parseSnapshot(row.snapshot)?.restoredAs?.nativeId, result.restoredNativeId);
});

test("Important 1: resumed move whose read fails → 'unknown', never 'nothing changed'", async () => {
  const { shop, shopify, common } = setup();
  const raw = basicNode({ title: "Nečitelná", codes: ["NECITELNA"] });
  await resumeRow(shop, raw, shopify);
  shopify.inject("WonNativeDiscount", ...Array.from({ length: 4 }, () => ({ throws: "ETIMEDOUT" })));
  const result = await moveNative({ ...common, nativeId: raw.id });
  assert.ok(!result.ok);
  assert.equal(result.code, "outcome_unknown");
  assert.doesNotMatch(result.error, /Nic se nezměnilo/);
  assert.equal((await rows(shop))[0].status, "backed_up");
});

// --- Important 2: REL-3 checks the rollback and the codes -----------------------------

test("Important 2: sync failed after save AND rollback fails → automatic native NOT recreated (no double discount), undo finishes", async () => {
  const { shop, shopify, common } = setup(["after_save", "before_save"]);
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Dvakrát ne", percentage: 0.2 }));

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.code, "sync_failed");
  assert.equal((result as { state?: string }).state, "rule_stuck");
  assert.equal(result.nativeRestored, false);
  assert.doesNotMatch(result.error, /funguje jako dřív/);
  assert.equal([...shopify.nodes.values()].filter((n) => n.discount.title === "Dvakrát ne").length, 0);
  assert.equal(shopify.callsTo("WonNativeAutomaticBasicCreate").length, 0);
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 1, "the rule could not be removed");
  const [row] = await rows(shop);
  assert.equal(row.status, "failed");
  assert.equal(parseSnapshot(row.snapshot)?.restoredAs, undefined);

  const undo = await undoMove({ ...common, backupId: row.id });
  assert.ok(undo.ok, JSON.stringify(undo));
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 0);
  assert.equal([...shopify.nodes.values()].filter((n) => n.discount.title === "Dvakrát ne").length, 1);
});

test("Important 2: the config is rolled back BEFORE the restore (no 'code taken' round trip)", async () => {
  const { shopify, common } = setup(["after_node"]);
  const nativeId = shopify.add(basicNode({ title: "Pořadí", codes: ["PORADI"] }));
  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal((result as { state?: string }).state, "restored");
  const lookupsBeforeCreate = shopify.calls.findIndex((c) => c.name === "WonNativeCodeBasicCreate");
  const takenAnswers = shopify.calls.slice(0, lookupsBeforeCreate).filter((c) => c.name === "WonNativeCodeLookup");
  // Two reads of the code before the create, both finding it free: the F2 live check
  // (no Won node may hold it) and the restore's own look-up. No resync round trip.
  assert.equal(takenAnswers.length, 2, "the live check and the restore's look-up, no 'code taken' retry");
  assert.equal(shopify.callsTo("WonNativeCodeBasicCreate").length, 1);
});

test("Important 2: codes lost in the immediate restore are surfaced and kept for undo", async () => {
  const { shop, shopify, common } = setup(["before_save"]);
  const codes = Array.from({ length: 260 }, (_, i) => `ZTRATA${i}`);
  const nativeId = shopify.add(basicNode({ title: "Ztracené kódy", codes }));
  shopify.inject("WonNativeRedeemCodesAdd", { userErrors: [{ message: "Internal error" }] });

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal((result as { state?: string }).state, "restored_partly");
  assert.equal((result as { codesMissing?: number }).codesMissing, 250);
  assert.doesNotMatch(result.error, /funguje jako dřív/);
  assert.match(result.error, /250 kódů/);
  const [row] = await rows(shop);
  assert.equal(parseSnapshot(row.snapshot)?.restoredAs?.codesMissing, 250);

  const undo = await undoMove({ ...common, backupId: row.id });
  assert.ok(undo.ok, JSON.stringify(undo));
  assert.equal(shopify.codesOf(result.restoredNativeId!).length, 260);
  assert.equal((await rows(shop))[0].status, "restored");
});

test("Minor 6: codes Shopify is still importing are not reported as failed", async () => {
  const { shop, shopify, common } = setup();
  const codes = Array.from({ length: 5 }, (_, i) => `POMALU${i}`);
  const nativeId = shopify.add(basicNode({ title: "Pomalé kódy", codes }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);
  shopify.bulkNeverDone = true;

  const undo = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(undo.ok, JSON.stringify(undo));
  assert.ok(undo.notRestored.some((t) => t.includes("ještě nahrává")), undo.notRestored.join("\n"));
  assert.ok(!undo.notRestored.some((t) => t.includes("nepodařilo")), undo.notRestored.join("\n"));
  assert.equal(parseSnapshot((await rows(shop))[0].snapshot)?.restoredAs?.codesPending, true);
});

test("Review (cannot verify): a Won node left without its rule in the saved config is re-synced away, then the native comes back", async () => {
  const { shop, shopify, sync, common } = setup(["node_without_save"]);
  const nativeId = shopify.add(basicNode({ title: "Sirotek", codes: ["SIROTEK"] }));
  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.state, "restored");
  assert.equal(shopify.holderOf("SIROTEK")?.discount.__typename, "DiscountCodeBasic");
  assert.equal(sync.nodeIds.size, 0, "the orphan Won node is gone");
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 0);
});

test("Minor 2: an automatic restore answered with a GraphQL error although it landed is found, not duplicated", async () => {
  const { shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Chybná odpověď" }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);
  shopify.inject("WonNativeAutomaticBasicCreate", { graphqlErrorAfterApply: "Internal error" });
  const undo = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(undo.ok, JSON.stringify(undo));
  const copies = [...shopify.nodes.values()].filter((n) => n.discount.title === "Chybná odpověď");
  assert.equal(copies.length, 1);
  assert.equal(copies[0].id, undo.nativeId);
});

// --- Important 3: never delete on an incomplete snapshot ------------------------------

test("Important 3: codesCount AT_LEAST → not movable, nothing deleted", async () => {
  const { shop, shopify, common } = setup();
  const raw = basicNode({ title: "Hodně kódů", codes: ["A1", "A2"] });
  raw.discount.fakeCodesCount = { count: 10000, precision: "AT_LEAST" };
  const nativeId = shopify.add(raw);
  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.code, "not_movable");
  assert.equal(shopify.callsTo("WonNativeCodeDelete").length, 0);
  assert.equal((await rows(shop)).length, 0);
  const detection = await detectNativeDiscounts(shopify, fast);
  assert.equal(detection.notMovable.find((e) => e.id === nativeId)?.reasonCode, "too_many_codes_to_back_up");
});

test("Important 3: fewer codes read than Shopify counts → incomplete snapshot, refused before the delete", async () => {
  const { shop, shopify, common } = setup();
  const raw = basicNode({ title: "Neúplná", codes: ["B1", "B2", "B3"] });
  raw.discount.fakeCodesCount = { count: 7, precision: "EXACT" };
  const nativeId = shopify.add(raw);
  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.code, "not_movable");
  assert.match(result.error, /nepodařilo načíst celou/);
  assert.equal(shopify.callsTo("WonNativeCodeDelete").length, 0);
  assert.equal((await rows(shop)).length, 0);
});

// --- Minor 1: conflicts with BXGY / other apps' codes ---------------------------------

test("Minor 1: a BXGY or another app's code discount holding a Won rule's code is a conflict", async () => {
  const shopify = new FakeShopify();
  const bxgy = shopify.add(otherNode("DiscountCodeBxgy", { title: "2+1 kód", codes: ["DVAJEDNA"] }));
  const app = shopify.add(otherNode("DiscountCodeApp", { title: "Věrnost", codes: ["VERNOST"] }));
  const config = createDefaultConfig();
  config.modules.codes.rules.push(
    { id: "a", enabled: true, name: "Won A", method: "code", codes: ["DVAJEDNA"], value: { kind: "percentage", percent: 5 }, target: { kind: "order" } },
    { id: "b", enabled: true, name: "Won B", method: "code", codes: ["vernost"], value: { kind: "percentage", percent: 5 }, target: { kind: "order" } },
  );
  const { conflicts } = await detectNativeDiscounts(shopify, { ...fast, config });
  assert.deepEqual(conflicts.map((c) => `${c.kind}:${c.nativeId}:${c.ruleId}`).sort(), [`same_code:${bxgy}:a`, `same_code:${app}:b`].sort());
});

// --- Minor 2: partial data survives a per-item error (API-2) ---------------------------

test("Minor 2: runGql keeps partial data next to per-item errors", async () => {
  const client = scriptedClient(async () => ({
    data: { discountNodes: { nodes: [{ id: "x" }] } },
    errors: [{ message: "Access denied for field", path: ["discountNodes", "nodes", 1] }],
  }));
  const result = await runGql(client, "shop", undefined, fast);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.deepEqual(result.data, { discountNodes: { nodes: [{ id: "x" }] } });
  assert.deepEqual((result as { partialErrors?: string[] }).partialErrors, ["Access denied for field"]);
});

// --- Minor 3/4/5/7: mapping and classification -----------------------------------------

test("Minor 3: a one-time-only native warns that Won would also discount subscriptions", () => {
  const plan = planMove(native(basicNode({ codes: ["JEDNOU"] })), createDefaultConfig(), { now: NOW });
  assert.ok(plan.warnings.some((w) => w.includes("předplatné")), plan.warnings.join("\n"));
});

test("Minor 4: an unparseable amount is refused, never an empty amount", () => {
  const n = native(basicNode({ method: "automatic", amount: "abc" }));
  assert.ok(classifyNative(n), "classified as not movable");
  assert.throws(() => planMove(n, createDefaultConfig(), { now: NOW }), /Won nezná/);
});

test("Minor 5: a code discount without any code is not movable", () => {
  const n = native(basicNode({ codes: [] }));
  assert.equal(classifyNative(n)?.code, "no_codes");
});

test("Minor 7: a subscription cycle limit that Won cannot keep is a stated loss; undo restores it", async () => {
  const raw = basicNode({ codes: ["CYKLUS"], appliesOnSubscription: true });
  raw.discount.codeBasicCycleLimit = 3;
  const plan = planMove(native(raw), createDefaultConfig(), { now: NOW });
  assert.ok(plan.losses.some((l) => l.includes("3")) && plan.losses.some((l) => l.includes("předplatné")), plan.losses.join("\n"));

  const { shopify, common } = setup();
  const nativeId = shopify.add(raw);
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);
  const undo = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(undo.ok);
  const create = shopify.callsTo("WonNativeCodeBasicCreate")[0];
  assert.equal((create.variables?.input as { recurringCycleLimit?: number }).recurringCycleLimit, 3);
});

test("Minor 8: copy has no formatMoney (name clash with the UI money helper)", () => {
  assert.equal("formatMoney" in copy, false);
});

// --- Minor 9: a DB guard, not only the in-process lock ---------------------------------

test("Minor 9: two app instances (no shared process lock) move the same native once", async () => {
  const { shop, shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Dvě instance" }));
  // A second copy of the module = a second app instance: its own in-process queue.
  const secondInstance = new URL("../../../app/lib/native/move.server.ts?instance=second", import.meta.url).href;
  const other = (await import(secondInstance)) as typeof import("../../../app/lib/native/move.server.ts");
  assert.notEqual(other.moveNative, moveNative);
  const [a, b] = await Promise.all([moveNative({ ...common, nativeId }), other.moveNative({ ...common, nativeId })]);
  const oks = [a, b].filter((r) => r.ok);
  assert.equal(oks.length >= 1, true);
  assert.equal(shopify.callsTo("WonNativeAutomaticDelete").length, 1);
  const all = await rows(shop);
  assert.equal(all.filter((r) => r.status === "moved").length, 1);
  assert.equal(all.length, 1);
  const loser = [a, b].find((r) => !r.ok || r.alreadyMoved);
  assert.ok(loser, "the second one saw the first");
  // Deterministic since the DB claim guard (partial unique index, fix round 1 of T5b):
  // exactly one instance moved it; the other was told it is in progress (or already moved).
  assert.equal([a, b].filter((r) => r.ok && !r.alreadyMoved).length, 1);
  assert.ok(!loser.ok ? loser.code === "in_progress" && loser.state === "in_progress" : loser.alreadyMoved, JSON.stringify(loser));
});

test("Minor 9 (DB guard): the losing instance's claim is refused by the database, never a second backup row", async () => {
  const { shop, shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Pojistka" }));
  // Instance A holds a live claim (its row was created a moment ago in another process).
  const held = await db.prisma.nativeDiscountBackup.create({
    data: { shop, nativeId, kind: "automatic_basic", title: "Pojistka", snapshot: "{}", status: "moving" },
  });
  // Instance B raced past the "previous row" check before A's row existed: its own create now hits the index.
  await assert.rejects(
    db.prisma.nativeDiscountBackup.create({ data: { shop, nativeId, kind: "automatic_basic", title: "Pojistka", snapshot: "{}", status: "moving" } }),
    (error: { code?: string }) => error.code === "P2002",
  );
  // And through the move itself: in progress, nothing deleted, still one row.
  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok && result.code === "in_progress" && result.backupId === held.id, JSON.stringify(result));
  assert.equal(shopify.callsTo("WonNativeAutomaticDelete").length, 0);
  assert.equal((await rows(shop)).length, 1);
});

test("Minor 9: a live claim of another instance blocks; a stale one is taken over", async () => {
  const { shop, shopify, common } = setup();
  const raw = basicNode({ title: "Zámek", codes: ["ZAMEK1"] });
  const nativeId = shopify.add(raw);
  const claim = await db.prisma.nativeDiscountBackup.create({
    data: { shop, nativeId, kind: "code_basic", title: "Zámek", snapshot: JSON.stringify(makeSnapshot(raw, shopify.shop)), status: "moving" },
  });
  const blocked = await moveNative({ ...common, nativeId });
  assert.ok(!blocked.ok);
  assert.equal(blocked.code, "in_progress");
  assert.equal(shopify.callsTo("WonNativeCodeDelete").length, 0);

  await db.prisma.nativeDiscountBackup.update({ where: { id: claim.id }, data: { updatedAt: new Date(Date.now() - 60 * 60_000) } });
  const takeover = await moveNative({ ...common, nativeId });
  assert.ok(takeover.ok, JSON.stringify(takeover));
  assert.equal((await rows(shop)).length, 1);
});
