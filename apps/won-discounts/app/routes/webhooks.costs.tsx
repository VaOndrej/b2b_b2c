import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { appCostRefresher, handleCostWebhook } from "../lib/integration/costs.server";

// inventory_items/update (shopify.app.toml, include_fields id, cost,
// updated_at, admin_graphql_api_id) → while margin protection is on, the
// inventory item is queued for ONE debounced per-shop mirror of its variant's
// cost (app/lib/integration/costs.server.ts). authenticate.webhook verifies the
// HMAC (401 otherwise, WBH-1). The handler only reads the config and queues an
// id — idempotent (WBH-2) and fast: the answer never waits for Shopify. A
// failing DB read answers 5xx, so Shopify retries.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  const outcome = await handleCostWebhook(
    { db, note: (s, work) => appCostRefresher(db).note(s, work) },
    { shop, topic: String(topic), payload },
  );
  if (outcome.handled !== "ignored") console.log(`[won-costs] ${topic} ${shop}: ${outcome.handled}`);
  return new Response();
};
