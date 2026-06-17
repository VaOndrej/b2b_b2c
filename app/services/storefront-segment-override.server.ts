import type { Segment } from "../../core/segment/segment.types.ts";
import { isSegment } from "../../core/segment/segment.types.ts";

/**
 * Gated, per-request storefront segment override — the ONLY way a forced segment
 * can be injected from outside, and the single source of truth shared by every
 * storefront proxy entrypoint (`resolveSegmentForStorefront` for storefront
 * content + the `/visibility` loader for visibility/quantity effects) so the
 * gate behaves identically everywhere.
 *
 * Why it exists: the dev store runs on NEW (passwordless) customer accounts, so a
 * real B2B browser login cannot be automated. To render B2B EFFECTS on the
 * storefront under Playwright we force the segment per-request via the
 * `mg_e2e_segment` query param. The B2B TRIGGER (tag b2b → segment) stays covered
 * by the integration tier, since this hatch deliberately bypasses the real
 * app-proxy customer plumbing (logged_in_customer_id → admin tag lookup).
 *
 * PROD-SAFETY (hard): the param is INERT unless the runner-owned env flag
 * `MARGIN_GUARD_E2E_OVERRIDE=1` is set AND the process is not a production build.
 * The flag is never committed to `.env`/git — the Playwright runner injects it
 * only for the duration of the test run. Anything other than a real Segment value
 * is rejected. We never log the override and never echo it back to the client.
 */
export const E2E_SEGMENT_OVERRIDE_PARAM = "mg_e2e_segment";

const E2E_SEGMENT_OVERRIDE_ENV = "MARGIN_GUARD_E2E_OVERRIDE";

type EnvLike = Record<string, string | undefined>;

/**
 * True only when the gated escape hatch is armed. Production builds (`NODE_ENV
 * === "production"`) are a hard kill: even an accidentally-set flag has no effect,
 * so the param can never influence a real shopper's segment.
 */
export function isE2ESegmentOverrideEnabled(
  env: EnvLike = process.env,
): boolean {
  if (env.NODE_ENV === "production") {
    return false;
  }
  return env[E2E_SEGMENT_OVERRIDE_ENV] === "1";
}

/**
 * Resolves the forced segment from a raw `mg_e2e_segment` value, or `null` when
 * the gate is closed or the value is not a real Segment. Returning `null` means
 * "ignore the param and resolve the segment normally".
 *
 * Allowed values are derived from the real Segment enum (`isSegment`), never
 * guessed, and matched case-insensitively for ergonomic project config.
 */
export function resolveStorefrontSegmentOverride(
  rawSegment: string | null | undefined,
  env: EnvLike = process.env,
): Segment | null {
  if (!isE2ESegmentOverrideEnabled(env)) {
    return null;
  }
  const normalized = String(rawSegment ?? "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  return isSegment(normalized) ? normalized : null;
}
