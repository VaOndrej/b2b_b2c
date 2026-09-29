import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { forgetShopifyState } from "../lib/sync/sync-state.server";

// app/uninstalled — clear the shop's sessions, and forget what the app DB
// claims about Shopify (audit P2-4): Shopify removes this app's discounts and
// app-owned metafields with the app, so the WonNode rows are dropped (the next
// sync re-creates the nodes, or adopts them by this app's function / by code)
// and every ProductTargetIndex hash is cleared (the next sync re-reads and
// rewrites the products; rows stay so a product that still carries a ref is
// still cleared — safe also for a delayed delivery after a quick reinstall).
// The margin cost mirror (VariantCost, MVP 2) is deleted: its metafields went
// with the app and a reinstall runs a new full pass once protection is on.
// Won Discounts data (ShopConfig, ConfigVersion, native-discount backups) is
// deliberately kept until GDPR shop/redact (~48 h later, PRIV-2 allows up to
// 30 days; see webhooks.shop.redact.tsx):
//   - webhooks can arrive late or twice — an uninstall webhook processed after
//     a quick reinstall must not wipe the NEW config;
//   - "undo" of a moved native discount needs its backup after a reinstall (A7).
// Idempotent. A failing deletion throws, so the route answers 5xx and Shopify retries.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  if (session) await db.session.deleteMany({ where: { shop } });
  await forgetShopifyState(db, shop);
  return new Response();
};
