import { createShopRedactAction } from "@won/app-kit/webhooks";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR shop/redact — ~48h after uninstall, erase the shop. Sessions are cleared
// for you. If your app stores shop-scoped data, pass `deleteShopData` to purge it:
//   createShopRedactAction({ authenticate, db, deleteShopData: async (shop) => { ... } })
export const action = createShopRedactAction({ authenticate, db });
