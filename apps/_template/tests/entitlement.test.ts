import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveEntitlement } from "@won/app-kit/entitlement";

// BILL-1: entitlement is server-derived and defaults to Free on ANY uncertainty —
// a failed or absent billing check must never grant a paid plan.

test("an authoritative paid plan resolves to pro", async () => {
  const e = await resolveEntitlement(async () => "pro");
  assert.deepEqual(e, { plan: "pro", pro: true });
});

test("a null check (undeterminable) falls back to Free, not Pro", async () => {
  const e = await resolveEntitlement(async () => null);
  assert.deepEqual(e, { plan: "free", pro: false });
});

test("a thrown check (billing hiccup) falls back to Free, never Pro", async () => {
  const e = await resolveEntitlement(async () => {
    throw new Error("billing down");
  });
  assert.deepEqual(e, { plan: "free", pro: false });
});

test("a known non-paid plan resolves as not-pro", async () => {
  const e = await resolveEntitlement(async () => "starter", { paidPlans: ["pro", "plus"] });
  assert.deepEqual(e, { plan: "starter", pro: false });
});

test("custom paid plans + free plan id are honoured", async () => {
  assert.deepEqual(await resolveEntitlement(async () => "plus", { paidPlans: ["plus"] }), {
    plan: "plus",
    pro: true,
  });
  assert.deepEqual(await resolveEntitlement(async () => null, { freePlan: "basic" }), {
    plan: "basic",
    pro: false,
  });
});
