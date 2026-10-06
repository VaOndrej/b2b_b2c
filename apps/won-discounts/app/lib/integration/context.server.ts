// The integration layer's request context (MVP 1 integration step): everything
// the wired admin needs to reach the shop's data and Shopify, built ONCE per
// request by the route from `authenticate.admin(request)`:
//
//   shop    the SESSION shop (SEC-2) — never a form field or a URL parameter;
//   db      the app's Prisma client (a throwaway SQLite in tests);
//   client  the one Admin GraphQL contract (app/lib/admin-client.server.ts):
//           the embedded admin in routes, a fake in tests.
//
// Everything below app/lib/integration takes this object, so the route/action
// tests run the real paths with a fake AdminClient + a test database.

import type { PrismaClient } from "../../generated/prisma/client";
import type { Locale } from "../../i18n";
import { adminClientFromApp, type AdminClient, type AppAdminGraphql } from "../admin-client.server";
import type { Sync } from "../sync/sync.server";
import type { SyncLogger } from "../sync/types";

export interface ShopCtx {
  /** The session shop (SEC-2). */
  shop: string;
  db: PrismaClient;
  client: AdminClient;
  /** Admin language of this request (native copy is worded on the server). */
  locale: Locale;
  /** This app's API key (client_id): its own app discounts are not "outside Won". */
  apiKey: string;
  /**
   * The session's granted scopes (comma list; `session.scope`). Optional scopes
   * (read_markets, item 9) are used only when granted. Absent = unknown.
   */
  scopes?: string;
  /** Test hooks: the sync (default: production wiring), the clock, the sync logger, the config-lock wait. */
  createSync?: (client: AdminClient, db: PrismaClient) => Sync;
  /** How long an admin write waits for the shop's config lock (default CONFIG_LOCK_WAIT_MS). */
  lockWaitMs?: number;
  now?: () => Date;
  logger?: SyncLogger;
}

export function shopCtx(
  admin: AppAdminGraphql,
  shop: string,
  db: PrismaClient,
  opts: { locale: Locale; apiKey?: string; scopes?: string | null },
): ShopCtx {
  return {
    shop,
    db,
    client: adminClientFromApp(admin, shop),
    locale: opts.locale,
    apiKey: opts.apiKey ?? "",
    ...(typeof opts.scopes === "string" ? { scopes: opts.scopes } : {}),
  };
}

/** The clock of a context. */
export function nowOf(ctx: Pick<ShopCtx, "now">): Date {
  return ctx.now ? ctx.now() : new Date();
}

/** Admin GraphQL as a plain function over the context's client (the ui-actions reads take this shape). */
export function graphqlOf(ctx: Pick<ShopCtx, "client">): (query: string, variables?: Record<string, unknown>) => Promise<unknown> {
  return (query, variables) => ctx.client.graphql(query, variables);
}
