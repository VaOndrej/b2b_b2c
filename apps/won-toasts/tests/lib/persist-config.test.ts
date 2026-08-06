import assert from "node:assert/strict";
import { test } from "node:test";

import { persistConfig } from "../../app/lib/persist-config.server";

test("a successful write reports saved:true", async () => {
  let ran = false;
  const result = await persistConfig(async () => {
    ran = true;
  });
  assert.ok(ran);
  assert.deepEqual(result, { saved: true });
});

test("a throwing write NEVER escapes — it reports saved:false with a friendly message", async () => {
  // This is the guard: a Prisma/DB failure (e.g. a stale client after a schema
  // change, exactly what white-screened the admin) must become data, not a throw.
  const result = await persistConfig(async () => {
    throw new Error("PrismaClientValidationError: Unknown argument `byType`");
  });
  assert.equal(result.saved, false);
  assert.ok(result.error && result.error.length > 0);
  // The raw error text must not leak to the merchant.
  assert.ok(!/Prisma|byType/.test(result.error as string));
});

test("a synchronous throw inside the callback is also caught", async () => {
  const result = await persistConfig(() => {
    throw new Error("boom");
  });
  assert.equal(result.saved, false);
});
