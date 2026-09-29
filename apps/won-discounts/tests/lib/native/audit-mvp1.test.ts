// MVP 1 audit, native move / undo (.superpowers/sdd/2026-09-28-won-discounts-mvp1/
// audit-mvp1-native.md F1–F13). One block per finding; every test was written
// before its fix and failed on the code the audit reviewed (f3-report.md).

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { codeHash } from "@won/core/discounts/code-hash";
import { createDefaultConfig } from "@won/core/discounts/config";

import { loadConfig, saveConfig, validateConfigForSave } from "../../../app/lib/config.server.ts";
import { movedBackups, nativeViews } from "../../../app/lib/integration/native.server.ts";
import { detectNativeDiscounts } from "../../../app/lib/native/detect.server.ts";
import { classifyNative } from "../../../app/lib/native/classify.ts";
import { lossText, warningText } from "../../../app/lib/native/copy.ts";
import { planMove } from "../../../app/lib/native/map.server.ts";
import { CLAIM_STALE_MS, moveNative, resolveStaleClaims, undoMove } from "../../../app/lib/native/move.server.ts";
import { normalizeNode } from "../../../app/lib/native/normalize.ts";
import { makeSnapshot, parseSnapshot } from "../../../app/lib/native/restore.server.ts";
import type { NativeDiscount } from "../../../app/lib/native/types.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { basicNode, FakeShopify, freeShippingNode, otherNode } from "./fake-shopify.ts";
import { createFakeSync, type SyncFailure } from "./fake-sync.ts";

let db: TestDatabase;
let shopCounter = 0;

before(() => {
  db = createTestDatabase("native-audit");
});

after(async () => {
  await db.drop();
});

const NOW = new Date("2026-09-28T12:00:00Z");
const SHOP_CONTEXT = { currencyCode: "CZK", ianaTimezone: "Europe/Prague" };

function setup(failures: SyncFailure[] = []) {
  shopCounter += 1;
  const shop = `audit-${shopCounter}.myshopify.com`;
  const shopify = new FakeShopify();
  shopify.now = () => NOW;
  const sync = createFakeSync(db.prisma, shopify, failures);
  const sleeps: number[] = [];
  const common = {
    client: shopify,
    db: db.prisma,
    shop,
    saveAndSync: sync.saveAndSync,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    bulkPolls: 2,
    now: () => NOW,
  };
  return { shop, shopify, sync, common, sleeps };
}

