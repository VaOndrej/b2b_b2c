-- CreateTable
CREATE TABLE "QuantityConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minimum" INTEGER NOT NULL DEFAULT 1,
    "step" INTEGER NOT NULL DEFAULT 1,
    "maximum" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "QuantityRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "minimum" INTEGER,
    "step" INTEGER,
    "maximum" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuantityRule_shop_fkey" FOREIGN KEY ("shop") REFERENCES "QuantityConfig" ("shop") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "QuantityConfig_shop_key" ON "QuantityConfig"("shop");

-- CreateIndex
CREATE INDEX "QuantityRule_shop_idx" ON "QuantityRule"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "QuantityRule_shop_targetKey_key" ON "QuantityRule"("shop", "targetKey");
