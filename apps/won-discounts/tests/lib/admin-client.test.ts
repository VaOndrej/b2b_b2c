import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AdminTransportError,
  adminClientFromApp,
  isThrottled,
  type AppAdminGraphql,
} from "../../app/lib/admin-client.server.ts";

// The sync layer talks to Shopify only through AdminClient. The app-session
// implementation must turn every failure shape of @shopify/shopify-app-react-router
// into either a result with `errors` (GraphQL level, incl. THROTTLED) or an
// AdminTransportError carrying the HTTP status — the retry policy (API-3)
// depends on telling them apart.

function appAdmin(impl: (query: string, variables: unknown) => Promise<Response>): AppAdminGraphql {
  return { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => impl(query, options?.variables) } as AppAdminGraphql;
}

test("app client: returns data and passes variables through", async () => {
  const seen: unknown[] = [];
  const client = adminClientFromApp(
    appAdmin(async (query, variables) => {
      seen.push({ query, variables });
      return new Response(JSON.stringify({ data: { shop: { id: "gid://shopify/Shop/1" } } }));
    }),
    "t.myshopify.com",
  );
  const result = await client.graphql("query X { shop { id } }", { a: 1 });
  assert.deepEqual(result, { data: { shop: { id: "gid://shopify/Shop/1" } } });
  assert.deepEqual(seen, [{ query: "query X { shop { id } }", variables: { a: 1 } }]);
});

test("app client: a GraphqlQueryError (THROTTLED) becomes a result with errors, not a throw", async () => {
  const client = adminClientFromApp(
    appAdmin(async () => {
      const error = Object.assign(new Error("Throttled"), {
        body: { data: null, errors: { graphQLErrors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] } },
      });
      throw error;
    }),
    "t.myshopify.com",
  );
  const result = await client.graphql("query X { shop { id } }");
  assert.equal(isThrottled(result), true);
  assert.equal(result.errors?.[0]?.message, "Throttled");
});

test("app client: HTTP 429 / 5xx become AdminTransportError with the status", async () => {
  const throttled = adminClientFromApp(
    appAdmin(async () => {
      throw Object.assign(new Error("Shopify is throttling requests"), { response: { code: 429, retryAfter: 2 } });
    }),
    "t.myshopify.com",
  );
  await assert.rejects(throttled.graphql("query X { shop { id } }"), (error: unknown) => {
    assert.ok(error instanceof AdminTransportError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterMs, 2000);
    return true;
  });

  const internal = adminClientFromApp(
    appAdmin(async () => {
      throw Object.assign(new Error("Internal"), { response: { code: 503 } });
    }),
    "t.myshopify.com",
  );
  await assert.rejects(internal.graphql("query X { shop { id } }"), (error: unknown) => {
    assert.ok(error instanceof AdminTransportError);
    assert.equal(error.status, 503);
    return true;
  });

  const network = adminClientFromApp(
    appAdmin(async () => {
      throw new TypeError("fetch failed");
    }),
    "t.myshopify.com",
  );
  await assert.rejects(network.graphql("query X { shop { id } }"), (error: unknown) => {
    assert.ok(error instanceof AdminTransportError);
    assert.equal(error.status, null);
    return true;
  });
});

test("app client: a thrown Response (re-auth redirect) is passed through untouched", async () => {
  const redirect = new Response(null, { status: 302, headers: { Location: "/auth" } });
  const client = adminClientFromApp(
    appAdmin(async () => {
      throw redirect;
    }),
    "t.myshopify.com",
  );
  await assert.rejects(client.graphql("query X { shop { id } }"), (error: unknown) => error === redirect);
});

test("isThrottled only matches the THROTTLED error code", () => {
  assert.equal(isThrottled({ errors: [{ message: "x", extensions: { code: "ACCESS_DENIED" } }] }), false);
  assert.equal(isThrottled({ data: {} }), false);
  assert.equal(isThrottled({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] }), true);
});
