import { createAppUninstalledAction } from "@won/app-kit/webhooks";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// app/uninstalled — clear the shop's sessions ONLY. Won Discounts data
// (ShopConfig, ConfigVersion and, from MVP 1, native-discount backups) is
// deliberately kept until GDPR shop/redact (~48 h later, PRIV-2 allows up to
// 30 days; see webhooks.shop.redact.tsx):
//   - webhooks can arrive late or twice — an uninstall webhook processed after
//     a quick reinstall must not wipe the NEW config;
//   - "undo" of a moved native discount needs its backup after a reinstall (A7).
// A failing session deletion throws, so the route answers 5xx and Shopify retries.
export const action = createAppUninstalledAction({ authenticate, db });
