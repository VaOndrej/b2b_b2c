import assert from "node:assert/strict";
import { test } from "node:test";

import { createScopesUpdateAction } from "@won/app-kit/webhooks";

// Audit 2026-10-26, finding REL-01: app/scopes_update wrote `payload.current` cast to string[] without a check, so
// an odd payload threw, answered 500 and Shopify retried it for 48 h. The shared action (@won/app-kit, every app and
// the template) now stores the scopes only when `current` is a list of strings and acknowledges anything else.

function deps(payload: unknown) {
  const updates: unknown[] = [];
  return {
    updates,
    deps: {
      authenticate: {
        webhook: async () => ({ shop: "scopes.myshopify.com", topic: "APP_SCOPES_UPDATE", payload, session: { id: "offline_scopes.myshopify.com" } }),
      },
      db: { session: { update: async (args: unknown) => void updates.push(args) } },
    },
  };
}
type ActionArgs = Parameters<ReturnType<typeof createScopesUpdateAction>>[0];
const args = () => ({ request: new Request("https://example.com/webhooks/app/scopes_update") }) as ActionArgs;

test("REL-01: the granted scopes are stored on the session", async () => {
  const { deps: d, updates } = deps({ current: ["read_products", "write_discounts"], previous: ["read_products"] });
  const res = await createScopesUpdateAction(d)(args());
  assert.equal(res.status, 200);
  assert.deepEqual(updates, [{ where: { id: "offline_scopes.myshopify.com" }, data: { scope: "read_products,write_discounts" } }]);
});

for (const [name, payload] of [
  ["no current", {}],
  ["current is a string", { current: "read_products" }],
  ["current holds a non-string", { current: ["read_products", 7] }],
  ["no payload object", null],
] as const) {
  test(`REL-01: an odd payload (${name}) is acknowledged with 200 and stores nothing`, async () => {
    const { deps: d, updates } = deps(payload);
    const res = await createScopesUpdateAction(d)(args());
    assert.equal(res.status, 200);
    assert.deepEqual(updates, []);
  });
}
