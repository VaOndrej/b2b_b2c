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
} from "../services/analytics.server";

const noStore = { "Cache-Control": "no-store" } as const;

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
    const ruleId = String(body.ruleId ?? "");
    const type = String(body.type ?? "") as LifecycleEvent;
    const variant = Number(body.variant) || 0;
    if (ruleId && LIFECYCLE_TYPES.includes(type)) {
      // Analytics is Pro-only; silently ignore for Free shops.
      const config = await getToastConfig(shop);
      if (config.plan === "pro") {
        await recordAnalyticsEvent(shop, ruleId, type, variant).catch(() => {});
      }
    }
  } catch {
    // never fail the beacon
  }
  return Response.json({ status: "ok" }, { headers: noStore });
};
