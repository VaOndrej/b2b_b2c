import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadAnalyticsScreen } from "../lib/integration/analytics-admin.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { AnalyticsScreen } from "../components/screens/AnalyticsScreen";

// Přehledy (MVP 7, contract M4). A static route (it wins over app.$module.tsx). Read-only: the numbers come from
// the order facts of the SESSION shop (SEC-2); the per-discount rows are Pro and never leave the server for a
// Free shop (BILL-1, analytics-admin.server.ts).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return loadAnalyticsScreen(ctx);
};

export default function Analytics() {
  return <AnalyticsScreen {...useLoaderData<typeof loader>()} />;
}
