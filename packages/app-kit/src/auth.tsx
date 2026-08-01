import { boundary } from "@shopify/shopify-app-react-router/server";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";

/**
 * `/auth/*` splat route — runs admin authentication and normalizes headers.
 * Wire with the app's `authenticate`. This route has no client component, so it
 * stays server-only and is safe to share across apps.
 *
 * NOTE: the `/auth/login` page (a client component + server loader in one route
 * file) is intentionally NOT shared here — React Router requires a route's
 * default (client) export to be free of server-only imports, so each app keeps
 * its own small `auth.login/route.tsx`. Copy it from any app / the template.
 */
export function createAuthSplatRoute(authenticate: {
  admin: (request: Request) => Promise<unknown>;
}) {
  const loader = async ({ request }: LoaderFunctionArgs) => {
    await authenticate.admin(request);
    return null;
  };

  const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);

  return { loader, headers };
}
