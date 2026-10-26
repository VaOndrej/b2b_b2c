import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";

import { deleteShopData } from "../../app/lib/config.server.ts";
import { APP_ROOT, createTestDatabase, type TestDatabase } from "./test-db.ts";

// Audit 2026-10-26, finding DATA-01 (PRIV-2): GDPR shop/redact is the ONE place the app erases a shop
// (webhooks.shop.redact.tsx → deleteShopData). CombinationCheck says in schema.prisma that it is "erased with
// the shop", but deleteShopData did not delete it. Fixed; the tests guard it and the next per-shop model.

// Session rows are deleted by the shop/redact action itself (@won/app-kit createShopRedactAction).
const DELETED_ELSEWHERE = new Set(["Session"]);

/** Every Prisma model with a `shop` field (per-shop data), read from the committed schema. */
function perShopModels(): string[] {
  const schema = readFileSync(path.join(APP_ROOT, "prisma/schema.prisma"), "utf8");
  const models: string[] = [];
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    if (/^\s+shop\s+String/m.test(match[2])) models.push(match[1]);
  }
  return models;
}

const delegate = (model: string) => model[0].toLowerCase() + model.slice(1);

let db: TestDatabase;

before(() => {
  db = createTestDatabase("shop-redact-coverage");
});

after(async () => {
  await db.drop();
});

test("the schema scan finds the per-shop models (guards the scan itself)", () => {
  const models = perShopModels();
  for (const known of ["ShopConfig", "ConfigVersion", "WonNode", "ShopEntitlement", "OrderDiscountFact", "CombinationCheck"]) {
    assert.ok(models.includes(known), `${known} is found`);
  }
});

test("DATA-01: deleteShopData names every per-shop model of the schema", () => {
  const source = readFileSync(path.join(APP_ROOT, "app/lib/config.server.ts"), "utf8");
  const body = source.slice(source.indexOf("export async function deleteShopData"));
  const missing = perShopModels()
    .filter((model) => !DELETED_ELSEWHERE.has(model))
    .filter((model) => !body.includes(`db.${delegate(model)}.deleteMany`));
  assert.deepEqual(missing, []);
});

test("DATA-01: shop/redact erases the shop's CombinationCheck row and keeps other shops'", async () => {
  const target = "redact-me.myshopify.com";
  const keep = "keep-me.myshopify.com";
  for (const shop of [target, keep]) {
    await db.prisma.combinationCheck.create({ data: { shop, computedAt: new Date(), plan: "free", payload: "[]" } });
  }
  await deleteShopData(db.prisma, target);
  assert.ok(await db.prisma.combinationCheck.findUnique({ where: { shop: keep } }), "another shop's row stays");
  assert.equal(await db.prisma.combinationCheck.findUnique({ where: { shop: target } }), null, "the redacted shop's row is gone");
});
