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
// Margin protection (MVP 2): `marginRefs` = the numeric ids (the payload's
// margin `col` keys) of the product's DECISIVE margin collections, at most 2
// (only while protection is on; drift audit P1, ruling 1): among the product's
// collections with a margin setting, the one with the highest minimum margin
// and the one with the lowest maximum discount, each compared by the value it
// EFFECTIVELY has — a field a collection leaves empty is the global value
// (resolveMargin), which can be the strictest. Ties: a collection strictest on
// both (then 1 ref), else the smaller numeric id. `resolveMargin` over them is
// exactly `resolveMargin` over all of the product's collections (max m, min p
// over a subset that holds a maximiser and a minimiser; tests/discounts/
// margin-refs.test.ts), and every checkout run reads ≤ 2 refs per line instead
// of one per collection (the function's instruction limit). They depend on the
// VALUES, not only on membership: a value change can move them, so the sync
// writes them like any other targeting change. They are NEVER dropped over the
// budget: without them the product would fall back to the global setting,
// possibly a larger discount than its collection allows. Dropping rule refs
// only ever means less discount (fail closed).
//
// Quantity tiers (MVP 3, contracts K1/K3): `tierRef` = the id of the scoped
// tier set that applies to the product (the first set listing the product,
// else the first listing one of its collections, config order — tiers.ts
// scopedTierSetResolver); absent = the global set applies. Like `marginRefs`
// it is NEVER dropped over the budget: without it the product would get the
// global set, possibly more than its own set gives. A set with no breaks (a
// Pro set on Free, plan-gate.ts) still claims its products: they get no tier.
//
// A reference is one string (rule and campaign ids are `[A-Za-z0-9_-]`, so "@"
// and "#" are safe separators):
//   "ruleId"                        always
//   "ruleId@<campaign>"             only while that campaign re-targets the rule
//   "<either of those>#<key>:<min>" the product is in the rule through an item
//                                   that has its OWN minimum quantity (below)
// Order and shipping rules are never listed: they apply to every line.
//
// Per-item minimum (Pro, plan 2026-10-06 bod 8; `target.itemMinimums`). The
// minimum travels in the ref, so it costs the shared config's 9 000 B nothing
// and the function needs neither collection memberships nor product ids:
//   - `key` = the tail of the item's GID (variantKey): the product's own number
//     for a products target, the collection's for a collections target;
//   - `min` = the item's minimum, 1–6 digits;
//   - the text before the last ":" (`ruleId[@campaign]#key`) is the GROUP: every
//     cart line whose refs name the same group counts toward it together — the
//     lines of one product (its variants together), or of one collection.
// A product listed through an item WITHOUT its own minimum gets the plain ref
// (the rule's common minimum applies). A product in two targeted collections
// gets one ref per collection (plain or with a minimum), so the engine can let
// it qualify through ANY of them (plan.ts "Per-item minimum").
// Cost: 3 + key + min characters a ref (≤ 22 B with a 13-digit id) in THAT
// product's metafield, which has its own 9 000 B budget; over it the longest
// refs go first, which only ever means less discount (a dropped item ref stops
// the product counting toward its group; a dropped plain ref leaves it its
// item minimum).
// Consistency: like every targeting change, a changed minimum is in force for a
// product once its metafield is rewritten (the sync does it with the config).

import { variantKey } from "./cart.ts";
import type { ReadonlyDeep, WonDiscountsConfig } from "./config.ts";
import { buildMarginPayload, type FunctionMarginPayload, marginCollectionIds } from "./margin.ts";
import { scopedTierSetResolver } from "./tiers.ts";

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

/** The rule (and campaign) a ref names; an item ref's `#key:min` tail is not part of either. */
export function parseRuleRef(ref: string): RuleRefParts {
  const hash = ref.indexOf("#");
  const base = hash === -1 ? ref : ref.slice(0, hash);
  const at = base.indexOf("@");
  return at === -1 ? { ruleId: base } : { ruleId: base.slice(0, at), campaignId: base.slice(at + 1) };
}

/** `base#key:min` — the ref of a product listed through an item with its own minimum quantity. */
export function itemRef(base: string, key: string, minimum: number): string {
  return `${base}#${key}:${minimum}`;
}

export interface ItemRefParts {
  /** The plain ref before "#": `ruleId` or `ruleId@<campaign>`. */
  base: string;
  /** `base#key`: the lines naming it count together. */
  group: string;
  /** The tail of the item's GID. */
  key: string;
  minimum: number;
}

const ITEM_MIN_RE = /^[0-9]{1,6}$/;

