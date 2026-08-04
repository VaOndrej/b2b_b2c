// MVP11 app-proxy endpoint for REAL aggregates.
//   GET  → recent cart-add + order timestamps (within a window) so the embed can
//          count "X in the last N hours" locally via @won/core countWithinWindow.
//   POST → a cart-add beacon: the storefront records one genuine cart-add event.
// Only timestamps are exposed — never PII. Cold-start honest: empty store → [].

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  recentToastEventTimestamps,
  recordToastEvent,
} from "../services/toast-events.server";

const MAX_WINDOW_HOURS = 720; // 30 days
const noStore = { "Cache-Control": "no-store" } as const;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = context.session?.shop ?? url.searchParams.get("shop");
  if (!shop) {
    return Response.json(
      { status: "won-toasts-aggregates-ok", cartAdds: [], orders: [] },
      { headers: noStore },
    );
  }

  const hours = Math.min(
    MAX_WINDOW_HOURS,
    Math.max(1, Number(url.searchParams.get("window")) || 24),
  );
  const windowMs = hours * 3_600_000;

  try {
    const [cartAdds, orders] = await Promise.all([
      recentToastEventTimestamps(shop, "cart_add", windowMs),
      recentToastEventTimestamps(shop, "order", windowMs),
    ]);
    return Response.json(
      { status: "won-toasts-aggregates-ok", cartAdds, orders },
      { headers: noStore },
    );
  } catch {
    return Response.json(
      { status: "won-toasts-aggregates-ok", cartAdds: [], orders: [] },
      { headers: noStore },
    );
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const shop = context.session?.shop;
  if (shop) {
    // A single genuine cart-add. Quantity intentionally fixed at 1 (one shopper
    // action) — we count distinct add events, not units.
    await recordToastEvent(shop, "cart_add", 1).catch(() => {});
  }
  return Response.json({ status: "ok" }, { headers: noStore });
};
