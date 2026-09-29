-- MVP 2 margin protection (Task 3): the cost mirror (VariantCost: inventoryItem.unitCost
-- → the $app:won_discounts/variant metafield the discount function reads), its full-pass
-- bookkeeping on ShopSyncState (costsScannedAt / costsCursor / costsPending) and the
-- product metafield value on ProductTargetIndex (marginRefs + rule refs for the impact
-- overview). app/lib/sync/costs.ts, app/lib/sync/products.ts.
-- AlterTable
ALTER TABLE "ProductTargetIndex" ADD COLUMN "value" TEXT;

-- AlterTable
ALTER TABLE "ShopSyncState" ADD COLUMN "costsCursor" TEXT;
ALTER TABLE "ShopSyncState" ADD COLUMN "costsPending" TEXT;
ALTER TABLE "ShopSyncState" ADD COLUMN "costsScannedAt" DATETIME;

-- CreateTable
CREATE TABLE "VariantCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "title" TEXT,
    "variantTitle" TEXT,
    "price" TEXT NOT NULL,
    "cost" TEXT,
    "currency" TEXT,
    "metafieldValue" TEXT,
    "mayCarry" BOOLEAN NOT NULL DEFAULT false,
    "writeError" TEXT,
    "writeFailedAt" DATETIME,
    "scanId" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "VariantCost_shop_inventoryItemId_idx" ON "VariantCost"("shop", "inventoryItemId");

-- CreateIndex
CREATE INDEX "VariantCost_shop_productId_idx" ON "VariantCost"("shop", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantCost_shop_variantId_key" ON "VariantCost"("shop", "variantId");

