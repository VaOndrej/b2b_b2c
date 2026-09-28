import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createSync } from "../../../app/lib/sync/sync.server.ts";
import { AUTO_NODE_TITLE, SYNC_RUNS_KEPT } from "../../../app/lib/sync/nodes.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { FakeShopify, WON_FUNCTION_HANDLE, WON_FUNCTION_ID } from "./fake-shopify.ts";
import { autoRule, codeRule, configWith, makeDeps, NOW, NOW_SHOP_LOCAL } from "./helpers.ts";

// Sync layer (spec §1, §3 "Emise per uzel" + "Transport configu", §9): the only
// code that writes Won's state into Shopify. Order: nodes (their function_vars)
// → product metafields → the shared shop function_config LAST (the flip, T1
// function-payload.ts), read back and verified; idempotent; retried with
// backoff (API-3); every step recorded in SyncRun.

let db: TestDatabase;
let shopSeq = 0;
let shop: string;

before(() => {
  db = createTestDatabase("sync");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  shopSeq += 1;
  shop = `sync-${shopSeq}.myshopify.com`;
});

const ALL_COMBINE = { productDiscounts: true, orderDiscounts: true, shippingDiscounts: true };
const NS = "$app:won_discounts";

function varsOf(node: { metafields: Map<string, { value: string }> }) {
  const value = node.metafields.get(`${NS}/function_vars`)?.value;
  return value === undefined ? undefined : JSON.parse(value);
}

