import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";

// Fix round 1, item 4: the double-claim guard of native moves / undos is the
// DATABASE's (a partial unique index: one `moving`/`undoing` row per shop +
// native discount), not only an in-process queue plus a rivals query — two app
// instances can no longer both claim the same discount, whatever the timing.

let db: TestDatabase;
before(() => {
  db = createTestDatabase("int-claim-guard");
});
after(async () => {
  await db.drop();
});

const row = (status: string, nativeId = "gid://shopify/DiscountCodeNode/1") => ({
  shop: "claim.myshopify.com",
  nativeId,
  kind: "code_basic",
  title: "LETO",
  snapshot: "{}",
  status,
});

test("a second live claim of the same native discount is refused by the database (P2002)", async () => {
  await db.prisma.nativeDiscountBackup.create({ data: row("moving") });
  await assert.rejects(db.prisma.nativeDiscountBackup.create({ data: row("moving") }), (error: { code?: string }) => error.code === "P2002");
  await assert.rejects(db.prisma.nativeDiscountBackup.create({ data: row("undoing") }), (error: { code?: string }) => error.code === "P2002");
  // Finished rows are history: any number of them, next to one claim.
  await db.prisma.nativeDiscountBackup.create({ data: row("failed") });
  await db.prisma.nativeDiscountBackup.create({ data: row("moved") });
  await db.prisma.nativeDiscountBackup.create({ data: row("restored") });
  // Another native discount is claimed independently.
  await db.prisma.nativeDiscountBackup.create({ data: row("moving", "gid://shopify/DiscountCodeNode/2") });
  // A compare-and-set claim of another row of the same native is refused too.
  const failed = await db.prisma.nativeDiscountBackup.findFirst({ where: { status: "failed" } });
  await assert.rejects(
    db.prisma.nativeDiscountBackup.updateMany({ where: { id: failed!.id }, data: { status: "undoing" } }),
    (error: { code?: string }) => error.code === "P2002",
  );
});
