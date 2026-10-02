-- MVP 5 Výprodej (contracts O1, O7, O8): sale runs on existing variants (OutletRun), their history
-- (OutletEvent, idempotent per webhook step) and the scheduler's per-task state (JobState).
-- app/lib/integration/outlet.server.ts, app/lib/jobs/scheduler.server.ts.
-- CreateTable
CREATE TABLE "OutletRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quota" INTEGER NOT NULL,
    "percent" INTEGER NOT NULL,
    "endsAt" DATETIME,
    "priceListIds" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL,
    "endReason" TEXT,
    "sold" INTEGER NOT NULL DEFAULT 0,
    "returned" INTEGER NOT NULL DEFAULT 0,
    "returnPending" INTEGER NOT NULL DEFAULT 0,
    "backup" TEXT,
    "sale" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OutletEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "orderId" TEXT,
    "lineId" TEXT,
    "key" TEXT NOT NULL,
    "detail" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "JobState" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "lastRunAt" DATETIME,
    "lastError" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "OutletRun_shop_status_idx" ON "OutletRun"("shop", "status");

-- CreateIndex
CREATE INDEX "OutletRun_shop_variantId_idx" ON "OutletRun"("shop", "variantId");

-- CreateIndex
CREATE INDEX "OutletEvent_shop_runId_at_idx" ON "OutletEvent"("shop", "runId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "OutletEvent_shop_key_key" ON "OutletEvent"("shop", "key");