const rows = (shop: string) => db.prisma.nativeDiscountBackup.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });
const manyCodes = (n: number, prefix = "K") => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(4, "0")}`);

function native(raw: { id: string; discount: unknown }): NativeDiscount {
  const node = normalizeNode(raw, SHOP_CONTEXT);
  assert.ok(node && node.movableType);
  return node.native;
}

/** Two different codes with the same 8-hex hash (what the discount function matches codes by). */
function collidingPair(prefix: string): [string, string] {
  const seen = new Map<string, string>();
  for (let i = 0; ; i++) {
    const code = `${prefix}${i}`;
    const other = seen.get(codeHash(code));
    if (other) return [other, code];
    seen.set(codeHash(code), code);
  }
}

// --- F1: every save-time refusal happens BEFORE the delete -----------------------------------

test("F1: a discount whose codes would push the function config over budget is refused before the delete", async () => {
  const { shop, shopify, sync, common } = setup();
  const nativeId = shopify.add(basicNode({ title: "Tisíc kódů", codes: manyCodes(900) }));

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.code, "config_budget");
  assert.equal(result.state, "unchanged");
  assert.match(result.error, /Nic se nezměnilo/);
  assert.equal(shopify.callsTo("WonNativeCodeDelete").length, 0, "nothing deleted");
  assert.ok(shopify.nodes.has(nativeId));
  assert.equal(sync.calls.length, 0);
  assert.equal((await rows(shop)).length, 0);
});

test("F1: a code whose hash collides with another native's code is refused before the delete", async () => {
  const { shopify, sync, common } = setup();
  const [mine, theirs] = collidingPair("PODZIM");
  const nativeId = shopify.add(basicNode({ title: "Podzim", codes: [mine] }));

  const result = await moveNative({ ...common, nativeId, otherCodes: [theirs] });
  assert.ok(!result.ok);
  assert.equal(result.code, "code_hash_collision");
  assert.equal(result.state, "unchanged");
  assert.equal(shopify.callsTo("WonNativeCodeDelete").length, 0);
  assert.equal(sync.calls.length, 0);
});

test("F1: an unreadable stored config is refused before the delete", async () => {
  const { shop, shopify, common } = setup();
  await db.prisma.shopConfig.create({ data: { shop, schemaVersion: 1, data: "{not json" } });
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Rozbitý config" }));

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.code, "config_unreadable");
  assert.equal(shopify.callsTo("WonNativeAutomaticDelete").length, 0);
});

test("F1: validateConfigForSave is the save's own dry run (same refusal, nothing written)", async () => {
  const { shop } = setup();
  const config = createDefaultConfig();
  config.modules.codes.rules.push({
    id: "big",
    enabled: true,
    name: "Big",
    method: "code",
    codes: manyCodes(900),
    value: { kind: "percentage", percent: 5 },
    target: { kind: "order" },
  });
  const dry = validateConfigForSave(config);
  assert.ok(!dry.ok);
  assert.equal(dry.reason, "function_config_too_large");
  const saved = await saveConfig(db.prisma, shop, config);
  assert.ok(!saved.ok);
  assert.equal(saved.reason, "function_config_too_large");
  assert.equal((await loadConfig(db.prisma, shop)).exists, false);
});

test("F1: a failed move's restore keeps the REMAINING uses and says exactly what changed", async () => {
  const { shopify, common } = setup(["after_node"]);
  const nativeId = shopify.add(basicNode({ title: "Limit 50", codes: ["LIMIT50"], usageLimit: 50, used: 5, oncePerCustomer: true }));

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.state, "restored");
  const restored = shopify.nodes.get(result.restoredNativeId!);
  assert.equal(restored.discount.usageLimit, 45, "limit − uses so far (the counter restarts at 0)");
  assert.doesNotMatch(result.error, /funguje jako dřív/);
  assert.match(result.error, /s novým ID/);
  assert.match(result.error, /od nuly/);
  assert.match(result.error, /zbývajících 45/);
  assert.match(result.error, /1× na zákazníka/);
});

// --- F2: before a restore, Shopify must no longer run the Won rule ----------------------------

test("F2: rollback's sync failed while Shopify still runs the rule → Undo resyncs first, restores only on a clean live state", async () => {
  // Move (code: delete first): the sync wrote the rule live, then failed; the rollback saved "no rule" but did not sync.
  const { shop, shopify, sync, common } = setup(["after_node", "after_save"]);
  const nativeId = shopify.add(basicNode({ title: "Kód 10 %", codes: ["KOD10"] }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(!moved.ok);
  assert.equal(moved.state, "rule_stuck");
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 0, "the DB says: no rule");
  assert.match(shopify.shopFunctionConfig ?? "", /native-/, "…but Shopify still runs it");

  let liveAtCreate: string | null = "unset";
  shopify.onCall = (name) => {
    if (name === "WonNativeCodeBasicCreate") liveAtCreate = shopify.shopFunctionConfig;
  };
  const undo = await undoMove({ ...common, backupId: moved.backupId! });
  assert.ok(undo.ok, JSON.stringify(undo));
  assert.equal(sync.calls.length, 3, "move, rollback, resync before the restore");
  assert.doesNotMatch(String(liveAtCreate), /native-/, "the native was created only once the rule was gone live");
  assert.equal([...shopify.nodes.values()].filter((n) => n.discount.title === "Kód 10 %").length, 1);
  assert.equal(shopify.holderOf("KOD10")?.discount.__typename, "DiscountCodeBasic");
});

test("F2: the resync fails → Undo refuses honestly and does NOT recreate the native (no double discount)", async () => {
  const { shopify, common } = setup(["after_node", "after_save", "before_save"]);
  const nativeId = shopify.add(basicNode({ title: "Kód 20 %", codes: ["KOD20"], percentage: 0.2 }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(!moved.ok);

  const undo = await undoMove({ ...common, backupId: moved.backupId! });
  assert.ok(!undo.ok);
  assert.equal(undo.code, "rule_still_live");
  assert.doesNotMatch(undo.error, /Nic se nezměnilo, sleva dál platí přes Won/);
  assert.equal(shopify.callsTo("WonNativeCodeBasicCreate").length, 0);
});

test("F2: the live state cannot be read → no restore, honest 'could not check'", async () => {
  const { shopify, common } = setup(["throw"]);
  const nativeId = shopify.add(basicNode({ title: "Nečitelné", codes: ["NECITELNE"] }));
  shopify.inject("WonSyncShopConfigReadBack", ...Array.from({ length: 8 }, () => ({ throws: "ETIMEDOUT" })));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(!moved.ok);
  assert.equal(moved.state, "rule_unverified");
  assert.match(moved.error, /Je v záloze/);
  assert.equal(shopify.callsTo("WonNativeCodeBasicCreate").length, 0);
});

// --- F3: an unanswered delete is re-checked with backoff ----------------------------------------

test("F3: a delete that commits late is seen by the re-checks (backoff ~20 s), the move continues", async () => {
  const { shopify, sync, common, sleeps } = setup();
  const nativeId = shopify.add(basicNode({ title: "Pozdní", codes: ["POZDNI"] }));
  shopify.inject("WonNativeCodeDelete", { throws: "no answer from Shopify within 30000 ms" });
  let checks = 0;
  shopify.onCall = (name) => {
    if (name === "WonNativeDiscountExists" && ++checks === 2) shopify.nodes.delete(nativeId); // lands late
  };

  const result = await moveNative({ ...common, nativeId });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(shopify.holderOf("POZDNI")?.id, sync.nodeIds.get(result.ruleId));
  assert.ok(sleeps.length >= 2, "waited between the checks");
});

test("F3: still there after every re-check → backed_up, no restoredAs, listed with its backup", async () => {
  const { shop, shopify, common, sleeps } = setup();
  const nativeId = shopify.add(basicNode({ title: "Tichý", codes: ["TICHY"] }));
  shopify.inject("WonNativeCodeDelete", { throws: "no answer from Shopify within 30000 ms" });

  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.state, "still_there");
  assert.doesNotMatch(result.error, /Nic se nezměnilo/);
  assert.equal(shopify.callsTo("WonNativeDiscountExists").length, 3, "three re-checks");
  const waited = sleeps.reduce((a, b) => a + b, 0);
  assert.ok(waited >= 15_000 && waited <= 30_000, `waited ${waited} ms`);
  const [row] = await rows(shop);
  assert.equal(row.status, "backed_up");
  assert.equal(parseSnapshot(row.snapshot)?.restoredAs, undefined, "never 'restored' without proof");
  const listed = await movedBackups({ db: db.prisma, shop }, "Europe/Prague");
  assert.deepEqual(listed.map((m) => [m.backupId, m.state]), [[row.id, "attention"]]);
});

// --- F7: an exception after the claim never leaves the discount nowhere ----------------------------

test("F7: a database error after the delete → the claim is released and the native restored at once", async () => {
  const { shop, shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ title: "Výpadek DB", codes: ["VYPADEK"] }));
  let reads = 0;
  const real = db.prisma;
  const flakyShopConfig = {
    findUnique: (args: Parameters<typeof real.shopConfig.findUnique>[0]) => {
      reads += 1;
      if (reads === 2) return Promise.reject(Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "P1008" }));
      return real.shopConfig.findUnique(args);
    },
  };
  // The second config read (right after the delete) fails like a locked SQLite file.
  const flaky = new Proxy(real, {
    get(target, prop) {
      if (prop === "shopConfig") return flakyShopConfig;
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as typeof db.prisma;

  const result = await moveNative({ ...common, db: flaky, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.code, "internal_error");
  assert.equal(result.state, "restored");
  assert.equal(shopify.holderOf("VYPADEK")?.discount.__typename, "DiscountCodeBasic");
  const [row] = await rows(shop);
  assert.notEqual(row.status, "moving", "the claim is released");
});

test("F7: the overview sweep resolves stale claims from the live state", async () => {
  const { shop, shopify, common } = setup();
  const live = basicNode({ title: "Žije", codes: ["ZIJE"] });
  shopify.add(live);
  const gone = basicNode({ title: "Pryč", codes: ["PRYC"] });
  const old = new Date(Date.now() - CLAIM_STALE_MS - 60_000);
  const a = await db.prisma.nativeDiscountBackup.create({
    data: { shop, nativeId: live.id, kind: "code_basic", title: "Žije", snapshot: JSON.stringify(makeSnapshot(live, shopify.shop)), status: "moving" },
  });
  const b = await db.prisma.nativeDiscountBackup.create({
    data: { shop, nativeId: gone.id, kind: "code_basic", title: "Pryč", snapshot: JSON.stringify(makeSnapshot(gone, shopify.shop)), status: "undoing" },
  });
  await db.prisma.nativeDiscountBackup.updateMany({ where: { shop }, data: { updatedAt: old } });

  const resolved = await resolveStaleClaims(common);
  assert.equal(resolved, 2);
  const after = new Map((await rows(shop)).map((r) => [r.id, r]));
  assert.equal(after.get(a.id)?.status, "failed", "still live in Shopify, no rule: nothing changed");
  assert.equal(parseSnapshot(after.get(a.id)!.snapshot)?.restoredAs?.nativeId, live.id);
  assert.equal(after.get(b.id)?.status, "backed_up", "gone from Shopify: in the backup, undo finishes it");
  assert.ok(after.get(b.id)?.error);
  const listed = await movedBackups({ db: db.prisma, shop }, null);
  assert.deepEqual(listed.map((m) => m.backupId), [b.id]);
});

// --- F8: an automatic restore is idempotent BEFORE the create ------------------------------------

test("F8: undo's create answer lost and the lookup fails → unknown, rule NOT put back; the next undo finds the copy", async () => {
  const { shop, shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Ztracená", percentage: 0.15 }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);
  shopify.inject("WonNativeAutomaticBasicCreate", { throwsAfterApply: "ETIMEDOUT" });
  // The look-up BEFORE the create works; the one after the lost answer fails (one read = 4 attempts).
  shopify.onCall = (name) => {
    if (name === "WonNativeAutomaticBasicCreate") shopify.inject("WonNativeRecentAutomatic", ...Array.from({ length: 4 }, () => ({ throws: "ETIMEDOUT" })));
  };

  const first = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(!first.ok);
  assert.equal(first.code, "restore_unknown");
  assert.doesNotMatch(first.error, /dál platí přes Won/);
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 0, "the Won rule is not put back on top");
  assert.ok(parseSnapshot((await rows(shop))[0].snapshot)?.restoring, "restore marker recorded before the create");

  const second = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(second.ok, JSON.stringify(second));
  assert.equal(shopify.callsTo("WonNativeAutomaticBasicCreate").length, 1, "found, not created again");
  assert.equal([...shopify.nodes.values()].filter((n) => n.discount.title === "Ztracená").length, 1);
});

test("F8: with a restore marker, a failed lookup never creates", async () => {
  const { shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Značka" }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);
  shopify.inject("WonNativeAutomaticBasicCreate", { throwsAfterApply: "ETIMEDOUT" });
  // After the (landed, unanswered) create every look-up fails: this undo's and the next one's.
  shopify.onCall = (name) => {
    if (name === "WonNativeAutomaticBasicCreate") shopify.inject("WonNativeRecentAutomatic", ...Array.from({ length: 8 }, () => ({ throws: "ETIMEDOUT" })));
  };
  const first = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(!first.ok);
  assert.equal(first.code, "restore_unknown");

  const again = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(!again.ok);
  assert.equal(again.code, "restore_unknown");
  assert.equal(shopify.callsTo("WonNativeAutomaticBasicCreate").length, 1, "no second create while we cannot look");
});

test("F8: a resumed move after a crash between the restore and its row update does not add the Won rule on top", async () => {
  const { shop, shopify, sync, common } = setup();
  const raw = basicNode({ method: "automatic", title: "Obnovená", percentage: 0.1 });
  const envelope = { ...makeSnapshot(raw, shopify.shop, new Date("2026-09-28T11:00:00Z")), restoring: { at: "2026-09-28T11:30:00.000Z" } };
  // The restore landed (new id), the original is gone, the row still says "moving" (stale).
  shopify.add({ ...basicNode({ method: "automatic", title: "Obnovená", percentage: 0.1, startsAt: raw.discount.startsAt }), id: "gid://shopify/DiscountAutomaticNode/777" });
  shopify.nodes.get("gid://shopify/DiscountAutomaticNode/777").discount.createdAt = "2026-09-28T11:30:05Z";
  const row = await db.prisma.nativeDiscountBackup.create({
    data: { shop, nativeId: raw.id, kind: "automatic_basic", title: "Obnovená", snapshot: JSON.stringify(envelope), status: "moving" },
  });
  await db.prisma.nativeDiscountBackup.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - CLAIM_STALE_MS - 60_000) } });

  const result = await moveNative({ ...common, nativeId: raw.id });
  assert.ok(!result.ok);
  assert.equal(result.state, "restored");
  assert.equal(result.restoredNativeId, "gid://shopify/DiscountAutomaticNode/777");
  assert.equal(sync.calls.length, 0, "no Won rule added");
  assert.equal((await loadConfig(db.prisma, shop)).config.modules.codes.rules.length, 0);
});

// --- F9 / F10: undo checks what it did -------------------------------------------------------

test("F9: undo — removing the rule fails and putting it back fails too → never 'still runs through Won'", async () => {
  const { shop, shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Nejistá cesta" }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);
  const sync2 = createFakeSync(db.prisma, shopify, ["after_save", "before_save"]);

  const undo = await undoMove({ ...common, saveAndSync: sync2.saveAndSync, backupId: moved.backupId });
  assert.ok(!undo.ok);
  assert.equal(undo.code, "remove_rule_failed_unverified");
  assert.doesNotMatch(undo.error, /sleva dál platí přes Won/);
  const [row] = await rows(shop);
  assert.equal(row.status, "failed", "listed for attention, not 'moved'");
});

test("F10: a leftover Won node holding the code is resynced away before the undo restores", async () => {
  const { shop, shopify, sync, common } = setup();
  const nativeId = shopify.add(basicNode({ title: "Sirotek", codes: ["SIROTEK"] }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);
  // The config lost the rule behind the sync's back (e.g. an old instance's write): the node still holds the code.
  const { config } = await loadConfig(db.prisma, shop);
  config.modules.codes.rules = [];
  assert.ok((await saveConfig(db.prisma, shop, config)).ok);
  assert.equal(shopify.holderOf("SIROTEK")?.discount.__typename, "DiscountCodeApp");

  const undo = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(undo.ok, JSON.stringify(undo));
  assert.equal(shopify.holderOf("SIROTEK")?.discount.__typename, "DiscountCodeBasic");
  assert.equal(sync.nodeIds.size, 0);
});

// --- F1 (undo side): the remaining uses stay remaining --------------------------------------------

test("F1: undo sets the limit to what is left after the uses through Won, and says so", async () => {
  const { shopify, sync, common } = setup();
  const nativeId = shopify.add(basicNode({ title: "Sto použití", codes: ["STO"], usageLimit: 100, used: 10 }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);
  shopify.nodes.get(sync.nodeIds.get(moved.ruleId)!).discount.asyncUsageCount = 7; // uses through Won

  const undo = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(undo.ok, JSON.stringify(undo));
  assert.equal(shopify.nodes.get(undo.nativeId!).discount.usageLimit, 83);
  assert.ok(undo.notRestored.some((n) => /83/.test(n)), undo.notRestored.join("\n"));
  assert.ok(!undo.notRestored.some((n) => /platí znovu celý/.test(n)));
});

// --- F12: optimistic concurrency across instances --------------------------------------------

test("F12: saveConfig with an expected version refuses a base that changed meanwhile", async () => {
  const { shop } = setup();
  const base = await loadConfig(db.prisma, shop);
  assert.equal(base.version, null);
  const a = createDefaultConfig();
  a.engine.combination.productWithOrder = !a.engine.combination.productWithOrder;
  assert.ok((await saveConfig(db.prisma, shop, a)).ok);
  const stale = await saveConfig(db.prisma, shop, createDefaultConfig(), { expectedVersion: base.version });
  assert.ok(!stale.ok);
  assert.equal(stale.reason, "base_changed");
  const fresh = await loadConfig(db.prisma, shop);
  assert.ok(fresh.version);
  assert.ok((await saveConfig(db.prisma, shop, createDefaultConfig(), { expectedVersion: fresh.version })).ok);
});

test("F12: another instance's write between the move's read and save is kept (retry on conflict)", async () => {
  const { shop, shopify, sync, common } = setup();
  const nativeId = shopify.add(basicNode({ title: "Souběh", codes: ["SOUBEH"] }));
  let wrote = false;
  sync.beforeSave = async () => {
    if (wrote) return;
    wrote = true;
    const { config } = await loadConfig(db.prisma, shop);
    config.modules.codes.rules.push({
      id: "other-instance",
      enabled: true,
      name: "Jiná instance",
      method: "code",
      codes: ["JINA"],
      value: { kind: "percentage", percent: 5 },
      target: { kind: "order" },
    });
    assert.ok((await saveConfig(db.prisma, shop, config)).ok);
  };

  const result = await moveNative({ ...common, nativeId });
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(sync.conflicts, 1);
  const ids = (await loadConfig(db.prisma, shop)).config.modules.codes.rules.map((r) => r.id).sort();
  assert.deepEqual(ids, ["native-" + nativeId.split("/").pop(), "other-instance"].sort());
});

// --- F13 ------------------------------------------------------------------------------------

test("F13: a read with per-field errors refuses the move (a nulled field is never 'no limit')", async () => {
  const { shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ title: "Částečná", codes: ["CASTECNA"], usageLimit: 10 }));
  shopify.inject("WonNativeDiscount", { dataWithErrors: "Internal error resolving usageLimit" });
  const result = await moveNative({ ...common, nativeId });
  assert.ok(!result.ok);
  assert.equal(result.code, "read_failed");
  assert.equal(shopify.callsTo("WonNativeCodeDelete").length, 0);
});

test("F13: an unknown or missing shipping destination is not movable (conservative)", () => {
  const raw = freeShippingNode({ method: "automatic" });
  raw.discount.destinationSelection = null;
  assert.equal(classifyNative(native(raw))?.code, "unsupported_value");
  raw.discount.destinationSelection = { __typename: "DiscountSomethingNew" };
  assert.equal(classifyNative(native(raw))?.code, "unsupported_value");
});

test("F13: a fixed amount off EACH item of the whole order is refused (Won takes it once per order)", () => {
  const n = native(basicNode({ method: "automatic", amount: "20.00", appliesOnEachItem: true, items: { all: true } }));
  assert.equal(classifyNative(n)?.code, "fixed_each_item_on_order");
});

test("F13: movedBackups finds a moved discount behind more than 200 newer rows", async () => {
  const { shop } = setup();
  const old = await db.prisma.nativeDiscountBackup.create({
    data: { shop, nativeId: "gid://shopify/DiscountCodeNode/1", kind: "code_basic", title: "Stará", snapshot: "{}", status: "moved" },
  });
  await db.prisma.nativeDiscountBackup.update({ where: { id: old.id }, data: { updatedAt: new Date(Date.now() - 86_400_000) } });
  for (let i = 0; i < 210; i++) {
    await db.prisma.nativeDiscountBackup.create({
      data: {
        shop,
        nativeId: `gid://shopify/DiscountCodeNode/${1000 + i}`,
        kind: "code_basic",
        title: `R${i}`,
        snapshot: JSON.stringify({
          format: 1,
          takenAt: "2026-09-01T00:00:00.000Z",
          shop: SHOP_CONTEXT,
          node: { id: "x" },
          restoredAs: { nativeId: "x", at: "2026-09-02T00:00:00.000Z" },
        }),
        status: "restored",
      },
    });
  }
  const listed = await movedBackups({ db: db.prisma, shop }, null);
  assert.deepEqual(listed.map((m) => m.backupId), [old.id]);
});

