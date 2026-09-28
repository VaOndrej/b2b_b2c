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

// --- shop/redact deletion failures (audit P2-4, PRIV-2) ---------------------------------

function failingRedactDeps() {
  const sessions: string[] = [];
  return {
    sessions,
    deps: {
      authenticate: fakeAuth(),
      db: {
        session: {
          deleteMany: async ({ where }: { where: { shop: string } }) => {
            sessions.push(where.shop);
          },
        },
      },
      deleteShopData: async () => {
        throw Object.assign(new Error("SQLITE_BUSY customer@example.com"), { code: "P2034" });
      },
    },
  };
}

test("shop/redact default (SHARE-1): a failing deletion is still ACKed 200 — unchanged for other apps", async () => {
  const { deps } = failingRedactDeps();
  const res = await createShopRedactAction(deps)(actionArgs());
  assert.equal(res.status, 200);
});

test("shop/redact with retryOnDeletionError: a failing deletion answers 500 so Shopify retries, logged without the error text", async () => {
  const { deps, sessions } = failingRedactDeps();
  const logged: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => logged.push(a);
  try {
    const res = await createShopRedactAction({ ...deps, retryOnDeletionError: true })(actionArgs());
    assert.equal(res.status, 500);
  } finally {
    console.error = orig;
  }
  const flat = JSON.stringify(logged);
  assert.match(flat, /test\.myshopify\.com/, "the failure must be logged");
  assert.match(flat, /P2034/, "with the error code for diagnosis");
  assert.ok(!flat.includes("customer@example.com"), "but never the error message (may carry PII)");
  assert.deepEqual(sessions, [], "sessions stay until the retry succeeds");
});

test("shop/redact with retryOnDeletionError: success still clears data and sessions with 200", async () => {
  const deleted: string[] = [];
  let sessionsCleared = false;
  const action = createShopRedactAction({
    authenticate: fakeAuth(),
    db: {
      session: {
        deleteMany: async () => {
          sessionsCleared = true;
        },
      },
    },
    deleteShopData: async (shop) => {
      deleted.push(shop);
    },
    retryOnDeletionError: true,
  });
  const res = await action(actionArgs());
  assert.equal(res.status, 200);
  assert.deepEqual(deleted, ["test.myshopify.com"]);
  assert.equal(sessionsCleared, true);
});
