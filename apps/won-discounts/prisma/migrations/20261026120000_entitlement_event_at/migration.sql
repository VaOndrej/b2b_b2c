-- Audit 2026-10-26, BILL-01: how recent the plan row is, so a late or retried app_subscriptions/update is ignored.
-- AlterTable
ALTER TABLE "ShopEntitlement" ADD COLUMN "eventAt" DATETIME;
