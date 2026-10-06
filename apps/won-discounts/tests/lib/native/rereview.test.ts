// F3 fix round 2 (f3-rereview.md): N1 (the stale-claim sweep decides from what
// SHOPIFY runs), F4 remainder (movable natives kept in Shopify), and the minors
// (dry-run markets, automatic look-up freshness, copy slips, heartbeat around
// every sync of a claimed operation). Written before the fixes (f3-report.md).

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createDefaultConfig, type WonDiscountsConfig } from "@won/core/discounts/config";

import { loadConfig, saveConfig, validateConfigForSave } from "../../../app/lib/config.server.ts";
import { movedBackups, nativeViews } from "../../../app/lib/integration/native.server.ts";
import { lossText, moveDialogCopy } from "../../../app/lib/native/copy.ts";
import { detectNativeDiscounts } from "../../../app/lib/native/detect.server.ts";
import { planMove } from "../../../app/lib/native/map.server.ts";
import { CLAIM_STALE_MS, moveNative, resolveStaleClaims, undoMove } from "../../../app/lib/native/move.server.ts";
import { normalizeNode } from "../../../app/lib/native/normalize.ts";
import { makeSnapshot, parseSnapshot } from "../../../app/lib/native/restore.server.ts";
import type { NativeDiscount } from "../../../app/lib/native/types.ts";
import type { ShopMarket } from "../../../app/lib/sync/markets.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { basicNode, FakeShopify } from "./fake-shopify.ts";
import { createFakeSync, type SyncFailure } from "./fake-sync.ts";

let db: TestDatabase;
let shopCounter = 0;

before(() => {
  db = createTestDatabase("native-rereview");
});

after(async () => {
  await db.drop();
});

const NOW = new Date("2026-09-28T12:00:00Z");
const SHOP_CONTEXT = { currencyCode: "CZK", ianaTimezone: "Europe/Prague" };

function setup(failures: SyncFailure[] = []) {
  shopCounter += 1;
  const shop = `rereview-${shopCounter}.myshopify.com`;
  const shopify = new FakeShopify();
  shopify.now = () => NOW;
  const sync = createFakeSync(db.prisma, shopify, failures);
  const common = { client: shopify, db: db.prisma, shop, saveAndSync: sync.saveAndSync, sleep: async () => {}, bulkPolls: 2, now: () => NOW };
  return { shop, shopify, sync, common };
}

const rows = (shop: string) => db.prisma.nativeDiscountBackup.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });

function native(raw: { id: string; discount: unknown }): NativeDiscount {
  const node = normalizeNode(raw, SHOP_CONTEXT);
  assert.ok(node && node.movableType);
  return node.native;
}

/**
 * A create-first move whose process died: the Won rule of `raw` saved AND live
 * (the create's sync finished), the native still live, the claim stale.
 */
async function deadCreateFirst(env: ReturnType<typeof setup>, title: string) {
  const raw = basicNode({ method: "automatic", title });
  const nativeId = env.shopify.add(raw);
  const config: WonDiscountsConfig = createDefaultConfig();
  const rule = planMove(native(raw), config, { now: NOW }).rule;
  config.modules.codes.rules.push(rule);
  assert.deepEqual(await env.sync.saveAndSync({ shop: env.shop, config }), { ok: true });
  const row = await db.prisma.nativeDiscountBackup.create({
    data: {
      shop: env.shop,
      nativeId,
      kind: "automatic_basic",
      title,
      snapshot: JSON.stringify(makeSnapshot(raw, env.shopify.shop)),
      wonRuleId: rule.id,
      status: "moving",
    },
  });
  await db.prisma.nativeDiscountBackup.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - CLAIM_STALE_MS - 60_000) } });
  return { nativeId, ruleId: rule.id, rowId: row.id };
}

// --- N1: the stale-claim sweep reads what Shopify runs ------------------------------------------

