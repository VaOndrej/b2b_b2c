import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDataRequestAction,
  createCustomersRedactAction,
  createShopRedactAction,
} from "@won/app-kit/webhooks";

// A new app cloned from the template must be GDPR-compliant BY CONSTRUCTION
// (doctrine WBH-3): the three mandatory compliance webhooks exist, acknowledge,
// and — critically — never leak PII to logs (PRIV-3), while letting an app that
// DOES store customer data plug in its own deletion.

function fakeAuth(payload: unknown = {}) {
  return {
    webhook: async () => ({
      shop: "test.myshopify.com",
      topic: "TEST",
      payload,
      session: null,
    }),
  };
}
const req = () => new Request("https://example.com/webhooks");

/**
 * The argument shape react-router hands a webhook action. Derived from the
 * factory's own return type rather than re-declared, so a signature change in
 * @won/app-kit surfaces here as a type error instead of being masked by a cast.
 * Only `request` is read by these actions.
 */
type ActionArgs = Parameters<ReturnType<typeof createDataRequestAction>>[0];
const actionArgs = () => ({ request: req() }) as ActionArgs;

test("data_request acknowledges with 200 and never logs the payload (PRIV-3)", async () => {
  const logged: unknown[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => logged.push(a);
  try {
    const action = createDataRequestAction({
      authenticate: fakeAuth({ customer: { id: 1, email: "a@b.c" } }),
      db: {},
    });
    const res = await action(actionArgs());
    assert.equal(res.status, 200);
    // No log line may carry the payload object (which holds PII).
    const flat = JSON.stringify(logged);
    assert.ok(!flat.includes("a@b.c"), "data_request must not log customer PII");
  } finally {
    console.log = orig;
  }
});

test("customers/redact calls the app's redact callback with shop + payload", async () => {
  const calls: Array<{ shop: string; payload: unknown }> = [];
  const action = createCustomersRedactAction({
    authenticate: fakeAuth({ customer: { id: 7 } }),
    db: {},
    redactCustomer: async (args) => {
      calls.push(args);
    },
  });
  const res = await action(actionArgs());
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].shop, "test.myshopify.com");
});

test("customers/redact still acknowledges 200 even if the callback throws (idempotent)", async () => {
  const action = createCustomersRedactAction({
    authenticate: fakeAuth(),
    db: {},
    redactCustomer: async () => {
      throw new Error("boom");
    },
  });
  const res = await action(actionArgs());
  assert.equal(res.status, 200);
});

test("customers/redact is compliant with NO callback (PII-free app default)", async () => {
  const action = createCustomersRedactAction({ authenticate: fakeAuth(), db: {} });
  const res = await action(actionArgs());
  assert.equal(res.status, 200);
});

test("shop/redact clears sessions and runs the app's data deletion", async () => {
  const deleted: string[] = [];
  let sessionsCleared = false;
  const action = createShopRedactAction({
    authenticate: fakeAuth(),
    db: {
      session: {
        deleteMany: async ({ where }: { where: { shop: string } }) => {
          sessionsCleared = where.shop === "test.myshopify.com";
        },
      },
    },
    deleteShopData: async (shop) => {
      deleted.push(shop);
    },
  });
  const res = await action(actionArgs());
  assert.equal(res.status, 200);
  assert.deepEqual(deleted, ["test.myshopify.com"]);
  assert.equal(sessionsCleared, true);
});
