import { createShopRedactAction } from "@won/app-kit/webhooks";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteShopData } from "../lib/config.server";

// GDPR shop/redact — ~48 h after uninstall, erase the shop (PRIV-2). This is
// the ONLY place Won Discounts app data is deleted (app/uninstalled keeps it,
// see webhooks.app.uninstalled.tsx): sessions plus ShopConfig + ConfigVersion
// via app/lib/config.server.ts (idempotent — safe to retry).
// retryOnDeletionError: a failed deletion is logged without PII and answered
// with 500, so Shopify retries the webhook instead of the data being kept.
export const action = createShopRedactAction({
  authenticate,
  db,
  deleteShopData: (shop) => deleteShopData(db, shop),
  retryOnDeletionError: true,
});
