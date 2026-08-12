import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { runPopularitySync } from "../services/popularity.server";

// Won Toasts — Phase 8 trust-data bridge trigger (Pro-gated inside the service).
// POST here ("Recompute popularity now") to recompute per-product units sold +
// bestseller and write them to `won.*` product metafields the theme reads.
// Resource route (action only) — a "Recompute now" button in the admin can POST
// to /app/popularity/run; the service returns { ok:false, reason:"not_pro" } for
// Free plans so the UI can prompt an upgrade.
export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const result = await runPopularitySync(admin);
  return Response.json(result);
}
