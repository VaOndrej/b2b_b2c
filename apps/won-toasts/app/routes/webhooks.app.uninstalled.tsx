import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteShopData } from "../services/toast-config.server";
import { deleteShopEvents } from "../services/toast-events.server";
import { deleteShopSales } from "../services/sale-events.server";
import { deleteShopAnalytics } from "../services/analytics.server";
import { deleteShopExperiments } from "../services/experiments.server";

// Uninstall must purge the shop's app data (GDPR + clean re-install). Webhooks
// can fire more than once and after uninstall, so missing data is a no-op.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  await deleteShopData(shop);
  await deleteShopEvents(shop).catch(() => {});
  await deleteShopSales(shop).catch(() => {});
  await deleteShopAnalytics(shop).catch(() => {});
  await deleteShopExperiments(shop).catch(() => {});
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
