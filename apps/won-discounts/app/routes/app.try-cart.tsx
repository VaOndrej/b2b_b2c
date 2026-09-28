import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { tryCartAction, tryCartPage } from "../lib/integration/pages.server";
import { TryCartScreen } from "../components/screens/TryCartScreen";

// Vyzkoušet košík. The plan is computed on the server: Shopify prices for the
// chosen market, then the engine on the discount function's own payload.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "" });
  return tryCartPage(ctx, { scopes: session.scope ?? "" });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "" });
  return tryCartAction(ctx, await request.formData(), { scopes: session.scope ?? "" });
};

export default function TryCart() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  return (
    <TryCartScreen
      {...loaded}
      lines={submitted?.lines ?? loaded.lines}
      plan={submitted?.plan ?? loaded.plan}
      result={submitted ? submitted.result : loaded.result}
    />
  );
}
