// MVP12 app-proxy endpoint: the recent-sales social-proof feed. Returns
// anonymized items ONLY when (a) an enabled order.created recipe exists, (b) the
// plan is Pro, and (c) the shop has enough real orders (cold-start honesty).
// Otherwise an empty feed — never a fabricated sale.

import type { LoaderFunctionArgs } from "react-router";

import { coldStartReady } from "@won/core/toasts/social-proof";

import { authenticate } from "../shopify.server";
import { getToastConfig } from "../services/toast-config.server";
import { countSaleEvents, recentSaleEvents } from "../services/sale-events.server";

const noStore = { "Cache-Control": "no-store" } as const;
const empty = (extra: Record<string, unknown> = {}) =>
  Response.json(
    { status: "won-toasts-social-ok", sales: [], ...extra },
    { headers: noStore },
  );

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // SEC-2: appProxy verifies the HMAC over the ENTIRE query string, so a request
  // that reaches here has an authentic `?shop=` — the fallback is safe (we prefer
  // the session's shop, but the signed query param is not attacker-controlled).
  const context = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = context.session?.shop ?? url.searchParams.get("shop");
  if (!shop) return empty();

  try {
    const config = await getToastConfig(shop);
    if (config.plan !== "pro") return empty({ reason: "plan" });

    const rule = config.notifications.find(
      (n) => n.type === "order.created" && n.enabled,
    );
    if (!rule) return empty({ reason: "disabled" });

    const minOrders = (rule as { minOrders?: number }).minOrders ?? 5;
    const total = await countSaleEvents(shop);
    if (!coldStartReady(total, minOrders)) {
      // Not enough real sales yet — be honest, show nothing.
      return empty({ reason: "cold-start" });
    }

    const sales = await recentSaleEvents(shop, {
      showName: (rule as { showName?: boolean }).showName !== false,
      showCity: (rule as { showCity?: boolean }).showCity !== false,
    });
    return Response.json(
      { status: "won-toasts-social-ok", sales },
      { headers: noStore },
    );
  } catch {
    return empty();
  }
};
