// AdminClient: the one way the Won Discounts sync layer talks to the Shopify
// Admin GraphQL API (spec §1 "Sync vrstva, jediný zapisovač do Shopify").
//
// Two implementations share this contract:
//   - adminClientFromApp(admin, shop) — the embedded app's session client
//     (`authenticate.admin(request).admin`), used by saveAndSync;
//   - createCliAdminClient(...) (admin-client-cli.server.ts) — `shopify app
//     execute` as the app, for scripts and live tests on the dev store.
//
// Contract (the retry policy in sync/transport.ts depends on it, API-3):
//   - a GraphQL-level failure (incl. cost throttling, `THROTTLED`) RESOLVES with
//     `errors` — the request was answered, nothing half-applied by transport;
//   - a transport failure (HTTP 429/5xx, network) REJECTS with
//     AdminTransportError carrying the HTTP status (null = no response): for a
//     mutation the request may or may not have been applied;
//   - anything else (a thrown Response = re-auth redirect, programming errors)
//     is rethrown untouched.

import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export interface GraphQLErrorLike {
  message: string;
  extensions?: { code?: unknown; [key: string]: unknown };
  path?: readonly (string | number)[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface AdminGraphQLResult<TData = any> {
  data?: TData | null;
  errors?: GraphQLErrorLike[];
}

export interface AdminClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graphql<TData = any>(query: string, variables?: Record<string, unknown>): Promise<AdminGraphQLResult<TData>>;
}

/** HTTP-level failure: `status` is the HTTP status, or null when there was no response (network, CLI crash). */
export class AdminTransportError extends Error {
  readonly status: number | null;
  /** Server-suggested wait (Retry-After), when known. */
  readonly retryAfterMs: number | null;

  constructor(message: string, options: { status?: number | null; retryAfterMs?: number | null; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AdminTransportError";
    this.status = options.status ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
  }
}

/** True when Shopify rejected the request for cost throttling (safe to retry: nothing was executed). */
export function isThrottled(result: AdminGraphQLResult): boolean {
  return (result.errors ?? []).some((error) => error?.extensions?.code === "THROTTLED");
}

export function normalizeGraphQLErrors(errors: unknown): GraphQLErrorLike[] {
  if (!Array.isArray(errors)) return [];
  return errors.map((error) => {
    if (error && typeof error === "object") {
      const e = error as { message?: unknown; extensions?: unknown; path?: unknown };
      const out: GraphQLErrorLike = { message: typeof e.message === "string" ? e.message : JSON.stringify(error) };
      if (e.extensions && typeof e.extensions === "object") out.extensions = e.extensions as GraphQLErrorLike["extensions"];
      if (Array.isArray(e.path)) out.path = e.path as (string | number)[];
      return out;
    }
    return { message: String(error) };
  });
}

/** The part of the app's admin context this module uses. */
export type AppAdminGraphql = Pick<AdminApiContext, "graphql">;

interface ShopifyApiErrorShape {
  message?: unknown;
  body?: { data?: unknown; errors?: { graphQLErrors?: unknown } };
  response?: { code?: unknown; retryAfter?: unknown };
}

const writeListeners = new Set<(shop: string) => void>();

/** `listener(shop)` runs after every mutation adminClientFromApp sends for that shop — a failed one too: it may have been applied. */
export function onAdminWrite(listener: (shop: string) => void): void {
  writeListeners.add(listener);
}

/**
 * AdminClient over the embedded app's session (`authenticate.admin`) of `shop`. The
 * library's own retries are off (`tries` unset): sync/transport.ts owns the
 * retry policy so every attempt is visible in the sync steps.
 */
export function adminClientFromApp(admin: AppAdminGraphql, shop: string): AdminClient {
  return {
    async graphql(query, variables) {
      const write = /^\s*mutation\b/.test(query);
      try {
        // AdminOperations is string-indexed, so any document is a valid key.
        const response = await admin.graphql(query, variables === undefined ? undefined : { variables });
        const body = (await response.json()) as { data?: unknown; errors?: unknown };
        const errors = normalizeGraphQLErrors(body.errors);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return errors.length > 0 ? { data: (body.data ?? null) as any, errors } : { data: (body.data ?? null) as any };
      } catch (error) {
        if (error instanceof Response) throw error;
        const e = (error ?? {}) as ShopifyApiErrorShape;
        const graphQLErrors = e.body?.errors?.graphQLErrors;
        if (Array.isArray(graphQLErrors)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { data: (e.body?.data ?? null) as any, errors: normalizeGraphQLErrors(graphQLErrors) };
        }
        const status = typeof e.response?.code === "number" ? e.response.code : null;
        const retryAfter = typeof e.response?.retryAfter === "number" ? e.response.retryAfter : null;
        const message = typeof e.message === "string" ? e.message : String(error);
        throw new AdminTransportError(message, {
          status,
          retryAfterMs: retryAfter === null ? null : Math.round(retryAfter * 1000),
          cause: error,
        });
      } finally {
        if (write) for (const listener of writeListeners) listener(shop);
      }
    },
  };
}
