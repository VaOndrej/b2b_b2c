import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

// App proxy health check. shopify.app.toml [app_proxy] maps a storefront
// request at /apps/won-discounts/* (prefix "apps" + subpath "won-discounts")
// to this app at <app url>/won-discounts/* — see
// https://shopify.dev/docs/apps/build/online-store/app-proxies ("How it
// works": prefix + subpath on the storefront side map onto the app's `url`
// path on the server side). Route file name follows the same flat-routes dot
// convention as the won-toasts reference (won-toasts.health.tsx ->
// /won-toasts/health).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  return Response.json(
    { status: "won-discounts-health-ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
};
