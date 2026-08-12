import { createCustomersRedactAction } from "@won/app-kit/webhooks";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR customers/redact. The template stores no customer PII, so no deletion is
// needed. If your app stores customer data, pass a `redactCustomer` callback that
// deletes it for the identified customer (idempotent — the webhook may retry).
//   createCustomersRedactAction({ authenticate, db, redactCustomer: async ({ shop, payload }) => { ... } })
export const action = createCustomersRedactAction({ authenticate, db });
