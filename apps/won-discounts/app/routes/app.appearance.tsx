import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { appearanceAction, loadAppearanceScreen } from "../lib/integration/appearance.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import type { UiResult } from "../components/model/types";
import { AppearanceScreen } from "../components/screens/AppearanceScreen";

// Vzhled (MVP 3): the four ready-made looks of the quantity-tier table. A static
// route (wins over app.$module.tsx); data and writes in
// app/lib/integration/appearance.server.ts, the SESSION shop (SEC-2), the form
// parsed on the server (SEC-1).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return loadAppearanceScreen(ctx, { scopes: session.scope ?? "" });
};

export const action = async ({ request }: ActionFunctionArgs): Promise<UiResult> => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return appearanceAction(ctx, await request.formData());
};

export default function Appearance() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  return <AppearanceScreen key={loaded.configVersion ?? "none"} {...loaded} result={submitted ?? null} />;
}
