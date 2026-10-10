-- Výprodej: how a sale shows on the storefront and the text of its badge are set per sale (feedback 9 Oct 2026).
-- Existing sales keep the shop's display setting (NULL) and the default label (NULL).
-- AlterTable
ALTER TABLE "OutletRun" ADD COLUMN "display" TEXT;
ALTER TABLE "OutletRun" ADD COLUMN "message" TEXT;
