// App-proxy endpoint the storefront embed reads to render toasts. Returns a
// COMPLETE resolved config (defaults + shop overrides). The storefront never
// hardcodes behaviour — it renders whatever this returns.

import type { LoaderFunctionArgs } from "react-router";

import { resolveToastConfig } from "@won/core/toasts/config.defaults";

import { authenticate } from "../shopify.server";
import { getToastConfig } from "../services/toast-config.server";

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
    const config = await getToastConfig(shop);
    return Response.json(
      { status: "won-toasts-config-ok", config },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "won-toasts-config-ok", config: resolveToastConfig(null) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
};
