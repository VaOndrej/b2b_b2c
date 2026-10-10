-- Výprodej: a sale can let its variant take the other discounts too (per sale; feedback 10 Oct 2026).
-- Existing sales keep the shop's rule (NULL).
-- AlterTable
ALTER TABLE "OutletRun" ADD COLUMN "combine" BOOLEAN;
