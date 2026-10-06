import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { loadPlanScreen, planAction } from "../lib/integration/plan-admin.server";
import { PLAN_ACTION } from "../components/model/plan";
import { PlanScreen } from "../components/screens/PlanScreen";

// Tarif (MVP 7, contracts M1–M3). The plan in force is server-derived (BILL-1): every load reconciles it with
// Shopify's active subscriptions — also the landing after Shopify's confirmation page (?billing=return). The
// data and the actions live in app/lib/integration/plan-admin.server.ts; the context is the SESSION shop (SEC-2).
// Since the menu change of 6 Oct 2026 the plan is shown in Nastavení (app.settings.tsx renders the same sections).
// This route stays: Shopify returns here after the confirmation page, the "Zobrazit tarif Pro" links open it, and
// its action serves the plan sections on both pages (they post here through a fetcher).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return loadPlanScreen(ctx);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const env = process.env;
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return planAction(ctx, await request.formData());
};

export default function Plan() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return <PlanScreen {...loaded} result={result ?? null} action={PLAN_ACTION} />;
}
