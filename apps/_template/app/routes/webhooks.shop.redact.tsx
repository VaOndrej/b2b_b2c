import { createShopRedactAction } from "@won/app-kit/webhooks";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR shop/redact — ~48h after uninstall, erase the shop (PRIV-2). Sessions are
// cleared for you. If your app stores shop-scoped data, pass `deleteShopData` to
// purge it (idempotent — Shopify may deliver the webhook more than once):
//   createShopRedactAction({ authenticate, db, deleteShopData: async (shop) => { ... }, retryOnDeletionError: true })
// retryOnDeletionError: a failed deletion is logged without PII and answered
// with 500, so Shopify retries the webhook instead of the data being silently
// kept (the app-kit default still ACKs 200 for backwards compatibility).
export const action = createShopRedactAction({ authenticate, db, retryOnDeletionError: true });
