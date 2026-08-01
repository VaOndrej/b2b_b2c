-- CreateTable
CREATE TABLE "CatalogVariantVisibilityRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "visibilityMode" TEXT NOT NULL DEFAULT 'HIDDEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogVariantVisibilityRule_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogVariantVisibilityRule_catalogId_variantId_key" ON "CatalogVariantVisibilityRule"("catalogId", "variantId");
