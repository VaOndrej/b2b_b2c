import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ShouldRevalidateFunction } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { WonNavMenu } from "@won/app-kit/admin-nav";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";
import { adminLocale } from "../lib/integration/locale.server";
import { t, type Locale } from "../i18n";
import { LocaleProvider } from "../i18n/context";
import { navItems } from "../components/model/modules";

// The embedded admin shell: App Bridge, the admin language (A10) and the nav.
//
// Language: Shopify passes the admin language as `?locale=` on the document load
// of the embedded app; in-app navigations drop the query string. adminLocale
// (app/lib/integration/locale.server.ts) reads it from the request or the
// session; the first value is also kept in component state, so a revalidation
// never flips the language mid-session.
//
// Nav: the shared Won structure (@won/app-kit/admin-nav: home first, at most five
// items after it, the plan lives in Nastavení). The discount pages share the item
// "Slevy" and a sub-navigation on the page (components/shell/SubNav.tsx), which
// reads `goals` from this loader (useRouteLoaderData("routes/app")) for its order.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [{ config }, locale] = await Promise.all([loadConfig(db, session.shop), adminLocale(request, session, db)]);
  return {
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    locale,
    goals: [...config.onboarding.goals],
  };
};

// Re-read after a form submission (e.g. onboarding goals reorder the sub-navigation) or a new
// ?locale=; plain in-app navigations keep the layout's data.
export const shouldRevalidate: ShouldRevalidateFunction = ({ nextUrl, formMethod, defaultShouldRevalidate }) =>
  formMethod || nextUrl.searchParams.has("locale") ? defaultShouldRevalidate : false;

export default function App() {
  const data = useLoaderData<typeof loader>();
  const [locale] = useState<Locale>(data.locale);

  return (
    <AppProvider embedded apiKey={data.apiKey}>
      <WonNavMenu homeLabel={t(locale, "nav.overview")} items={navItems(locale)} />
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
