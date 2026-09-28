import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { shopCtx } from "../lib/integration/context.server";
import { adminLocale } from "../lib/integration/locale.server";
import { discountsPage } from "../lib/integration/pages.server";
import { DiscountsScreen } from "../components/screens/DiscountsScreen";

// Slevy a kódy — the rule list, each rule with its real state in Shopify.
// `?deleted=1` is the landing after a delete (it reports what that delete's sync did).
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = await adminLocale(request, session, db);
  // eslint-disable-next-line no-undef
  const ctx = shopCtx(admin, session.shop, db, { locale, apiKey: process.env.SHOPIFY_API_KEY || "" });
  const deleted = new URL(request.url).searchParams.get("deleted") === "1";
  return discountsPage(ctx, { scopes: session.scope ?? "", deleted });
};

export default function Discounts() {
  const props = useLoaderData<typeof loader>();
  return <DiscountsScreen {...props} />;
}
