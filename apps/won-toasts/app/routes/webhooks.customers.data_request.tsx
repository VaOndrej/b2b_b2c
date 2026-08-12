import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { salesForCustomer } from "../services/sale-events.server";

// GDPR customers/data_request — surface the (minimal, anonymized) data we hold
// for a customer so the merchant can fulfil the request. We only ever store a
// first name + city + product on the social-proof feed. Acknowledge with 200.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const customerId = (payload as { customer?: { id?: number | string } })?.customer
    ?.id;
  if (customerId != null) {
    // Confirm we can locate the record set, but NEVER log the rows themselves —
    // they carry the customer's name + city (Level 2 PII). Logging PII, least of
    // all in the GDPR data-request handler, is forbidden (doctrine PRIV-3).
    const count = (await salesForCustomer(shop, customerId).catch(() => [])).length;
    console.log(
      `customers/data_request for ${shop}: ${count} social-proof record(s) held`,
    );
  }
  return new Response();
};
