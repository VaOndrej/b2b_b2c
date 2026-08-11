// App-proxy endpoint the storefront embed reads to render toasts. Returns a
// COMPLETE resolved config (defaults + shop overrides). The storefront never
// hardcodes behaviour — it renders whatever this returns.

import type { LoaderFunctionArgs } from "react-router";

import { resolveToastConfig } from "@won/core/toasts/config.defaults";
import { gateConfigForPlan } from "@won/core/toasts/tier";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  resolveConfigWithOverlay,
} from "../services/toast-config.server";
import { getActiveExperiment } from "../services/experiments.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const context = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = context.session?.shop ?? url.searchParams.get("shop");

  if (!shop) {
    // Unknown shop → serve a safe disabled default so the storefront no-ops.
    return Response.json(
      { status: "won-toasts-config-ok", config: resolveToastConfig(null) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    // Gate to the shop's plan server-side, so the storefront simply renders
    // what it receives (Free gets the default look + capped milestones).
    const config = gateConfigForPlan(await getToastConfig(shop));
    // MVP13c holdout + live A/B: a running experiment can (a) hold a share of
    // visitors out entirely (shown NO toasts), and (b) serve a VARIANT config to
    // a share of the rest while the control config serves everyone else. The
    // storefront resolves membership per cart token via @won/core inHoldout /
    // assignArm. We resolve BOTH arms server-side so plan-gating is enforced for
    // each. 0 = disabled.
    let holdoutPercent = 0;
    let experiment:
      | { variantPercent: number; config: ReturnType<typeof gateConfigForPlan> }
      | null = null;
    try {
      const active = await getActiveExperiment(shop);
      if (active) {
        holdoutPercent = active.holdoutPercent ?? 0;
        const variantPercent = active.variantPercent ?? 0;
        if (variantPercent > 0 && active.variant) {
          const variantConfig = gateConfigForPlan(
            await resolveConfigWithOverlay(shop, active.variant),
          );
          experiment = { variantPercent, config: variantConfig };
        }
      }
    } catch {
      /* holdout/experiment is best-effort — never block config */
    }
    return Response.json(
      { status: "won-toasts-config-ok", config, holdoutPercent, experiment },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "won-toasts-config-ok", config: resolveToastConfig(null) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
};
