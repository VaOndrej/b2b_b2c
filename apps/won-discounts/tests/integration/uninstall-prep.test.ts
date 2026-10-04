import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import type { ShopCtx } from "../../app/lib/integration/context.server.ts";
import { planUninstallPrep, runUninstallPrep } from "../../app/lib/integration/uninstall-prep.server.ts";
import { FakeShopify } from "../lib/sync/fake-shopify.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { APP_KEY, quiet } from "./helpers.ts";

// MVP 7 contract M3 (A7): "Připravit na odinstalaci" ends every sale that is not ended (prices back) and restores
// every moved Shopify discount from its backup — the session shop's only, sales first, one failure never stops
// the rest.

let db: TestDatabase;
let seq = 0;
let shop: string;
before(() => {
  db = createTestDatabase("uninstall-prep");
});
after(async () => {
  await db.drop();
});
beforeEach(() => {
  seq += 1;
  shop = `uninstall-${seq}.myshopify.com`;
});

const ctxOf = (): ShopCtx => ({ shop, db: db.prisma, client: new FakeShopify(), locale: "cs", apiKey: APP_KEY, logger: quiet });

async function seed(target: string) {
  const run = (variant: number, status: string) =>
    db.prisma.outletRun.create({ data: { shop: target, productId: "gid://shopify/Product/1", variantId: `gid://shopify/ProductVariant/${variant}`, quota: 5, percent: 20, status } });
  const backup = (title: string, status: string) =>
    db.prisma.nativeDiscountBackup.create({ data: { shop: target, nativeId: `gid://shopify/DiscountCodeNode/${title}`, kind: "code_basic", title, snapshot: "{}", status } });
  return {
    active: await run(1, "active"),
    ending: await run(2, "ending"),
    ended: await run(3, "ended"),
    moved: await backup("LETO15", "moved"),
    restored: await backup("ZIMA", "restored"),
  };
}

test("the plan lists the sales that are not ended and the moved discounts of THIS shop only", async () => {
  const mine = await seed(shop);
  await seed(`other-${shop}`);
  const plan = await planUninstallPrep(ctxOf());
  assert.deepEqual(plan.outlets.map((o) => o.id), [mine.active.id, mine.ending.id]);
  assert.deepEqual(plan.natives, [{ id: mine.moved.id, title: "LETO15" }]);
});

test("the run ends the sales first, then restores the discounts; a failure is listed and the rest still runs", async () => {
  const mine = await seed(shop);
  const order: string[] = [];
  const result = await runUninstallPrep(ctxOf(), {
    endOutlet: async (_ctx, id) => {
      order.push(`outlet:${id}`);
      return id === mine.active.id ? { ok: false, detail: "price write refused" } : { ok: true };
    },
    restoreNative: async (_ctx, id) => {
      order.push(`native:${id}`);
      return { ok: true };
    },
  });
  assert.deepEqual(order, [`outlet:${mine.active.id}`, `outlet:${mine.ending.id}`, `native:${mine.moved.id}`]);
  assert.deepEqual(result, { ended: 1, restored: 1, failed: [{ what: "outlet", id: mine.active.id, detail: "price write refused" }] });
});

test("a thrown error is that item's failure; nothing to do is a clean result", async () => {
  assert.deepEqual(await runUninstallPrep(ctxOf()), { ended: 0, restored: 0, failed: [] });
  const mine = await seed(shop);
  const result = await runUninstallPrep(ctxOf(), {
    endOutlet: async () => ({ ok: true }),
    restoreNative: async () => {
      throw new Error("boom");
    },
  });
  assert.deepEqual(result, { ended: 2, restored: 0, failed: [{ what: "native", id: mine.moved.id, detail: "boom" }] });
});
