import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { loadConfig, saveConfig } from "../../../app/lib/config.server.ts";
import { moveNative, previewMove, undoMove } from "../../../app/lib/native/move.server.ts";
import { makeSnapshot, parseSnapshot } from "../../../app/lib/native/restore.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { basicNode, FakeShopify, freeShippingNode, otherNode } from "./fake-shopify.ts";
import { createFakeSync, type SyncFailure } from "./fake-sync.ts";

// Decision C6 + REL-3: backup → delete native → rule in Won; a failure after
// the delete restores the native AT ONCE with the same code; undo restores it
// from the backup and removes the Won rule. Idempotent, one at a time per shop.

let db: TestDatabase;
let shopCounter = 0;

before(() => {
  db = createTestDatabase("native-move");
});

after(async () => {
  await db.drop();
});

const NOW = new Date("2026-09-28T12:00:00Z");
const fast = { sleep: async () => {}, bulkPolls: 2, now: () => NOW };

function setup(failures: SyncFailure[] = []) {
  shopCounter += 1;
  const shop = `native-${shopCounter}.myshopify.com`;
  const shopify = new FakeShopify();
  shopify.now = () => NOW;
  const sync = createFakeSync(db.prisma, shopify, failures);
  const common = { client: shopify, db: db.prisma, shop, saveAndSync: sync.saveAndSync, ...fast };
  return { shop, shopify, sync, common };
}

async function backups(shop: string) {
  return db.prisma.nativeDiscountBackup.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });
}

const manyCodes = (n: number) => Array.from({ length: n }, (_, i) => `Leto${String(i).padStart(3, "0")}`);

test("move: backup with EVERY code → native deleted → Won rule live on its own node", async () => {
  const { shop, shopify, sync, common } = setup();
  const codes = manyCodes(120); // more than the first page (100): the full read pages
  const nativeId = shopify.add(
    basicNode({ title: "Léto 10 %", codes, items: { products: ["gid://shopify/Product/1"] }, oncePerCustomer: true, used: 3 }),
  );

  const result = await moveNative({ ...common, nativeId });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.ok);
  assert.equal(result.alreadyMoved, false);
  assert.equal(result.ruleId, `native-${nativeId.split("/").pop()}`);
  assert.ok(result.losses.some((l) => l.includes("1× na zákazníka")));
  assert.equal(shopify.nodes.has(nativeId), false, "native deleted");
  assert.equal(shopify.callsTo("WonNativeCodesPage").length, 1);

  const [row] = await backups(shop);
  assert.equal(row.status, "moved");
  assert.equal(row.wonRuleId, result.ruleId);
  assert.equal(row.kind, "code_basic");
  const snapshot = parseSnapshot(row.snapshot);
  assert.equal(snapshot?.node.discount.codes.nodes.length, 120);

  const { config } = await loadConfig(db.prisma, shop);
  const rule = config.modules.codes.rules.find((r) => r.id === result.ruleId);
  assert.equal(rule?.codes?.length, 120);
  assert.deepEqual(rule?.origin, { nativeId });
  // The code now lives on Won's node.
  assert.equal(shopify.holderOf("LETO000")?.id, sync.nodeIds.get(result.ruleId));
});

