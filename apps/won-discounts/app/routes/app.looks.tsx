import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { looksAction } from "../lib/integration/looks.server";
import type { UiResult } from "../components/model/types";

// The look of a storefront element (feedback 6 Oct 2026, bod 13): every module's page posts its element's look
// here (components/looks/LookSection). An action only — the looks are shown on the modules' pages. Data and writes
// in app/lib/integration/looks.server.ts, the SESSION shop (SEC-2), the form parsed on the server (SEC-1).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { redirect } = await authenticate.admin(request);
  return redirect("/app");
};

export const action = async ({ request }: ActionFunctionArgs): Promise<UiResult> => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return looksAction(ctx, await request.formData());
};