test("N1 (a): died after the create, before the delete → the sweep rolls the live Won rule back; nothing changed", async () => {
  const env = setup();
  const { nativeId, ruleId, rowId } = await deadCreateFirst(env, "Pád po vytvoření");
  assert.match(env.shopify.shopFunctionConfig ?? "", new RegExp(ruleId), "both apply right now");

  assert.equal(await resolveStaleClaims(env.common), 1);
  assert.equal((await loadConfig(db.prisma, env.shop)).config.modules.codes.rules.length, 0);
  assert.doesNotMatch(env.shopify.shopFunctionConfig ?? "", new RegExp(ruleId), "Shopify no longer runs the Won rule");
  assert.ok(env.shopify.nodes.has(nativeId));
  const [row] = await rows(env.shop);
  assert.equal(row.id, rowId);
  assert.equal(row.status, "failed");
  assert.equal(parseSnapshot(row.snapshot)?.restoredAs?.nativeId, nativeId);
});

test("N1 (a'): …and the rollback fails → listed with 'both may apply, click Undo now'", async () => {
  const env = setup();
  const { ruleId } = await deadCreateFirst(env, "Pád, rollback selže");
  env.sync.failures.push("before_save");

  await resolveStaleClaims(env.common);
  const [row] = await rows(env.shop);
  assert.equal(row.status, "backed_up");
  assert.match(row.error ?? "", /Klikněte hned na „Vrátit zpět“/);
  assert.match(env.shopify.shopFunctionConfig ?? "", new RegExp(ruleId));
  const listed = await movedBackups({ db: db.prisma, shop: env.shop }, null);
  assert.deepEqual(listed.map((m) => m.state), ["attention"]);
});

test("N1 (b): died during the rollback (DB saved without the rule, Shopify still runs it) → resynced, never hidden as untouched", async () => {
  const env = setup();
  const { ruleId } = await deadCreateFirst(env, "Pád v rollbacku");
  // The rollback's save landed, its sync never ran.
  assert.ok((await saveConfig(db.prisma, env.shop, createDefaultConfig())).ok);
  const syncsBefore = env.sync.calls.length;

  await resolveStaleClaims(env.common);
  assert.ok(env.sync.calls.length > syncsBefore, "a resync ran");
  assert.doesNotMatch(env.shopify.shopFunctionConfig ?? "", new RegExp(ruleId), "clean live before the row is settled");
  assert.equal((await rows(env.shop))[0].status, "failed");
});

test("N1 (b'): …and the resync fails → the row stays listed until the live state is clean", async () => {
  const env = setup();
  const { ruleId } = await deadCreateFirst(env, "Pád v rollbacku, resync selže");
  assert.ok((await saveConfig(db.prisma, env.shop, createDefaultConfig())).ok);
  env.sync.failures.push("before_save");

  await resolveStaleClaims(env.common);
  assert.match(env.shopify.shopFunctionConfig ?? "", new RegExp(ruleId));
  const [row] = await rows(env.shop);
  assert.equal(row.status, "backed_up");
  assert.equal(parseSnapshot(row.snapshot)?.restoredAs, undefined);
  assert.match(row.error ?? "", /Klikněte hned na „Vrátit zpět“/);
  const listed = await movedBackups({ db: db.prisma, shop: env.shop }, null);
  assert.equal(listed.length, 1);
});

// --- F4 remainder: movable natives the merchant keeps in Shopify --------------------------------

test("F4: a movable native that stays in Shopify is compared too (tagged with its id, so a batch can leave it out)", async () => {
  const shopify = new FakeShopify();
  shopify.now = () => NOW;
  const a = shopify.add(
    basicNode({ method: "automatic", title: "A 10 % z objednávky", combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false } }),
  );
  const b = shopify.add(
    basicNode({
      method: "automatic",
      title: "B trička",
      items: { products: ["gid://shopify/Product/1"] },
      combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: false },
    }),
  );
  const detection = await detectNativeDiscounts(shopify, { sleep: async () => {} });
  assert.equal(detection.movable.length, 2);
  const { discounts } = nativeViews(detection, createDefaultConfig(), "cs", NOW);
  const viewA = discounts.find((d) => d.id === a) as (typeof discounts)[number] & { stacking?: { nativeId: string; text: string }[] };
  const note = viewA.stacking?.find((s) => s.nativeId === b);
  assert.ok(note && /„B trička“/.test(note.text) && /sečtou/.test(note.text), JSON.stringify(viewA));
});

