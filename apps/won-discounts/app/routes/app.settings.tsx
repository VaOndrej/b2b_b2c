import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { loadSettingsScreen, settingsAction } from "../lib/integration/settings.server";
import type { UiResult } from "../components/model/types";
import { SettingsScreen } from "../components/screens/SettingsScreen";

// Nastavení (MVP 3): the Free per-category combination switches (engine.combination,
// the MVP 1 debt) and the market currencies. Data and writes in
// app/lib/integration/settings.server.ts; the SESSION shop (SEC-2), the form
// parsed on the server (SEC-1).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return loadSettingsScreen(ctx, { scopes: session.scope ?? "" });
};

export const action = async ({ request }: ActionFunctionArgs): Promise<UiResult> => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return settingsAction(ctx, await request.formData());
};

export default function Settings() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  return <SettingsScreen key={loaded.configVersion ?? "none"} {...loaded} result={submitted ?? null} />;
}
