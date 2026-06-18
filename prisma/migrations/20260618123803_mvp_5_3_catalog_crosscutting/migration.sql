-- CreateTable
CREATE TABLE "CatalogCouponRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogCouponRule_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogDiscountCap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "maxCombinedPercentOff" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogDiscountCap_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogDiscountBlacklistRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "leftType" TEXT NOT NULL,
    "leftValue" TEXT NOT NULL,
    "rightType" TEXT NOT NULL,
    "rightValue" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogDiscountBlacklistRule_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CatalogCustomerQuantityRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "maxOrderQuantity" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogCustomerQuantityRule_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCouponRule_catalogId_code_key" ON "CatalogCouponRule"("catalogId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogDiscountCap_catalogId_key" ON "CatalogDiscountCap"("catalogId");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogCustomerQuantityRule_catalogId_customerId_productId_key" ON "CatalogCustomerQuantityRule"("catalogId", "customerId", "productId");
