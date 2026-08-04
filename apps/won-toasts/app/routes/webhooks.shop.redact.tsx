import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteShopData } from "../services/toast-config.server";
import { deleteShopEvents } from "../services/toast-events.server";
import { deleteShopSales } from "../services/sale-events.server";
import { deleteShopAnalytics } from "../services/analytics.server";

// GDPR shop/redact — 48h after uninstall, erase EVERY trace of the shop:
// config, aggregate events, social-proof sales, analytics, and sessions.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  await deleteShopData(shop).catch(() => {});
  await deleteShopEvents(shop).catch(() => {});
  await deleteShopSales(shop).catch(() => {});
  await deleteShopAnalytics(shop).catch(() => {});
  await db.session.deleteMany({ where: { shop } }).catch(() => {});

  return new Response();
};
