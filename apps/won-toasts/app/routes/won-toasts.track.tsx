// MVP13 app-proxy endpoint: the storefront beacons a toast lifecycle event
// (impression/click/dismiss/undo) here. Only recorded for Pro shops (analytics
// is a Pro feature). No PII — just a rule id, event type, and A/B variant.

import type { ActionFunctionArgs } from "react-router";

import type { LifecycleEvent } from "@won/core/toasts/analytics";

import { authenticate } from "../shopify.server";
import { getToastConfig } from "../services/toast-config.server";
import {
  LIFECYCLE_TYPES,
  recordAnalyticsEvent,
  recordAtoms,
} from "../services/analytics.server";

const noStore = { "Cache-Control": "no-store" } as const;

// MVP13a — the storefront beacon posts here (sendBeacon, best-effort). Two shapes:
//   { events: [ { atom, ruleId?, dims, dwellMs?, clickTarget?, suppressReason? } ] }
//     → the rich batched atom pipeline (scrub → raw store → daily rollup).
//   { ruleId, type, variant }  (legacy single event from an older cached bundle)
//     → the original per-rule impression/click/dismiss/undo path.
// Analytics is Pro-only; Free shops are silently accepted and dropped.
export const action = async ({ request }: ActionFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const shop = context.session?.shop;
  if (!shop) return Response.json({ status: "ok" }, { headers: noStore });

  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const config = await getToastConfig(shop);
    if (config.plan !== "pro") {
      return Response.json({ status: "ok" }, { headers: noStore });
    }

    if (Array.isArray(body.events)) {
      // Rich batched atoms — scrub happens server-side in recordAtoms.
      await recordAtoms(shop, body.events).catch(() => {});
    } else {
      // Legacy single lifecycle event.
      const ruleId = String(body.ruleId ?? "");
      const type = String(body.type ?? "") as LifecycleEvent;
      const variant = Number(body.variant) || 0;
      if (ruleId && LIFECYCLE_TYPES.includes(type)) {
        await recordAnalyticsEvent(shop, ruleId, type, variant).catch(() => {});
      }
    }
  } catch {
    // never fail the beacon
  }
  return Response.json({ status: "ok" }, { headers: noStore });
};