test("fresh shop: writes the shop config, 1 automatic node and 1 code node per active code rule", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const config = configWith([
    autoRule("a1"),
    codeRule("welcome", {
      name: "Welcome newsletter",
      codes: ["WELCOME10", "WELCOME-B", "WELCOME-C"],
      target: { kind: "products", productIds: ["gid://shopify/Product/1"], variantIds: [] },
      schedule: { startsAt: "2026-10-01T00:00:00+02:00", endsAt: "2026-10-31T23:59:59+01:00" },
      limits: { usageLimit: 100, oncePerCustomer: true },
    }),
    codeRule("ship", { codes: ["SHIPFREE"], value: { kind: "freeShipping" }, target: { kind: "shipping" } }),
    codeRule("off", { enabled: false, codes: ["OFF10"] }),
  ]);

  const result = await createSync(deps).syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.deepEqual(result.errors, []);

  // Shop config: app-owned shop metafield, owner = shop GID, json.
  const shopSet = fake
    .callsOf("WonSyncMetafieldsSet")
    .find((call) => (call.variables as { metafields: { key: string }[] }).metafields[0]!.key === "function_config");
  assert.deepEqual((shopSet!.variables as { metafields: unknown[] }).metafields, [
    { ownerId: fake.shopId, namespace: NS, key: "function_config", type: "json", value: fake.shopMetafieldValue("function_config") },
  ]);
  assert.deepEqual(JSON.parse(fake.shopMetafieldValue("function_config")!).rules.map((r: { id: string }) => r.id), ["a1", "welcome", "ship", "off"]);
  assert.deepEqual(
    deps.log.shopConfigCalls,
    [{ now: NOW_SHOP_LOCAL, shopTimezone: "Europe/Prague", forceNoCampaign: false }],
    "builders get the shop-local now and the shop's zone; no campaign → no phase 1",
  );
  assert.equal(fake.callsOf("WonSyncShopConfigReadBack").length, 1, "shop config read back after the write");

  // Exactly 1 automatic + 2 code nodes (the disabled rule has none).
  const won = fake.wonNodes();
  assert.equal(won.length, 3);
  const auto = won.find((node) => node.kind === "automatic")!;
  assert.equal(auto.title, AUTO_NODE_TITLE);
  assert.deepEqual([...auto.discountClasses].sort(), ["ORDER", "PRODUCT", "SHIPPING"]);
  assert.deepEqual(auto.combinesWith, ALL_COMBINE);
  assert.equal(auto.endsAt, null);
  assert.deepEqual(varsOf(auto), {
    role: "automatic",
    campaignId: null,
    campaignStart: "1970-01-01T00:00:00",
    campaignEnd: "1970-01-01T00:00:00",
    varsVersion: null,
  });
  const autoCreate = fake.callsOf("WonSyncAutomaticCreate")[0]!.variables as { automaticAppDiscount: Record<string, unknown> };
  assert.equal(autoCreate.automaticAppDiscount.functionHandle, WON_FUNCTION_HANDLE);
  assert.equal(autoCreate.automaticAppDiscount.startsAt, NOW.toISOString());

  const welcome = won.find((node) => node.title === "Welcome newsletter")!;
  assert.deepEqual(welcome.discountClasses, ["PRODUCT"]);
  assert.deepEqual(welcome.combinesWith, ALL_COMBINE);
  assert.equal(welcome.usageLimit, 100);
  assert.equal(welcome.appliesOncePerCustomer, true);
  assert.equal(welcome.startsAt, "2026-09-30T22:00:00.000Z");
  assert.equal(welcome.endsAt, "2026-10-31T22:59:59.000Z");
  assert.deepEqual(welcome.codes.map((c) => c.code).sort(), ["WELCOME-B", "WELCOME-C", "WELCOME10"]);
  const welcomeCreate = fake.callsOf("WonSyncCodeCreate").find(
    (call) => (call.variables as { codeAppDiscount: { title: string } }).codeAppDiscount.title === "Welcome newsletter",
  )!.variables as { codeAppDiscount: Record<string, unknown> };
  assert.equal(welcomeCreate.codeAppDiscount.code, "WELCOME10", "first code on create");
  assert.deepEqual(welcomeCreate.codeAppDiscount.context, { all: "ALL" });
  assert.deepEqual(
    fake.callsOf("WonSyncRedeemBulkAdd").map((call) => call.variables),
    [{ discountId: welcome.id, codes: [{ code: "WELCOME-B" }, { code: "WELCOME-C" }] }],
    "the rest of the codes via discountRedeemCodeBulkAdd",
  );
  assert.deepEqual(varsOf(welcome), {
    role: "code",
    ruleId: "welcome",
    campaignId: null,
    campaignStart: "1970-01-01T00:00:00",
    campaignEnd: "1970-01-01T00:00:00",
    varsVersion: null,
  });

  const ship = won.find((node) => node.title === "Rule ship")!;
  assert.deepEqual(ship.discountClasses, ["SHIPPING"]);
  assert.equal(ship.usageLimit, null);
  assert.equal(ship.appliesOncePerCustomer, false);
  assert.equal(ship.startsAt, NOW.toISOString());

  // Tracked in WonNode.
  const rows = await db.prisma.wonNode.findMany({ where: { shop }, orderBy: { key: "asc" } });
  assert.deepEqual(
    rows.map((row) => [row.key, row.role, row.ruleId, row.discountNodeId]),
    [
      ["auto", "automatic", null, auto.id],
      ["code:ship", "code", "ship", ship.id],
      ["code:welcome", "code", "welcome", welcome.id],
    ],
  );
  assert.ok(rows.every((row) => typeof row.codesHash === "string" || row.role === "automatic"));

  // SyncRun recorded.
  const runs = await db.prisma.syncRun.findMany({ where: { shop } });
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.ok, true);
  assert.equal(runs[0]!.errorCount, 0);
  assert.ok(runs[0]!.finishedAt);
  const steps = JSON.parse(runs[0]!.steps) as { step: string; ok: boolean; detail: string }[];
  assert.deepEqual(steps, result.steps);
  assert.ok(steps.every((step) => typeof step.detail === "string" && step.detail.length > 0));
});

