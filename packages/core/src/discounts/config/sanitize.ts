import { collectOverrideTargets, sanitizeCampaigns } from "./campaigns.ts";
import { sanitizeRules } from "./codes.ts";
import { sanitizeEngine } from "./engine.ts";
import { SCHEMA_VERSION } from "./enums.ts";
import { CONFIG_LIMITS } from "./limits.ts";
import { sanitizeMargin } from "./margin.ts";
import { sanitizeMarkets } from "./markets.ts";
import { sanitizeOutlet } from "./outlet.ts";
import { sanitizeLocales, sanitizeOnboarding, sanitizeStorefront } from "./presentation.ts";
import { sanitizeRewards } from "./rewards.ts";
import { isRecord } from "./sanitize-helpers.ts";
import { sanitizeTierSets } from "./tiers.ts";
import type { ConfigIssue, WonDiscountsConfig } from "./types.ts";

/**
 * The single sanitizer (DATA-2): clamps, enums, defaults, drops unknown keys and
 * orphaned/invalid entries. Returns a complete, valid config plus a list of
 * human-readable issues for the admin to show (§4c). Never throws.
 */
export function sanitizeConfig(input: unknown): { config: WonDiscountsConfig; issues: ConfigIssue[] } {
  const issues: ConfigIssue[] = [];
  const rec = isRecord(input) ? input : {};
  const modules = isRecord(rec.modules) ? rec.modules : {};

  const markets = sanitizeMarkets(rec.markets, issues);
  const engine = sanitizeEngine(rec.engine, issues);

  const codesRaw = isRecord(modules.codes) ? modules.codes : {};
  const { rules, aliases: ruleAliases } = sanitizeRules(codesRaw.rules, issues);

  const tiersRaw = isRecord(modules.tiers) ? modules.tiers : {};
  const { sets, aliases: setAliases } = sanitizeTierSets(tiersRaw.sets, issues);

  const { rewards, aliases: giftAliases } = sanitizeRewards(modules.rewards, issues);

  const config: WonDiscountsConfig = {
    schemaVersion: SCHEMA_VERSION,
    markets,
    engine,
    modules: {
      codes: { rules },
      tiers: { sets },
      rewards,
      outlet: sanitizeOutlet(modules.outlet, issues),
      margin: sanitizeMargin(modules.margin, issues),
    },
    // Campaigns last: their overrides are checked against the final rule/tier/gift ids.
    campaigns: sanitizeCampaigns(
      rec.campaigns,
      issues,
      collectOverrideTargets(rules, sets, rewards.gifts, { rules: ruleAliases, sets: setAliases, gifts: giftAliases }),
    ),
    storefront: sanitizeStorefront(rec.storefront),
    locales: sanitizeLocales(rec.locales, issues),
    onboarding: sanitizeOnboarding(rec.onboarding, issues),
  };

  return { config, issues: capIssues(issues) };
}

/**
 * Caps the issues list at CONFIG_LIMITS.maxIssues, replacing anything past that
 * with one summary issue — the list itself is not something a hostile or buggy
 * admin request should be able to blow up (audit P3-10 followup).
 */
function capIssues(issues: ConfigIssue[]): ConfigIssue[] {
  if (issues.length <= CONFIG_LIMITS.maxIssues) return issues;
  const kept = issues.slice(0, CONFIG_LIMITS.maxIssues);
  kept.push({
    path: "",
    code: "issues_truncated",
    message: `${issues.length - CONFIG_LIMITS.maxIssues} more problem(s) were found but are not listed here.`,
  });
  return kept;
}

/**
 * True when `stored` was written by a NEWER schema than this code knows (DATA-3,
 * rolling deploys). Such a config can still be read — readStoredConfig returns the
 * best-effort current-schema view — but must be treated as read-only: writing that
 * view back would silently drop every field the newer code added.
 */
export function isNewerSchema(stored: unknown): boolean {
  return isRecord(stored) && typeof stored.schemaVersion === "number" && stored.schemaVersion > SCHEMA_VERSION;
}

/**
 * Tolerant migration, vN -> current (DATA-3). MVP0 has no prior real schema, so a
 * v0/no-version fixture only needs its schemaVersion stamped forward — sanitizeConfig
 * fills any structural gaps. Future breaking shape changes branch on `version` here,
 * each with its own fixture test, before the shape reaches sanitizeConfig.
 * A newer-schema config passes through unchanged (see isNewerSchema).
 */
export function migrateConfig(stored: unknown): unknown {
  if (!isRecord(stored)) return stored;
  const version = typeof stored.schemaVersion === "number" ? stored.schemaVersion : 0;
  if (version >= SCHEMA_VERSION) return stored;
  return { ...stored, schemaVersion: SCHEMA_VERSION };
}

/**
 * migrate + sanitize; never throws, always returns a valid, freshly allocated
 * config (never DEFAULT_CONFIG itself). For a newer-schema row this is a read-only
 * view — check isNewerSchema(stored) before saving anything derived from it.
 */
export function readStoredConfig(stored: unknown): WonDiscountsConfig {
  return sanitizeConfig(migrateConfig(stored)).config;
}
