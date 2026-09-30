// planCart internals shared by plan.ts and plan-margin.ts — NOT a public API
// (these shapes change with the engine). They live in their own module so that
// plan-margin.ts needs no runtime import from plan.ts: plan.ts → plan-margin.ts
// → plan-internal.ts, with only type imports pointing back at plan.ts.

import type { NormalizedLine, PlanLocale } from "./cart.ts";
import type { DiscountMethod } from "./config.ts";
import { type DescribableRule, describeRule } from "./describe.ts";
import type { MarginBasis, MarginSettings } from "./margin.ts";
import type { DiscountClass, EmittedValue, PlanLineMarginCap, PlanModule, PlanStack, RuleOutcome, RuleState } from "./plan.ts";

export type ValueKind = "percentage" | "fixed" | "freeShipping";

export interface Rule {
  id: string;
  name: string;
  method: DiscountMethod;
  /** "codes" for a discount rule; "tiers" for a tier set's candidate (plan-tiers.ts, id `tier:<setId>`). */
  module: PlanModule;
  enabled: boolean;
  cls: DiscountClass;
  valueKind: ValueKind;
  percent: number;
  /** Fixed amount in the cart currency; null = no value for it. */
  fixed: number | null;
  priority: number;
  codeHashes: string[];
  minSubtotal: number | null;
  minSubtotalMissing: boolean;
  minQuantity: number;
  /** The minimum counts only the lines the rule targets (scope "entitled"). */
  minEntitled: boolean;
  scheduled: boolean;
  /** Scheduled, but the payload's schedule is not a pair of valid shop days: never live. */
  scheduleInvalid: boolean;
  startsOn: string | null;
  endsOn: string | null;
  markets: string[] | null;
  segmentTargeted: boolean;
  /** Pro combinesWith as written on this rule (the relation is made symmetric in partnersOf). */
  combines: string[];
  describable: DescribableRule;
  // evaluation
  state: RuleState | null; // null = eligible so far
  missing?: RuleOutcome["missing"];
  hadCandidate: boolean;
  lostTo: string[];
  dropped: boolean;
  /** Margin protection took one of its winning (or stacked) contributions to 0. */
  marginFloored: boolean;
}

export interface Candidate {
  rule: Rule;
  amount: number;
  /**
   * A tier candidate's own value and message on its line (the break it
   * reached there); absent for a rule, whose value and label come from the rule.
   */
  value?: EmittedValue;
  label?: string;
}

export interface WorkLine {
  line: NormalizedLine;
  excluded: "outlet" | "gift" | null;
  ruleSet: Set<string>;
  product: PlanStack | null;
  /** Margin on: the floor of a discountable line; null when margin is off or the line is excluded. */
  floor: LineFloor | null;
  marginCapped?: PlanLineMarginCap;
  /** Margin on: the output must emit this line's product discount exactly (markTightLines). */
  marginTight?: true;
  /** The line's tier candidate (plan-tiers.ts), null when its set gives it nothing. */
  tier: Candidate | null;
}

export interface LineFloor {
  floorUnit: number;
  basis: MarginBasis;
  settings: MarginSettings;
}

export interface StackContext {
  byId: Map<string, Rule>;
  partners: Map<string, Set<string>>;
  locale: PlanLocale;
  currency: string;
}

/**
 * Owner of a stack (whose node emits it): among the CODE components when there
 * is one — so the code shows as applied and Shopify counts its use — else among
 * all; highest priority, then id asc. (A stack is only ever of one class.)
 */
export function ownerOf(components: Candidate[]): Rule {
  const codes = components.filter((c) => c.rule.method === "code");
  const pool = codes.length > 0 ? codes : components;
  let owner = pool[0].rule;
  for (const { rule } of pool) {
    if (rule.priority > owner.priority || (rule.priority === owner.priority && rule.id < owner.id)) owner = rule;
  }
  return owner;
}

export function label(rule: Rule, locale: PlanLocale, currency: string): string {
  return rule.name || describeRule(rule.describable, locale, currency, { short: true });
}

/** A candidate's message: its own (a tier's break) or its rule's label. */
export function candidateLabel(c: Candidate, locale: PlanLocale, currency: string): string {
  return c.label ?? label(c.rule, locale, currency);
}

export function orderAmount(rule: Rule, base: number): number {
  if (rule.valueKind === "percentage") return Math.round((base * rule.percent) / 100);
  if (rule.valueKind === "fixed" && rule.fixed !== null) return Math.min(rule.fixed, base);
  return 0;
}
