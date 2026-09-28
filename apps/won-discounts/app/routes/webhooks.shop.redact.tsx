import { createShopRedactAction } from "@won/app-kit/webhooks";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteShopData } from "../lib/config.server";

// GDPR shop/redact — ~48h after uninstall, erase the shop (PRIV-2). Sessions
// are cleared for you; this also purges the shop's ShopConfig + ConfigVersion
// history via app/lib/config.server.ts (idempotent — safe to retry).
export const action = createShopRedactAction({
  authenticate,
  db,
  deleteShopData: (shop) => deleteShopData(db, shop),
});
