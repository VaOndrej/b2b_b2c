-- AlterTable
ALTER TABLE "Session" ADD COLUMN "adminLocale" TEXT;

-- AlterTable
ALTER TABLE "SyncRun" ADD COLUMN "configVersionId" TEXT;

-- Claim guard (fix round 1, item 4): at most ONE live claim (`moving` or
-- `undoing`) per shop + native discount, across every app instance. Prisma's
-- schema language cannot express a partial index, so it exists only here
-- (documented on the model in schema.prisma; `migrate diff` ignores it). The
-- native move/undo code treats a violation (P2002) as "already claimed".
CREATE UNIQUE INDEX "NativeDiscountBackup_one_claim_per_native" ON "NativeDiscountBackup"("shop", "nativeId") WHERE "status" IN ('moving', 'undoing');
