import type { ActionFunctionArgs } from "react-router";

type WebhookAuthenticator = {
  webhook: (request: Request) => Promise<any>;
};

type WebhookDeps = {
  authenticate: WebhookAuthenticator;
  db: any;
};

// Compliance factories accept optional app-supplied deletion callbacks so a
// PII-free app is GDPR-compliant with zero extra code, while an app that stores
// customer data plugs in its own erasure (doctrine WBH-3, PRIV-2).
type ComplianceDeps = WebhookDeps & {
  /** customers/redact — delete the identified customer's stored data. Idempotent. */
  redactCustomer?: (args: { shop: string; payload: any }) => Promise<void> | void;
  /** shop/redact — erase all app-owned data for the shop (sessions cleared for you). */
  deleteShopData?: (shop: string) => Promise<void> | void;
};

async function runSafe(fn: (() => Promise<void> | void) | undefined) {
  if (!fn) return;
  try {
    await fn();
  } catch {
    // Compliance webhooks must still ACK 200 even if our own cleanup fails;
    // Shopify retries, and a thrown handler would look like a rejected request.
  }
}

/**
 * `app/uninstalled` — clear the shop's sessions. Webhooks can fire more than
 * once and after uninstall, so a missing session is treated as a no-op.
 */
export function createAppUninstalledAction({ authenticate, db }: WebhookDeps) {
  return async ({ request }: ActionFunctionArgs) => {
    const { shop, session, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    if (session) {
      await db.session.deleteMany({ where: { shop } });
    }

    return new Response();
  };
}

/**
 * `app/scopes_update` — persist the shop's current granted scopes on its session.
 */
export function createScopesUpdateAction({ authenticate, db }: WebhookDeps) {
  return async ({ request }: ActionFunctionArgs) => {
    const { payload, session, topic, shop } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    const current = payload.current as string[];
    if (session) {
      await db.session.update({
        where: { id: session.id },
        data: { scope: current.toString() },
      });
    }

    return new Response();
  };
}

// ── Mandatory GDPR compliance webhooks (doctrine WBH-3) ────────────────────────
// Every Shopify App Store app MUST subscribe to and answer all three, even with
// no PII stored. HMAC is verified by `authenticate.webhook` (401 on bad HMAC —
// WBH-1); these handlers just acknowledge and run any app-supplied deletion.

/**
 * `customers/data_request` — a customer asked to see their data. We acknowledge
 * with 200; the merchant fulfils the request out-of-band. **Never log the
 * payload** — it carries customer PII (PRIV-3).
 */
export function createDataRequestAction({ authenticate }: WebhookDeps) {
  return async ({ request }: ActionFunctionArgs) => {
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    return new Response();
  };
}

/**
 * `customers/redact` — delete the identified customer's data. Pass `redactCustomer`
 * to erase app-stored PII; omit it if the app stores none (still compliant).
 */
export function createCustomersRedactAction({
  authenticate,
  redactCustomer,
}: ComplianceDeps) {
  return async ({ request }: ActionFunctionArgs) => {
    const { shop, topic, payload } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    await runSafe(redactCustomer ? () => redactCustomer({ shop, payload }) : undefined);
    return new Response();
  };
}

/**
 * `shop/redact` — ~48h after uninstall, erase the shop. Clears sessions for you;
 * pass `deleteShopData` to purge the rest of the app's shop-scoped data.
 */
export function createShopRedactAction({
  authenticate,
  db,
  deleteShopData,
}: ComplianceDeps) {
  return async ({ request }: ActionFunctionArgs) => {
    const { shop, topic } = await authenticate.webhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);
    await runSafe(deleteShopData ? () => deleteShopData(shop) : undefined);
    await db.session.deleteMany({ where: { shop } }).catch(() => {});
    return new Response();
  };
}
