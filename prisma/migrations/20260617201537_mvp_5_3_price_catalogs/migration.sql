-- CreateTable
CREATE TABLE "PriceCatalog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "matchCompany" BOOLEAN NOT NULL DEFAULT false,
    "membershipMode" TEXT NOT NULL DEFAULT 'INHERIT_ALL',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CatalogAudienceTag" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    CONSTRAINT "CatalogAudienceTag_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogMarketFilter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "countryCode" TEXT,
    "currencyCode" TEXT,
    "languageCode" TEXT,
    CONSTRAINT "CatalogMarketFilter_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    CONSTRAINT "CatalogMembership_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogPriceRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "targetId" TEXT,
    "mode" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogPriceRule_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogTierPriceRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "minQuantity" INTEGER NOT NULL,
    "unitPrice" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogTierPriceRule_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogFloorRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "minPercentOfBasePrice" REAL NOT NULL,
    "allowZeroFinalPrice" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogFloorRule_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogQuantityRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "collectionId" TEXT,
    "moq" INTEGER,
    "step" INTEGER,
    "max" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogQuantityRule_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogDiscountRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "targetId" TEXT,
    "code" TEXT,
    "percentOff" REAL NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "stackMode" TEXT NOT NULL DEFAULT 'STACKABLE',
    "minPricePercentOfBasePrice" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogDiscountRule_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogAudienceTag_catalogId_tag_key" ON "CatalogAudienceTag"("catalogId", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogMembership_catalogId_productId_key" ON "CatalogMembership"("catalogId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogPriceRule_catalogId_scope_targetId_key" ON "CatalogPriceRule"("catalogId", "scope", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogTierPriceRule_catalogId_productId_variantId_minQuantity_key" ON "CatalogTierPriceRule"("catalogId", "productId", "variantId", "minQuantity");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogFloorRule_catalogId_productId_variantId_key" ON "CatalogFloorRule"("catalogId", "productId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogQuantityRule_catalogId_productId_variantId_collectionId_key" ON "CatalogQuantityRule"("catalogId", "productId", "variantId", "collectionId");

-- MVP_5_3 Phase 1 — seed the two system catalogs with stable ids that match the
-- function config catalogIds ("default" / "b2b"). The default catalog is the
-- global baseline / anonymous-B2C fallback; the b2b catalog matches purchasing
-- companies and the default b2b customer tag. Idempotent via INSERT OR IGNORE.
INSERT OR IGNORE INTO "PriceCatalog"
  ("id", "name", "priority", "status", "isDefault", "isSystem", "matchCompany", "membershipMode", "createdAt", "updatedAt")
VALUES
  ('default', 'Default', 0, 'ACTIVE', true, true, false, 'INHERIT_ALL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('b2b', 'B2B', 100, 'ACTIVE', false, true, true, 'INHERIT_ALL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO "CatalogAudienceTag" ("id", "catalogId", "tag")
VALUES ('seed-audience-b2b', 'b2b', 'b2b');
