// App-level config guards that depend on Shopify platform limits (not on the
// config's own shape, which @won/core/discounts/config owns). saveConfig runs
// them after sanitizing and refuses the save when one fails (§4c: the admin
// explains the limit, never silently drops a rule).

import type { ConfigIssue, DiscountRule, ReadonlyDeep, WonDiscountsConfig } from "@won/core/discounts/config";
import { findCodeHashCollisions } from "@won/core/discounts/function-payload";

/**
 * Most ACTIVE code rules a shop may have (C2 fallback, spec §3 "Admin limit").
 *
 * Every active code rule is its own Shopify code app discount (one node per
 * rule: codes of one node never stack in a cart, verdict C2), next to Won's one
 * automatic node. Shopify caps how many discount functions a store can have
 * active:
 *   - "You can activate a maximum of 25 discount functions on each store."
 *     https://shopify.dev/docs/api/functions/2026-04/discount (Discount Function API, note)
 *   - automatic app discounts limit raised 5 → 25:
 *     https://shopify.dev/changelog/increased-limits-for-automatic-function-based-discounts
 * The docs do not say whether code app discounts count separately, so this
 * assumes the stricter reading: ALL active function discounts on the store
 * (every app's, automatic and code) share the 25. Won uses 1 automatic + N
 * code nodes; 20 code rules leaves 25 − 21 = 4 slots for other apps' discount
 * functions and for rules the merchant enables while a sync is still running.
 * Verified against the docs only, not on a store with 25 nodes [unverified].
 */
export const MAX_ACTIVE_CODE_RULES = 20;

/** Shopify's documented store-wide cap the constant above is derived from. */
export const SHOPIFY_MAX_ACTIVE_DISCOUNT_FUNCTIONS = 25;

type RuleView = ReadonlyDeep<DiscountRule>;
type ConfigView = ReadonlyDeep<WonDiscountsConfig>;

/**
 * A code rule that is enabled on its own: method "code", enabled, at least one
 * code. A scheduled (future or ended) rule still counts: its node exists in
 * Shopify with startsAt/endsAt (single, predictable rule for the admin).
 */
export function isActiveCodeRule(rule: RuleView): boolean {
  return rule.method === "code" && rule.enabled && Array.isArray(rule.codes) && rule.codes.length > 0;
}

/**
 * Every code rule the sync keeps a Shopify code node for: the active ones, plus
 * disabled code rules that a live (not killed) campaign switches on with an
 * `enabled: true` override — their codes must be redeemable while the campaign
 * runs, and the node cannot be created at the campaign's start (no sync runs
 * then). Outside the campaign the engine sees the rule disabled and the node
 * emits nothing.
 */
export function activeCodeRules(config: ConfigView): RuleView[] {
  const enabledByCampaign = new Set<string>();
  for (const campaign of config.campaigns) {
    if (campaign.killed) continue;
    for (const override of campaign.overrides) {
      if ((override.patch as { enabled?: unknown }).enabled === true) enabledByCampaign.add(override.ruleId);
    }
  }
  return config.modules.codes.rules.filter(
    (rule) =>
      isActiveCodeRule(rule) ||
      (rule.method === "code" && enabledByCampaign.has(rule.id) && Array.isArray(rule.codes) && rule.codes.length > 0),
  );
}

export type CodeRuleLimitCheck =
  | { ok: true; count: number; limit: number }
  | { ok: false; count: number; limit: number; issue: ConfigIssue };

export function checkActiveCodeRuleLimit(config: ConfigView): CodeRuleLimitCheck {
  const count = activeCodeRules(config).length;
  const limit = MAX_ACTIVE_CODE_RULES;
  if (count <= limit) return { ok: true, count, limit };
  return {
    ok: false,
    count,
    limit,
    issue: {
      path: "modules.codes.rules",
      code: "too_many_code_rules",
      message:
        `At most ${limit} code discounts can be active at the same time; this config has ${count}. ` +
        `Each active code discount is its own Shopify discount, and Shopify runs at most ` +
        `${SHOPIFY_MAX_ACTIVE_DISCOUNT_FUNCTIONS} app discounts per store (Won's automatic discount and other apps count too). ` +
        `Disable or delete ${count - limit} code discount(s), or add their codes to another code discount.`,
    },
  };
}

export type CodeHashCollisionCheck =
  | { ok: true }
  | {
      ok: false;
      /** Each group: codes (upper-case) the function could not tell apart. */
      collisions: string[][];
      issue: ConfigIssue;
    };

/**
 * Codes travel to the discount function as 8-hex FNV-1a hashes (T1
 * code-hash.ts); two codes with the same hash would be indistinguishable
 * there, so such a config is refused (the odds are ~n²/2³³, but the admin must
 * never let it through silently). `otherCodes` = codes of the shop's other
 * (native) discounts, when the caller knows them: a colliding native code
 * could otherwise trigger a Won rule.
 */
export function checkCodeHashCollisions(config: ConfigView, otherCodes: readonly string[] = []): CodeHashCollisionCheck {
  const found = findCodeHashCollisions(config, otherCodes);
  if (found.length === 0) return { ok: true };
  const collisions = found.map((c) => c.codes.map((x) => x.code));
  const describe = (c: (typeof found)[number]) =>
    c.codes.map((x) => (x.ruleId === null ? `${x.code} (another discount on the store)` : `${x.code} (rule ${x.ruleId})`)).join(" and ");
  return {
    ok: false,
    collisions,
    issue: {
      path: "modules.codes.rules",
      code: "code_hash_collision",
      message:
        `The discount function cannot tell these codes apart: ${found.map(describe).join("; ")}. ` +
        "Change one code in each pair (for example add or remove a character).",
    },
  };
}
