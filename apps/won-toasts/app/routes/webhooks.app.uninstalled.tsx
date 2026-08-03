import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteShopData } from "../services/toast-config.server";

// Uninstall must purge the shop's app data (GDPR + clean re-install). Webhooks
// can fire more than once and after uninstall, so missing data is a no-op.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  await deleteShopData(shop);
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
