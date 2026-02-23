CREATE TABLE "ProductTierPriceRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "segment" TEXT,
    "minQuantity" INTEGER NOT NULL,
    "unitPrice" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductTierPriceRule_configId_fkey" FOREIGN KEY ("configId") REFERENCES "MarginGuardConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProductTierPriceRule_configId_productId_segment_minQuantity_key"
ON "ProductTierPriceRule"("configId", "productId", "segment", "minQuantity");
