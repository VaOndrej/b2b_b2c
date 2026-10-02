// Výprodej 5a (F-O1): can the app read the shop's orders? The quota counts sold pieces from order webhooks; until
// Shopify approves the app's protected customer data access it refuses orders even with the read_orders scope
// (live probe 2026-10-02: `ACCESS_DENIED: This app is not approved to access the Order object`). The admin then says
// the quota is not counted and recommends an end date.
//
//   ordersAccess(ctx)   true only when the session holds read_orders AND one order read succeeds. Without the
//                       scope nothing is read. The answer is cached per shop (cachedRead, SIGNAL_CACHE_TTL_MS);
//                       a failed read (transport, any other error) is not cached and counts as no access — the
//                       screen never claims a count it cannot do.

import type { GraphQLErrorLike } from "../admin-client.server";
import { cachedRead } from "./themes.server";
import type { ShopCtx } from "./context.server";

const ORDERS_PROBE = `query WonDiscountsOrdersProbe { orders(first: 1) { nodes { id } } }`;

/** True when the granted scopes (comma list) include read_orders; unknown scopes (null) = probe anyway. */
export function hasOrdersScope(scopes: string | null | undefined): boolean {
  if (scopes === null || scopes === undefined) return true;
  return scopes
    .split(",")
    .map((s) => s.trim())
    .some((s) => s === "read_orders" || s === "write_orders");
}

/** Shopify's refusal of a protected resource (`extensions.code` ACCESS_DENIED, or the message says so). */
function isAccessDenied(errors: readonly GraphQLErrorLike[] | undefined): boolean {
  return (errors ?? []).some((e) => e.extensions?.code === "ACCESS_DENIED" || /^ACCESS_DENIED\b|not approved to access/i.test(e.message));
}

class ProbeUnknown extends Error {}

export async function ordersAccess(ctx: Pick<ShopCtx, "shop" | "client" | "scopes">): Promise<boolean> {
  if (!hasOrdersScope(ctx.scopes)) return false;
  try {
    return await cachedRead(`orders-access:${ctx.shop}`, async () => {
      let result;
      try {
        result = await ctx.client.graphql<{ orders?: { nodes?: unknown[] } | null }>(ORDERS_PROBE);
      } catch (error) {
        if (error instanceof Response) throw error;
        throw new ProbeUnknown();
      }
      if (isAccessDenied(result.errors)) return false;
      if (result.errors?.length || !result.data?.orders) throw new ProbeUnknown();
      return true;
    });
  } catch (error) {
    if (error instanceof ProbeUnknown) return false;
    throw error;
  }
}