/**
 * An item ref's parts (the Rust function parses the same way, plan.rs
 * `item_of`): the text has a "#"; after its FIRST "#" comes a non-empty key,
 * the LAST ":" and 1–6 ASCII digits making a number ≥ 1. A text with a "#"
 * that is not exactly that is no ref at all (null: it names no rule).
 */
export function parseItemRef(ref: string): ItemRefParts | null {
  const hash = ref.indexOf("#");
  if (hash === -1) return null;
  const colon = ref.lastIndexOf(":");
  if (colon <= hash + 1) return null;
  const digits = ref.slice(colon + 1);
  if (!ITEM_MIN_RE.test(digits)) return null;
  const minimum = Number(digits);
  if (minimum < 1) return null;
  return { base: ref.slice(0, hash), group: ref.slice(0, colon), key: ref.slice(hash + 1, colon), minimum };
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
   * Numeric ids (variantKey of the GID) of the product's DECISIVE margin
   * collections (≤ 2, see `decisiveMarginRefs`), sorted; absent when none (or
   * margin protection is off).
   */
  marginRefs?: string[];
  /**
   * MVP 3 (contract K1/K3): the id of the Pro tier set that applies to this
   * product — the first set listing the product, else the first listing one of
   * its collections. Absent = the global set applies. The engine gives a line
   * whose `tierRef` names a set the payload does not have no tier at all.
   * Never dropped over the budget (see the header).
   */
  tierRef?: string;
}

export interface ProductRuleEntry extends ProductMetafieldValue {
  /**
   * Present only when the product went over PRODUCT_METAFIELD_BUDGET_BYTES and
   * the value above was reduced to fit. `bytes` = size before; refs in
   * `collapsedRefs` now apply product-wide (they covered every current variant;
   * a variant added later inherits them until the product is re-indexed); refs in
   * `droppedRefs` no longer apply to this product at all. The sync must surface
   * both to the merchant. `marginRefs` and `tierRef` are never dropped.
   */
  oversized?: { bytes: number; collapsedRefs: string[]; droppedRefs: string[] };
}

/** Exactly what to write to the product metafield (never the `oversized` report). */
export function productMetafieldValue(entry: ProductMetafieldValue): ProductMetafieldValue {
  return {
    ruleIds: entry.ruleIds,
    variantRuleIds: entry.variantRuleIds,
    ...(entry.marginRefs && entry.marginRefs.length > 0 ? { marginRefs: entry.marginRefs } : {}),
    ...(entry.tierRef ? { tierRef: entry.tierRef } : {}),
  };
}

const utf8Bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

/** What never leaves a product's value over the budget (see the header). */
interface KeptRefs {
  marginRefs: readonly string[];
  tierRef: string | undefined;
}

function toValue(
  whole: ReadonlySet<string>,
  perVariant: ReadonlyMap<string, ReadonlySet<string>>,
  kept: KeptRefs,
): ProductMetafieldValue {
  const variantRuleIds: Record<string, string[]> = {};
  for (const key of [...perVariant.keys()].sort()) {
    const refs = [...perVariant.get(key)!].filter((ref) => !whole.has(ref)).sort();
    if (refs.length > 0) variantRuleIds[key] = refs;
  }
  return {
    ruleIds: [...whole].sort(),
    variantRuleIds,
    ...(kept.marginRefs.length > 0 ? { marginRefs: [...kept.marginRefs] } : {}),
    ...(kept.tierRef !== undefined ? { tierRef: kept.tierRef } : {}),
  };
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
 * ref asc); `marginRefs` and `tierRef` always stay.
 */
function fitProduct(
  whole: Set<string>,
  perVariant: Map<string, Set<string>>,
  variantCount: number,
  kept: KeptRefs,
): ProductRuleEntry {
  let value = toValue(whole, perVariant, kept);
  const bytes = utf8Bytes(value);
  if (bytes <= PRODUCT_METAFIELD_BUDGET_BYTES) return value;

  const collapsedRefs: string[] = [];
  for (const [ref, count] of variantRefCounts(perVariant, whole)) {
    if (count !== variantCount) continue;
    whole.add(ref);
    collapsedRefs.push(ref);
  }
  value = toValue(whole, perVariant, kept);
  const droppedRefs: string[] = [];
  for (const [ref] of variantRefCounts(perVariant, whole)) {
    if (utf8Bytes(value) <= PRODUCT_METAFIELD_BUDGET_BYTES) break;
    for (const refs of perVariant.values()) refs.delete(ref);
    droppedRefs.push(ref);
    value = toValue(whole, perVariant, kept);
  }
  if (utf8Bytes(value) > PRODUCT_METAFIELD_BUDGET_BYTES) {
    const productWide = [...whole].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
    for (const ref of productWide) {
      if (utf8Bytes(value) <= PRODUCT_METAFIELD_BUDGET_BYTES) break;
      whole.delete(ref);
      for (const refs of perVariant.values()) refs.delete(ref);
      droppedRefs.push(ref);
      value = toValue(whole, perVariant, kept);
    }
  }
  return { ...value, oversized: { bytes, collapsedRefs: collapsedRefs.sort(), droppedRefs: droppedRefs.sort() } };
}

