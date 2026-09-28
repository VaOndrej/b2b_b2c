import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { buildOverviewProps, OverviewScreen } from "../components/screens/OverviewScreen";
import { DEV_OVERVIEW_FIXTURE, isDevHarnessEnabled } from "../lib/dev-harness.server";

// Dev-only admin harness (Task 5 brief): renders the REAL Přehled screen (the
// same OverviewScreen component as app/routes/app._index.tsx) against a
// fixture config, with no Shopify auth and no database — so we can screenshot
// admin screens at 390/1440px without logging into Shopify admin.
// `?readOnly=1` renders the newer-schema (read-only) state.
//
// Double guard against ever reaching a non-development environment:
//   1. BUILD-TIME: app/routes.ts excludes this file from the route manifest
//      unless NODE_ENV is exactly "development" or "test".
//   2. RUNTIME (defence in depth, e.g. a misconfigured build): the loader
//      404s whenever isDevHarnessEnabled() is false (same allowlist).
//
// The splat ($ -> /dev/preview/*) accepts any sub-path; MVP 0 only has one
// screen (the overview), so every path renders it.
//
// The route component only reads useLoaderData() and renders shared
// components — it never imports dev-harness.server.ts values itself (React
// Router strips loader/action from the client bundle, but NOT a component's
// own imports).
export const loader = ({ request }: LoaderFunctionArgs) => {
  if (!isDevHarnessEnabled()) {
    throw new Response("Not Found", { status: 404 });
  }
  const readOnly = new URL(request.url).searchParams.get("readOnly") === "1";
  return buildOverviewProps(DEV_OVERVIEW_FIXTURE, { readOnly });
};

export default function DevPreview() {
  const props = useLoaderData<typeof loader>();

  return (
    <>
      {/* Polaris web components (s-page, s-section, …), loaded the same way
          @shopify/shopify-app-react-router's <AppProvider> loads it for real
          admin pages, so a screenshot of this route looks like the real app. */}
      <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      <OverviewScreen {...props} />
    </>
  );
}
