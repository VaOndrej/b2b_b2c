import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";
import { buildOverviewProps, OverviewScreen } from "../components/screens/OverviewScreen";

// Přehled v0. The screen itself lives in components/screens/OverviewScreen.tsx
// so the dev harness renders exactly the same component (audit P2-5).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { config, readOnly } = await loadConfig(db, session.shop);
  return buildOverviewProps(config, { readOnly });
};

export default function Index() {
  const props = useLoaderData<typeof loader>();
  return <OverviewScreen {...props} />;
}
