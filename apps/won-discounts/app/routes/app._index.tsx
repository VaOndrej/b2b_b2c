import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { overviewAction, overviewData } from "../lib/integration/pages.server";
import { buildOverviewProps, OverviewScreen } from "../components/screens/OverviewScreen";

// Přehled v1. The screen lives in components/screens/OverviewScreen.tsx so the
// dev harness renders exactly the same component (audit P2-5). The loader and
// action bodies live in app/lib/integration/pages.server.ts (tested with a fake
// Shopify); the request context is built from the SESSION shop (SEC-2).
//
// The loader is also the sync retry trigger (resyncIfPending, bounded — REL-1)
// and reads the native discounts (detection cached ≤ 60 s, bounded).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "" });
  const { config, options } = await overviewData(ctx, { scopes: session.scope ?? "" });
  return buildOverviewProps(config, options);
};

// "Přesunout" / "Přesunout vše" / "Vrátit zpět" (NativeDiscountsPanel fetcher) and
// "Synchronizovat znovu" (ResyncButton, from any admin page).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "" });
  return overviewAction(ctx, await request.formData());
};

export default function Index() {
  const props = useLoaderData<typeof loader>();
  return <OverviewScreen {...props} />;
}
