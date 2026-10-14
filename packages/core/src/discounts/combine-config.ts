// Combining discounts, read from a stored config (schema 2) — for the admin: which discounts a shop has, which
// two can meet in a cart, where the two sides disagree (a mismatch), and what a new discount starts with.
// The rule itself is combine.ts; the checkout engine (plan.ts) reads the same lists from the function payload.

import { addUp, allows, COMBINE_BIT, COMBINE_ENTITY, type CombineModule, type CombineSide, COMBINE_TYPES, type CombineType, combineMask, combineTypeOfRule, isShippingRule, normalizeCombineTypes } from "./combine.ts";
import type { DiscountRule, ReadonlyDeep, WonDiscountsConfig } from "./config/types.ts";
import { isMilestoneRule } from "./milestones.ts";

export { COMBINE_ENTITY };

type Config = ReadonlyDeep<WonDiscountsConfig>;

/** Whose list a discount follows: a rule its own, a module's discount its module's. */
export type CombineOwner = "rule" | CombineModule;

/** One discount of the shop, as the rule sees it. */
export interface CombineEntity {
  /** A rule id, or one of COMBINE_ENTITY. */
  id: string;
  owner: CombineOwner;
  type: CombineType;
  /** The list it follows. */
  types: CombineType[];
  /** Its exceptions (a rule only). */
  rules: string[];
  /** What it discounts: a line's price, the order, shipping; the gift; a line on sale. */
  cls: "product" | "order" | "shipping" | "gift" | "outlet";
  /** A reward of Milníky, and which one. */
  reward?: "gift" | "shipping" | "discount";
  /** The rule, for a rule and for an order discount of Milníky. */
  rule?: ReadonlyDeep<DiscountRule>;
}

const clsOfRule = (rule: ReadonlyDeep<Pick<DiscountRule, "value" | "target">>) => (isShippingRule(rule) ? "shipping" : rule.target.kind === "order" ? "order" : "product");

/**
 * Every discount of the config that can take part: each rule (off or on — it can be turned on), the tier sets
 * as one, the gift tiers as one, the free shipping of Milníky, and a line on sale (always: the sales are not in
 * the config).
 */
export function combineEntities(config: Config): CombineEntity[] {
  const { codes, tiers, rewards, outlet } = config.modules;
  const out: CombineEntity[] = [];
  for (const rule of codes.rules) {
    const cls = clsOfRule(rule);
    if (isMilestoneRule(rule)) out.push({ id: rule.id, owner: "rewards", type: "rewards", types: [...rewards.combine.types], rules: [], cls, reward: "discount", rule });
    else out.push({ id: rule.id, owner: "rule", type: combineTypeOfRule(rule), types: [...(rule.combine?.types ?? [])], rules: [...(rule.combine?.rules ?? [])], cls, rule });
  }
  if (tiers.sets.length > 0) out.push({ id: COMBINE_ENTITY.tiers, owner: "tiers", type: "tiers", types: [...tiers.combine.types], rules: [], cls: "product" });
  if (rewards.gifts.length > 0) out.push({ id: COMBINE_ENTITY.gift, owner: "rewards", type: "rewards", types: [...rewards.combine.types], rules: [], cls: "gift", reward: "gift" });
  if (rewards.freeShipping) out.push({ id: COMBINE_ENTITY.shipping, owner: "rewards", type: "shipping", types: [...rewards.combine.types], rules: [], cls: "shipping", reward: "shipping" });
  out.push({ id: COMBINE_ENTITY.outlet, owner: "outlet", type: "outlet", types: [...outlet.combine.types], rules: [], cls: "outlet" });
  return out;
}

export function combineSideOf(entity: Pick<CombineEntity, "id" | "type" | "types" | "rules" | "reward">): CombineSide {
  return { id: entity.id, bit: COMBINE_BIT[entity.type], mask: combineMask(entity.types), except: entity.rules, ...(entity.reward ? { reward: entity.reward } : {}) };
}

/**
 * Can the two be in one cart so that adding them up means something? Not: two shipping discounts (one delivery),
 * two rewards of Milníky of one kind (one ladder), a line on sale with a shipping discount or a gift (they are
 * not discounts of its price: they always apply).
 */
export function combineMeets(a: Pick<CombineEntity, "cls" | "reward">, b: Pick<CombineEntity, "cls" | "reward">): boolean {
  if (a.reward && b.reward) return a.reward !== b.reward;
  if (a.cls === "outlet" || b.cls === "outlet") {
    const other = a.cls === "outlet" ? b : a;
    return other.cls === "product" || other.cls === "order";
  }
  return !(a.cls === "shipping" && b.cls === "shipping");
}

/** Do the two add up (combine.ts THE RULE)? false for two that never meet. */
export function combineAddUp(a: CombineEntity, b: CombineEntity): boolean {
  return combineMeets(a, b) && addUp(combineSideOf(a), combineSideOf(b));
}

/** One side allows the other and the other does not: at the checkout the two do NOT add up. */
export interface CombineMismatch {
  /** The entity that allows. */
  allowing: string;
  /** The entity that does not. */
  refusing: string;
}

/**
 * Every pair that can meet where exactly one side allows the other — from the config alone, so it shows right
 * after a save. Two rewards of Milníky never mismatch (they read one value of one list).
 */
export function combineMismatches(config: Config): CombineMismatch[] {
  const entities = combineEntities(config);
  const sides = entities.map(combineSideOf);
  const out: CombineMismatch[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      if ((entities[i].reward && entities[j].reward) || !combineMeets(entities[i], entities[j])) continue;
      const ij = allows(sides[i], sides[j]);
      const ji = allows(sides[j], sides[i]);
      if (ij === ji) continue;
      out.push(ij ? { allowing: entities[i].id, refusing: entities[j].id } : { allowing: entities[j].id, refusing: entities[i].id });
    }
  }
  return out;
}