test("order: nodes (with their vars) → product metafields → shop config LAST, then read back", async () => {
  const fake = new FakeShopify();
  const product = fake.addProduct(1);
  const deps = makeDeps(fake, db.prisma);
  const first = await createSync(deps).syncShop(shop, configWith([autoRule("a"), codeRule("c")]));
  assert.equal(first.ok, true);

  // Change everything at once: node properties, node vars, product targeting, shop config.
  fake.calls = [];
  const config = configWith([
    autoRule("a", { target: { kind: "products", productIds: [product.id], variantIds: [] } }),
    codeRule("c", { name: "Renamed" }),
    autoRule("b"), // changes the shop payload too
  ]);
  const codeNode = fake.wonNodes().find((node) => node.kind === "code")!;
  codeNode.metafields.set(`${NS}/function_vars`, { id: "x", namespace: NS, key: "function_vars", type: "json", value: "{}" });
  const result = await createSync(deps).syncShop(shop, config);
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  const ops = fake.mutations().map((call) => {
    if (call.op !== "WonSyncMetafieldsSet") return call.op;
    return `set:${(call.variables as { metafields: { key: string }[] }).metafields[0]!.key}`;
  });
  const at = (name: string) => ops.indexOf(name);
  assert.ok(at("WonSyncCodeUpdate") !== -1 && at("set:function_vars") !== -1 && at("set:product") !== -1, ops.join(", "));
  assert.ok(at("WonSyncCodeUpdate") < at("set:function_vars"), `nodes before vars: ${ops.join(", ")}`);
  assert.ok(at("set:function_vars") < at("set:product"), `vars before products: ${ops.join(", ")}`);
  assert.equal(ops.at(-1), "set:function_config", `shop config is the last write: ${ops.join(", ")}`);
  const lastWrite = fake.calls.map((call) => call.kind).lastIndexOf("mutation");
  const readBack = fake.calls.findIndex((call) => call.op === "WonSyncShopConfigReadBack");
  assert.ok(readBack > lastWrite, "read back after the shop config write");
});

test("idempotent: a second sync with the same config sends no mutation", async () => {
  const fake = new FakeShopify();
  const p1 = fake.addProduct(1);
  const collection = fake.addCollection(7, [fake.addProduct(2).id, fake.addProduct(3).id]);
  const deps = makeDeps(fake, db.prisma);
  const config = configWith([
    autoRule("a", { target: { kind: "products", productIds: [p1.id], variantIds: [] } }),
    codeRule("c", { codes: ["C1", "C2"], target: { kind: "collections", ids: [collection] } }),
  ]);
  const sync = createSync(deps);
  assert.equal((await sync.syncShop(shop, config)).ok, true);
  const before = fake.mutations().length;
  assert.ok(before > 0);

  const second = await sync.syncShop(shop, config);
  assert.equal(second.ok, true, JSON.stringify(second.errors));
  assert.deepEqual(fake.mutations().slice(before), [], "no mutation on an unchanged config");
  assert.equal(fake.callsOf("WonSyncNodeCodes").length, 0, "codes hash fast path: codes not re-read");
});

test("codes: added codes via bulk add (≤ 250 per call), removed codes via bulk delete by redeem-code id", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("c", { codes: ["KEEP", "DROP1", "DROP2"] })]));
  const node = fake.wonNodes().find((n) => n.kind === "code")!;
  const dropIds = node.codes.filter((c) => c.code.startsWith("DROP")).map((c) => c.id);

  const many = Array.from({ length: 300 }, (_, i) => `NEW${String(i).padStart(3, "0")}`);
  fake.calls = [];
  const result = await sync.syncShop(shop, configWith([codeRule("c", { codes: ["KEEP", ...many] })]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  const deletes = fake.callsOf("WonSyncRedeemBulkDelete").map((call) => call.variables as { discountId: string; ids: string[] });
  assert.deepEqual(deletes, [{ discountId: node.id, ids: dropIds }]);
  const adds = fake.callsOf("WonSyncRedeemBulkAdd").map((call) => (call.variables as { codes: unknown[] }).codes.length);
  assert.deepEqual(adds, [250, 50]);
  assert.deepEqual(node.codes.map((c) => c.code).sort(), ["KEEP", ...many].sort());
  assert.equal(fake.wonNodes().length, 2, "same node, no re-create");
  const deleteIndex = fake.calls.findIndex((call) => call.op === "WonSyncRedeemBulkDelete");
  const addIndex = fake.calls.findIndex((call) => call.op === "WonSyncRedeemBulkAdd");
  assert.ok(deleteIndex < addIndex, "removals before additions (a code can move between rules)");
});

