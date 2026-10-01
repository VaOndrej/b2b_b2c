import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { adminClientFromApp } from "../lib/admin-client.server";
import { parseCartPlanRequest, runCartPlan } from "../lib/integration/cart-plan.server";
import { authenticate } from "../shopify.server";

// App proxy: the storefront cart's live plan (MVP 4, contract R9). The embed
// POSTs the cart to /apps/won-discounts/cart-plan; Shopify signs the request and
// forwards it here (won-discounts.health.tsx explains the path mapping). The
// shop is the proxy signature's (SEC-2), never the body's. An unknown shape is
// 400, a shop without an offline session 503 — the embed then shows no hint
// (fail closed: it promises nothing).

const NO_STORE = { "Cache-Control": "no-store" };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) return Response.json({ ok: false, reason: "no_session" }, { status: 503, headers: NO_STORE });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const parsed = parseCartPlanRequest(body);
  if (!parsed) return Response.json({ ok: false, reason: "invalid" }, { status: 400, headers: NO_STORE });
  try {
    const answer = await runCartPlan(adminClientFromApp(admin), session.shop, parsed);
    return Response.json(answer, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) throw error;
    return Response.json({ ok: false, reason: "unavailable" }, { status: 503, headers: NO_STORE });
  }
};

/** GET is not a plan request. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  return Response.json({ ok: false, reason: "post_only" }, { status: 405, headers: NO_STORE });
};
