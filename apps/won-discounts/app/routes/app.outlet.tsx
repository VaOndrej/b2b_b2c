import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { loadOutletScreen, outletAction } from "../lib/integration/outlet-admin.server";
import { OutletScreen } from "../components/screens/OutletScreen";

// Výprodej (MVP 5, Pro). A static route: it wins over app.$module.tsx, so /app/outlet keeps its URL. The
// screen lives in components/screens/OutletScreen.tsx (the dev harness renders the same component); the data
// and the actions live in app/lib/integration/outlet-admin.server.ts. The context comes from the SESSION shop
// (SEC-2); every form is parsed on the server (SEC-1); Pro is checked there (BILL-1, A6).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return loadOutletScreen(ctx);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return outletAction(ctx, await request.formData());
};

export default function Outlet() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  return <OutletScreen key={`${loaded.configVersion ?? "none"}-${loaded.running.length}-${loaded.ended.length}`} {...loaded} result={submitted ?? null} />;
}