test("F13 + F11: the copy says the usage count is approximate and no longer claims the history stays", () => {
  assert.match(warningText({ code: "usage_limit_remaining", used: 3, limit: 10, remaining: 7 }, "cs"), /přibližně/);
  assert.match(warningText({ code: "usage_limit_remaining", used: 3, limit: 10, remaining: 7 }, "en"), /approximate/);
  assert.doesNotMatch(lossText({ code: "usage_history", used: 3 }, "cs"), /zůstane v Shopify/);
  assert.doesNotMatch(lossText({ code: "usage_history", used: 3 }, "en"), /stays in Shopify/);
});

// --- F4: combining with the discounts that stay in Shopify -------------------------------------------

test("F4: the plan says which remaining natives will now stack with the moved discount, or keep blocking it", () => {
  const n = native(
    basicNode({
      method: "automatic",
      title: "10 % z objednávky",
      combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false },
    }),
  );
  const plan = planMove(n, createDefaultConfig(), {
    now: NOW,
    remaining: [
      { title: "2+1 trička", stacking: { classes: ["product"], combinesWith: { productDiscounts: false, orderDiscounts: true, shippingDiscounts: false } } },
      { title: "Věrnostní app", stacking: { classes: ["order"], combinesWith: { productDiscounts: true, orderDiscounts: false, shippingDiscounts: true } } },
    ],
  });
  const stacks = plan.warnings.find((w) => w.includes("2+1 trička"));
  assert.ok(stacks && /sečtou/.test(stacks), plan.warnings.join("\n"));
  const blocks = plan.warnings.find((w) => w.includes("Věrnostní app"));
  assert.ok(blocks && /jen jednu/.test(blocks), plan.warnings.join("\n"));
});

