import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { recordSubscriptionUpdate } from "../lib/billing.server";
import { offlineClient } from "../lib/integration/costs.server";
import { resyncShop } from "../lib/sync/save-and-sync.server";

// Billing (MVP 7, contract M1; BILL-1): Shopify reports a change of the shop's subscription — approved, cancelled,
// expired, frozen. The plan row follows at once (idempotent: a redelivery changes nothing, WBH-2) and a changed plan
// resyncs the shop in the background with its offline session, so checkout runs what the plan allows without
// anybody opening the app. authenticate.webhook verifies the HMAC (401 otherwise, WBH-1). A failing DB write
// answers 5xx and Shopify retries; a failed resync is retried by the Přehled and the scheduler.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload } = await authenticate.webhook(request);
  const outcome = await recordSubscriptionUpdate(db, shop, payload);
  if (outcome?.changed) {
    console.log(`[won-billing] ${shop}: plan ${outcome.plan}`);
    void offlineClient(shop)
      .then((client) => (client ? resyncShop({ client, db, shop }) : undefined))
      .catch((error: unknown) => console.error(`[won-billing] ${shop}: ${error instanceof Error ? error.message : String(error)}`));
  }
  return new Response();
};
