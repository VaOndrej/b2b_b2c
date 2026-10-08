-- Kontrola kombinací: the result is stored (computed after a sync and once a day), the pages only read it.
-- AlterTable
ALTER TABLE "ShopSyncState" ADD COLUMN "currency" TEXT;

-- CreateTable
CREATE TABLE "CombinationCheck" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "computedAt" DATETIME NOT NULL,
    "plan" TEXT NOT NULL,
    "products" TEXT NOT NULL DEFAULT '[]',
    "productsReadAt" DATETIME,
    "payload" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);