test("idempotent + one at a time: two clicks delete once, both answer ok", async () => {
  const { shop, shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Auto 5 %", percentage: 0.05 }));

  const [a, b] = await Promise.all([moveNative({ ...common, nativeId }), moveNative({ ...common, nativeId })]);
  assert.ok(a.ok && b.ok);
  assert.equal(a.alreadyMoved, false);
  assert.equal(b.alreadyMoved, true);
  assert.equal(b.backupId, a.backupId);
  assert.equal(shopify.callsTo("WonNativeAutomaticDelete").length, 1);
  assert.equal((await backups(shop)).length, 1);

  const again = await moveNative({ ...common, nativeId });
  assert.ok(again.ok && again.alreadyMoved);
  assert.equal(shopify.callsTo("WonNativeAutomaticDelete").length, 1);
});

test("REL-3: sync fails after the delete (Won node already holds the code) → native back at once, same code", async () => {
  const { shop, shopify, sync, common } = setup(["after_node"]);
  const nativeId = shopify.add(
    basicNode({ title: "VIP kód", codes: ["VIP20", "vip21"], percentage: 0.2, minimum: { subtotal: "500.00" }, usageLimit: 50, used: 5 }),
  );

  const result = await moveNative({ ...common, nativeId });

  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.code, "sync_failed");
  assert.equal(result.state, "restored");
  assert.equal(result.nativeRestored, true);
  // F1: a new discount, with what is LEFT of its limit (50 − 5), never "works as before".
  assert.equal(
    result.error,
    "Přesun se nepovedl (config read-back failed). Slevu jsme hned vrátili do Shopify. Je to nová sleva s novým ID. Počítadlo použití začíná od nuly, limit jsme nastavili na zbývajících 45.",
  );
  const restoredId = result.restoredNativeId!;
  const restored = shopify.nodes.get(restoredId);
  assert.equal(restored.discount.__typename, "DiscountCodeBasic");
  assert.equal(restored.discount.title, "VIP kód");
  assert.deepEqual(shopify.codesOf(restoredId).sort(), ["VIP20", "vip21"]);
  assert.equal(restored.discount.customerGets.value.percentage, 0.2);
  assert.equal(restored.discount.minimumRequirement.greaterThanOrEqualToSubtotal.amount, "500.00");
  assert.equal(restored.discount.usageLimit, 45);
  // The config is rolled back first (the Won node released the code), then one create.
  assert.equal(shopify.callsTo("WonNativeCodeBasicCreate").length, 1);
  assert.equal(sync.calls.length, 2); // the failed save + the rollback
  assert.equal(sync.nodeIds.size, 0);
  const { config } = await loadConfig(db.prisma, shop);
  assert.equal(config.modules.codes.rules.length, 0);

  const [row] = await backups(shop);
  assert.equal(row.status, "failed");
  assert.equal(row.error, result.error);
  assert.equal(parseSnapshot(row.snapshot)?.restoredAs?.nativeId, restoredId);

  // Nothing left to undo.
  const undo = await undoMove({ ...common, backupId: row.id });
  assert.ok(undo.ok && undo.alreadyRestored);
});

test("create-first (automatic): the Won rule's save is refused → nothing deleted, nothing changed", async () => {
  const { shop, shopify, sync, common } = setup(["before_save"]);
  const nativeId = shopify.add(freeShippingNode({ method: "automatic", title: "Doprava nad 1000", minimum: { subtotal: "1000.00" } }));

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.code, "sync_failed");
  assert.equal(result.state, "unchanged");
  assert.equal(result.error, "Přesun se nepovedl (Shopify is not answering). Nic se nezměnilo.");
  assert.equal(sync.calls.length, 1, "no rollback save when nothing was saved");
  assert.ok(shopify.nodes.has(nativeId), "the same discount, same id");
  assert.equal(shopify.callsTo("WonNativeAutomaticDelete").length, 0);
  assert.equal(shopify.callsTo("WonNativeAutomaticFreeShippingCreate").length, 0);
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 0);
  assert.equal((await backups(shop)).length, 0, "a fresh backup of a move that changed nothing is dropped");
});

test("REL-3: the restore fails too → the backup keeps the only copy; undo finishes the job later", async () => {
  const { shop, shopify, common } = setup(["throw"]);
  const nativeId = shopify.add(basicNode({ title: "Křehká", codes: ["KREHKA"] }));
  shopify.inject("WonNativeCodeBasicCreate", { userErrors: [{ message: "Internal error" }] });

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.code, "sync_failed");
  assert.equal(result.state, "in_backup");
  assert.equal(result.nativeRestored, false);
  assert.match(result.error, /Je v záloze, klikni na „Vrátit zpět“\.$/);
  assert.equal(shopify.holderOf("KREHKA"), null);
  const [row] = await backups(shop);
  assert.equal(row.status, "failed");

  const undo = await undoMove({ ...common, backupId: row.id });
  assert.ok(undo.ok, JSON.stringify(undo));
  assert.equal(undo.alreadyRestored, false);
  assert.equal(shopify.holderOf("KREHKA")?.discount.title, "Křehká");
  assert.equal((await backups(shop))[0].status, "restored");
});

test("delete refused by Shopify → nothing changed, native still live, nothing to undo", async () => {
  const { shop, shopify, sync, common } = setup();
  const nativeId = shopify.add(basicNode({ title: "Zamčená", codes: ["ZAMEK"] }));
  shopify.inject("WonNativeCodeDelete", { userErrors: [{ message: "Discount is locked" }] });

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.code, "delete_failed");
  assert.equal(result.error, "Shopify slevu nesmazal (Discount is locked). Nic se nezměnilo.");
  assert.ok(shopify.nodes.has(nativeId));
  assert.equal(sync.calls.length, 0);
  const [row] = await backups(shop);
  const undo = await undoMove({ ...common, backupId: row.id });
  assert.ok(undo.ok && undo.alreadyRestored && undo.nativeId === nativeId);
});

