import assert from "node:assert/strict";
import { test } from "node:test";

import {
  planFromSubscriptionUpdate,
  PRO_PLAN_NAME,
} from "../../app/services/billing.server";

// BILL-1: entitlement must reconcile from Shopify's authoritative subscription
// state (the app_subscriptions/update webhook), not only when the merchant opens
// the Plan page — a cancelled sub must drop the stored plan to Free.

test("an ACTIVE Pro subscription resolves to 'pro'", () => {
  const plan = planFromSubscriptionUpdate({
    app_subscription: { name: PRO_PLAN_NAME, status: "ACTIVE" },
  });
  assert.equal(plan, "pro");
});

test("any non-ACTIVE status for our plan resolves to 'free' (default to Free)", () => {
  for (const status of ["CANCELLED", "EXPIRED", "FROZEN", "DECLINED", "PENDING"]) {
    assert.equal(
      planFromSubscriptionUpdate({ app_subscription: { name: PRO_PLAN_NAME, status } }),
      "free",
      `status ${status} must downgrade to free`,
    );
  }
});

test("an update for a different plan is ignored (null)", () => {
  const plan = planFromSubscriptionUpdate({
    app_subscription: { name: "Some Other App Plan", status: "ACTIVE" },
  });
  assert.equal(plan, null);
});

test("a malformed / empty payload is ignored (null), never a crash", () => {
  assert.equal(planFromSubscriptionUpdate(undefined), null);
  assert.equal(planFromSubscriptionUpdate({}), null);
  assert.equal(planFromSubscriptionUpdate({ app_subscription: {} }), null);
});
