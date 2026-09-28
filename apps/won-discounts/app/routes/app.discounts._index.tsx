import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { loadConfig } from "../lib/config.server";
import { graphqlFrom, readShopContext } from "../lib/ui-actions.server";
import { NOT_WIRED_SIGNALS } from "../components/model/signals";
import { buildDiscountsProps, DiscountsScreen } from "../components/screens/DiscountsScreen";

// Slevy a kódy — the rule list. `?deleted=1` is the landing after a delete.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [{ config, readOnly }, shopContext] = await Promise.all([
    loadConfig(db, session.shop),
    readShopContext(graphqlFrom(admin)),
  ]);
  const deleted = new URL(request.url).searchParams.get("deleted") === "1";
  return buildDiscountsProps(config, {
    readOnly,
    // Integration: the last SyncRun from app/lib/sync.
    sync: NOT_WIRED_SIGNALS.sync,
    shopCurrency: shopContext.currencyCode,
    result: deleted ? { ok: true, message: "deleted" } : null,
  });
};

export default function Discounts() {
  const props = useLoaderData<typeof loader>();
  return <DiscountsScreen {...props} />;
}
