// F3 follow-up (controller decisions on audit-mvp1-native.md):
//   1. docs/won-discounts/rozhodnuti.md "Přesun nativních slev": backup → create
//      in Won (synced, confirmed live) → delete the native. Automatic natives
//      follow it; a delete that fails takes the Won rule out again, checked
//      live, so a double discount never lasts. Code natives keep delete-first
//      (Shopify blocks a code text held even by an ended discount, verified live).
//   2. Claim heartbeat: a long restore (up to 10 000 codes) refreshes its claim,
//      so it is never taken over as stale.

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { loadConfig } from "../../../app/lib/config.server.ts";
import { movedBackups } from "../../../app/lib/integration/native.server.ts";
import { CLAIM_STALE_MS, moveNative, undoMove } from "../../../app/lib/native/move.server.ts";
import { parseSnapshot } from "../../../app/lib/native/restore.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { basicNode, FakeShopify, freeShippingNode } from "./fake-shopify.ts";
import { createFakeSync, type SyncFailure } from "./fake-sync.ts";

let db: TestDatabase;
let shopCounter = 0;

before(() => {
  db = createTestDatabase("native-create-first");
});

after(async () => {
  await db.drop();
});

const NOW = new Date("2026-09-28T12:00:00Z");

function setup(failures: SyncFailure[] = [], sleep: (ms: number) => Promise<void> = async () => {}) {
  shopCounter += 1;
  const shop = `create-first-${shopCounter}.myshopify.com`;
  const shopify = new FakeShopify();
  shopify.now = () => NOW;
  const sync = createFakeSync(db.prisma, shopify, failures);
  const common = { client: shopify, db: db.prisma, shop, saveAndSync: sync.saveAndSync, sleep, bulkPolls: 2, now: () => NOW };
  return { shop, shopify, sync, common };
}

const rows = (shop: string) => db.prisma.nativeDiscountBackup.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });
const ruleIdOf = (nativeId: string) => `native-${nativeId.split("/").pop()}`;

// --- 1. Automatic: create first, delete after ------------------------------------------------

test("automatic: the Won rule is live in Shopify BEFORE the native is deleted; the move ends 'moved'", async () => {
  const { shop, shopify, sync, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Auto 10 %" }));
  let liveAtDelete: string | null = "unset";
  shopify.onCall = (name) => {
    if (name === "WonNativeAutomaticDelete") liveAtDelete = shopify.shopFunctionConfig;
  };

  const result = await moveNative({ ...common, nativeId });
  assert.ok(result.ok, JSON.stringify(result));
  assert.match(String(liveAtDelete), new RegExp(ruleIdOf(nativeId)), "Shopify ran the Won rule when the native went");
  assert.equal(shopify.nodes.has(nativeId), false);
  assert.ok(sync.autoNodeId && shopify.nodes.has(sync.autoNodeId), "the Won automatic node is live");
  assert.equal((await rows(shop))[0].status, "moved");
});

test("code: the native still goes FIRST (its code must be free for the Won node)", async () => {
  const { shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ title: "Kód", codes: ["PRVNI"] }));
  let liveAtDelete: string | null = "unset";
  shopify.onCall = (name) => {
    if (name === "WonNativeCodeDelete") liveAtDelete = shopify.shopFunctionConfig;
  };

  const result = await moveNative({ ...common, nativeId });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(liveAtDelete, null, "no Won rule yet when the native was deleted");
});

test("automatic: the Won rule cannot be created (synced but failed) → rolled back, nothing deleted", async () => {
  const { shop, shopify, sync, common } = setup(["after_node"]);
  const nativeId = shopify.add(freeShippingNode({ method: "automatic", title: "Doprava zdarma" }));

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.code, "sync_failed");
  assert.equal(result.state, "unchanged");
  assert.match(result.error, /Nic se nezměnilo\.$/);
  assert.ok(shopify.nodes.has(nativeId), "same discount, same id");
  assert.equal(shopify.callsTo("WonNativeAutomaticDelete").length, 0);
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 0);
  assert.doesNotMatch(shopify.shopFunctionConfig ?? "", new RegExp(ruleIdOf(nativeId)), "no longer live in Shopify");
  assert.equal(sync.autoNodeId, null);
  assert.equal((await rows(shop)).length, 0);
});

test("automatic: Shopify does not confirm the Won rule after the sync → rolled back, nothing deleted", async () => {
  const { shop, shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Neověřená" }));
  let reads = 0;
  shopify.onCall = (name) => {
    // The first read-back after the sync still shows the old config (not live yet).
    if (name === "WonSyncShopConfigReadBack" && ++reads === 1) shopify.shopFunctionConfig = JSON.stringify({ modules: { codes: { rules: [] } } });
  };

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.state, "unchanged");
  assert.match(result.error, /Shopify does not run the Won rule yet/);
  assert.ok(shopify.nodes.has(nativeId));
  assert.equal(shopify.callsTo("WonNativeAutomaticDelete").length, 0);
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 0);
});

