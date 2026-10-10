-- Výprodej: WHICH other discounts a sale takes (feedback 10 Oct 2026, 6th round): "tiers,product,order" or a part.
-- NULL with combine = true is a sale from before the list: it takes every one.
-- AlterTable
ALTER TABLE "OutletRun" ADD COLUMN "combineWith" TEXT;