test("a code moved from one rule to another in one save ends on the new rule's node", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("a", { codes: ["A1", "MOVE"] }), codeRule("b", { codes: ["B1"] })]));
  const result = await sync.syncShop(shop, configWith([codeRule("a", { codes: ["A1"] }), codeRule("b", { codes: ["B1", "MOVE"] })]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const byTitle = new Map(fake.wonNodes().map((node) => [node.title, node.codes.map((c) => c.code).sort()]));
  assert.deepEqual(byTitle.get("Rule a"), ["A1"]);
  assert.deepEqual(byTitle.get("Rule b"), ["B1", "MOVE"]);
});

test("C1: a DISABLED rule's node is deactivated (usage history kept); a DELETED rule's node is deleted; foreign discounts untouched", async () => {
  const fake = new FakeShopify();
  const foreignCode = fake.addForeignNode({ kind: "code", title: "Native 5%", codes: [{ id: "gid://shopify/DiscountRedeemCode/1", code: "NATIVE5" }] });
  const foreignAuto = fake.addForeignNode({ kind: "automatic", title: AUTO_NODE_TITLE });
  const otherApp = fake.addForeignNode({ kind: "code", title: "Other app", functionId: "someone-else", codes: [{ id: "gid://shopify/DiscountRedeemCode/2", code: "OTHER" }] });
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("keep"), codeRule("disable"), codeRule("remove")]));
  const disabledNode = fake.wonNodes().find((n) => n.title === "Rule disable")!;
  fake.calls = [];

  const result = await sync.syncShop(shop, configWith([codeRule("keep"), codeRule("disable", { enabled: false })]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  // disabled → deactivated, still there, still tracked, codes kept
  assert.ok(fake.nodes.has(disabledNode.id), "the disabled rule's node is NOT deleted");
  assert.equal(fake.statusOf(disabledNode), "EXPIRED");
  assert.deepEqual(disabledNode.codes.map((c) => c.code), ["DISABLE10"]);
  assert.deepEqual(fake.callsOf("WonSyncCodeDeactivate").map((c) => c.variables), [{ id: disabledNode.id }]);
  // deleted → deleted
  assert.deepEqual(fake.wonNodes().map((node) => node.title).sort(), ["Rule disable", "Rule keep", AUTO_NODE_TITLE].sort());
  assert.equal(fake.callsOf("WonSyncCodeDelete").length, 1);
  const keys = (await db.prisma.wonNode.findMany({ where: { shop } })).map((row) => row.key).sort();
  assert.deepEqual(keys, ["auto", "code:disable", "code:keep"]);
  // No vars written to the inactive node.
  assert.ok(!fake.callsOf("WonSyncMetafieldsSet").some((c) => JSON.stringify(c.variables).includes(disabledNode.id)));
  for (const foreign of [foreignCode, foreignAuto, otherApp]) assert.ok(fake.nodes.has(foreign.id), `${foreign.title} untouched`);
  const touched = new Set(fake.mutations().map((call) => String((call.variables as { id?: string })?.id ?? "")));
  for (const foreign of [foreignCode, foreignAuto, otherApp]) assert.ok(!touched.has(foreign.id));

  // Idempotent while disabled: nothing is sent again.
  fake.calls = [];
  await sync.syncShop(shop, configWith([codeRule("keep"), codeRule("disable", { enabled: false })]));
  assert.deepEqual(fake.mutations(), []);
});

