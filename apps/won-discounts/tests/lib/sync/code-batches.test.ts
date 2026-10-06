import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { generateBatchCodes, removeBatchCodes } from "@won/core/discounts/code-batch";
import type { CodeBatch } from "@won/core/discounts/config";
import { gateConfigForPlan } from "@won/core/discounts/plan-gate";

import { desiredNodes, withBatchCodes } from "../../../app/lib/sync/nodes.ts";
import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify } from "./fake-shopify.ts";
import { codeRule, configWith, makeDeps } from "./helpers.ts";

// Generated code batches (plan 2026-10-06 dávka 4) in the sync: a batch's codes
// are rebuilt from its seed and added to the rule's Shopify discount through
// the node sync's existing redeem-code path (≤ 250 a call). Against the fake
// Shopify only — nothing here talks to a store.

let db: TestDatabase;
let shopSeq = 0;
let shop: string;

before(() => {
  db = createTestDatabase("sync_batches");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  shopSeq += 1;
  shop = `batches-${shopSeq}.myshopify.com`;
});

const batchOf = (n: number, extra: Partial<CodeBatch> = {}): CodeBatch => ({ id: `b${n}`, prefix: `B${n}-`, count: 100, seed: (n + 1).toString(16).padStart(32, "0"), length: 10, alphabet: "both", ...extra });

test("desired nodes: a code rule's node holds its hand-typed codes and its batches' codes in force; batches alone make it active", () => {
  const batch = batchOf(1, { count: 5, removed: [2] });
  const codes = generateBatchCodes(batch);
  const config = configWith([codeRule("a", { codes: ["hand"], codeBatches: [batch] }), codeRule("b", { codes: [], codeBatches: [batchOf(2, { count: 3 })] }), codeRule("c", { codes: [] })]);
  const nodes = desiredNodes(config);
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  assert.deepEqual(byKey.get("code:a")?.codes, ["HAND", codes[0], codes[1], codes[3], codes[4]]);
  assert.equal(byKey.get("code:a")?.active, true);
  assert.equal(byKey.get("code:b")?.active, true, "a rule with generated codes only is a code rule with codes");
  assert.equal(byKey.get("code:b")?.codes.length, 3);
  assert.equal(byKey.get("code:c")?.active, false, "no code at all: never created");
  // A rule without batches is passed through as it is; an automatic rule's stored batches add nothing.
  const plain = configWith([codeRule("a")]);
  assert.equal(withBatchCodes(plain), plain);
  const auto = configWith([codeRule("a", { method: "automatic", codes: [], codeBatches: [batch] })]);
  assert.equal(withBatchCodes(auto), auto);
  assert.deepEqual(desiredNodes(auto).find((n) => n.key === "code:a")?.codes, []);
});

test("sync: a batch of 600 codes reaches the discount in calls of at most 250; a second sync sends nothing", async () => {
  const fake = new FakeShopify();
  const sync = createSync(makeDeps(fake, db.prisma));
  const batch = batchOf(1, { count: 600 });
  const config = configWith([codeRule("c", { codes: [], codeBatches: [batch] })]);
  const result = await sync.syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const node = fake.wonNodes().find((n) => n.kind === "code")!;
  assert.deepEqual(node.codes.map((c) => c.code).sort(), generateBatchCodes(batch).sort());
  // The first code creates the discount; the other 599 go in bulk.
  const adds = fake.callsOf("WonSyncRedeemBulkAdd").map((call) => (call.variables as { codes: unknown[] }).codes.length);
  assert.deepEqual(adds, [250, 250, 99]);

  fake.calls = [];
  const again = await sync.syncShop(shop, config);
  assert.equal(again.ok, true, JSON.stringify(again.errors));
  assert.deepEqual(fake.calls.filter((call) => /RedeemBulk|Create|Update/.test(call.op)).map((call) => call.op), []);
});

test("sync: deleting codes of a batch removes exactly those; a second batch adds its codes; the first batch's stay", async () => {
  const fake = new FakeShopify();
  const sync = createSync(makeDeps(fake, db.prisma));
  const first = batchOf(1, { count: 40 });
  await sync.syncShop(shop, configWith([codeRule("c", { codes: ["HAND"], codeBatches: [first] })]));
  const node = fake.wonNodes().find((n) => n.kind === "code")!;
  const all = generateBatchCodes(first);
  const less = removeBatchCodes(first, [all[3], all[17]]);
  const second = batchOf(2, { count: 30 });

  fake.calls = [];
  const result = await sync.syncShop(shop, configWith([codeRule("c", { codes: ["HAND"], codeBatches: [less, second] })]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const removedIds = fake.callsOf("WonSyncRedeemBulkDelete").flatMap((call) => (call.variables as { ids: string[] }).ids);
  assert.equal(removedIds.length, 2);
  const added = fake.callsOf("WonSyncRedeemBulkAdd").flatMap((call) => (call.variables as { codes: { code: string }[] }).codes.map((c) => c.code));
  assert.deepEqual(added.sort(), generateBatchCodes(second).sort());
  const want = ["HAND", ...all.filter((_, i) => i !== 3 && i !== 17), ...generateBatchCodes(second)];
  assert.deepEqual(node.codes.map((c) => c.code).sort(), want.sort());
});

test("Free: the gated config's nodes hold only what Free allows — a Pro pattern's codes and the codes past 100 leave the discount", () => {
  const patterned = batchOf(1, { count: 20, suffix: "X" });
  const large = batchOf(2, { count: 250 });
  const config = configWith([codeRule("c", { codes: [], codeBatches: [patterned, large] })]);
  const pro = desiredNodes(gateConfigForPlan(config, "pro").config).find((n) => n.key === "code:c")!;
  assert.equal(pro.codes.length, 270);
  const free = desiredNodes(gateConfigForPlan(config, "free").config).find((n) => n.key === "code:c")!;
  assert.deepEqual(free.codes, generateBatchCodes(large).slice(0, 100));
});

test("per-item minimum refs: a product ref with a `#key:min` tail still names its rule (collection limits read it)", async () => {
  const { refTargetsCollections } = await import("../../../app/lib/sync/products.ts");
  const config = configWith([
    codeRule("col", { method: "automatic", codes: undefined, target: { kind: "collections", ids: ["gid://shopify/Collection/1"], itemMinimums: [{ id: "gid://shopify/Collection/1", quantity: 3 }] } }),
    codeRule("prod", { method: "automatic", codes: undefined, target: { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] } }),
  ]);
  assert.equal(refTargetsCollections(config, "col#1:3"), true);
  assert.equal(refTargetsCollections(config, "col"), true);
  assert.equal(refTargetsCollections(config, "prod#1:3"), false);
});
