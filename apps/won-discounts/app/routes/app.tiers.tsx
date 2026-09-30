import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { loadTiersScreen, tiersAction } from "../lib/integration/tiers.server";
import type { UiResult } from "../components/model/types";
import { TiersScreen } from "../components/screens/TiersScreen";

// Množstevní slevy (MVP 3). A static route: it wins over app.$module.tsx, so
// /app/tiers (nav, Přehled, deep links) keeps its URL. The screen lives in
// components/screens/TiersScreen.tsx so the dev harness renders the same
// component; the data and the writes live in app/lib/integration/tiers.server.ts.
// The request context is built from the SESSION shop (SEC-2); the form is parsed
// on the server (SEC-1) and BILL-1 is applied there (gate notes; the sync gates).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return loadTiersScreen(ctx, { scopes: session.scope ?? "" });
};

// `intent=save` (+ `replaceUnreadable=1` to confirm replacing an unreadable stored config, I3).
export const action = async ({ request }: ActionFunctionArgs): Promise<UiResult> => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return tiersAction(ctx, await request.formData());
};

export default function Tiers() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  // Remount on a new stored version (after a save) so the form shows what is stored now.
  return <TiersScreen key={loaded.configVersion ?? "none"} {...loaded} result={submitted ?? null} />;
}
