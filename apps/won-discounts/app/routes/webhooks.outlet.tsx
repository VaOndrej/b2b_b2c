import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { offlineClient } from "../lib/integration/costs.server";
import { recordOutletWebhook, settleOutletWebhook } from "../lib/integration/outlet.server";

// Výprodej (MVP 5, contract O7): orders/create, orders/cancelled, refunds/create → the sale ledger
// (app/lib/integration/outlet.server.ts). authenticate.webhook verifies the HMAC (401 otherwise, WBH-1). The
// ledger write is idempotent per order line (OutletEvent.key, WBH-2) and answers before any Shopify call; a
// failing DB write answers 5xx, so Shopify retries. What the order asks for afterwards (end a used-up quota,
// reopen after a return, the storefront's "zbývá X ks") runs in the background with the shop's offline
// session; without one the scheduler's outlet.due ends the quota later.
// NOT SUBSCRIBED YET: the order topics need the app's protected customer data access (live fact F-O1 in the
// MVP 5 plan); the subscription goes into shopify.app.toml once Ondřej enabled it in the Partner Dashboard.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const outcome = await recordOutletWebhook({ shop, db }, String(topic), payload);
  if (outcome.recorded > 0) console.log(`[won-outlet] ${topic} ${shop}: ${outcome.recorded} step(s)`);
  if (outcome.end.length + outcome.reopen.length + outcome.storefront.length > 0) {
    void offlineClient(shop)
      .then((client) => (client ? settleOutletWebhook({ shop, db, client }, outcome) : undefined))
      .catch((error: unknown) => console.error(`[won-outlet] ${shop}: ${error instanceof Error ? error.message : String(error)}`));
  }
  return new Response();
};
