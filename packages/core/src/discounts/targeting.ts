// Precomputed targeting (plan T3, spec §1 C3): which product/collection rules
// apply to which product or variant. The sync layer writes `productRuleIndex`
// into each product's `$app:won_discounts` metafield as
//   productMetafieldValue(entry) = { ruleIds: [...], variantRuleIds: { "<variant numeric id>": [...] } }
// and the function passes both to the engine per cart line (CartLineInput). The
// function never needs collection slots in its input query and the rules' id
// lists never reach the 9 000 B config budget.
//
// The product metafield has the same silent 10 000 B limit as the shop config
// (over it the function reads `null`, and EVERY Won product discount on that
// product disappears). So each product value is kept under
// PRODUCT_METAFIELD_BUDGET_BYTES: variant keys are the short numeric ids, and an
// over-budget product first collapses variant refs that cover every current
// variant (equivalent today), then drops the largest variant-level refs until it
// fits, then (only if still over) product-wide refs, longest first — failing
// closed for those rules on that product only — and says so in
// `entry.oversized` for the sync to surface.
//
// Margin protection (MVP 2): `marginRefs` = the numeric ids of the product's
// collections that have a margin setting (only while protection is on; the
// payload's margin `col` is keyed by the same ids). They are NEVER dropped over
// the budget: without them the product would fall back to the global setting,
// possibly a larger discount than its collection allows. Dropping rule refs
// only ever means less discount (fail closed).
//
// A reference is one string (rule and campaign ids are `[A-Za-z0-9_-]`, so "@"
// is a safe separator):
//   "ruleId"             always
//   "ruleId@<campaign>"  only while that campaign re-targets the rule
// Order and shipping rules are never listed: they apply to every line.

import { variantKey } from "./cart.ts";
import type { ReadonlyDeep, WonDiscountsConfig } from "./config.ts";
import { marginCollectionIds } from "./margin.ts";

export { variantKey };

/** Per-product metafield budget: ~10 % under the 10 000 B the function reads (C3/C7). */
export const PRODUCT_METAFIELD_BUDGET_BYTES = 9000;

export interface RuleRefParts {
  ruleId: string;
  campaignId?: string;
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

/** The value written to the product metafield (sorted, unique lists; only variants that have refs). */
export interface ProductMetafieldValue {
  ruleIds: string[];
  /** Keyed by the variant's numeric id (variantKey). */
  variantRuleIds: Record<string, string[]>;
  /**
   * Numeric ids (variantKey of the GID) of the product's collections that have
   * a margin setting, sorted; absent when none (or margin protection is off).
   */
  marginRefs?: string[];
}

export interface ProductRuleEntry extends ProductMetafieldValue {
  /**
   * Present only when the product went over PRODUCT_METAFIELD_BUDGET_BYTES and
   * the value above was reduced to fit. `bytes` = size before; refs in
   * `collapsedRefs` now apply product-wide (they covered every current variant;
   * a variant added later inherits them until the product is re-indexed); refs in
   * `droppedRefs` no longer apply to this product at all. The sync must surface
   * both to the merchant. `marginRefs` are never dropped.
   */
  oversized?: { bytes: number; collapsedRefs: string[]; droppedRefs: string[] };
}

/** Exactly what to write to the product metafield (never the `oversized` report). */
export function productMetafieldValue(entry: ProductMetafieldValue): ProductMetafieldValue {
  return {
    ruleIds: entry.ruleIds,
    variantRuleIds: entry.variantRuleIds,
    ...(entry.marginRefs && entry.marginRefs.length > 0 ? { marginRefs: entry.marginRefs } : {}),
  };
}

const utf8Bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

function toValue(
  whole: ReadonlySet<string>,
  perVariant: ReadonlyMap<string, ReadonlySet<string>>,
  marginRefs: readonly string[],
): ProductMetafieldValue {
  const variantRuleIds: Record<string, string[]> = {};
  for (const key of [...perVariant.keys()].sort()) {
    const refs = [...perVariant.get(key)!].filter((ref) => !whole.has(ref)).sort();
    if (refs.length > 0) variantRuleIds[key] = refs;
  }
  return { ruleIds: [...whole].sort(), variantRuleIds, ...(marginRefs.length > 0 ? { marginRefs: [...marginRefs] } : {}) };
}

/** Variant count per variant-level ref, largest first (ties: ref asc). */
function variantRefCounts(perVariant: ReadonlyMap<string, ReadonlySet<string>>, whole: ReadonlySet<string>): [string, number][] {
  const counts = new Map<string, number>();
  for (const refs of perVariant.values()) for (const ref of refs) if (!whole.has(ref)) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * Fit one product under the budget (see the header): collapse equivalents, drop
 * the largest variant-level refs, then product-wide refs (longest first, ties
 * ref asc); `marginRefs` always stay.
 */
function fitProduct(
  whole: Set<string>,
  perVariant: Map<string, Set<string>>,
  variantCount: number,
  marginRefs: readonly string[],
): ProductRuleEntry {
  let value = toValue(whole, perVariant, marginRefs);
  const bytes = utf8Bytes(value);
  if (bytes <= PRODUCT_METAFIELD_BUDGET_BYTES) return value;

  const collapsedRefs: string[] = [];
  for (const [ref, count] of variantRefCounts(perVariant, whole)) {
    if (count !== variantCount) continue;
    whole.add(ref);
    collapsedRefs.push(ref);
  }
  value = toValue(whole, perVariant, marginRefs);
  const droppedRefs: string[] = [];
  for (const [ref] of variantRefCounts(perVariant, whole)) {
    if (utf8Bytes(value) <= PRODUCT_METAFIELD_BUDGET_BYTES) break;
    for (const refs of perVariant.values()) refs.delete(ref);
    droppedRefs.push(ref);
    value = toValue(whole, perVariant, marginRefs);
  }
  if (utf8Bytes(value) > PRODUCT_METAFIELD_BUDGET_BYTES) {
    const productWide = [...whole].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
    for (const ref of productWide) {
      if (utf8Bytes(value) <= PRODUCT_METAFIELD_BUDGET_BYTES) break;
      whole.delete(ref);
      for (const refs of perVariant.values()) refs.delete(ref);
      droppedRefs.push(ref);
      value = toValue(whole, perVariant, marginRefs);
    }
  }
  return { ...value, oversized: { bytes, collapsedRefs: collapsedRefs.sort(), droppedRefs: droppedRefs.sort() } };
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
 * productId → { ruleIds, variantRuleIds, marginRefs? } for every product given
 * (empty entries included, so the sync can clear a stale metafield).
 *  - Every rule is indexed, enabled or not: enabling a rule then needs no product
 *    metafield rewrite (the engine checks `enabled`, schedule, codes…).
 *  - A variant target is listed per variant (keyed by numeric id) and not
 *    collapsed to the product even when every current variant is listed — a
 *    variant added later must not inherit the discount — unless the product is
 *    over PRODUCT_METAFIELD_BUDGET_BYTES (then see `oversized`).
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
  const marginCollections = new Set(marginCollectionIds(config.modules.margin));

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
        const key = variantKey(variantId);
        let refs = perVariant.get(key);
        if (!refs) perVariant.set(key, (refs = new Set()));
        refs.add(scope.ref);
      }
    }
    const marginRefs =
      marginCollections.size === 0
        ? []
        : [...new Set(product.collectionIds.filter((id) => marginCollections.has(id)).map(variantKey))].sort();
    index.set(product.productId, fitProduct(whole, perVariant, new Set(product.variantIds).size, marginRefs));
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