test("API-3 + REL-2: THROTTLED delete is retried; a delete that landed before a transport error counts as done", async () => {
  const { shopify, common } = setup();
  const a = shopify.add(basicNode({ method: "automatic", title: "A" }));
  shopify.inject("WonNativeAutomaticDelete", { throttled: true });
  const first = await moveNative({ ...common, nativeId: a });
  assert.ok(first.ok);
  assert.equal(shopify.callsTo("WonNativeAutomaticDelete").length, 2);

  const b = shopify.add(basicNode({ method: "automatic", title: "B" }));
  shopify.inject("WonNativeAutomaticDelete", { throwsAfterApply: "socket hang up" });
  const second = await moveNative({ ...common, nativeId: b });
  assert.ok(second.ok, JSON.stringify(second));
  assert.equal(shopify.callsTo("WonNativeAutomaticDelete").length, 3, "a mutation is never blindly resent");
});

test("refused before any change: code already on a Won rule, BXGY, missing discount", async () => {
  const { shop, shopify, common } = setup();
  const base = (await loadConfig(db.prisma, shop)).config;
  base.modules.codes.rules.push({
    id: "leto",
    enabled: true,
    name: "Léto Won",
    method: "code",
    codes: ["LETO"],
    value: { kind: "percentage", percent: 5 },
    target: { kind: "order" },
  });
  assert.ok((await saveConfig(db.prisma, shop, base)).ok);

  const taken = shopify.add(basicNode({ title: "Léto Shopify", codes: ["leto"] }));
  const r1 = await moveNative({ ...common, nativeId: taken });
  assert.ok(!r1.ok);
  assert.equal(r1.code, "code_taken");
  assert.equal(r1.error, "Kód LETO už má Won pravidlo „Léto Won“. Nic se nezměnilo. Změň kód ve Won a zkus to znovu.");

  const bxgy = shopify.add(otherNode("DiscountCodeBxgy", { title: "2+1", codes: ["DVAJEDNA"] }));
  const r2 = await moveNative({ ...common, nativeId: bxgy });
  assert.ok(!r2.ok);
  assert.equal(r2.code, "not_movable");
  assert.equal(r2.error, "Won Discounts nemá Kup X, dostaneš Y. Pokryjí to množstevní slevy. Nic se nezměnilo.");

  const r3 = await moveNative({ ...common, nativeId: "gid://shopify/DiscountCodeNode/404", locale: "en" });
  assert.ok(!r3.ok);
  assert.equal(r3.error, "This discount is no longer in Shopify. Nothing changed. Refresh the list.");

  assert.equal(shopify.callsTo("WonNativeCodeDelete").length, 0);
  assert.equal((await backups(shop)).length, 0);
  assert.ok(shopify.nodes.has(taken) && shopify.nodes.has(bxgy));
});

test("undo: Won rule and node removed, native back with every code, same values and dates", async () => {
  const { shop, shopify, sync, common } = setup();
  const codes = manyCodes(300); // restore = 1 code in the create + 2 bulk adds (250 max each)
  const original = basicNode({
    title: "Podzim",
    codes,
    amount: "75.00",
    items: { collections: ["gid://shopify/Collection/5"] },
    startsAt: "2026-09-20T22:00:00Z",
    endsAt: "2026-12-31T23:00:00Z",
    usageLimit: 500,
    used: 12,
    oncePerCustomer: true,
    combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true },
  });
  const nativeId = shopify.add(original);
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);

  const undo = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(undo.ok, JSON.stringify(undo));
  assert.equal(undo.alreadyRestored, false);
  assert.deepEqual(undo.notRestored, [
    "Sleva má v Shopify nové ID.",
    "Počítadlo použití v Shopify začíná od nuly.",
    "Limit „1× na zákazníka“ začne znovu.",
    "Limit jsme nastavili na zbývajících 488 z 500 (použití před přesunem i přes Won jsou odečtená).",
  ]);
  const back = shopify.nodes.get(undo.nativeId!);
  assert.equal(back.discount.title, "Podzim");
  assert.deepEqual(shopify.codesOf(undo.nativeId!).sort(), [...codes].sort());
  assert.equal(shopify.callsTo("WonNativeRedeemCodesAdd").length, 2);
  assert.deepEqual(back.discount.customerGets.value, {
    __typename: "DiscountAmount",
    amount: { amount: "75.00", currencyCode: "CZK" },
    appliesOnEachItem: true,
  });
  assert.deepEqual(back.discount.customerGets.items.collections.nodes, [{ id: "gid://shopify/Collection/5" }]);
  assert.equal(back.discount.startsAt, original.discount.startsAt);
  assert.equal(back.discount.endsAt, original.discount.endsAt);
  assert.equal(back.discount.usageLimit, 488, "500 − 12 used before the move − 0 through Won (F1)");
  assert.equal(back.discount.appliesOncePerCustomer, true);
  assert.deepEqual(back.discount.combinesWith, original.discount.combinesWith);

  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 0);
  assert.equal(sync.nodeIds.size, 0);
  const [row] = await backups(shop);
  assert.equal(row.status, "restored");
  assert.equal(parseSnapshot(row.snapshot)?.restoredAs?.nativeId, undo.nativeId);

  const twice = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(twice.ok && twice.alreadyRestored);
  assert.equal(shopify.callsTo("WonNativeCodeBasicCreate").length, 1);
});

