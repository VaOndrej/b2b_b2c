import test from "node:test";
import assert from "node:assert/strict";
import {
  E2E_AUDIENCE_OVERRIDE_PARAM,
  isE2EOverrideEnabled,
  resolveStorefrontAudienceOverride,
} from "../../app/services/storefront-catalog-override.server.ts";

// The gated, prod-safe storefront AUDIENCE override (mg_e2e_audience). These tests
// pin the safety contract: the param is INERT unless the runner-owned flag is
// armed, a HARD no-op in production, and only ever yields normalized audience tags
// (catalog resolution is tag-based).

test("the override query param is mg_e2e_audience", () => {
  assert.equal(E2E_AUDIENCE_OVERRIDE_PARAM, "mg_e2e_audience");
});

test("override is INERT without the runner-owned flag — the param is ignored", () => {
  const env = {}; // no MARGIN_GUARD_E2E_OVERRIDE
  assert.equal(isE2EOverrideEnabled(env), false);
  assert.equal(resolveStorefrontAudienceOverride("mg-e2e-catalog", env), null);
  assert.equal(resolveStorefrontAudienceOverride("", env), null);
});

test("PROD-SAFETY: override is a HARD no-op in production builds even if the flag is set", () => {
  const env = { MARGIN_GUARD_E2E_OVERRIDE: "1", NODE_ENV: "production" };
  assert.equal(isE2EOverrideEnabled(env), false);
  assert.equal(resolveStorefrontAudienceOverride("mg-e2e-catalog", env), null);
});

test("flag must equal exactly '1' to arm the override", () => {
  assert.equal(isE2EOverrideEnabled({ MARGIN_GUARD_E2E_OVERRIDE: "1" }), true);
  assert.equal(isE2EOverrideEnabled({ MARGIN_GUARD_E2E_OVERRIDE: "true" }), false);
  assert.equal(isE2EOverrideEnabled({ MARGIN_GUARD_E2E_OVERRIDE: "0" }), false);
  assert.equal(isE2EOverrideEnabled({ MARGIN_GUARD_E2E_OVERRIDE: "" }), false);
});

test("armed override normalizes audience tags (trim/lowercase/dedupe, comma-split)", () => {
  const env = { MARGIN_GUARD_E2E_OVERRIDE: "1", NODE_ENV: "test" };
  assert.equal(isE2EOverrideEnabled(env), true);
  assert.deepEqual(resolveStorefrontAudienceOverride("mg-e2e-catalog", env), [
    "mg-e2e-catalog",
  ]);
  assert.deepEqual(resolveStorefrontAudienceOverride(" MG-E2E-Catalog ", env), [
    "mg-e2e-catalog",
  ]);
  assert.deepEqual(resolveStorefrontAudienceOverride("gold, silver ,gold", env), [
    "gold",
    "silver",
  ]);
});

test("absent param (null) is no-override; present-empty forces the base context ([])", () => {
  const env = { MARGIN_GUARD_E2E_OVERRIDE: "1", NODE_ENV: "test" };
  // null/undefined => the param was not on the URL => resolve audience normally.
  assert.equal(resolveStorefrontAudienceOverride(null, env), null);
  assert.equal(resolveStorefrontAudienceOverride(undefined, env), null);
  // Present-but-empty => the override IS active, forcing zero tags (base/default).
  assert.deepEqual(resolveStorefrontAudienceOverride("", env), []);
  assert.deepEqual(resolveStorefrontAudienceOverride("   ", env), []);
});
