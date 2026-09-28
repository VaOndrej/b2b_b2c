-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN "pending" TEXT;

-- CreateTable
CREATE TABLE "ProductTargetIndex" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "payloadHash" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ProductTargetIndex_shop_idx" ON "ProductTargetIndex"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ProductTargetIndex_shop_productId_key" ON "ProductTargetIndex"("shop", "productId");
