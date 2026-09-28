import { useLoaderData } from "react-router";

import {
  DEV_OVERVIEW_FIXTURE,
  isDevHarnessEnabled,
  statusLabel,
  typeLabel,
} from "../lib/dev-harness.server";

// Dev-only admin harness (Task 5 brief): renders a standalone "Přehled v0"
// preview against a fixture config, with no Shopify auth — so we can
// screenshot admin screens at 390/1440px without ever logging into Shopify
// admin in a browser.
//
// Double guard against ever reaching production:
//   1. BUILD-TIME: app/routes.ts excludes this file from the route manifest
//      when NODE_ENV === "production" — the module never ships.
//   2. RUNTIME (defence in depth, e.g. a misconfigured build): the loader
//      404s whenever isDevHarnessEnabled() is false.
//
// The splat ($ -> /dev/preview/*) accepts any sub-path; MVP 0 only has one
// screen (the overview), so every path renders it.
//
// The route component only reads useLoaderData() — it never imports
// dev-harness.server.ts itself. That module is `.server`-only (React Router
// strips loader/action from the client bundle, but NOT a component's own
// imports), so all label lookups happen inside the loader and are passed down
// as plain, already-Czech strings.
export const loader = () => {
  if (!isDevHarnessEnabled()) {
    throw new Response("Not Found", { status: 404 });
  }
  return {
    shopName: DEV_OVERVIEW_FIXTURE.shopName,
    items: DEV_OVERVIEW_FIXTURE.items.map((item) => ({
      id: item.id,
      name: item.name,
      statusLabel: statusLabel(item.status),
      typeLabel: typeLabel(item.type),
      valueSummary: item.valueSummary,
    })),
  };
};

export default function DevPreview() {
  const { shopName, items } = useLoaderData<typeof loader>();

  return (
    <>
      {/* Polaris web components (s-page, s-section, …), loaded the same way
          @shopify/shopify-app-react-router's <AppProvider> loads it for real
          admin pages, so a screenshot of this route looks like the real app. */}
      <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      <s-page heading="Přehled v0 (dev harness)">
        <s-section heading={shopName}>
          <s-paragraph>
            Toto je vývojářský náhled bez přihlášení do Shopify adminu. Nikdy
            neběží v produkčním sestavení.
          </s-paragraph>
          {items.map((item) => (
            <s-paragraph key={item.id}>
              <s-text>{item.name}</s-text> — {item.statusLabel},{" "}
              {item.typeLabel}, {item.valueSummary}
            </s-paragraph>
          ))}
        </s-section>
      </s-page>
    </>
  );
}
