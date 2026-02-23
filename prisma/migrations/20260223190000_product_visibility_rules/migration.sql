CREATE TABLE "ProductVisibilityRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "visibilityMode" TEXT NOT NULL,
    "customerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductVisibilityRule_configId_fkey" FOREIGN KEY ("configId") REFERENCES "MarginGuardConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProductVisibilityRule_configId_productId_key"
ON "ProductVisibilityRule"("configId", "productId");
