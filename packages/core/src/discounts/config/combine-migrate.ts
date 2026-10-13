// Schema 1 → 2 (13 Oct 2026, docs/won-discounts/navrh-kombinace-2026-10-13.md "Převod stávajících obchodů"):
// the four category switches (`engine.combination`) and `combinesWith` on a rule become lists of types and
// exceptions (combine.ts).
//
// THE GOAL: after the conversion no cart gets more than before it. The switches were by CLASS (product, order,
// shipping), the lists are by TYPE (automatic, with a code, …), so not every shop converts exactly; where it
// does not, the conversion picks the stricter side (the two do not add up) and reports the pair.
//
// How. Every discount the shop has is one ENTITY: each rule, the tier sets together, the gift tiers together,
// the free shipping of Milníky, a line on sale; a rule a campaign re-shapes (another value or target) is one
// more entity for the shape it has in that campaign. For every two entities that can meet in a cart the old
// engine says whether they added up (`before`, below). The new engine adds two up when each one's LIST has the
// other's TYPE, and every rule of one type gets the same list here, so the conversion decides 36 yes/no values
// `list of X has type Y`:
//   - two values a pair of entities reads are made EQUAL (so no pair starts as a mismatch: one side allowing,
//     the other not);
//   - a group of equal values is "yes" only when every pair that reads it added up before;
//   - a value no pair reads (the shop has no such two discounts yet) takes what the switches would have meant
//     for such a pair, the stricter reading where the classes are not known (`fallback`).
// Two rules of the same class linked by `combinesWith` added up before whatever the switches said: they become
// exceptions on BOTH rules (an exception only allows, and both sides must allow). Pro runs them; below Pro the
// plan gate takes them out, so there the pair stops adding up (decided 13 Oct 2026).
//
// What it returns besides the config: every pair that added up before and does not now (`lost`), so the admin
// can say it once.

import { COMBINE_TYPES, type CombineType, combineTypeOfRule, isShippingRule } from "../combine.ts";
import { isMilestoneRule } from "../milestones.ts";
import { sanitizeDiscountRule, sanitizeRules } from "./codes.ts";
import { sanitizeRewards } from "./rewards.ts";
import { isRecord } from "./sanitize-helpers.ts";
import { sanitizeTierSets } from "./tiers.ts";
import type { DiscountRule } from "./types.ts";

/** Ids of the entities that are not rules, as `lost` names them. */
export const COMBINE_ENTITY = { tiers: "tiers", gift: "rewards:gift", shipping: "reward:shipping", outlet: "outlet" } as const;

export interface CombineLostPair {
  /** A rule id, or one of COMBINE_ENTITY. */
  a: string;
  b: string;
  /** true = the two still add up on Pro, through an exception: only a shop below Pro loses the pair. */
  exception: boolean;
}

export interface CombineMigration {
  /** The stored value with the new fields written in (still raw: the sanitizer reads it next). */
  config: Record<string, unknown>;
  /** At most COMBINE_LOST_MAX pairs; `lostCount` says how many there are. */
  lost: CombineLostPair[];
  lostCount: number;
}

export const COMBINE_LOST_MAX = 200;

type Owner = CombineType;
type Cls = "product" | "order" | "shipping" | "gift" | "outlet";

interface Entity {
  id: string;
  /** Whose list it follows: a rule its type's (every rule of a type gets the same list), a module's discount its module's. */
  owner: Owner;
  type: CombineType;
  cls: Cls;
  reward?: "gift" | "shipping" | "discount";
  /** A rule as a campaign re-shapes it: it meets only the other entities, never its own rule. */
  variantOf?: string;
}

interface Switches {
  outletWithAnything: boolean;
  productWithOrder: boolean;
  productWithShipping: boolean;
  orderWithShipping: boolean;
}

function readSwitches(stored: Record<string, unknown>): Switches {
  const engine = isRecord(stored.engine) ? stored.engine : {};
  const c = isRecord(engine.combination) ? engine.combination : {};
  const flag = (key: keyof Switches, fallback: boolean) => (typeof c[key] === "boolean" ? (c[key] as boolean) : fallback);
  // The defaults schema 1 had.
  return {
    outletWithAnything: flag("outletWithAnything", false),
    productWithOrder: flag("productWithOrder", true),
    productWithShipping: flag("productWithShipping", true),
    orderWithShipping: flag("orderWithShipping", true),
  };
}

const clsOfRule = (rule: Pick<DiscountRule, "value" | "target">): Cls => (isShippingRule(rule) ? "shipping" : rule.target.kind === "order" ? "order" : "product");

