-- CreateTable
CREATE TABLE "SaleEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "firstName" TEXT,
    "city" TEXT,
    "product" TEXT,
    "customerId" TEXT,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "SaleEvent_shop_at_idx" ON "SaleEvent"("shop", "at");

-- CreateIndex
CREATE INDEX "SaleEvent_shop_customerId_idx" ON "SaleEvent"("shop", "customerId");
