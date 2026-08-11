import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { PrismaClient } from "../../app/generated/prisma/client.ts";
import { createExperimentService } from "../../app/services/experiments.server";

const dir = mkdtempSync(path.join(tmpdir(), "won-toasts-exp-"));
const prisma = new PrismaClient({ datasourceUrl: `file:${path.join(dir, "exp.sqlite")}` });
const service = createExperimentService(prisma);

before(async () => {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE "Experiment" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "shop" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'running',
      "control" JSONB NOT NULL,
      "variant" JSONB NOT NULL,
      "variantPercent" INTEGER NOT NULL DEFAULT 50,
      "holdoutPercent" INTEGER NOT NULL DEFAULT 0,
      "gatingMode" TEXT NOT NULL DEFAULT 'test_first',
      "baseline" JSONB,
      "audit" JSONB,
      "source" TEXT NOT NULL DEFAULT 'manual',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "decidedAt" DATETIME
    )
  `);
});

after(async () => {
  await prisma.$disconnect();
  await rm(dir, { recursive: true, force: true });
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
