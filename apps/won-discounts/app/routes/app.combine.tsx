import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { combineAction } from "../lib/integration/combine.server";
import type { UiResult } from "../components/model/types";

// "Sčítá se s" of a module (docs/won-discounts/navrh-kombinace-2026-10-13.md): Množstevní slevy, Milníky and
// Výprodej post their list here (components/shell/ModuleCombine). An action only. Data and writes in
// app/lib/integration/combine.server.ts, the SESSION shop (SEC-2), the form parsed on the server (SEC-1).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { redirect } = await authenticate.admin(request);
  return redirect("/app");
};

export const action = async ({ request }: ActionFunctionArgs): Promise<UiResult> => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return combineAction(ctx, await request.formData());
};
