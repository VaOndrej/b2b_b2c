-- Umístění na webu (balík E): the tags found in the live theme, for the storefront config's `tg`.
-- AlterTable
ALTER TABLE "ShopSyncState" ADD COLUMN "themeTags" TEXT;
ALTER TABLE "ShopSyncState" ADD COLUMN "themeTagsAt" DATETIME;
