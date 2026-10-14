import type { LoaderFunctionArgs } from "react-router";

import { adminClientFromApp } from "../lib/admin-client.server";
import { CardTiersRateLimited, parseCardTiersRequest, runCardTiers } from "../lib/integration/card-tiers.server";
import { authenticate } from "../shopify.server";

// App proxy: the card lines a page could not compute (umístění na webu, balík B2). A `<won-discounts show="card-tier">`
// tag names a product the page does not list; the tags script GETs /apps/won-discounts/card-tiers?h=…&cur=…&mk=…&c=…
// and Shopify signs the request and forwards it here (won-discounts.health.tsx explains the path mapping). The shop
// is the proxy signature's (SEC-2). An unknown shape is 400, a shop without an offline session 503, a shop over its
// read limit 429 — the tag then stays empty (fail closed: it promises nothing).

const NO_STORE = { "Cache-Control": "no-store" };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) return Response.json({ ok: false, reason: "no_session" }, { status: 503, headers: NO_STORE });
  const parsed = parseCardTiersRequest(new URL(request.url).searchParams);
  if (!parsed) return Response.json({ ok: false, reason: "invalid" }, { status: 400, headers: NO_STORE });
  try {
    return Response.json(await runCardTiers(adminClientFromApp(admin, session.shop), session.shop, parsed), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof CardTiersRateLimited) return Response.json({ ok: false, reason: "busy" }, { status: 429, headers: NO_STORE });
    return Response.json({ ok: false, reason: "unavailable" }, { status: 503, headers: NO_STORE });
  }
};