// --- Minor: the dry run measures the same markets as the save ------------------------------------

test("F1 minor: the dry run merges the shop's market countries like the save does (refused before the delete)", async () => {
  const { shop, shopify, sync, common } = setup();
  const base = createDefaultConfig();
  base.markets = [{ handle: "eu", currency: "EUR", enabled: true }];
  base.modules.codes.rules.push({
    id: "eu-rule",
    enabled: true,
    name: "EU",
    method: "automatic",
    value: { kind: "percentage", percent: 5 },
    target: { kind: "order" },
    targeting: { markets: ["eu"] },
  });
  assert.ok((await saveConfig(db.prisma, shop, base)).ok);
  const shopMarkets: ShopMarket[] = [
    { handle: "eu", name: "EU", active: true, currency: "EUR", countries: Array.from({ length: 250 }, (_, i) => `${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`) },
  ];
  // Enough codes to fit WITHOUT the market's countries, but not with them.
  const saved = (await loadConfig(db.prisma, shop)).config;
  let count = 0;
  for (let n = 100; n < 1000 && count === 0; n += 5) {
    const raw = basicNode({ codes: Array.from({ length: n }, (_, i) => `TRH${String(i).padStart(4, "0")}`) });
    const next = structuredClone(saved);
    next.modules.codes.rules.push(planMove(native(raw), saved, { now: NOW }).rule);
    if (!validateConfigForSave(next, { shopMarkets }).ok && validateConfigForSave(next).ok) count = n;
  }
  assert.ok(count > 0, "calibration found a size that only the countries push over");
  const nativeId = shopify.add(basicNode({ title: "Na hraně", codes: Array.from({ length: count }, (_, i) => `TRH${String(i).padStart(4, "0")}`) }));

  const result = await moveNative({ ...common, nativeId, shopMarkets });
  assert.ok(!result.ok);
  assert.equal(result.code, "config_budget");
  assert.equal(result.state, "unchanged");
  assert.equal(shopify.callsTo("WonNativeCodeDelete").length, 0);
  assert.equal(sync.calls.length, 0);
});

// --- Minor: the automatic restore look-up does not trust one search page -------------------------

