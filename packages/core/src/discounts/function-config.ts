// Function-config payload + size budget (doctrine C3/C4, spec §2–§3). The discount
// function has no DB: everything it knows comes from the `$app:won_discounts` /
// `function_config` metafield on its discount node, which is ALSO the source of
// the input query's variables (`[extensions.input.variables]`). So this module
// decides exactly what goes into that metafield:
//
//   - only the function-relevant subset of WonDiscountsConfig — never locales,
//     storefront, onboarding or markets (they would eat the byte budget and block
//     saving a discount rule because a storefront text got longer, audit P1-2);
//   - ALWAYS top-level `campaignStart` and `campaignEnd` in shop-local
//     `YYYY-MM-DDTHH:MM:SS`. C4 proved on the platform that a missing key (or a
//     missing metafield) fails the run with InvalidVariableValueError before any
//     JS runs, and the query's `= "1970-…"` defaults are NOT applied: every
//     discount of that node silently disappears. With no campaign both keys are
//     NO_CAMPAIGN_DATETIME (a zero-length window, never active).
//
// The budget: 9000 B leaves ~10 % headroom under Shopify's 10 000 B limit (C3:
// 10 000 B passed, 10 001 B failed). The admin must refuse to save a config whose
// payload does not fit (§9) — apps/won-discounts saveConfig enforces `fits`.

import { isShopLocalDateTime, type ReadonlyDeep, type WonDiscountsConfig } from "./config.ts";

export const FUNCTION_CONFIG_BUDGET_BYTES = 9000;

/** Both campaign variables when there is no live campaign: 1970 → 1970 is never active. */
export const NO_CAMPAIGN_DATETIME = "1970-01-01T00:00:00";

export interface EncodedFunctionConfig {
  json: string;
  bytes: number;
  fits: boolean;
}

export interface EncodeFunctionConfigOptions {
  /**
   * The shop's current local time (`YYYY-MM-DDTHH:MM:SS`). Campaigns whose window
   * already ended are skipped when picking the window for the query variables.
   * Without it, the earliest live (non-killed, valid) window is used.
   */
  now?: string;
}

/** Read-only view: a live config and the frozen DEFAULT_CONFIG are both accepted. */
type ConfigInput = ReadonlyDeep<WonDiscountsConfig>;
type CampaignInput = ConfigInput["campaigns"][number];

/**
 * The window the function checks via `shop.localTime.dateTimeBetween` (C4). One
 * pair of variables means one window at a time; campaigns never overlap (A8,
 * enforced by sanitizeConfig), so "the current or next live one" is unambiguous.
 */
function selectCampaign(campaigns: readonly CampaignInput[], now: string | undefined): CampaignInput | null {
  const live = campaigns
    .filter(
      (c) =>
        !c.killed &&
        isShopLocalDateTime(c.window.start) &&
        isShopLocalDateTime(c.window.end) &&
        c.window.start < c.window.end &&
        (now === undefined || c.window.end > now),
    )
    .sort((a, b) => (a.window.start < b.window.start ? -1 : a.window.start > b.window.start ? 1 : 0));
  return live[0] ?? null;
}

/**
 * Build the exact object written to the `function_config` metafield. Keys are
 * whitelisted field by field (not spread), so a field added to the config later
 * does not reach the function — and its budget — until someone decides it should.
 */
export function buildFunctionPayload(c: ConfigInput, opts: EncodeFunctionConfigOptions = {}) {
  const selected = selectCampaign(c.campaigns, opts.now);
  const { codes, tiers, rewards, margin } = c.modules;
  return {
    campaignStart: selected ? selected.window.start : NO_CAMPAIGN_DATETIME,
    campaignEnd: selected ? selected.window.end : NO_CAMPAIGN_DATETIME,
    campaignId: selected ? selected.id : null,
    schemaVersion: c.schemaVersion,
    engine: c.engine,
    modules: {
      // Everything the engine reads from a rule. `limits` (usage limits live on the
      // Shopify node itself) and `origin` (native-discount backup link) are admin-only.
      codes: {
        rules: codes.rules.map((r) => ({
          id: r.id,
          enabled: r.enabled,
          name: r.name,
          method: r.method,
          ...(r.codes ? { codes: r.codes } : {}),
          value: r.value,
          target: r.target,
          ...(r.minimum ? { minimum: r.minimum } : {}),
          ...(r.schedule ? { schedule: r.schedule } : {}),
          ...(r.targeting ? { targeting: r.targeting } : {}),
          ...(r.combinesWith ? { combinesWith: r.combinesWith } : {}),
        })),
      },
      tiers: { sets: tiers.sets },
      rewards: {
        ...(rewards.freeShipping ? { freeShipping: rewards.freeShipping } : {}),
        gifts: rewards.gifts,
        countOtherDiscounts: rewards.countOtherDiscounts,
      },
      margin,
      // No `outlet`: outlet lines are flagged per variant metafield and priced via
      // price/compare_at (§4.4); display and reopen-on-return are storefront/admin only.
    },
    // Killed campaigns never ship; the function applies the overrides of the
    // campaign named by `campaignId` while `campaignActive` is true.
    campaigns: c.campaigns
      .filter((k) => !k.killed)
      .map((k) => ({ id: k.id, window: k.window, overrides: k.overrides })),
  };
}

/**
 * Serialize the function payload and measure it in UTF-8 bytes — not JS string
 * length/UTF-16 code units, which would under-count anything outside ASCII (e.g.
 * "Kč" is 2 UTF-16 code units but 3 UTF-8 bytes). Uses the platform TextEncoder
 * rather than Node's Buffer so this stays usable from any JS runtime.
 */
export function encodeFunctionConfig(
  c: ConfigInput,
  opts: EncodeFunctionConfigOptions = {},
): EncodedFunctionConfig {
  const json = JSON.stringify(buildFunctionPayload(c, opts));
  const bytes = new TextEncoder().encode(json).length;
  return { json, bytes, fits: bytes <= FUNCTION_CONFIG_BUDGET_BYTES };
}
