/*
  Warnings:

  - You are about to drop the `CustomerSnapshot` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "CustomerSnapshot";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "StorefrontContentRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "segment" TEXT NOT NULL,
    "pageType" TEXT NOT NULL DEFAULT 'ALL',
    "productId" TEXT,
    "collectionId" TEXT,
    "targetType" TEXT NOT NULL,
    "targetSelector" TEXT,
    "targetPosition" TEXT,
    "action" TEXT NOT NULL,
    "value" TEXT,
    "valueCsLocale" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StorefrontContentRule_configId_fkey" FOREIGN KEY ("configId") REFERENCES "MarginGuardConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectionVisibilityRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "collectionHandle" TEXT NOT NULL,
    "collectionTitle" TEXT,
    "visibilityMode" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CollectionVisibilityRule_configId_fkey" FOREIGN KEY ("configId") REFERENCES "MarginGuardConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StorefrontContentRule_configId_name_key" ON "StorefrontContentRule"("configId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionVisibilityRule_configId_collectionId_key" ON "CollectionVisibilityRule"("configId", "collectionId");
