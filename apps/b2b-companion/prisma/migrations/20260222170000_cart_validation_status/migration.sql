-- AlterTable
ALTER TABLE "MarginGuardConfig" ADD COLUMN "cartValidationStatus" TEXT NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "MarginGuardConfig" ADD COLUMN "cartValidationLastError" TEXT;

-- AlterTable
ALTER TABLE "MarginGuardConfig" ADD COLUMN "cartValidationLastSyncAt" DATETIME;
