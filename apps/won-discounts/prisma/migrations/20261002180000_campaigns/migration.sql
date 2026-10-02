-- MVP 6 Kampaně (contracts K3, K4): the scheduler's campaign boundary and the campaigns that finish after a
-- downgrade (A6). app/lib/sync/sync-state.server.ts, app/lib/jobs/scheduler.server.ts.
-- AlterTable
ALTER TABLE "ShopSyncState" ADD COLUMN "campaignBoundaryAt" DATETIME;
ALTER TABLE "ShopSyncState" ADD COLUMN "campaignsFinishing" TEXT;
