-- WBH-2: idempotency key for at-least-once orders/create webhooks. A duplicate
-- delivery for the same order must not double-count an aggregate event or a sale.
-- Nullable so cart_add beacons (no order) are unaffected; SQLite allows multiple
-- NULLs under a unique index.
ALTER TABLE "ToastEvent" ADD COLUMN "orderId" TEXT;
ALTER TABLE "SaleEvent" ADD COLUMN "orderId" TEXT;

CREATE UNIQUE INDEX "ToastEvent_shop_orderId_key" ON "ToastEvent"("shop", "orderId");
CREATE UNIQUE INDEX "SaleEvent_shop_orderId_key" ON "SaleEvent"("shop", "orderId");
