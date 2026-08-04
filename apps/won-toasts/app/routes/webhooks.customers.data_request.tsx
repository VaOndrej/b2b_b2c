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
    const rows = await salesForCustomer(shop, customerId).catch(() => []);
    // The merchant fulfils the request out-of-band; we report what we hold.
    console.log(
      `Won Toasts data for customer ${customerId} @ ${shop}:`,
      JSON.stringify(rows),
    );
  }
  return new Response();
};
