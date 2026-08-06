-- AlterTable
ALTER TABLE "ToastAppConfig" ADD COLUMN "locales" JSONB;

-- CreateTable
CREATE TABLE "ConfigVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ConfigVersion_shop_createdAt_idx" ON "ConfigVersion"("shop", "createdAt");
