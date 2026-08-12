import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";

/**
 * Expose the (public) API key so the document can load App Bridge from Shopify's
 * CDN in <head> — a Built for Shopify prerequisite for admin Web Vitals to be
 * measured (PERF-1). Apps must re-export this loader alongside the default:
 *   export { default, loader } from "@won/app-kit/root";
 */
export function loader() {
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY ?? "" };
}

/**
 * Generic embedded-app document shell shared by every app. Apps re-export this
 * as their route `root` default; app-specific chrome lives in `app/routes/app.tsx`.
 */
export default function AppDocument() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        {/* App Bridge in <head> so Shopify can measure admin Web Vitals (PERF-1).
            Idempotent alongside app-bridge-react's AppProvider per Shopify docs. */}
        {apiKey ? (
          <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" data-api-key={apiKey} />
        ) : null}
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
