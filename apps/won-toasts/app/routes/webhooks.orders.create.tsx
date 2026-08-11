import type { ActionFunctionArgs } from "react-router";

import { anonymizeOrder } from "@won/core/toasts/social-proof";

import { authenticate } from "../shopify.server";
import { recordToastEvent } from "../services/toast-events.server";
import { recordSaleEvent } from "../services/sale-events.server";
import { getToastConfig } from "../services/toast-config.server";
import { runExperimentGuardrails } from "../services/guardrail.server";

// MVP11 — record every real order as one aggregate event (quantity = total
// units). Feeds order.summary ("X orders in the last N days").
// MVP12 — when social proof is enabled, also store an ANONYMIZED sale (first
// name + city + product only) for the recent-sales feed. Opt-out orders are
// skipped by anonymizeOrder.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const lineItems = (payload as { line_items?: Array<{ quantity?: number }> })
    ?.line_items;
  const units = Array.isArray(lineItems)
    ? lineItems.reduce((sum, li) => sum + (Number(li?.quantity) || 0), 0)
    : 1;

  await recordToastEvent(shop, "order", Math.max(1, units)).catch(() => {});

  // Store an anonymized sale only if the merchant runs the social-proof recipe.
  try {
    const config = await getToastConfig(shop);
    const socialOn = config.notifications.some(
      (n) => n.type === "order.created" && n.enabled,
    );
    if (socialOn) {
      const sale = anonymizeOrder(payload, Date.now());
      if (sale) await recordSaleEvent(shop, sale);
    }
  } catch {
    // never let feed storage break order processing
  }

  // MVP13c: each order is a natural checkpoint (no cron in a Shopify app) — run
  // the live guardrail + auto-promote/rollback for any active experiment. This
  // is fully best-effort and never throws into the webhook.
  await runExperimentGuardrails(shop).catch(() => {});

  return new Response();
};
