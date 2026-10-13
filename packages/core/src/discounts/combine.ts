// Combining discounts by type (docs/won-discounts/navrh-kombinace-2026-10-13.md, decided 13 Oct 2026).
//
// Every discount has a TYPE, as the merchant knows it, and a LIST of the types it adds up with:
//
//   automatic   a discount from the editor without a code, on products or on the order
//   code        a discount from the editor with a code, on products or on the order
//   shipping    a discount from the editor on shipping (with a code or not), and the free shipping of Milníky
//   tiers       every quantity tier set
//   rewards     Milníky: the gift, and the order discount of a step
//   outlet      a line on sale
//
// A discount from the editor has exactly one type; shipping wins over "with a code". Its list is on the rule
// (`rule.combine`). The three modules have one list each (`modules.<module>.combine`): the free shipping and
// the order discount of Milníky follow the Milníky list, whatever their type.
//
// THE RULE (the port spec of the Rust function's `combine.rs`). For two discounts A and B:
//   A allows B   when A's list has B's type, or A names B as an exception (`combine.rules`, Pro; a rule names
//                a rule only);
//   A and B add up only when A allows B AND B allows A. Otherwise the customer gets the better of them.
// Two things never add up, whatever the lists say: two order discounts of Milníky (one ladder: the higher
// step replaces the lower), and two shipping discounts (there is one delivery to discount).
// Two DIFFERENT rewards of Milníky (the gift, the free shipping, the order discount) are steps of one ladder:
// they add up when the Milníky list has "rewards" (Milníky with each other), whatever else it has.
//
// Where the rule is asked (plan.ts is the port spec of each stage):
//   - on one line: its product discounts and its quantity tier — the stack is a set in which every two add up;
//   - on the order: its order discounts, the same way;
//   - an order discount next to the product discounts and tiers the cart got (plan.ts planOrderStage);
//   - a shipping discount next to everything the cart got (planShipping);
//   - the gift next to everything the cart got (plan-rewards.ts);
//   - a line on sale under the shop's rule (the variant flag `true`) and a product discount, a tier or an order
//     discount: the line takes it only when the two add up. Shipping and the gift are not discounts of the
//     line's price, so a sale line never stands in their way; a sale with its own list (a numeric flag)
//     follows that list alone, as before.
//
// A list is stored as type names and shipped to the function as one number, the sum of COMBINE_BIT.

import { isMilestoneRule } from "./milestones.ts";

export const COMBINE_TYPES = ["automatic", "code", "shipping", "tiers", "rewards", "outlet"] as const;
export type CombineType = (typeof COMBINE_TYPES)[number];

/** A module's list: the types its discounts add up with. */
export interface CombineSetting {
  types: CombineType[];
}

/** A rule's list, and (Pro) the rules it adds up with although their type is not in the list. Exceptions only allow. */
export interface RuleCombine extends CombineSetting {
  rules?: string[];
}

/** The modules that have one list for all their discounts. */
export const COMBINE_MODULES = ["tiers", "rewards", "outlet"] as const;
export type CombineModule = (typeof COMBINE_MODULES)[number];

export const COMBINE_BIT: Readonly<Record<CombineType, number>> = { automatic: 1, code: 2, shipping: 4, tiers: 8, rewards: 16, outlet: 32 };
export const COMBINE_ALL = 63;

/** A list as the function reads it. */
export function combineMask(types: readonly string[] | undefined | null): number {
  let mask = 0;
  for (const type of types ?? []) mask |= COMBINE_BIT[type as CombineType] ?? 0;
  return mask;
}

/** The types of a mask, in the order of COMBINE_TYPES (the order of the checkboxes). */
export function combineTypesOf(mask: number): CombineType[] {
  return COMBINE_TYPES.filter((type) => (mask & COMBINE_BIT[type]) !== 0);
}

/** A stored list: known types only, each once, in the order of COMBINE_TYPES. */
export function normalizeCombineTypes(value: unknown): CombineType[] {
  return Array.isArray(value) ? combineTypesOf(combineMask(value.filter((v): v is string => typeof v === "string"))) : [];
}

type RuleLike = { id: string; method: string; value: { kind: string }; target: { kind: string } };

/** A shipping discount: free shipping, or any value aimed at shipping. */
export function isShippingRule(rule: Pick<RuleLike, "value" | "target">): boolean {
  return rule.value.kind === "freeShipping" || rule.target.kind === "shipping";
}

/** The type of a discount rule. An order discount of Milníky is "rewards"; shipping wins over "with a code". */
export function combineTypeOfRule(rule: RuleLike): CombineType {
  if (isMilestoneRule(rule as Parameters<typeof isMilestoneRule>[0])) return "rewards";
  if (isShippingRule(rule)) return "shipping";
  return rule.method === "code" ? "code" : "automatic";
}

/** One side of the rule: what the discount is, and what it allows. */
export interface CombineSide {
  id: string;
  /** COMBINE_BIT of its type. */
  bit: number;
  /** Its list (its module's list for a module's discount). */
  mask: number;
  /** Rule ids it names as exceptions; empty for a module's discount. */
  except: readonly string[];
  /** A reward of Milníky, and which one: they follow the Milníky list's own type among themselves. */
  reward?: "gift" | "shipping" | "discount";
}

export function allows(a: CombineSide, b: CombineSide): boolean {
  return (a.mask & b.bit) !== 0 || (a.except.length > 0 && a.except.includes(b.id));
}

/** THE RULE: both allow the other. */
export function addUp(a: CombineSide, b: CombineSide): boolean {
  if (a.reward && b.reward) return a.reward !== b.reward && (a.mask & COMBINE_BIT.rewards) !== 0;
  if (a.bit === COMBINE_BIT.shipping && b.bit === COMBINE_BIT.shipping) return false;
  return allows(a, b) && allows(b, a);
}
