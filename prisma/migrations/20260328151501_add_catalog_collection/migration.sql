-- CreateTable
CREATE TABLE "CatalogCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceType" TEXT NOT NULL,
    "externalKey" TEXT NOT NULL,
    "shopifyCollectionId" TEXT,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCollection_shopifyCollectionId_key" ON "CatalogCollection"("shopifyCollectionId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCollection_sourceType_externalKey_key" ON "CatalogCollection"("sourceType", "externalKey");
