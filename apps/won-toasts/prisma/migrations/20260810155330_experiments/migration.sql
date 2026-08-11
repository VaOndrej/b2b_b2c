-- CreateTable
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
);

-- CreateIndex
CREATE INDEX "Experiment_shop_status_idx" ON "Experiment"("shop", "status");
