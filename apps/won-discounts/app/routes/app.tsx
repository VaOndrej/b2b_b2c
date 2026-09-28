import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ShouldRevalidateFunction } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { WonNavMenu } from "@won/app-kit/admin-nav";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";
import { resolveLocale, t, type Locale } from "../i18n";
import { LocaleProvider } from "../i18n/context";
import { navItems } from "../components/model/modules";

// The embedded admin shell: App Bridge, the admin language (A10) and the nav.
//
// Language: Shopify passes the admin language as `?locale=` on the document load
// of the embedded app; in-app navigations drop the query string. The first value
// is kept in component state, so a later revalidation without the parameter
// never flips the language.
//
// Nav: the shared Won structure (@won/app-kit/admin-nav: home first, Plan last).
// Modules that are not built yet stay visible (Admin IA: all modules always
// shown) in the order of the onboarding goals, and open a page that says so.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { config } = await loadConfig(db, session.shop);
  const locale = resolveLocale(new URL(request.url).searchParams.get("locale"));
  return {
    // eslint-disable-next-line no-undef
    apiKey: process.env.SHOPIFY_API_KEY || "",
    locale,
    goals: [...config.onboarding.goals],
  };
};

// Re-read after a form submission (e.g. onboarding goals reorder the nav) or a new
// ?locale=; plain in-app navigations keep the layout's data.
export const shouldRevalidate: ShouldRevalidateFunction = ({ nextUrl, formMethod, defaultShouldRevalidate }) =>
  formMethod || nextUrl.searchParams.has("locale") ? defaultShouldRevalidate : false;

export default function App() {
  const data = useLoaderData<typeof loader>();
  const [locale] = useState<Locale>(data.locale);

  return (
    <AppProvider embedded apiKey={data.apiKey}>
      <WonNavMenu homeLabel={t(locale, "nav.overview")} items={navItems(locale, data.goals)} />
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
