-- MVP 7 (contracts M1, M4): the shop's Pro subscription as Shopify reports it (app/lib/billing.server.ts) and one
-- fact per order about its discounts, without personal data (app/lib/analytics/order-facts.ts).
-- CreateTable
CREATE TABLE "ShopEntitlement" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "plan" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "status" TEXT,
    "trialEndsAt" DATETIME,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "checkedAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OrderDiscountFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "currency" TEXT NOT NULL,
    "subtotalMinor" INTEGER NOT NULL,
    "discountMinor" INTEGER NOT NULL,
    "parts" TEXT NOT NULL DEFAULT '[]',
    "gifts" INTEGER NOT NULL DEFAULT 0,
    "outletItems" INTEGER NOT NULL DEFAULT 0,
    "cancelledAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderDiscountFact_shop_orderId_key" ON "OrderDiscountFact"("shop", "orderId");

-- CreateIndex
CREATE INDEX "OrderDiscountFact_shop_createdAt_idx" ON "OrderDiscountFact"("shop", "createdAt");
