// Precomputed targeting (plan T3, spec §1 C3): which product/collection rules
// apply to which product. The sync layer writes `productRuleIndex` into each
// product's `$app:won_discounts` metafield; the function reads it per cart line
// (`CartLineInput.ruleIds`). The function never needs collection slots in its
// input query and the rules' id lists never reach the 9 000 B config budget.
//
// A reference is one string (rule and campaign ids are `[A-Za-z0-9_-]`, so ":"
// and "@" are safe separators):
//   "ruleId"                      the whole product
//   "ruleId:<variant>"            one variant (numeric tail of its GID)
//   "ruleId@<campaign>"           the product, only while that campaign re-targets the rule
//   "ruleId@<campaign>:<variant>" one variant, same
// Order and shipping rules are never listed: they apply to every line.

import type { ReadonlyDeep, WonDiscountsConfig } from "./config.ts";

export interface RuleRefParts {
  ruleId: string;
  campaignId?: string;
  variant?: string;
}

/** The short, stable key of a variant GID (`gid://shopify/ProductVariant/42` → "42"). */
export function variantKey(variantId: string): string {
  const slash = variantId.lastIndexOf("/");
  return slash === -1 ? variantId : variantId.slice(slash + 1);
}

export function ruleRef(ruleId: string, opts: { variantId?: string; campaignId?: string } = {}): string {
  let ref = ruleId;
  if (opts.campaignId) ref += `@${opts.campaignId}`;
  if (opts.variantId) ref += `:${variantKey(opts.variantId)}`;
  return ref;
}

export function parseRuleRef(ref: string): RuleRefParts {
  const at = ref.indexOf("@");
  const colon = ref.indexOf(":");
  const idEnd = at !== -1 ? at : colon !== -1 ? colon : ref.length;
  const out: RuleRefParts = { ruleId: ref.slice(0, idEnd) };
  if (at !== -1) out.campaignId = ref.slice(at + 1, colon > at ? colon : ref.length);
  if (colon !== -1) out.variant = ref.slice(colon + 1);
  return out;
}

export interface ProductTargetingInput {
  productId: string;
  variantIds: readonly string[];
  collectionIds: readonly string[];
}

interface Scope {
  ruleId: string;
  campaignId?: string;
  productIds: ReadonlySet<string>;
  variantIds: ReadonlySet<string>;
  collectionIds: ReadonlySet<string>;
}

type TargetLike = { kind?: unknown; productIds?: unknown; variantIds?: unknown; ids?: unknown };

const stringSet = (v: unknown) => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function scopeOf(target: unknown, ruleId: string, campaignId?: string): Scope | null {
  if (typeof target !== "object" || target === null) return null;
  const t = target as TargetLike;
  if (t.kind === "products") {
    return { ruleId, campaignId, productIds: stringSet(t.productIds), variantIds: stringSet(t.variantIds), collectionIds: new Set() };
  }
  if (t.kind === "collections") {
    return { ruleId, campaignId, productIds: new Set(), variantIds: new Set(), collectionIds: stringSet(t.ids) };
  }
  return null;
}

/**
 * productId → sorted, unique rule references for every product given (an empty
 * list included, so the sync can clear a stale metafield). Every rule is indexed,
 * enabled or not: enabling a rule then needs no product metafield rewrite (the
 * engine checks `enabled`, schedule, codes…). A campaign override that patches a
 * rule's target adds campaign-scoped refs (killed campaigns never ship, so they
 * add nothing). A variant target listing every variant of a product collapses to
 * the whole-product ref.
 */
export function productRuleIndex(
  config: ReadonlyDeep<WonDiscountsConfig>,
  products: readonly ProductTargetingInput[],
): Map<string, string[]> {
  const scopes: Scope[] = [];
  for (const rule of config.modules.codes.rules) {
    const scope = scopeOf(rule.target, rule.id);
    if (scope) scopes.push(scope);
  }
  const ruleIds = new Set(config.modules.codes.rules.map((r) => r.id));
  for (const campaign of config.campaigns) {
    if (campaign.killed) continue;
    for (const override of campaign.overrides) {
      if (!ruleIds.has(override.ruleId) || !("target" in override.patch)) continue;
      const scope = scopeOf(override.patch.target, override.ruleId, campaign.id);
      if (scope) scopes.push(scope);
    }
  }

  const index = new Map<string, string[]>();
  for (const product of products) {
    const refs = new Set<string>();
    for (const scope of scopes) {
      const opts = scope.campaignId ? { campaignId: scope.campaignId } : {};
      if (scope.productIds.has(product.productId) || product.collectionIds.some((c) => scope.collectionIds.has(c))) {
        refs.add(ruleRef(scope.ruleId, opts));
        continue;
      }
      const variants = product.variantIds.filter((v) => scope.variantIds.has(v));
      if (variants.length === 0) continue;
      if (variants.length === product.variantIds.length) {
        refs.add(ruleRef(scope.ruleId, opts));
      } else {
        for (const v of variants) refs.add(ruleRef(scope.ruleId, { ...opts, variantId: v }));
      }
    }
    index.set(product.productId, [...refs].sort());
  }
  return index;
}

/**
 * The rule ids that apply to one cart line (engine side of the refs above).
 * `retargeted` = rules whose target the applied campaign patches: for those only
 * refs scoped to that campaign count, for every other rule only unscoped ones.
 */
export function lineRuleIds(
  line: { variantId: string; ruleIds: readonly string[] },
  campaignId: string | null,
  retargeted: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  if (line.ruleIds.length === 0) return out;
  const key = variantKey(line.variantId);
  for (const ref of line.ruleIds) {
    const at = ref.indexOf("@");
    const colon = ref.indexOf(":");
    if (at === -1 && colon === -1) {
      if (!retargeted.has(ref)) out.add(ref);
      continue;
    }
    const { ruleId, campaignId: scoped, variant } = parseRuleRef(ref);
    if (variant !== undefined && variant !== key) continue;
    if (retargeted.has(ruleId) ? scoped !== undefined && scoped === campaignId : scoped === undefined) out.add(ruleId);
  }
  return out;
}
