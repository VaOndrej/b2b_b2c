ALTER TABLE "ProductQuantityRule"
ADD COLUMN "maxOrderQuantity" INTEGER;

CREATE TABLE "ProductCustomerQuantityRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "maxOrderQuantity" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductCustomerQuantityRule_configId_fkey" FOREIGN KEY ("configId") REFERENCES "MarginGuardConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProductCustomerQuantityRule_configId_productId_customerId_key"
ON "ProductCustomerQuantityRule"("configId", "productId", "customerId");