function ruleEntity(rule: DiscountRule, variantOf?: string): Entity {
  const type = combineTypeOfRule(rule);
  const milestone = isMilestoneRule(rule);
  return { id: rule.id, owner: milestone ? "rewards" : type, type, cls: clsOfRule(rule), ...(milestone ? { reward: "discount" as const } : {}), ...(variantOf ? { variantOf } : {}) };
}

/**
 * Did the two add up under schema 1's switches? null = they never meet (or adding them up means nothing): two
 * shipping discounts, two order discounts of Milníky, a sale line and a shipping discount or a gift.
 */
function before(a: Entity, b: Entity, sw: Switches): boolean | null {
  if (a.reward && b.reward) {
    if (a.reward === b.reward) return null;
    // The gift went with everything; the order discount and the free shipping followed "order with shipping".
    return a.reward === "gift" || b.reward === "gift" ? true : sw.orderWithShipping;
  }
  if (a.cls === "outlet" || b.cls === "outlet") {
    const other = a.cls === "outlet" ? b : a;
    return other.cls === "product" || other.cls === "order" ? sw.outletWithAnything : null;
  }
  if (a.cls === "gift" || b.cls === "gift") return true;
  if (a.cls === b.cls) return a.cls === "shipping" ? null : false;
  const has = (cls: Cls) => a.cls === cls || b.cls === cls;
  if (has("product") && has("order")) return sw.productWithOrder;
  if (has("product") && has("shipping")) return sw.productWithShipping;
  return sw.orderWithShipping;
}

/** What a value no pair reads takes: the switches' meaning for such a pair, the stricter one where classes are unknown. */
function fallback(owner: Owner, type: CombineType, sw: Switches): boolean {
  const price = (t: CombineType) => t === "automatic" || t === "code";
  const pair = (x: CombineType, y: CombineType) => (owner === x && type === y) || (owner === y && type === x);
  if (owner === type) return owner === "rewards";
  if (owner === "outlet" || type === "outlet") return pair("outlet", "shipping") ? false : sw.outletWithAnything;
  if (owner === "rewards" || type === "rewards") return true;
  if (price(owner) && price(type)) return false;
  if (pair("automatic", "tiers") || pair("code", "tiers")) return false;
  if (pair("tiers", "shipping")) return sw.productWithShipping;
  return sw.productWithShipping && sw.orderWithShipping; // a price discount and shipping
}

const varOf = (owner: Owner, type: CombineType) => COMBINE_TYPES.indexOf(owner) * COMBINE_TYPES.length + COMBINE_TYPES.indexOf(type);

/** The two values a pair reads. Two rewards of Milníky read one: the Milníky list's own type (combine.ts addUp). */
function varsOf(a: Entity, b: Entity): [number, number] {
  if (a.reward && b.reward) return [varOf("rewards", "rewards"), varOf("rewards", "rewards")];
  return [varOf(a.owner, b.type), varOf(b.owner, a.type)];
}

