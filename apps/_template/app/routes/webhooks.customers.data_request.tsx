import { createDataRequestAction } from "@won/app-kit/webhooks";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR customers/data_request. The template stores no customer PII, so this just
// acknowledges. If your app stores customer data, surface it to the merchant
// out-of-band here — but NEVER log the payload (it carries PII, doctrine PRIV-3).
export const action = createDataRequestAction({ authenticate, db });
