import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ShouldRevalidateFunction } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { WonNavMenu } from "@won/app-kit/admin-nav";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";
import { HoverStyles } from "../components/shell/hover";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { loadDiscountPageStates } from "../lib/integration/pages.server";
import { t, type Locale } from "../i18n";
import { LocaleProvider } from "../i18n/context";
import { layoutReloads, navItems, type DiscountNavData, type DiscountPageStates } from "../components/model/modules";
import { DiscountNav } from "../components/shell/SubNav";

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
// gets its order (`goals`) and the state of each page's module (`states`, the dot)
// from this loader through DiscountNav.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [loaded, locale] = await Promise.all([loadConfig(db, session.shop), adminLocale(request, session, db)]);
  // eslint-disable-next-line no-undef
  const apiKey = process.env.SHOPIFY_API_KEY || "";
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey, scopes: session.scope });
  // A failed read leaves the strip without dots ("not known"), never the app without its shell (REL-1).
  const states = await loadDiscountPageStates(ctx, loaded).catch((error: unknown): DiscountPageStates => {
    if (error instanceof Response) throw error;
    return {};
  });
  const discountNav: DiscountNavData = { goals: [...loaded.config.onboarding.goals], states };
  return { apiKey, locale, discountNav };
};

// When the layout reads again: model/modules.ts layoutReloads. The states cost no Shopify request on a
// navigation: the two small reads behind them are kept for 60 s (loadDiscountPageStates).
export const shouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }) =>
  layoutReloads({ submitted: formMethod !== undefined, localeInUrl: nextUrl.searchParams.has("locale"), fromPath: currentUrl.pathname, toPath: nextUrl.pathname }) ? defaultShouldRevalidate : false;

export default function App() {
  const data = useLoaderData<typeof loader>();
  const [locale] = useState<Locale>(data.locale);

  return (
    <AppProvider embedded apiKey={data.apiKey}>
      <WonNavMenu homeLabel={t(locale, "nav.overview")} items={navItems(locale)} />
      <LocaleProvider locale={locale}>
        <HoverStyles />
        <DiscountNav.Provider value={data.discountNav}>
          <Outlet />
        </DiscountNav.Provider>
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
