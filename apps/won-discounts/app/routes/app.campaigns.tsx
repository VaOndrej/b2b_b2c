import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { campaignsAction, loadCampaignsScreen } from "../lib/integration/campaigns-admin.server";
import { CampaignsScreen } from "../components/screens/CampaignsScreen";

// Kampaně (MVP 6, Pro). A static route: it wins over app.$module.tsx, so /app/campaigns keeps its URL. The screen
// lives in components/screens/CampaignsScreen.tsx (the dev harness renders the same component); the data and the
// actions live in app/lib/integration/campaigns-admin.server.ts. The context comes from the SESSION shop (SEC-2);
// every form is parsed on the server (SEC-1); Pro is checked there (BILL-1, A6).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return loadCampaignsScreen(ctx, { edit: new URL(request.url).searchParams.get("edit") });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return campaignsAction(ctx, await request.formData());
};

export default function Campaigns() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  return <CampaignsScreen key={`${loaded.configVersion ?? "none"}-${loaded.editing?.id ?? "new"}`} {...loaded} result={submitted ?? null} />;
}