test("C1: re-enabling a rule ACTIVATES its old node (same node, history kept) and applies its schedule", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("c")]));
  const node = fake.wonNodes().find((n) => n.kind === "code")!;
  await sync.syncShop(shop, configWith([codeRule("c", { enabled: false })]));
  assert.equal(fake.statusOf(node), "EXPIRED");
  fake.calls = [];

  const result = await sync.syncShop(shop, configWith([codeRule("c", { schedule: { endsAt: "2026-12-31T23:00:00Z" } })]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(fake.callsOf("WonSyncCodeActivate").map((c) => c.variables), [{ id: node.id }]);
  assert.equal(fake.callsOf("WonSyncCodeCreate").length, 0, "the same node, not a new one");
  assert.equal(fake.statusOf(node), "ACTIVE");
  assert.equal(node.endsAt, "2026-12-31T23:00:00.000Z");
  const activate = fake.calls.findIndex((c) => c.op === "WonSyncCodeActivate");
  const update = fake.calls.findIndex((c) => c.op === "WonSyncCodeUpdate");
  assert.ok(activate < update, "activate first, then the schedule update");
});

test("C1: a code moved from a DEACTIVATED rule to another rule is removed from the old node first", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("old", { codes: ["OLD1", "MOVE"] })]));
  const oldNode = fake.wonNodes().find((n) => n.title === "Rule old")!;
  fake.calls = [];

  // One save: "old" is disabled and loses MOVE, a new rule takes MOVE.
  const result = await sync.syncShop(
    shop,
    configWith([codeRule("old", { enabled: false, codes: ["OLD1"] }), codeRule("new", { codes: ["MOVE"] })]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(fake.statusOf(oldNode), "EXPIRED");
  assert.deepEqual(oldNode.codes.map((c) => c.code), ["OLD1"], "MOVE left the deactivated node, OLD1 stays");
  const newNode = fake.wonNodes().find((n) => n.title === "Rule new")!;
  assert.deepEqual(newNode.codes.map((c) => c.code), ["MOVE"]);
  const removal = fake.calls.findIndex((c) => c.op === "WonSyncRedeemBulkDelete");
  const create = fake.calls.findIndex((c) => c.op === "WonSyncCodeCreate");
  assert.ok(removal !== -1 && removal < create, "removed before the new node is created");
});

test("C1/M6: a code rule whose schedule already ended gets no node (no error loop); an existing one is deactivated", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  const ended = { schedule: { startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-02-01T00:00:00Z" } };
  const first = await sync.syncShop(shop, configWith([codeRule("past", ended)]));
  assert.equal(first.ok, true, JSON.stringify(first.errors));
  assert.equal(fake.callsOf("WonSyncCodeCreate").length, 0);
  const again = await sync.syncShop(shop, configWith([codeRule("past", ended)]));
  assert.equal(again.ok, true);
  assert.equal(fake.callsOf("WonSyncCodeCreate").length, 0, "no create attempt on later syncs either");

  // A live rule whose schedule is then moved into the past: its node is deactivated, not deleted.
  await sync.syncShop(shop, configWith([codeRule("soon")]));
  const node = fake.wonNodes().find((n) => n.title === "Rule soon")!;
  const later = await sync.syncShop(shop, configWith([codeRule("soon", ended)]));
  assert.equal(later.ok, true, JSON.stringify(later.errors));
  assert.ok(fake.nodes.has(node.id));
  assert.equal(fake.statusOf(node), "EXPIRED");
});

test("M5: one node failing (adoption read throws) does not stop the other nodes, codes or vars", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("a"), codeRule("b")]));
  await db.prisma.wonNode.deleteMany({ where: { shop, key: "code:a" } }); // "a" must be adopted
  const original = fake.graphql.bind(fake);
  fake.graphql = async (query, variables) => {
    // The adoption read of "a" (nodes query for a single untracked id) fails hard.
    if (query.includes("WonSyncNodes") && (variables as { ids: string[] }).ids.length === 1) throw new Error("boom: adopt read");
    return original(query, variables);
  };
  const result = await sync.syncShop(shop, configWith([codeRule("a"), codeRule("b", { codes: ["B10", "B-EXTRA"] }), codeRule("c")]));
  fake.graphql = original;
  assert.equal(result.ok, false);
  assert.ok(result.steps.some((s) => s.step === "node.create:code:a" && !s.ok && /boom/.test(s.detail)), JSON.stringify(result.steps));
  assert.ok(result.steps.some((s) => s.step === "codes.add:code:b" && s.ok), "b's codes still added");
  assert.ok(result.steps.some((s) => s.step === "node.create:code:c" && s.ok), "c still created");
  assert.deepEqual(result.pending, ["failed_steps"]);
});