test("F8 minor: a marked retry pages through the recent automatic discounts and re-checks once before any create", async () => {
  const { shopify, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Hledaná", percentage: 0.15 }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);
  // The first undo's create lands but its answer is lost, and the look-up after it fails.
  shopify.inject("WonNativeAutomaticBasicCreate", { throwsAfterApply: "ETIMEDOUT" });
  shopify.onCall = (name) => {
    if (name === "WonNativeAutomaticBasicCreate") shopify.inject("WonNativeRecentAutomatic", ...Array.from({ length: 4 }, () => ({ throws: "ETIMEDOUT" })));
  };
  const first = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(!first.ok && first.code === "restore_unknown", JSON.stringify(first));
  const copy = [...shopify.nodes.values()].find((n) => n.discount.title === "Hledaná");
  assert.ok(copy);
  // Meanwhile 60 newer automatic discounts; and the first answer does not show the copy yet (index lag).
  for (let i = 0; i < 60; i++) {
    const other = shopify.add(basicNode({ method: "automatic", title: `Jiná ${i}` }));
    shopify.nodes.get(other).discount.createdAt = new Date(NOW.getTime() + 60_000 + i * 1000).toISOString();
  }
  shopify.hiddenFromRecent.add(copy.id);
  let looks = 0;
  shopify.onCall = (name) => {
    if (name === "WonNativeRecentAutomatic" && ++looks > 2) shopify.hiddenFromRecent.clear();
  };

  const second = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(second.ok, JSON.stringify(second));
  assert.equal(second.nativeId, copy.id, "the earlier copy is reused");
  assert.equal(shopify.callsTo("WonNativeAutomaticBasicCreate").length, 1, "never created twice");
});

// --- Minor: copy slips ---------------------------------------------------------------------

test("copy: an automatic discount's lost count never mentions a code or a Won count", () => {
  const text = lossText({ code: "usage_history", used: 7, method: "automatic" }, "cs");
  assert.doesNotMatch(text, /kód|Won počítá/, text);
  assert.match(text, /7×/);
  const plan = planMove(native(basicNode({ method: "automatic", used: 7 })), createDefaultConfig(), { now: NOW });
  assert.ok(plan.losses.every((l) => !/kód|Won počítá/.test(l)), plan.losses.join("\n"));
});

test("copy: the undo modal never promises a new ID when the native may still be live; a partial restore only adds codes", async () => {
  const { shop } = setup();
  const raw = basicNode({ title: "Možná živá", codes: ["ZIVA"], usageLimit: 10 });
  const unknown = await db.prisma.nativeDiscountBackup.create({
    data: { shop, nativeId: raw.id, kind: "code_basic", title: "Možná živá", snapshot: JSON.stringify(makeSnapshot(raw, SHOP_CONTEXT)), status: "backed_up" },
  });
  const partialRaw = basicNode({ title: "Částečně", codes: ["CAST1", "CAST2"] });
  const partial = await db.prisma.nativeDiscountBackup.create({
    data: {
      shop,
      nativeId: partialRaw.id,
      kind: "code_basic",
      title: "Částečně",
      snapshot: JSON.stringify({ ...makeSnapshot(partialRaw, SHOP_CONTEXT), restoredAs: { nativeId: "gid://shopify/DiscountCodeNode/5", at: NOW.toISOString(), codesMissing: 1 } }),
      status: "failed",
    },
  });
  const listed = await movedBackups({ db: db.prisma, shop }, null);
  const costsOf = (id: string) => (listed.find((m) => m.backupId === id)?.undoCosts ?? []).join(" ");
  assert.match(costsOf(unknown.id), /jen odebereme Won pravidlo/);
  assert.match(costsOf(unknown.id), /Když v Shopify není/);
  assert.match(costsOf(partial.id), /Doplníme 1 chybějící/);
  assert.doesNotMatch(costsOf(partial.id), /nov(é|ým) ID/);
});

test("copy: the dialog intro tells the order per kind", () => {
  const intro = moveDialogCopy("X", { losses: [], warnings: [] }, "cs").intro;
  assert.match(intro, /automatick/i);
  assert.match(intro, /kódem/);
});

// --- Minor: heartbeat around every sync of a claimed operation --------------------------------

test("heartbeat: the undo refreshes its claim around its syncs (a long sync never looks stale)", async () => {
  const { shop, shopify, sync, common } = setup();
  const nativeId = shopify.add(basicNode({ method: "automatic", title: "Tep" }));
  const moved = await moveNative({ ...common, nativeId });
  assert.ok(moved.ok);
  const ages: number[] = [];
  let saves = 0;
  sync.failures.push("after_save"); // the undo's removal fails → the rule is put back (a second sync)
  sync.beforeSave = async () => {
    saves += 1;
    const [row] = await rows(shop);
    ages.push(Date.now() - row.updatedAt.getTime());
    // A whole stale window passes during this sync.
    await db.prisma.nativeDiscountBackup.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - 2 * CLAIM_STALE_MS) } });
  };

  const undo = await undoMove({ ...common, backupId: moved.backupId });
  assert.ok(!undo.ok && undo.code === "remove_rule_failed", JSON.stringify(undo));
  assert.equal(saves, 2);
  assert.ok(ages[1] < CLAIM_STALE_MS, `the claim was ${ages[1]} ms old at the put-back sync`);
});
