import type { ActionFunctionArgs } from "react-router";

type WebhookAuthenticator = {
  webhook: (request: Request) => Promise<any>;
};

type WebhookDeps = {
  authenticate: WebhookAuthenticator;
  db: any;
};

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
