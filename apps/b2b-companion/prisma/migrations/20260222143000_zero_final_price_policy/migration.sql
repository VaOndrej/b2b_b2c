-- AlterTable
ALTER TABLE "MarginGuardConfig" ADD COLUMN "allowZeroFinalPrice" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProductFloorRule" ADD COLUMN "allowZeroFinalPrice" BOOLEAN;
