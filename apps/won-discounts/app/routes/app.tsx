import type { HeadersFunction, LoaderFunctionArgs, ShouldRevalidateFunction } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { resolveLocale, t } from "../i18n";
import { LocaleProvider } from "../i18n/context";

// The embedded admin shell: App Bridge, the admin language (A10) and the nav.
//
// Language: Shopify passes the admin language as `?locale=` on the document
// load of the embedded app. In-app navigations drop the query string, so this
// layout's data is NOT re-fetched on them (shouldRevalidate below) and the
// language resolved on the first load stays for the session of the page.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const locale = resolveLocale(new URL(request.url).searchParams.get("locale"));
  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", locale };
};

export const shouldRevalidate: ShouldRevalidateFunction = ({ nextUrl, defaultShouldRevalidate }) =>
  nextUrl.searchParams.has("locale") ? defaultShouldRevalidate : false;

export default function App() {
  const { apiKey, locale } = useLoaderData<typeof loader>();

  // Won nav structure (@won/app-kit/admin-nav): home first (rel="home"), feature
  // pages in order, Plan last. Rendered here rather than through WonNavMenu
  // because WonNavMenu hard-codes an English "Overview" home label and this app's
  // admin speaks Czech too (A10). Modules that are not built yet stay visible
  // (Admin IA: all five modules always shown) and open a page that says so.
  const items: { to: string; label: string }[] = [
    { to: "/app/discounts", label: t(locale, "nav.discounts") },
    { to: "/app/try-cart", label: t(locale, "nav.tryCart") },
    { to: "/app/tiers", label: t(locale, "nav.tiers") },
    { to: "/app/rewards", label: t(locale, "nav.rewards") },
    { to: "/app/outlet", label: t(locale, "nav.outlet") },
    { to: "/app/margin", label: t(locale, "nav.margin") },
    { to: "/app/campaigns", label: t(locale, "nav.campaigns") },
    { to: "/app/appearance", label: t(locale, "nav.appearance") },
    { to: "/app/settings", label: t(locale, "nav.settings") },
    { to: "/app/plan", label: t(locale, "nav.plan") },
  ];

  return (
    <AppProvider embedded apiKey={apiKey}>
      <ui-nav-menu>
        <a href="/app" rel="home">
          {t(locale, "nav.overview")}
        </a>
        {items.map((item) => (
          <a key={item.to} href={item.to}>
            {item.label}
          </a>
        ))}
      </ui-nav-menu>
      <LocaleProvider locale={locale}>
        <Outlet />
      </LocaleProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so their headers are included.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