test("F4: detection reads how the discounts that stay combine, and the move dialog warns about them", async () => {
  const shopify = new FakeShopify();
  shopify.now = () => NOW;
  const bxgy = otherNode("DiscountAutomaticBxgy", { title: "2+1 trička" });
  bxgy.discount.combinesWith = { productDiscounts: false, orderDiscounts: true, shippingDiscounts: false };
  bxgy.discount.discountClasses = ["PRODUCT"];
  shopify.add(bxgy);
  shopify.add(basicNode({ method: "automatic", title: "5 % z objednávky", percentage: 0.05 }));
  const detection = await detectNativeDiscounts(shopify, { sleep: async () => {} });
  const entry = detection.notMovable.find((n) => n.title === "2+1 trička");
  assert.deepEqual(entry?.stacking, { classes: ["product"], combinesWith: { productDiscounts: false, orderDiscounts: true, shippingDiscounts: false } });
  const { discounts } = nativeViews(detection, createDefaultConfig(), "cs", NOW);
  const view = discounts.find((d) => d.title === "5 % z objednávky");
  // Tagged per other discount (a batch that moves it too leaves the note out, F4 remainder).
  assert.ok(
    view?.stacking?.some((note) => note.nativeId === bxgy.id && /„2\+1 trička“/.test(note.text) && /sečtou/.test(note.text)),
    JSON.stringify(view),
  );
});

// --- F5: minimums measured like Shopify measures them ----------------------------------------

test("F5: a product / collection discount's minimum counts only the entitled items; an order one the cart", () => {
  const collection = native(basicNode({ items: { collections: ["gid://shopify/Collection/1"] }, minimum: { subtotal: "500.00" } }));
  assert.deepEqual(planMove(collection, createDefaultConfig(), { now: NOW }).rule.minimum, { subtotal: { CZK: 50000 }, scope: "entitled" });
  const order = native(basicNode({ minimum: { quantity: 3 } }));
  assert.deepEqual(planMove(order, createDefaultConfig(), { now: NOW }).rule.minimum, { quantity: 3, scope: "cart" });
});
