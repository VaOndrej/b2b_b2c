import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { redactCustomerSales } from "../services/sale-events.server";

// GDPR customers/redact — delete every stored trace of a customer. Our only
// customer-linked data is the anonymized social-proof feed (SaleEvent), keyed
// by customerId; drop those rows. Idempotent: missing data is a no-op.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const customerId = (payload as { customer?: { id?: number | string } })?.customer
    ?.id;
  if (customerId != null) {
    await redactCustomerSales(shop, customerId).catch(() => {});
  }
  return new Response();
};
