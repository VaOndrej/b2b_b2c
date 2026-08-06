import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { WonNavMenu } from "@won/app-kit/admin-nav";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <WonNavMenu
        items={[
          // 4 task-based destinations + Plan (doctrine §7). Recipes+Events→Toasts,
          // Appearance+Behavior→Design, Targeting+Exclusions→Targeting,
          // Analytics→Insights. Old routes redirect so deep-links still resolve.
          { to: "/app/toasts", label: "Toasts" },
          { to: "/app/design", label: "Design" },
          { to: "/app/targeting", label: "Targeting" },
          { to: "/app/analytics", label: "Insights" },
          { to: "/app/plan", label: "Plan" },
        ]}
      />
      <Outlet />
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
