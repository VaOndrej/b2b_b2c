CREATE TABLE "ProductQuantityRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "segment" TEXT,
    "minimumOrderQuantity" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductQuantityRule_configId_fkey" FOREIGN KEY ("configId") REFERENCES "MarginGuardConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProductQuantityRule_configId_productId_segment_key"
ON "ProductQuantityRule"("configId", "productId", "segment");
