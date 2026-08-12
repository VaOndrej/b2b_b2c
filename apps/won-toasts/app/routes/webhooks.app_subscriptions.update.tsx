import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { planFromSubscriptionUpdate } from "../services/billing.server";
import { updateToastConfig } from "../services/toast-config.server";

// BILL-1: reconcile the stored plan the moment Shopify's subscription state
// changes — cancel / expire / freeze downgrades to Free immediately, instead of
// the shop keeping Pro on the storefront until it happens to open the Plan page.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const plan = planFromSubscriptionUpdate(payload);
  if (plan) {
    await updateToastConfig(shop, { plan }).catch(() => {});
  }
  return new Response();
};
