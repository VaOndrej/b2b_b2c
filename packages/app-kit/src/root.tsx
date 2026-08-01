import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

/**
 * Generic embedded-app document shell shared by every app. Apps re-export this
 * as their route `root` default; app-specific chrome lives in `app/routes/app.tsx`.
 */
export default function AppDocument() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
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
