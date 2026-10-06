-- Výprodej: the sale badge on the storefront can be hidden per sale (per variant). Existing sales keep it shown.
-- AlterTable
ALTER TABLE "OutletRun" ADD COLUMN "showBadge" BOOLEAN NOT NULL DEFAULT true;
