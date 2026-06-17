import test from "node:test";
import assert from "node:assert/strict";
import {
  E2E_SEGMENT_OVERRIDE_PARAM,
  isE2ESegmentOverrideEnabled,
  resolveStorefrontSegmentOverride,
} from "../../app/services/storefront-segment-override.server.ts";
import { SEGMENTS } from "../../core/segment/segment.types.ts";

// The gated, prod-safe storefront segment override (mg_e2e_segment). These tests
// pin the safety contract: the param is INERT unless the runner-owned flag is
// armed, a HARD no-op in production, and only ever yields a real Segment value.

test("the override query param is mg_e2e_segment", () => {
  assert.equal(E2E_SEGMENT_OVERRIDE_PARAM, "mg_e2e_segment");
});

test("override is INERT without the runner-owned flag — the param is ignored", () => {
  const env = {}; // no MARGIN_GUARD_E2E_OVERRIDE
  assert.equal(isE2ESegmentOverrideEnabled(env), false);
  assert.equal(resolveStorefrontSegmentOverride("B2B", env), null);
  assert.equal(resolveStorefrontSegmentOverride("B2C", env), null);
});

test("PROD-SAFETY: override is a HARD no-op in production builds even if the flag is set", () => {
  const env = { MARGIN_GUARD_E2E_OVERRIDE: "1", NODE_ENV: "production" };
  assert.equal(isE2ESegmentOverrideEnabled(env), false);
  assert.equal(resolveStorefrontSegmentOverride("B2B", env), null);
  assert.equal(resolveStorefrontSegmentOverride("B2C", env), null);
});

test("flag must equal exactly '1' to arm the override", () => {
  assert.equal(isE2ESegmentOverrideEnabled({ MARGIN_GUARD_E2E_OVERRIDE: "1" }), true);
  assert.equal(isE2ESegmentOverrideEnabled({ MARGIN_GUARD_E2E_OVERRIDE: "true" }), false);
  assert.equal(isE2ESegmentOverrideEnabled({ MARGIN_GUARD_E2E_OVERRIDE: "0" }), false);
  assert.equal(isE2ESegmentOverrideEnabled({ MARGIN_GUARD_E2E_OVERRIDE: "" }), false);
});

test("armed override forces a valid segment (case/whitespace-insensitive) and rejects everything else", () => {
  const env = { MARGIN_GUARD_E2E_OVERRIDE: "1", NODE_ENV: "test" };
  assert.equal(isE2ESegmentOverrideEnabled(env), true);
  assert.equal(resolveStorefrontSegmentOverride("B2B", env), "B2B");
  assert.equal(resolveStorefrontSegmentOverride("B2C", env), "B2C");
  assert.equal(resolveStorefrontSegmentOverride("b2b", env), "B2B");
  assert.equal(resolveStorefrontSegmentOverride(" b2c ", env), "B2C");
  // Anything that is not a real Segment is rejected.
  assert.equal(resolveStorefrontSegmentOverride("B2X", env), null);
  assert.equal(resolveStorefrontSegmentOverride("ADMIN", env), null);
  assert.equal(resolveStorefrontSegmentOverride("", env), null);
  assert.equal(resolveStorefrontSegmentOverride(null, env), null);
  assert.equal(resolveStorefrontSegmentOverride(undefined, env), null);
});

test("allowed override values are exactly the real Segment enum (not guessed)", () => {
  const env = { MARGIN_GUARD_E2E_OVERRIDE: "1", NODE_ENV: "test" };
  for (const segment of SEGMENTS) {
    assert.equal(resolveStorefrontSegmentOverride(segment, env), segment);
  }
});
