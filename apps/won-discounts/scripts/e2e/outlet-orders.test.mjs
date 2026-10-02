// Unit tests of the 5b order-cancel guard (scripts/e2e/outlet-orders.mjs): only THIS run's E2E test orders.
//
//   node --test apps/won-discounts/scripts/e2e/outlet-orders.test.mjs
//
// Kept next to the script, not under tests/ (tests/e2e is Playwright's testDir).

import assert from "node:assert/strict";
import { it } from "node:test";

import { skipReason } from "./outlet-orders.mjs";

const opts = { since: "2026-10-02T10:00:00Z", email: "won-e2e-outlet@example.com" };
const order = (over = {}) => ({
  createdAt: "2026-10-02T10:05:00Z",
  email: "WON-E2E-OUTLET@example.com",
  test: true,
  cancelledAt: null,
  lineItems: { nodes: [{ quantity: 1, variant: { product: { handle: "won-e2e-spare" } } }] },
  ...over,
});

it("this run's Bogus order of the won-e2e catalog by the E2E e-mail is cancelled", () => {
  assert.equal(skipReason(order(), opts), null);
});

it("anything else is skipped with its reason", () => {
  assert.equal(skipReason(order({ createdAt: "2026-10-02T09:59:59Z" }), opts), "created before this run");
  assert.equal(skipReason(order({ email: "someone@example.com" }), opts), "another e-mail");
  assert.equal(skipReason(order({ test: false }), opts), "not a test (Bogus) order");
  assert.equal(skipReason(order({ cancelledAt: "2026-10-02T10:06:00Z" }), opts), "already cancelled");
  assert.equal(skipReason(order({ lineItems: { nodes: [{ quantity: 1, variant: { product: { handle: "real-product" } } }] } }), opts), "a line outside the won-e2e-* catalog");
  assert.equal(skipReason(order({ lineItems: { nodes: [] } }), opts), "a line outside the won-e2e-* catalog");
});
