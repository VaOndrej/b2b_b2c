import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";
import { graphqlFrom, moveNative, readAdminContext, readBackupId, readNativeIds, undoMove } from "../lib/ui-actions.server";
import { buildOverviewProps, OverviewScreen } from "../components/screens/OverviewScreen";

// Přehled v1. The screen lives in components/screens/OverviewScreen.tsx so the
// dev harness renders exactly the same component (audit P2-5). All reads and
// writes go through app/lib/ui-actions.server.ts (the integration seam), always
// with the SESSION shop (SEC-2).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [{ config, readOnly }, reads] = await Promise.all([
    loadConfig(db, session.shop),
    readAdminContext({
      shop: session.shop,
      scopes: session.scope ?? "",
      // eslint-disable-next-line no-undef
      apiKey: process.env.SHOPIFY_API_KEY || "",
      graphql: graphqlFrom(admin),
      signals: true,
    }),
  ]);
  return buildOverviewProps(config, {
    readOnly,
    signals: reads.signals ?? undefined,
    shopCurrency: reads.shopContext.currencyCode,
    timezone: reads.shopContext.timezone,
    marketNames: reads.marketNames,
  });
};

// "Přesunout" / "Přesunout vše" / "Vrátit zpět" (NativeDiscountsPanel fetcher).
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "move") return moveNative({ shop: session.shop }, readNativeIds(form));
  if (intent === "undo") return undoMove({ shop: session.shop }, readBackupId(form));
  return { ok: false as const, reason: "bad_request" as const };
};

export default function Index() {
  const props = useLoaderData<typeof loader>();
  return <OverviewScreen {...props} />;
}