test("undo: restore refused → the Won rule is put back, the discount keeps running through Won", async () => {
  const { shop, shopify, sync, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Auto 15 %", percentage: 0.15 }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);
  shopify.inject("WonNativeAutomaticBasicCreate", { userErrors: [{ message: "Title is invalid" }] });

  const undo = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(!undo.ok);
  assert.equal(undo.code, "restore_failed_rule_back");
  assert.equal(undo.error, "Slevu se nepodařilo vrátit do Shopify (Title is invalid). Won pravidlo jsme obnovili, sleva dál platí přes Won.");
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules[0]?.id, moved.ruleId);
  assert.equal((await backups(shop))[0].status, "moved");
  assert.equal(sync.calls.length, 3); // move, remove, put back
});

test("undo: an automatic restore whose response was lost is found, not duplicated", async () => {
  const { shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Ztracená odpověď" }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);
  shopify.inject("WonNativeAutomaticBasicCreate", { throwsAfterApply: "ETIMEDOUT" });

  const undo = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(undo.ok, JSON.stringify(undo));
  const copies = [...shopify.nodes.values()].filter((n) => n.discount.title === "Ztracená odpověď");
  assert.equal(copies.length, 1);
  assert.equal(copies[0].id, undo.nativeId);
});

test("SEC-2: a backup is only ever undone for its own shop", async () => {
  const a = setup();
  const b = setup();
  const nativeId = a.shopify.add(basicNode({ method: "automatic", title: "Shop A" }));
  const moved = await moveNative({ ...a.common, nativeId });
  assert.ok(moved.ok);
  const cross = await undoMove({ ...b.common, backupId: moved.backupId });
  assert.ok(!cross.ok);
  assert.equal(cross.code, "backup_not_found");
});

test("resume: a move that died after the delete continues from the backup", async () => {
  const { shop, shopify, common } = setup();
  const raw = basicNode({ title: "Přerušená", codes: ["PRERUSENA"] });
  const nativeId = raw.id;
  // State after a crash between "delete" and "Won rule": backup row, native gone.
  await db.prisma.nativeDiscountBackup.create({
    data: {
      shop,
      nativeId,
      kind: "code_basic",
      title: "Přerušená",
      snapshot: JSON.stringify(makeSnapshot(raw, shopify.shop)),
      wonRuleId: null,
      status: "backed_up",
    },
  });

  const result = await moveNative({ ...common, nativeId });
  assert.ok(result.ok, JSON.stringify(result));
  const rows = await backups(shop);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "moved");
  assert.equal(shopify.holderOf("PRERUSENA")?.discount.__typename, "DiscountCodeApp");
});

test("resume: a move that died after the sync but before 'moved' keeps the same rule, no duplicate", async () => {
  const { shop, shopify, sync, common } = setup();
  const nativeId = shopify.add(basicNode({ title: "Skoro hotová", codes: ["SKORO"] }));
  const first = await moveNative({ ...common, nativeId });
  assert.ok(first.ok);
  await db.prisma.nativeDiscountBackup.update({ where: { id: first.backupId }, data: { status: "backed_up" } });

  const again = await moveNative({ ...common, nativeId });
  assert.ok(again.ok && !again.alreadyMoved, JSON.stringify(again));
  assert.equal(again.ruleId, first.ruleId);
  assert.equal(again.backupId, first.backupId);
  const rules = (await loadConfig(db.prisma, shop)).config.modules.codes.rules;
  assert.deepEqual(rules.map((r) => r.id), [first.ruleId]);
  assert.equal(sync.nodeIds.size, 1);
});

test("preview: the dialog copy comes from the full read and changes nothing", async () => {
  const { shop, shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ title: "Náhled", codes: manyCodes(101), oncePerCustomer: true }));
  const preview = await previewMove({ client: common.client, db: common.db, shop, nativeId, ...fast });
  assert.ok(preview.ok);
  assert.equal(preview.native.codes.length, 101);
  assert.ok(preview.plan.losses.some((l) => l.includes("1× na zákazníka")));
  assert.ok(shopify.nodes.has(nativeId));
  assert.equal((await backups(shop)).length, 0);
});
