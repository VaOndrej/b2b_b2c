-- CreateTable
CREATE TABLE "WonNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "ruleId" TEXT,
    "discountNodeId" TEXT NOT NULL,
    "codesHash" TEXT,
    "varsVersion" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NativeDiscountBackup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "nativeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "wonRuleId" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "steps" TEXT NOT NULL,
    "errorCount" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE INDEX "WonNode_shop_idx" ON "WonNode"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "WonNode_shop_key_key" ON "WonNode"("shop", "key");

-- CreateIndex
CREATE INDEX "NativeDiscountBackup_shop_status_idx" ON "NativeDiscountBackup"("shop", "status");

-- CreateIndex
CREATE INDEX "SyncRun_shop_startedAt_idx" ON "SyncRun"("shop", "startedAt");
