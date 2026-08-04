import assert from "node:assert/strict";
import { test } from "node:test";

import { signTestToken, verifyTestToken } from "../../src/toasts/test-token.ts";

const SECRET = "shh-app-secret";

test("a signed test token verifies with the same secret", () => {
  const expMs = 10_000;
  const sig = signTestToken("added", expMs, SECRET);
  assert.equal(
    verifyTestToken({ type: "added", expMs, sig, secret: SECRET, nowMs: 5_000 }),
    true,
  );
});

test("an expired token is rejected", () => {
  const expMs = 10_000;
  const sig = signTestToken("added", expMs, SECRET);
  assert.equal(
    verifyTestToken({ type: "added", expMs, sig, secret: SECRET, nowMs: 10_001 }),
    false,
  );
});

test("a tampered type or wrong secret is rejected", () => {
  const expMs = 10_000;
  const sig = signTestToken("added", expMs, SECRET);
  assert.equal(
    verifyTestToken({ type: "removed", expMs, sig, secret: SECRET, nowMs: 1 }),
    false,
  );
  assert.equal(
    verifyTestToken({ type: "added", expMs, sig, secret: "other", nowMs: 1 }),
    false,
  );
  assert.equal(
    verifyTestToken({ type: "added", expMs, sig: "deadbeef", secret: SECRET, nowMs: 1 }),
    false,
  );
});