interface Scope {
  ref: string;
  productIds: ReadonlySet<string>;
  variantIds: ReadonlySet<string>;
  collectionIds: ReadonlySet<string>;
  /** Item GID (a product's, or a collection's) → its own minimum quantity. */
  minimums: ReadonlyMap<string, number>;
}

type TargetLike = { kind?: unknown; productIds?: unknown; variantIds?: unknown; ids?: unknown; itemMinimums?: unknown };

const stringSet = (v: unknown) => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const ITEM_KEY_RE = /^[A-Za-z0-9_-]+$/;

/** `target.itemMinimums` as a map; an entry the ref cannot carry (a key with other characters, no whole quantity ≥ 1) is not one. */
function minimumsOf(v: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(v)) return out;
  for (const item of v) {
    if (typeof item !== "object" || item === null) continue;
    const { id, quantity } = item as { id?: unknown; quantity?: unknown };
    if (typeof id !== "string" || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1 || quantity > 999_999) continue;
    if (!ITEM_KEY_RE.test(variantKey(id)) || out.has(id)) continue;
    out.set(id, quantity);
  }
  return out;
}

function scopeOf(target: unknown, ref: string): Scope | null {
  if (typeof target !== "object" || target === null) return null;
  const t = target as TargetLike;
  if (t.kind === "products") {
    return { ref, productIds: stringSet(t.productIds), variantIds: stringSet(t.variantIds), collectionIds: new Set(), minimums: minimumsOf(t.itemMinimums) };
  }
  if (t.kind === "collections") {
    return { ref, productIds: new Set(), variantIds: new Set(), collectionIds: stringSet(t.ids), minimums: minimumsOf(t.itemMinimums) };
  }
  return null;
}

/**
 * The refs one scope gives a product, product-wide: none when the scope does
 * not list it. Products target: its own minimum's ref, else the plain one.
 * Collections target: one ref per targeted collection the product is in — with
 * that collection's minimum, or the plain ref (once) for the ones without.
 */
function wholeRefs(scope: Scope, product: ProductTargetingInput): string[] {
  if (scope.productIds.has(product.productId)) return [productRef(scope, product.productId)];
  const out: string[] = [];
  for (const collectionId of product.collectionIds) {
    if (!scope.collectionIds.has(collectionId)) continue;
    const minimum = scope.minimums.get(collectionId);
    const ref = minimum === undefined ? scope.ref : itemRef(scope.ref, variantKey(collectionId), minimum);
    if (!out.includes(ref)) out.push(ref);
  }
  return out;
}

/** A products target's ref for a product (listed whole, or through its variants): with the product's own minimum when it has one. */
function productRef(scope: Scope, productId: string): string {
  const minimum = scope.minimums.get(productId);
  return minimum === undefined ? scope.ref : itemRef(scope.ref, variantKey(productId), minimum);
}

/** Numeric id order for the `col` keys (canonical digit strings): shorter first, then by digits. */
const byNumericId = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);

/**
 * The product's decisive margin collections (see the header), ≤ 2, sorted:
 * `keys` = the `col` keys of its margin collections. A key the payload does not
 * list is ignored (so does resolveMargin). Exact: `resolveMargin(payload,
 * decisive)` equals `resolveMargin(payload, keys)`, because the strictest
 * minimum over a set holding the maximiser is the maximum, and likewise the
 * maximum discount — and the set is empty only when no key has a setting.
 */
export function decisiveMarginRefs(payload: ReadonlyDeep<FunctionMarginPayload>, keys: readonly string[]): string[] {
  if (!payload.enabled || !payload.col) return [];
  const col = payload.col;
  const listed = [...new Set(keys)].filter((key) => Object.prototype.hasOwnProperty.call(col, key)).sort(byNumericId);
  if (listed.length === 0) return [];
  const globalMin = payload.min ?? 0;
  const minOf = (key: string) => col[key][0] ?? globalMin;
  const maxOf = (key: string) => col[key][1] ?? payload.max;
  const strictestMin = Math.max(...listed.map(minOf));
  const strictestMax = Math.min(...listed.map(maxOf));
  const both = listed.find((key) => minOf(key) === strictestMin && maxOf(key) === strictestMax);
  if (both !== undefined) return [both];
  const byMin = listed.find((key) => minOf(key) === strictestMin)!;
  const byMax = listed.find((key) => maxOf(key) === strictestMax)!;
  return [byMin, byMax].sort();
}