test("M9: WonNode.varsVersion is no longer written", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  await createSync(deps).syncShop(shop, configWith([codeRule("c")]));
  const rows = await db.prisma.wonNode.findMany({ where: { shop } });
  assert.ok(rows.every((row) => row.varsVersion === null));
});

test("changed rule properties update the existing node (title, classes, schedule, limits)", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("c", { limits: { usageLimit: 5, oncePerCustomer: true } })]));
  const node = fake.wonNodes().find((n) => n.kind === "code")!;
  const result = await sync.syncShop(
    shop,
    configWith([
      codeRule("c", {
        name: "New name",
        target: { kind: "collections", ids: ["gid://shopify/Collection/9"] },
        schedule: { endsAt: "2026-12-31T23:00:00Z" },
      }),
    ]),
  );
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(fake.callsOf("WonSyncCodeCreate").length, 1, "updated in place, not re-created");
  assert.equal(node.title, "New name");
  assert.deepEqual(node.discountClasses, ["PRODUCT"]);
  assert.equal(node.endsAt, "2026-12-31T23:00:00.000Z");
  assert.equal(node.usageLimit, null);
  assert.equal(node.appliesOncePerCustomer, false);
});

test("API-3: THROTTLED and 5xx are retried with exponential backoff and the sync succeeds", async () => {
  const fake = new FakeShopify();
  fake.fail("WonSyncCodeCreate", { transport: 503 }, 1);
  fake.fail("WonSyncMetafieldsSet", { throttled: true }, 2);
  const deps = makeDeps(fake, db.prisma);
  const result = await createSync(deps).syncShop(shop, configWith([codeRule("c")]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  // code create 503 → 100 ms; shop config THROTTLED twice → 100, 200 ms (doubling).
  assert.deepEqual(deps.sleeps, [100, 100, 200]);
  assert.equal(fake.callsOf("WonSyncCodeCreate").length, 2);
  assert.equal(fake.callsOf("WonSyncMetafieldsSet").length, 3);
  assert.equal(fake.wonNodes().length, 2, "the 503 create was retried once, no duplicate");
  assert.ok(fake.shopMetafieldValue("function_config"));
});

test("API-3: retries give up after the configured attempts; the failure is recorded, nothing after it breaks", async () => {
  const fake = new FakeShopify();
  fake.fail("WonSyncAutomaticCreate", { throttled: true }, 10);
  const deps = makeDeps(fake, db.prisma);
  const result = await createSync(deps).syncShop(shop, configWith([codeRule("c")]));
  assert.equal(result.ok, false);
  assert.equal(fake.callsOf("WonSyncAutomaticCreate").length, 4, "attempts = 4");
  assert.deepEqual(deps.sleeps.slice(0, 3), [100, 200, 400]);
  const failed = result.steps.filter((step) => !step.ok);
  assert.ok(failed.some((step) => step.step === "node.create:auto" && /Throttled/.test(step.detail)), JSON.stringify(failed));
  assert.equal(fake.wonNodes().filter((n) => n.kind === "code").length, 1, "the code node is still created");
  const run = await db.prisma.syncRun.findFirst({ where: { shop } });
  assert.equal(run!.ok, false);
  assert.ok(run!.errorCount >= 1);
});

test("userErrors on one code node fail that step only; the others proceed", async () => {
  const fake = new FakeShopify();
  fake.fail("WonSyncCodeCreate", { userErrors: [{ field: ["codeAppDiscount", "title"], message: "Title is too long" }] }, 1);
  const deps = makeDeps(fake, db.prisma);
  const result = await createSync(deps).syncShop(shop, configWith([codeRule("x"), codeRule("y")]));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /Title is too long/.test(error)), JSON.stringify(result.errors));
  assert.equal(fake.wonNodes().filter((n) => n.kind === "code").length, 1);
  assert.equal(await db.prisma.wonNode.count({ where: { shop, role: "code" } }), 1);
});

