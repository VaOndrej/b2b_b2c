import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { appTargetingRefresher, handleTargetingWebhook } from "../lib/integration/targeting.server";

// products/update, products/delete, collections/update, collections/delete
// (shopify.app.toml) → the shop's product targeting is marked stale and ONE
// debounced re-index is scheduled (app/lib/integration/targeting.server.ts).
// authenticate.webhook verifies the HMAC (401 otherwise, WBH-1). The handler
// only writes a stale mark / drops an index row — idempotent (WBH-2: a
// repeated or late delivery changes nothing more) and fast: the answer never
// waits for Shopify. A failing DB write answers 5xx, so Shopify retries.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const outcome = await handleTargetingWebhook(
    { db, schedule: (s) => appTargetingRefresher(db).schedule(s) },
    { shop, topic: String(topic), payload },
  );
  if (outcome.handled !== "ignored") console.log(`Received ${topic} webhook for ${shop}: ${outcome.handled}`);
  return new Response();
};
