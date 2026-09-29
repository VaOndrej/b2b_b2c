import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { appCostRefresher, handleCostWebhook } from "../lib/integration/costs.server";
import { appTargetingRefresher, handleTargetingWebhook } from "../lib/integration/targeting.server";

// products/create, products/update, products/delete, collections/update,
// collections/delete (shopify.app.toml) → the shop's product targeting is
// marked stale and ONE debounced re-index is scheduled
// (app/lib/integration/targeting.server.ts); the product topics also keep the
// margin cost mirror fresh (app/lib/integration/costs.server.ts: the product's
// variants queued while margin protection is on; a deleted product's rows
// dropped). authenticate.webhook verifies the HMAC (401 otherwise, WBH-1). The
// handlers only write a stale mark / drop rows / queue an id — idempotent
// (WBH-2: a repeated or late delivery changes nothing more) and fast: the
// answer never waits for Shopify. A failing DB write answers 5xx, so Shopify
// retries.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const delivery = { shop, topic: String(topic), payload };
  const outcome = await handleTargetingWebhook({ db, schedule: (s) => appTargetingRefresher(db).schedule(s) }, delivery);
  const costs = await handleCostWebhook({ db, note: (s, work) => appCostRefresher(db).note(s, work) }, delivery);
  if (outcome.handled !== "ignored") console.log(`Received ${topic} webhook for ${shop}: ${outcome.handled}`);
  if (costs.handled !== "ignored") console.log(`[won-costs] ${topic} ${shop}: ${costs.handled}`);
  return new Response();
};
