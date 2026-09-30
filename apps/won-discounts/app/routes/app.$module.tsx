import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import { isUpcomingModule } from "../components/model/modules";
import { ComingSoonScreen } from "../components/screens/ComingSoonScreen";

// Modules that are visible but not built yet: /app/rewards, /app/outlet,
// /app/campaigns. A module that ships gets its own static route (app.margin.tsx
// since MVP 2, app.tiers.tsx and app.appearance.tsx since MVP 3), which wins
// over this one, so the URLs in the nav and in deep links stay valid.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  if (!isUpcomingModule(params.module)) throw new Response("Not Found", { status: 404 });
  return { module: params.module };
};

export default function UpcomingModule() {
  const { module } = useLoaderData<typeof loader>();
  return <ComingSoonScreen module={module} />;
}