test("automatic: created, then Shopify refuses the delete → the Won rule is rolled back (checked live), nothing changed", async () => {
  const { shop, shopify, sync, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Zamčená auto" }));
  shopify.inject("WonNativeAutomaticDelete", { userErrors: [{ message: "Discount is locked" }] });

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.code, "delete_failed");
  assert.equal(result.state, "unchanged");
  assert.equal(result.error, "Shopify slevu nesmazal (Discount is locked). Nic se nezměnilo.");
  assert.ok(shopify.nodes.has(nativeId));
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 0);
  assert.doesNotMatch(shopify.shopFunctionConfig ?? "", new RegExp(ruleIdOf(nativeId)));
  assert.equal(sync.autoNodeId, null, "the Won automatic node is gone again");
  const [row] = await rows(shop);
  assert.equal(row.status, "failed");
  assert.equal(parseSnapshot(row.snapshot)?.restoredAs?.nativeId, nativeId);
  const undo = await undoMove({ ...common, backupId: row.id });
  assert.ok(undo.ok && undo.alreadyRestored, "nothing to undo");
});

test("automatic: the delete gets no answer and the native is still there → Won rule rolled back, backup listed", async () => {
  const { shop, shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Bez odpovědi" }));
  shopify.inject("WonNativeAutomaticDelete", { throws: "no answer from Shopify within 30000 ms" });

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.state, "rolled_back_unknown");
  assert.match(result.error, /Won pravidlo jsme zase odebrali, ať sleva neplatí dvakrát/);
  assert.ok(shopify.nodes.has(nativeId));
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 0);
  const [row] = await rows(shop);
  assert.equal(row.status, "backed_up");
  assert.equal(parseSnapshot(row.snapshot)?.restoredAs, undefined);
  const listed = await movedBackups({ db: db.prisma, shop }, null);
  assert.deepEqual(listed.map((m) => [m.backupId, m.state]), [[row.id, "attention"]]);

  // The native is live: the undo converges on "nothing to do".
  const undo = await undoMove({ ...common, backupId: row.id });
  assert.ok(undo.ok && undo.alreadyRestored && undo.nativeId === nativeId, JSON.stringify(undo));
});

test("automatic: the delete is refused AND the rollback fails → 'both may apply' said, backup listed, undo takes the rule out", async () => {
  const { shop, shopify, sync, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Obě" }));
  shopify.inject("WonNativeAutomaticDelete", { userErrors: [{ message: "Discount is locked" }] });
  shopify.onCall = (name) => {
    if (name === "WonNativeAutomaticDelete") sync.failures.push("before_save"); // the rollback's save
  };

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.state, "both_live");
  assert.match(result.error, /Klikněte hned na „Vrátit zpět“/);
  const [row] = await rows(shop);
  assert.equal(row.status, "backed_up");
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 1);

  const undo = await undoMove({ ...common, backupId: row.id });
  assert.ok(undo.ok && undo.alreadyRestored && undo.nativeId === nativeId, JSON.stringify(undo));
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 0);
  assert.doesNotMatch(shopify.shopFunctionConfig ?? "", new RegExp(ruleIdOf(nativeId)));
  assert.ok(shopify.nodes.has(nativeId));
});

// --- 2. Claim heartbeat -----------------------------------------------------------------

test("heartbeat: a long restore refreshes its claim after every code chunk, so it is never stale", async () => {
  const seen: { chunk: number; status: string; ageMs: number }[] = [];
  let shopName = "";
  let shopifyRef: FakeShopify | null = null;
  // Each bulk chunk waits for Shopify (sleep); pretend a whole stale window passes during chunk 1.
  const sleep = async () => {
    const chunk = shopifyRef?.callsTo("WonNativeRedeemCodesAdd").length ?? 0;
    if (chunk === 0) return;
    const [row] = await db.prisma.nativeDiscountBackup.findMany({ where: { shop: shopName } });
    seen.push({ chunk, status: row.status, ageMs: Date.now() - row.updatedAt.getTime() });
    if (chunk === 1) {
      await db.prisma.nativeDiscountBackup.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - 2 * CLAIM_STALE_MS) } });
    }
  };
  const { shop, shopify, common } = setup(["before_save"], sleep);
  shopName = shop;
  shopifyRef = shopify;
  const codes = Array.from({ length: 600 }, (_, i) => `DLOUHO${String(i).padStart(3, "0")}`);
  const nativeId = shopify.add(basicNode({ title: "Dlouhá obnova", codes }));

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.state, "restored", JSON.stringify(result));
  assert.equal(shopify.codesOf(result.restoredNativeId!).length, 600);
  const later = seen.filter((s) => s.chunk >= 2);
  assert.ok(later.length >= 2, JSON.stringify(seen));
  for (const s of later) {
    assert.equal(s.status, "moving");
    assert.ok(s.ageMs < CLAIM_STALE_MS, `chunk ${s.chunk}: claim ${s.ageMs} ms old, would be taken over`);
  }
});
