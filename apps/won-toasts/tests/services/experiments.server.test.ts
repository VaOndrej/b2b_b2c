import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createExperimentService } from "../../app/services/experiments.server";
import { createTestDatabase } from "../lib/test-db.ts";

// The schema is built from schema.prisma by `prisma db push` (tests/lib/test-db.ts),
// so this fixture can never drift from the real model the service writes to.
const db = createTestDatabase("experiments");
const prisma = db.prisma;
const service = createExperimentService(prisma);

after(async () => {
  await db.drop();
});

const base = {
  name: "Shorter cart toast",
  control: { global: { durationMs: 5000 } },
  variant: { global: { durationMs: 3000 } },
  variantPercent: 50,
  holdoutPercent: 10,
  gatingMode: "test_first" as const,
};

test("startExperiment creates a running experiment with a 'started' audit entry", async () => {
  const shop = "exp.myshopify.com";
  const exp = await service.startExperiment(shop, base);
  assert.ok(exp);
  assert.equal(exp!.status, "running");
  const audit = exp!.audit as { outcome: string }[];
  assert.equal(audit[0].outcome, "started");
});

test("only ONE active experiment per shop (queue) — a second start is rejected", async () => {
  const shop = "queue.myshopify.com";
  const first = await service.startExperiment(shop, base);
  assert.ok(first);
  const second = await service.startExperiment(shop, base);
  assert.equal(second, null); // rejected while one is running
  const active = await service.getActiveExperiment(shop);
  assert.equal(active!.id, first!.id);
});

test("decideExperiment records the outcome + appends audit and frees the queue", async () => {
  const shop = "decide.myshopify.com";
  const exp = await service.startExperiment(shop, base);
  const decided = await service.decideExperiment(shop, exp!.id, "promoted", "variant won");
  assert.equal(decided!.status, "promoted");
  const audit = decided!.audit as { outcome: string }[];
  assert.equal(audit[audit.length - 1].outcome, "promoted");
  // queue is now free for a new experiment
  assert.equal(await service.getActiveExperiment(shop), null);
  const next = await service.startExperiment(shop, base);
  assert.ok(next);
});

test("deleteShopExperiments purges only the given shop (GDPR)", async () => {
  await service.startExperiment("keep2.myshopify.com", base);
  await service.startExperiment("drop2.myshopify.com", base);
  await service.deleteShopExperiments("drop2.myshopify.com");
  assert.equal((await service.listExperiments("drop2.myshopify.com")).length, 0);
  assert.ok((await service.listExperiments("keep2.myshopify.com")).length >= 1);
});
