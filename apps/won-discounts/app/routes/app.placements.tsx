import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { loadPlacementsScreen, placementsAction } from "../lib/integration/placements.server";
import type { PlacementsResult } from "../components/model/placements";
import { PlacementsScreen } from "../components/screens/PlacementsScreen";

// Umístění na webu (balík E): every Won element and its places on one page. Data and actions in
// app/lib/integration/placements.server.ts, the SESSION shop (SEC-2), the form read on the server (SEC-1).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return loadPlacementsScreen(ctx);
};

export const action = async ({ request }: ActionFunctionArgs): Promise<PlacementsResult> => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return placementsAction(ctx, await request.formData());
};

export default function Placements() {
  const loaded = useLoaderData<typeof loader>();
  return <PlacementsScreen {...loaded} />;
}
