ALTER TABLE "MarginGuardConfig" ADD COLUMN "productCatalogSourceType" TEXT NOT NULL DEFAULT 'SHOPIFY';
ALTER TABLE "MarginGuardConfig" ADD COLUMN "productCatalogAutoImportEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MarginGuardConfig" ADD COLUMN "productCatalogLastSyncAt" DATETIME;
ALTER TABLE "MarginGuardConfig" ADD COLUMN "productCatalogLastSyncError" TEXT;

CREATE TABLE "CatalogProduct" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceType" TEXT NOT NULL,
  "externalKey" TEXT NOT NULL,
  "shopifyProductId" TEXT,
  "title" TEXT NOT NULL,
  "handle" TEXT,
  "status" TEXT,
  "vendor" TEXT,
  "productType" TEXT,
  "imageUrl" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "syncedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "CatalogProduct_sourceType_externalKey_key"
ON "CatalogProduct"("sourceType", "externalKey");

CREATE UNIQUE INDEX "CatalogProduct_shopifyProductId_key"
ON "CatalogProduct"("shopifyProductId");

CREATE TABLE "CatalogVariant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sourceType" TEXT NOT NULL,
  "externalKey" TEXT NOT NULL,
  "shopifyVariantId" TEXT,
  "shopifyProductId" TEXT,
  "title" TEXT NOT NULL,
  "productTitle" TEXT NOT NULL,
  "productHandle" TEXT,
  "sku" TEXT,
  "optionSummary" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "syncedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "CatalogVariant_sourceType_externalKey_key"
ON "CatalogVariant"("sourceType", "externalKey");

CREATE UNIQUE INDEX "CatalogVariant_shopifyVariantId_key"
ON "CatalogVariant"("shopifyVariantId");