/** One discount that allows others which do not allow it back: the finding, once per discount (navrh-kombinace, "Neshoda"). */
export interface CombineMismatchGroup {
  allowing: CombineEntity;
  /** In the config's order. */
  refusing: CombineEntity[];
}

/** combineMismatches grouped by the side that allows, in the order of the shop's discounts. */
export function combineMismatchGroups(config: Config): CombineMismatchGroup[] {
  const entities = combineEntities(config);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const groups = new Map<string, CombineEntity[]>();
  for (const m of combineMismatches(config)) groups.set(m.allowing, [...(groups.get(m.allowing) ?? []), byId.get(m.refusing)!]);
  return entities.filter((e) => groups.has(e.id)).map((allowing) => ({ allowing, refusing: groups.get(allowing.id)! }));
}

/** The ids of every discount in some mismatch, either side (the red dots). */
export function combineMismatchIds(config: Config): Set<string> {
  const out = new Set<string>();
  for (const m of combineMismatches(config)) {
    out.add(m.allowing);
    out.add(m.refusing);
  }
  return out;
}

/** Whose list an entity follows, as a key of COMBINE_OFFERED. */
function offeredKeyOf(entity: CombineEntity): keyof typeof COMBINE_OFFERED {
  return entity.owner === "rule" ? (entity.type as "automatic" | "code" | "shipping") : entity.owner;
}

/**
 * Sets one mismatch straight in one save (the buttons of the finding):
 *  - "allow": every discount that refuses `allowingId` allows it too — with an exception naming it when both are
 *    rules and the plan runs exceptions (`exceptions`: only that pair changes), else with its type in their list;
 *  - "deny": `allowingId` stops allowing them — its exceptions naming them go, then the types of those still left.
 * A type added or removed changes the list for every discount of that type: the finding says so before the click.
 * Unknown id or no mismatch: the config as it is.
 */
export function fixCombineMismatch(config: WonDiscountsConfig, allowingId: string, mode: "allow" | "deny", opts: { exceptions: boolean }): WonDiscountsConfig {
  const group = combineMismatchGroups(config).find((g) => g.allowing.id === allowingId);
  if (!group) return config;
  const next = structuredClone(config) as WonDiscountsConfig;
  const { allowing, refusing } = group;
  // Edits the list an entity follows: a rule's own, else its module's.
  const edit = (entity: CombineEntity, change: (types: CombineType[], rules: string[]) => { types: CombineType[]; rules: string[] }) => {
    if (entity.owner === "rule") {
      const rule = next.modules.codes.rules.find((r) => r.id === entity.id)!;
      const done = change([...(rule.combine?.types ?? [])], [...(rule.combine?.rules ?? [])]);
      rule.combine = { types: normalizeCombineTypes(done.types), ...(done.rules.length > 0 ? { rules: done.rules } : {}) };
    } else {
      const module = next.modules[entity.owner];
      module.combine = { types: normalizeCombineTypes(change([...module.combine.types], []).types) };
    }
  };
  if (mode === "allow") {
    for (const r of refusing) {
      const pair = opts.exceptions && r.owner === "rule" && allowing.owner === "rule";
      edit(r, (types, rules) => (pair ? { types, rules: rules.includes(allowing.id) ? rules : [...rules, allowing.id] } : { types: COMBINE_OFFERED[offeredKeyOf(r)].includes(allowing.type) ? [...types, allowing.type] : types, rules }));
    }
  } else {
    const named = new Set(refusing.map((r) => r.id));
    edit(allowing, (types, rules) => {
      const kept = rules.filter((id) => !named.has(id));
      // Still allowed through the list: the type goes.
      const viaType = new Set(refusing.filter((r) => types.includes(r.type)).map((r) => r.type));
      return { types: types.filter((t) => !viaType.has(t)), rules: kept };
    });
  }
  return next;
}

/**
 * The types a list can meaningfully name, by whose list it is — the checkboxes the admin shows. Left out is what
 * never meets (combineMeets): its own type for shipping, tiers and a sale, and a sale for a shipping discount
 * (and the other way round). The Milníky list keeps its own type: its rewards with each other.
 */
export const COMBINE_OFFERED: Readonly<Record<"automatic" | "code" | "shipping" | CombineModule, readonly CombineType[]>> = {
  automatic: COMBINE_TYPES,
  code: COMBINE_TYPES,
  shipping: ["automatic", "code", "tiers", "rewards"],
  tiers: ["automatic", "code", "shipping", "rewards", "outlet"],
  rewards: COMBINE_TYPES,
  outlet: ["automatic", "code", "tiers", "rewards"],
};

/**
 * What a NEW rule of `type` starts with, so that it starts without a mismatch: the shop's default list
 * (`engine.combineDefault`) for a price discount; for a shipping discount the mirror — every type whose own
 * list (the default for rules, a module's for its discounts) has "shipping".
 */
export function defaultCombineFor(config: Config, type: "automatic" | "code" | "shipping"): CombineType[] {
  const base = config.engine.combineDefault;
  if (type !== "shipping") return COMBINE_TYPES.filter((t) => base.includes(t));
  const { tiers, rewards } = config.modules;
  return COMBINE_OFFERED.shipping.filter((t) => (t === "tiers" ? tiers.combine.types : t === "rewards" ? rewards.combine.types : base).includes("shipping"));
}
