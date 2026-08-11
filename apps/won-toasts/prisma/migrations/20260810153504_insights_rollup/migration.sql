-- AlterTable
ALTER TABLE "AnalyticsEvent" ADD COLUMN "dims" JSONB;
ALTER TABLE "AnalyticsEvent" ADD COLUMN "dwellMs" INTEGER;

-- CreateTable
CREATE TABLE "ToastRollup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT 'unknown',
    "pageType" TEXT NOT NULL DEFAULT 'unknown',
    "customerState" TEXT NOT NULL DEFAULT 'unknown',
    "abVariant" INTEGER NOT NULL DEFAULT 0,
    "counters" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ToastRollup_shop_date_idx" ON "ToastRollup"("shop", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ToastRollup_shop_date_type_device_pageType_customerState_abVariant_key" ON "ToastRollup"("shop", "date", "type", "device", "pageType", "customerState", "abVariant");