/**
 * productId → { ruleIds, variantRuleIds, marginRefs?, tierRef? } for every
 * product given (empty entries included, so the sync can clear a stale metafield).
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
  const marginPayload = buildMarginPayload(config.modules.margin);
  const tierRefOf = scopedTierSetResolver(config.modules.tiers.sets);

  const index = new Map<string, ProductRuleEntry>();
  for (const product of products) {
    const whole = new Set<string>();
    const perVariant = new Map<string, Set<string>>();
    for (const scope of scopes) {
      const listed = wholeRefs(scope, product);
      if (listed.length > 0) {
        for (const ref of listed) whole.add(ref);
        continue;
      }
      for (const variantId of product.variantIds) {
        if (!scope.variantIds.has(variantId)) continue;
        const key = variantKey(variantId);
        let refs = perVariant.get(key);
        if (!refs) perVariant.set(key, (refs = new Set()));
        // The variants of one product count together: the minimum is the product's.
        refs.add(productRef(scope, product.productId));
      }
    }
    const marginRefs =
      marginCollections.size === 0
        ? []
        : decisiveMarginRefs(marginPayload, product.collectionIds.filter((id) => marginCollections.has(id)).map(variantKey));
    const tierRef = tierRefOf(product);
    index.set(product.productId, fitProduct(whole, perVariant, new Set(product.variantIds).size, { marginRefs, tierRef }));
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
  return lineTargeting(line, campaignId, retargeted).ruleIds;
}

/** A line's part in one item group of a rule (an item ref it lists). */
export interface LineItemRef {
  ruleId: string;
  /** `ruleId[@campaign]#key` (parseItemRef): the lines naming it count together. */
  group: string;
  key: string;
  minimum: number;
}

export interface LineTargeting {
  /** Every rule that targets the line, through a plain ref or an item ref. */
  ruleIds: Set<string>;
  /** Rules the line lists by a plain ref: the rule's common minimum decides for it there. */
  plain: Set<string>;
  /** The line's item refs, each (rule, group) once, in ref order; [] for a line without any. */
  items: LineItemRef[];
}

/** The rule a plain ref (no "#") names for this run, or null. */
function plainRuleId(ref: string, campaignId: string | null, retargeted: ReadonlySet<string>): string | null {
  const at = ref.indexOf("@");
  if (at === -1) return retargeted.has(ref) ? null : ref;
  const ruleId = ref.slice(0, at);
  return retargeted.has(ruleId) && ref.slice(at + 1) === campaignId ? ruleId : null;
}

/**
 * `lineRuleIds` with the per-item minimums the refs carry (the Rust function:
 * plan.rs `line_rule_ids` + `collect_item_refs`). Ref by ref:
 *   1. a ref that names a rule as it is, is that rule's plain ref — for a text
 *      with a "#" only when the rule exists (`known`: the plan's rule ids; an
 *      id holds a "#" in a hand-made config only);
 *   2. any other text with a "#" is an item ref or nothing (parseItemRef): its
 *      base before the "#" must name an existing rule the way a plain ref
 *      does. Each (rule, group) counts once a line.
 * Without `known` every rule a base names is taken as existing, and no text
 * with a "#" is a plain ref.
 */
export function lineTargeting(
  line: { ruleIds: readonly string[] },
  campaignId: string | null,
  retargeted: ReadonlySet<string>,
  known?: { has(ruleId: string): boolean },
): LineTargeting {
  const ruleIds = new Set<string>();
  const plain = new Set<string>();
  const items: LineItemRef[] = [];
  for (const ref of line.ruleIds) {
    const direct = plainRuleId(ref, campaignId, retargeted);
    if (!ref.includes("#")) {
      if (direct === null) continue;
      ruleIds.add(direct);
      plain.add(direct);
      continue;
    }
    if (direct !== null && known?.has(direct) === true) {
      ruleIds.add(direct);
      plain.add(direct);
      continue;
    }
    const item = parseItemRef(ref);
    const ruleId = item ? plainRuleId(item.base, campaignId, retargeted) : null;
    if (!item || ruleId === null || known?.has(ruleId) === false) continue;
    ruleIds.add(ruleId);
    if (!items.some((x) => x.ruleId === ruleId && x.group === item.group)) items.push({ ruleId, group: item.group, key: item.key, minimum: item.minimum });
  }
  return { ruleIds, plain, items };
}
