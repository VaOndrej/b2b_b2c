import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { loadRewardsScreen, rewardsAction } from "../lib/integration/rewards.server";
import type { UiResult } from "../components/model/types";
import { MilestonesScreen } from "../components/screens/MilestonesScreen";

// Milníky (dřív „Odměny za košík“, MVP 4; feedback 6 Oct 2026 bod 9). A static route: it wins over
// app.$module.tsx, and /app/rewards keeps its URL. The screen lives in components/screens/MilestonesScreen.tsx
// (the dev harness renders the same component); the data and the writes live in
// app/lib/integration/rewards.server.ts. The context comes from the SESSION shop
// (SEC-2); the form is parsed on the server (SEC-1); BILL-1 gates in the sync.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  // N1: the setup guide opens the page on a first step (free shipping) with its amounts prefilled.
  const start = new URL(request.url).searchParams.get("start") === "shipping" ? ("shipping" as const) : null;
  return { ...(await loadRewardsScreen(ctx, { scopes: session.scope ?? "" })), start };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<UiResult> => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "", scopes: session.scope });
  return rewardsAction(ctx, await request.formData());
};

export default function Rewards() {
  const loaded = useLoaderData<typeof loader>();
  const submitted = useActionData<typeof action>();
  return <MilestonesScreen key={loaded.configVersion ?? "none"} {...loaded} result={submitted ?? null} />;
}