export function migrateCombineV1(stored: Record<string, unknown>): CombineMigration {
  const sw = readSwitches(stored);
  const modules = isRecord(stored.modules) ? stored.modules : {};
  const codesRaw = isRecord(modules.codes) ? modules.codes : {};
  const rawRules = Array.isArray(codesRaw.rules) ? codesRaw.rules : [];
  // The rules as the sanitizer will keep them (final ids; `aliases`: the id a rule had → the id it got).
  const { rules, aliases } = sanitizeRules(rawRules, []);
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const finalId = (raw: unknown): string | undefined => (typeof raw === "string" ? (ruleById.has(raw) ? raw : aliases.get(raw)) : undefined);
  const tiersRaw = isRecord(modules.tiers) ? modules.tiers : {};
  const hasTiers = sanitizeTierSets(tiersRaw.sets, []).sets.length > 0;
  const { rewards } = sanitizeRewards(modules.rewards, []);

  const entities: Entity[] = rules.map((rule) => ruleEntity(rule));
  if (hasTiers) entities.push({ id: COMBINE_ENTITY.tiers, owner: "tiers", type: "tiers", cls: "product" });
  if (rewards.gifts.length > 0) entities.push({ id: COMBINE_ENTITY.gift, owner: "rewards", type: "rewards", cls: "gift", reward: "gift" });
  if (rewards.freeShipping) entities.push({ id: COMBINE_ENTITY.shipping, owner: "rewards", type: "shipping", cls: "shipping", reward: "shipping" });
  // A shop's sales are not in the config: a line on sale can always come.
  entities.push({ id: COMBINE_ENTITY.outlet, owner: "outlet", type: "outlet", cls: "outlet" });
  // A rule a campaign gives another value or target may be of another class or type while the campaign runs.
  const campaigns = Array.isArray(stored.campaigns) ? stored.campaigns.filter(isRecord) : [];
  const base = entities.length;
  for (const campaign of campaigns) {
    for (const override of Array.isArray(campaign.overrides) ? campaign.overrides : []) {
      if (!isRecord(override) || !isRecord(override.patch) || !("value" in override.patch || "target" in override.patch)) continue;
      const rule = ruleById.get(finalId(override.ruleId) ?? "");
      if (!rule) continue;
      const shaped = sanitizeDiscountRule({ ...rule, ...("value" in override.patch ? { value: override.patch.value } : {}), ...("target" in override.patch ? { target: override.patch.target } : {}) }, [], "");
      if (!shaped) continue;
      const variant = ruleEntity(shaped, rule.id);
      // Its list stays the rule's own, whatever type the campaign makes of it.
      variant.owner = ruleEntity(rule).owner;
      const same = (e: Entity) => e.owner === variant.owner && e.type === variant.type && e.cls === variant.cls && e.reward === variant.reward;
      if (!same(ruleEntity(rule)) && !entities.slice(base).some((e) => e.variantOf === rule.id && same(e))) entities.push(variant);
    }
  }

  // Equal values in groups (union-find over the 36 values); a group one pair says "no" to is "no".
  const size = COMBINE_TYPES.length * COMBINE_TYPES.length;
  const parent = Array.from({ length: size }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const read = new Set<number>();
  const refused = new Set<number>();
  const pairs: { a: Entity; b: Entity; was: boolean }[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];
      if (a.variantOf === b.id || b.variantOf === a.id || (a.variantOf !== undefined && a.variantOf === b.variantOf)) continue;
      const was = before(a, b, sw);
      if (was === null) continue;
      pairs.push({ a, b, was });
      const [x, y] = varsOf(a, b);
      parent[find(x)] = find(y);
    }
  }
  for (const { a, b, was } of pairs) {
    const root = find(varsOf(a, b)[0]);
    read.add(root);
    if (!was) refused.add(root);
  }
  const has = (owner: Owner, type: CombineType): boolean => {
    const root = find(varOf(owner, type));
    return read.has(root) ? !refused.has(root) : fallback(owner, type, sw);
  };
  const listOf = (owner: Owner): CombineType[] => COMBINE_TYPES.filter((type) => has(owner, type));

  // `combinesWith` → exceptions on both rules, for the pairs the lists do not already add up.
  const linked = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);
  const linksOf = (list: unknown): string[] => (isRecord(list) && Array.isArray(list.ruleIds) ? list.ruleIds.map(finalId).filter((id): id is string => id !== undefined) : []);
  const seen = new Set<string>();
  const rawOf = new Map<string, Record<string, unknown>>();
  for (const raw of rawRules) {
    if (!isRecord(raw)) continue;
    const id = finalId(raw.id);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    rawOf.set(id, raw);
    for (const other of linksOf(raw.combinesWith)) if (other !== id) linked.add(key(id, other));
  }
  const entityOf = new Map(entities.slice(0, base).map((e) => [e.id, e]));
  const listsAddUp = (a: Entity, b: Entity): boolean => {
    const [x, y] = varsOf(a, b);
    return has(COMBINE_TYPES[Math.floor(x / COMBINE_TYPES.length)], COMBINE_TYPES[x % COMBINE_TYPES.length]) && has(COMBINE_TYPES[Math.floor(y / COMBINE_TYPES.length)], COMBINE_TYPES[y % COMBINE_TYPES.length]);
  };
  /** Before, `combinesWith` counted between two rules of one class only (product with product, order with order). */
  const linkCounted = (a: Entity, b: Entity) => !a.reward && !b.reward && a.cls === b.cls && (a.cls === "product" || a.cls === "order") && linked.has(key(a.id, b.id));
  const exceptions = new Map<string, string[]>();
  const except = (from: string, to: string) => {
    const list = exceptions.get(from);
    if (list) list.push(to);
    else exceptions.set(from, [to]);
  };
  for (const pair of linked) {
    const [idA, idB] = pair.split("\n");
    const a = entityOf.get(idA);
    const b = entityOf.get(idB);
    if (!a || !b || a.reward || b.reward) continue;
    // In every shape the two have (a campaign may re-shape either), the link must have counted or the switches allowed it.
    const shapes = (e: Entity) => [e, ...entities.slice(base).filter((v) => v.variantOf === e.id)];
    const was = shapes(a).every((sa) => shapes(b).every((sb) => (sa.cls === sb.cls && (sa.cls === "product" || sa.cls === "order")) || before(sa, sb, sw) === true));
    if (!was || listsAddUp(a, b)) continue;
    except(idA, idB);
    except(idB, idA);
  }

  // What was lost: pairs that added up before and do not by the lists now.
  const lost: CombineLostPair[] = [];
  let lostCount = 0;
  for (const { a, b, was } of pairs) {
    if (a.variantOf !== undefined || b.variantOf !== undefined) continue;
    if (!(was || linkCounted(a, b)) || listsAddUp(a, b)) continue;
    lostCount++;
    if (lost.length < COMBINE_LOST_MAX) lost.push({ a: a.id, b: b.id, exception: exceptions.get(a.id)?.includes(b.id) === true });
  }

  // Write the new fields into a copy of the stored value.
  const combineOf = (rule: DiscountRule): Record<string, unknown> => {
    const rulesExcept = exceptions.get(rule.id);
    return { types: listOf(ruleEntity(rule).owner), ...(rulesExcept ? { rules: rulesExcept } : {}) };
  };
  const outRules = rawRules.map((raw) => {
    if (!isRecord(raw)) return raw;
    const id = finalId(raw.id);
    const rule = id !== undefined && rawOf.get(id) === raw ? ruleById.get(id) : undefined;
    const { combinesWith: _dropped, ...rest } = raw;
    return rule && !isMilestoneRule(rule) ? { ...rest, combine: combineOf(rule) } : rest;
  });
  const outCampaigns = campaigns.map((campaign) => {
    if (!Array.isArray(campaign.overrides)) return campaign;
    // A patched `combinesWith` replaced the rule's list for the campaign: the rule keeps only the exceptions the
    // campaign's own links allowed too (never one the base rule did not have).
    const patchedLinks = new Map<string, Set<string>>();
    for (const override of campaign.overrides) {
      if (!isRecord(override) || !isRecord(override.patch) || !("combinesWith" in override.patch)) continue;
      const id = finalId(override.ruleId);
      if (id !== undefined) patchedLinks.set(id, new Set(linksOf(override.patch.combinesWith)));
    }
    const linkedInCampaign = (a: string, b: string): boolean => {
      const lists = (from: string, to: string) => (patchedLinks.has(from) ? patchedLinks.get(from)!.has(to) : linksOf(rawOf.get(from)?.combinesWith).includes(to));
      return lists(a, b) || lists(b, a);
    };
    return {
      ...campaign,
      overrides: campaign.overrides.map((override) => {
        if (!isRecord(override) || !isRecord(override.patch) || !("combinesWith" in override.patch)) return override;
        const { combinesWith: _dropped, ...patch } = override.patch;
        const rule = ruleById.get(finalId(override.ruleId) ?? "");
        if (!rule || isMilestoneRule(rule)) return { ...override, patch };
        const kept = (exceptions.get(rule.id) ?? []).filter((other) => linkedInCampaign(rule.id, other));
        return { ...override, patch: { ...patch, combine: { types: listOf(ruleEntity(rule).owner), ...(kept.length > 0 ? { rules: kept } : {}) } } };
      }),
    };
  });

  const engine = isRecord(stored.engine) ? stored.engine : {};
  const { combination: _combination, ...engineRest } = engine;
  const newRuleOwner: Owner = rules.some((r) => ruleEntity(r).owner === "automatic") || !rules.some((r) => ruleEntity(r).owner === "code") ? "automatic" : "code";
  const config: Record<string, unknown> = {
    ...stored,
    engine: { ...engineRest, combineDefault: listOf(newRuleOwner) },
    modules: {
      ...modules,
      codes: { ...codesRaw, rules: outRules },
      tiers: { ...tiersRaw, combine: { types: listOf("tiers") } },
      rewards: { ...(isRecord(modules.rewards) ? modules.rewards : {}), combine: { types: listOf("rewards") } },
      outlet: { ...(isRecord(modules.outlet) ? modules.outlet : {}), combine: { types: listOf("outlet") } },
    },
    ...(Array.isArray(stored.campaigns) ? { campaigns: outCampaigns } : {}),
  };
  return { config, lost, lostCount };
}
