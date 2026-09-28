import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteShopData } from "../lib/config.server";

// app/uninstalled — clear the shop's sessions and purge Won Discounts data
// (PRIV-2: don't wait for the later shop/redact webhook to drop it). Mirrors
// @won/app-kit/webhooks' createAppUninstalledAction, extended with our own
// deletion since that factory has no deleteShopData hook. Webhooks can fire
// more than once and after uninstall, so a missing session or already-deleted
// data is a no-op, not an error.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    await deleteShopData(db, shop);
  } catch {
    // Must still ACK 200 even if our own cleanup fails; Shopify retries the webhook.
  }

  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
