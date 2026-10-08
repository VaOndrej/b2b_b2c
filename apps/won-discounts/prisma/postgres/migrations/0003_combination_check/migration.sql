-- Kontrola kombinací: the result is stored (computed after a sync and once a day), the pages only read it.
-- AlterTable
ALTER TABLE "ShopSyncState" ADD COLUMN "currency" TEXT;

-- CreateTable
CREATE TABLE "CombinationCheck" (
    "shop" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "plan" TEXT NOT NULL,
    "products" TEXT NOT NULL DEFAULT '[]',
    "productsReadAt" TIMESTAMP(3),
    "payload" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CombinationCheck_pkey" PRIMARY KEY ("shop")
);