test("REL-3: when the shop config write fails, the previous shop config stays and the run fails", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("c")]));
  const previous = fake.shopMetafieldValue("function_config");

  fake.fail("WonSyncMetafieldsSet", { userErrors: [{ message: "Value is invalid JSON" }] }, 1);
  const result = await sync.syncShop(shop, configWith([codeRule("c"), codeRule("d")]));
  assert.equal(result.ok, false);
  assert.ok(result.steps.some((step) => step.step === "shop_config.write" && !step.ok), JSON.stringify(result.steps));
  assert.match(result.errors.join(" "), /Value is invalid JSON/);
  assert.equal(fake.shopMetafieldValue("function_config"), previous, "the previous, complete config is still in place");
  // The new node exists already; with the old shop config it emits nothing (its rule is unknown there).
  assert.equal(fake.wonNodes().filter((n) => n.kind === "code").length, 2);
});

test("REL-3: a payload over the function budget is never written", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma, {
    buildShopFunctionConfig: () => ({ json: "{}", bytes: 9500, fits: false }),
  });
  const result = await createSync(deps).syncShop(shop, configWith([codeRule("c")]));
  assert.equal(result.ok, false);
  assert.deepEqual(fake.mutations(), []);
  assert.match(result.errors.join(" "), /9500/);
});

test("REL-3: a read-back that does not match rolls the shop config back to the previous one and stops", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  const sync = createSync(deps);
  await sync.syncShop(shop, configWith([codeRule("c")]));
  const previous = fake.shopMetafieldValue("function_config");
  const nodesBefore = fake.wonNodes().length;

  // Shopify answers the (first) read-back with something else than what was written.
  const original = fake.graphql.bind(fake);
  let tampered = false;
  fake.graphql = async (query, variables) => {
    const result = await original(query, variables);
    if (query.includes("WonSyncShopConfigReadBack") && !tampered) {
      tampered = true;
      return { data: { shop: { id: fake.shopId, metafield: { id: "m", value: '{"truncated":' } } } };
    }
    return result;
  };
  const result = await sync.syncShop(shop, configWith([codeRule("c"), codeRule("d")]));
  assert.equal(result.ok, false);
  assert.ok(result.steps.some((step) => step.step === "shop_config.verify" && !step.ok));
  assert.ok(result.steps.some((step) => step.step === "shop_config.rollback" && step.ok), JSON.stringify(result.steps));
  assert.equal(fake.shopMetafieldValue("function_config"), previous, "previous config restored");
  assert.equal(fake.wonNodes().length, nodesBefore + 1, "rule d's node exists (harmless under the old config)");
});

