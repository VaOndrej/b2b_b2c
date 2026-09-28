// Precomputed targeting (plan T3, spec §1 C3): which product/collection rules
// apply to which product or variant. The sync layer writes `productRuleIndex`
// into each product's `$app:won_discounts` metafield as
//   { ruleIds: [...], variantRuleIds: { "<variant GID>": [...] } }
// and the function passes both to the engine per cart line (CartLineInput). The
// function never needs collection slots in its input query and the rules' id
// lists never reach the 9 000 B config budget.
//
// A reference is one string (rule and campaign ids are `[A-Za-z0-9_-]`, so "@"
// is a safe separator):
//   "ruleId"             always
//   "ruleId@<campaign>"  only while that campaign re-targets the rule
// Order and shipping rules are never listed: they apply to every line.

import type { ReadonlyDeep, WonDiscountsConfig } from "./config.ts";

export interface RuleRefParts {
  ruleId: string;
  campaignId?: string;
}

/** The short, stable key of a GID (`gid://shopify/ProductVariant/42` → "42"); used by adapters. */
export function variantKey(variantId: string): string {
  const slash = variantId.lastIndexOf("/");
  return slash === -1 ? variantId : variantId.slice(slash + 1);
}

export function ruleRef(ruleId: string, opts: { campaignId?: string } = {}): string {
  return opts.campaignId ? `${ruleId}@${opts.campaignId}` : ruleId;
}

export function parseRuleRef(ref: string): RuleRefParts {
  const at = ref.indexOf("@");
  return at === -1 ? { ruleId: ref } : { ruleId: ref.slice(0, at), campaignId: ref.slice(at + 1) };
}

export interface ProductTargetingInput {
  productId: string;
  variantIds: readonly string[];
  collectionIds: readonly string[];
}

/** What the product metafield carries (sorted, unique lists; only variants that have refs). */
export interface ProductRuleEntry {
  ruleIds: string[];
  variantRuleIds: Record<string, string[]>;
}

interface Scope {
  ref: string;
  productIds: ReadonlySet<string>;
  variantIds: ReadonlySet<string>;
  collectionIds: ReadonlySet<string>;
}

type TargetLike = { kind?: unknown; productIds?: unknown; variantIds?: unknown; ids?: unknown };

const stringSet = (v: unknown) => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function scopeOf(target: unknown, ref: string): Scope | null {
  if (typeof target !== "object" || target === null) return null;
  const t = target as TargetLike;
  if (t.kind === "products") {
    return { ref, productIds: stringSet(t.productIds), variantIds: stringSet(t.variantIds), collectionIds: new Set() };
  }
  if (t.kind === "collections") {
    return { ref, productIds: new Set(), variantIds: new Set(), collectionIds: stringSet(t.ids) };
  }
  return null;
}

/**
 * productId → { ruleIds, variantRuleIds } for every product given (empty entries
 * included, so the sync can clear a stale metafield).
 *  - Every rule is indexed, enabled or not: enabling a rule then needs no product
 *    metafield rewrite (the engine checks `enabled`, schedule, codes…).
 *  - A variant target is listed per variant and never collapsed to the product,
 *    even when every current variant is listed: a variant added later must not
 *    inherit the discount (the sync re-indexes on product changes).
 *  - A variant ref already covered product-wide is not repeated.
 *  - A campaign override that patches a rule's target adds campaign-scoped refs
 *    (killed campaigns add nothing).
 */
export function productRuleIndex(
  config: ReadonlyDeep<WonDiscountsConfig>,
  products: readonly ProductTargetingInput[],
): Map<string, ProductRuleEntry> {
  const scopes: Scope[] = [];
  for (const rule of config.modules.codes.rules) {
    const scope = scopeOf(rule.target, ruleRef(rule.id));
    if (scope) scopes.push(scope);
  }
  const ruleIds = new Set(config.modules.codes.rules.map((r) => r.id));
  for (const campaign of config.campaigns) {
    if (campaign.killed) continue;
    for (const override of campaign.overrides) {
      if (!ruleIds.has(override.ruleId) || !("target" in override.patch)) continue;
      const scope = scopeOf(override.patch.target, ruleRef(override.ruleId, { campaignId: campaign.id }));
      if (scope) scopes.push(scope);
    }
  }

  const index = new Map<string, ProductRuleEntry>();
  for (const product of products) {
    const whole = new Set<string>();
    const perVariant = new Map<string, Set<string>>();
    for (const scope of scopes) {
      if (scope.productIds.has(product.productId) || product.collectionIds.some((c) => scope.collectionIds.has(c))) {
        whole.add(scope.ref);
        continue;
      }
      for (const variantId of product.variantIds) {
        if (!scope.variantIds.has(variantId)) continue;
        let refs = perVariant.get(variantId);
        if (!refs) perVariant.set(variantId, (refs = new Set()));
        refs.add(scope.ref);
      }
    }
    const variantRuleIds: Record<string, string[]> = {};
    for (const variantId of [...perVariant.keys()].sort()) {
      const refs = [...perVariant.get(variantId)!].filter((ref) => !whole.has(ref)).sort();
      if (refs.length > 0) variantRuleIds[variantId] = refs;
    }
    index.set(product.productId, { ruleIds: [...whole].sort(), variantRuleIds });
  }
  return index;
}

/**
 * The rule ids that apply to one cart line (engine side of the refs above; the
 * line's refs already include its own variant's). `retargeted` = rules whose
 * target the applied campaign patches: for those only refs scoped to that
 * campaign count, for every other rule only unscoped ones.
 */
export function lineRuleIds(
  line: { ruleIds: readonly string[] },
  campaignId: string | null,
  retargeted: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const ref of line.ruleIds) {
    const at = ref.indexOf("@");
    if (at === -1) {
      if (!retargeted.has(ref)) out.add(ref);
      continue;
    }
    const ruleId = ref.slice(0, at);
    if (retargeted.has(ruleId) && ref.slice(at + 1) === campaignId) out.add(ruleId);
  }
  return out;
}
