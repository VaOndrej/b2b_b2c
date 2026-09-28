-- CreateTable
CREATE TABLE "ShopConfig" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "schemaVersion" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ConfigVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ConfigVersion_shop_createdAt_idx" ON "ConfigVersion"("shop", "createdAt");