test("a lost create response (5xx after it was applied) is recovered by lookup, never duplicated", async () => {
  const fake = new FakeShopify();
  fake.fail("WonSyncAutomaticCreate", { transportAfterApply: 502 }, 1);
  fake.fail("WonSyncCodeCreate", { transportAfterApply: null }, 1);
  const deps = makeDeps(fake, db.prisma);
  const result = await createSync(deps).syncShop(shop, configWith([codeRule("c", { codes: ["LOST1", "LOST2"] })]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(fake.wonNodes().filter((n) => n.kind === "automatic").length, 1);
  assert.equal(fake.wonNodes().filter((n) => n.kind === "code").length, 1);
  assert.equal(fake.callsOf("WonSyncAutomaticCreate").length, 1);
  assert.equal(fake.callsOf("WonSyncCodeCreate").length, 1);
  const code = fake.wonNodes().find((n) => n.kind === "code")!;
  assert.deepEqual(code.codes.map((c) => c.code).sort(), ["LOST1", "LOST2"]);
  const rows = await db.prisma.wonNode.findMany({ where: { shop } });
  assert.deepEqual(rows.map((row) => row.discountNodeId).sort(), fake.wonNodes().map((n) => n.id).sort());
});

test("a Won node missing from WonNode (crash after create) is adopted instead of duplicated", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  await createSync(deps).syncShop(shop, configWith([codeRule("c")]));
  await db.prisma.wonNode.deleteMany({ where: { shop } });
  const result = await createSync(deps).syncShop(shop, configWith([codeRule("c")]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(fake.wonNodes().length, 2);
  assert.equal(await db.prisma.wonNode.count({ where: { shop } }), 2);
});

test("a tracked node deleted in Shopify (by the merchant) is recreated", async () => {
  const fake = new FakeShopify();
  const deps = makeDeps(fake, db.prisma);
  await createSync(deps).syncShop(shop, configWith([codeRule("c")]));
  const code = fake.wonNodes().find((n) => n.kind === "code")!;
  fake.nodes.delete(code.id);
  const result = await createSync(deps).syncShop(shop, configWith([codeRule("c")]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const recreated = fake.wonNodes().find((n) => n.kind === "code")!;
  assert.notEqual(recreated.id, code.id);
  const row = await db.prisma.wonNode.findFirst({ where: { shop, key: "code:c" } });
  assert.equal(row!.discountNodeId, recreated.id);
});

test("a code already used by a foreign discount is reported clearly, nothing is created for it", async () => {
  const fake = new FakeShopify();
  fake.addForeignNode({ kind: "code", title: "Black Friday (native)", codes: [{ id: "gid://shopify/DiscountRedeemCode/9", code: "BF20" }] });
  const deps = makeDeps(fake, db.prisma);
  const result = await createSync(deps).syncShop(shop, configWith([codeRule("bf", { codes: ["BF20"] })]));
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /BF20.*Black Friday \(native\)/);
  assert.equal(fake.callsOf("WonSyncCodeCreate").length, 0);
});

test("SyncRun keeps only the last runs per shop; SEC-2: another shop's rows are untouched", async () => {
  const other = `${shop}-other`;
  const otherFake = new FakeShopify();
  await createSync(makeDeps(otherFake, db.prisma)).syncShop(other, configWith([codeRule("o")]));
  const otherNodes = await db.prisma.wonNode.findMany({ where: { shop: other } });

  const fake = new FakeShopify();
  let clock = NOW.getTime();
  const deps = makeDeps(fake, db.prisma, { now: () => new Date((clock += 1000)) });
  const sync = createSync(deps);
  for (let i = 0; i < SYNC_RUNS_KEPT + 3; i += 1) await sync.syncShop(shop, configWith([codeRule("c")]));
  assert.equal(await db.prisma.syncRun.count({ where: { shop } }), SYNC_RUNS_KEPT);
  assert.equal(await db.prisma.syncRun.count({ where: { shop: other } }), 1);
  assert.deepEqual(await db.prisma.wonNode.findMany({ where: { shop: other } }), otherNodes);
});

test("the function is identified by handle; adoption only ever matches this app's function", async () => {
  const fake = new FakeShopify();
  // A foreign automatic node with Won's title but another function: never adopted.
  fake.addForeignNode({ kind: "automatic", title: AUTO_NODE_TITLE, functionId: "someone-else" });
  const deps = makeDeps(fake, db.prisma);
  const result = await createSync(deps).syncShop(shop, configWith([]));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const auto = fake.wonNodes().filter((n) => n.kind === "automatic");
  assert.equal(auto.length, 1);
  assert.equal(auto[0]!.functionId, WON_FUNCTION_ID);
});
