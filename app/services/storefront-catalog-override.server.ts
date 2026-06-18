/**
 * Gated, per-request storefront AUDIENCE override — the ONLY way forced audience
 * tags can be injected from outside, and the single source of truth shared by
 * every storefront proxy entrypoint (`resolveSegmentForStorefront` for storefront
 * content + the `/visibility` loader for visibility/quantity effects) so the gate
 * behaves identically everywhere.
 *
 * Why it exists: the dev store runs on NEW (passwordless) customer accounts, so a
 * real tagged-customer browser login cannot be automated. To render
 * catalog-specific EFFECTS on the storefront under Playwright we force the matched
 * audience tags per-request via the `mg_e2e_audience` query param. Catalog
 * resolution is tag-based, so injecting an audience tag (e.g. a dedicated e2e
 * catalog's tag) makes that catalog resolve without a real login. The TRIGGER
 * (real customer tag → matched catalog) stays covered by the integration tier,
 * since this hatch deliberately bypasses the real app-proxy customer plumbing
 * (logged_in_customer_id → admin tag lookup).
 *
 * PROD-SAFETY (hard): the param is INERT unless the runner-owned env flag
 * `MARGIN_GUARD_E2E_OVERRIDE=1` is set AND the process is not a production build.
 * The flag is never committed to `.env`/git — the Playwright runner injects it
 * only for the duration of the test run. We never log the override and never echo
 * it back to the client.
 */
export const E2E_AUDIENCE_OVERRIDE_PARAM = "mg_e2e_audience";

const E2E_OVERRIDE_ENV = "MARGIN_GUARD_E2E_OVERRIDE";

type EnvLike = Record<string, string | undefined>;

/**
 * True only when the gated escape hatch is armed. Production builds (`NODE_ENV
 * === "production"`) are a hard kill: even an accidentally-set flag has no effect,
 * so the param can never influence a real shopper's resolved catalog.
 */
export function isE2EOverrideEnabled(env: EnvLike = process.env): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }
  return env[E2E_OVERRIDE_ENV] === "1";
}

/**
 * Resolves the forced audience tags from a raw `mg_e2e_audience` value, or `null`
 * when the gate is closed OR the param is absent (=> resolve the audience
 * normally). When the gate is open and the param is PRESENT — even empty — it
 * returns a (possibly empty) deduped, normalized tag list:
 *
 *   - `mg_e2e_audience=mg-e2e-catalog` → `["mg-e2e-catalog"]` (force that catalog)
 *   - `mg_e2e_audience=`               → `[]` (force the base/default context,
 *                                              skipping the admin tag lookup)
 *   - param absent                     → `null` (no override; resolve normally)
 *
 * An empty array is deliberately distinct from `null`: callers treat a non-null
 * result (including `[]`) as "the override is active for this request".
 */
export function resolveStorefrontAudienceOverride(
  rawAudience: string | null | undefined,
  env: EnvLike = process.env,
): string[] | null {
  if (!isE2EOverrideEnabled(env)) {
    return null;
  }
  if (rawAudience == null) {
    return null;
  }
  const tags = String(rawAudience)
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(tags));
}
