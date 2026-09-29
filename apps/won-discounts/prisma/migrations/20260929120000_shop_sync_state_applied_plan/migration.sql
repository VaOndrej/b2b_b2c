-- F2 re-review I-2 (BILL-1): the plan ("free" | "pro") the shop function
-- config live in Shopify was built for; a different plan now triggers a resync
-- (app/lib/sync/runs.ts appliedPlanOf, save-and-sync.server.ts resyncIfPending).
-- AlterTable
ALTER TABLE "ShopSyncState" ADD COLUMN "appliedPlan" TEXT;
