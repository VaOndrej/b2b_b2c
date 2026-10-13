// planCart — the one discount brain (spec §3, doctrine DATA-4). A pure,
// deterministic function of (cart, shared config) that every Won node in the
// discount function, the admin "Vyzkoušet košík" and later the storefront run
// unchanged; each node then emits only its own part (emit.ts).
//
// Stages (A1 defaults, spec §3 "Deterministické pořadí"), one function each:
//   resolveRules    campaign overrides (only when the node's campaign + varsVersion
//                   match the shop config, C4/C7) → the rules as they are now;
//   matchCodes      entered codes → code rules, by hash (code-hash.ts);
//   prepareLines    a line on sale takes only what adds up with the sale
//                   (combine.ts; nothing by default), gift lines are out of
//                   everything, thresholds included; precomputed targeting per line;
//   gateRules       enabled, code entered, schedule (shop days), market
//                   (country), segment (unsupported), currency, targets,
//                   minimum (the WHOLE cart, [spec] „minimum košíku“, or the
//                   rule's own lines when its minimum scope is "entitled");
//   applyItemMinimums  (Pro, plan 2026-10-06 bod 8; "Per-item minimum" below)
//                   a product rule with per-item minimums keeps only the
//                   lines whose item reached its own minimum;
//   prepareTiers    (MVP 3, plan-tiers.ts, its header is the port spec) each
//                   line's quantity-tier candidate `tier:<setId>`: its set (K1:
//                   `tierRef`, else the global set), counted per line / product
//                   / cart over eligible lines, the highest offered break;
//   planProducts    per line the better one for the customer wins (ties:
//                   priority desc, id asc), a tier candidate competing like a
//                   rule; candidates that add up (combine.ts addUp, every two
//                   of the set) make a stack, searched among the
//                   MAX_STACK_CANDIDATES (6) best-ranked candidates of the line
//                   only (the same for the order stack);
//   applyMarginProtection  (MVP 2, only when `modules.margin` is on; the margin
//                   stages live in plan-margin.ts, the arithmetic in margin.ts)
//                   each line's product allocation capped at its headroom above
//                   the floor, the stack cut in rank order, owner recomputed;
//   planOrderStage  on the subtotal AFTER product discounts [spec], better wins
//                   [spec]; only the order discounts that add up with every
//                   product discount the cart got go next to them, else the
//                   better of "products first" and "order first" wins (its header);
//                   with margin on, protectOrder lowers it or leaves out lines
//                   at their floor, then markTightLines flags what the output
//                   must emit exactly;
//   planShipping    one winner (percent above fixed: the function knows no
//                   delivery cost) among the candidates that add up with every
//                   discount the cart got; margin protection never touches shipping;
//   buildOutcomes   per-rule and per-code states for explain/admin; per tier set
//                   its state, counting groups and the "add N more" hint.
//
// Margin protection OFF (the default, and any payload without the enabled
// compact margin) skips both margin steps: the plan is MVP 1's, decision for
// decision. It never blocks: it only lowers discounts (principle 5).
//
// Stack ownership (who emits): a stack that contains a code rule is owned by a
// CODE rule (highest priority, then id asc), so the code shows as applied in
// Shopify and its usage limit / once-per-customer is counted; otherwise the
// highest-priority rule. Known limitation: in a stack of two code rules only the
// owner's code is emitted, so Shopify counts a use of that code only; the other
// code shows `applicable: false` (explain says it applied together).
//
// Money is integer minor units of the cart currency. A currency without a value
// (fixed amount, minimum) takes the rule out of play (MKT-1, principle 6).
// Pro stack cap ([spec], MVP 2 audit round 3): a stack is searched only among
// the MAX_STACK_CANDIDATES best-ranked candidates of its target (rank = byRank:
// amount desc, priority desc, id asc). A candidate ranked 7th or lower is never
// part of a stack, even when it combines with every member; it counts as
// "outranked" (explain says a better discount won, which is true: each member
// of the stack gives more than it). This bounds the search per target: a mesh
// of Pro rules with a dozen distinct candidates on every line took the Rust
// function to 102–119 % of Shopify's instruction limit (it then gives no
// discount at all). Margin protection is unaffected: it caps what the stack
// search picked.
//
// Per-item minimum (Pro; the port spec of plan.rs `collect_item_refs` +
// `apply_item_minimums`). A
// product or collection rule may give a selected product / collection its own
// minimum quantity; each item is judged on its own (owner's decision):
//   1. A line's refs say, per rule, whether it lists the rule plainly and
//      which item groups of the rule it is in, each with that item's minimum
//      (targeting.ts lineTargeting: a ref `ruleId[@campaign]#key:min` whose
//      base names an existing rule; each (rule, group) once a line). Gift
//      lines are outside all of it.
//   2. A group's count = the quantities of every non-gift line that names it
//      (outlet lines count, as for every minimum): the pieces of one product
//      (its variants together), or of one collection, in the cart.
//   3. Only a PRODUCT-class rule some non-gift line names by an item ref is an
//      "item rule". Its common `minimum.quantity` then never fails the rule as
//      a whole: it is measured as always (the cart, or all the rule's lines
//      when "entitled") and decides for the lines that list the rule plainly.
//      Every other gate, the subtotal minimum included, is unchanged.
//   4. A line keeps an eligible item rule when it lists the rule plainly and
//      the common quantity minimum is reached, OR one of its groups of the rule
//      has a count ≥ that group's minimum. So a product in two targeted
//      collections qualifies when ANY of them does, and a product that is also
//      in a collection without its own minimum follows the common one there.
//      A line that does not keep it is not the rule's line any more.
//   5. An eligible item rule that keeps no non-gift line is `below_minimum`.
// Example: 10 % on A (from 3), B (from 4), C (no own minimum, no common one);
// cart 3×A, 1×B, 2×C → A's and C's lines get it, B's does not.
//
// Performance: O(lines × rules-per-line) + one sort per line; the stacking
// search only runs when some discount of the shop adds up with anything, over
// at most MAX_STACK_CANDIDATES candidates of a line. Margin protection of the order discount is
// O(lines²) at worst here (one pass over each candidate prefix: 200 lines ≈
// 20 000 steps); its limit is exact over at most ORDER_SEARCH_EXACT_LINES (16)
// lines tied for the minimum and a safe bound beyond (plan-margin.ts
// orderSetLimit), which is what lets the Rust function do O(lines × 16).

import { type CartPlanInput, ENTERED_CODE_PADDING, type NormalizedCart, type NormalizedLine, normalizeCart, OUTLET_ALLOW, type PlanLocale } from "./cart.ts";
import { matchesCodeBatch, readCodeBatch, type ReadCodeBatch } from "./code-batch.ts";
import { addUp, COMBINE_ALL, COMBINE_BIT, type CombineSide } from "./combine.ts";
import { codeHash } from "./code-hash.ts";
import type { DiscountMethod, DiscountRuleValue, DiscountTargetKind, MinimumScope, ReadonlyDeep, TierCountAcross } from "./config.ts";
import { CONFIG_LIMITS } from "./config/limits.ts";
import { DISCOUNT_TARGET_KINDS } from "./config/enums.ts";
import type { DescribableRule } from "./describe.ts";
import type { FunctionConfigPayload } from "./function-payload.ts";
import { type MarginBasis, type MarginSource, readMarginPayload } from "./margin.ts";
import {
  type Candidate,
  candidateLabel,
  label,
  orderAmount,
  ownerOf,
  type Rule,
  type StackContext,
  type ValueKind,
  type WorkLine,
  outOfOrder,
} from "./plan-internal.ts";
import { applyMarginProtection, computeFloors, markTightLines, protectOrder } from "./plan-margin.ts";
import { planGifts, rewardBase, rewardsProgress, SHIPPING_REWARD_ID, SHIPPING_REWARD_LABEL, shippingReward } from "./plan-rewards.ts";
import { readRewardsPayload } from "./rewards.ts";
import { prepareTiers, TIER_CANDIDATE_PREFIX, tierCandidateId, TIER_LABEL, tierHint, tierOutcomes, tierStepBreak } from "./plan-tiers.ts";
import { lineTargeting } from "./targeting.ts";
import { marketAmountsView } from "./market-amounts.ts";
import { isMilestoneRuleId } from "./milestones.ts";

export { TIER_CANDIDATE_PREFIX, tierCandidateId, TIER_LABEL, tierStepBreak };

// --- Public plan shape ------------------------------------------------------------------

export type DiscountClass = "product" | "order" | "shipping";
/** Which module produced an allocation: a discount rule, a quantity tier set (MVP 3) or a reward (MVP 4: gift, free shipping). */
export type PlanModule = "codes" | "tiers" | "rewards";

export type RuleState =
  | "applied" // its node emits (part of) the plan
  | "combined" // its value is inside a Pro stack another rule's node emits
  | "outranked" // it had something to give but a better discount won everywhere (a Pro partner ranked below MAX_STACK_CANDIDATES included)
  | "not_combinable" // it does not add up with a discount the cart got (combine.ts), and that one was better
  | "zero_value" // eligible but worth nothing here (0 %, 0 amount, empty base)
  | "disabled"
  | "code_not_entered"
  | "not_started"
  | "ended"
  | "schedule_unknown" // scheduled, but no shop date (or no shop-local schedule) to compare
  | "market" // Pro market targeting: the cart country is not in the rule's markets (or unknown)
  | "unsupported" // uses a feature the checkout cannot evaluate yet (segment targeting)
  | "currency_missing" // no amount / minimum for the cart currency (MKT-1)
  | "no_target_lines"
  | "outlet_only" // every line it targets is on outlet
  | "below_minimum"
  | "margin_floor"; // margin protection took what it had won (alone or stacked) to 0 — unless it was dropped as not combinable

/**
 * `over_limit`: first entered after the first MAX_ENTERED_CODES entries (cart.ts),
 * so never matched to a rule (its rule, if any, does not see it). A code among
 * them that cannot be a Won code (longer than every Won code, or entered with
 * more white space around it than ENTERED_CODE_PADDING allows) is `unknown`
 * (matchCodes).
 */
export type CodeState = RuleState | "same_rule" | "unknown" | "over_limit";

export { ENTERED_CODE_PADDING, MAX_ENTERED_CODES } from "./cart.ts";

export type PlanFailure = "config_missing" | "invalid_input" | "internal_error";

/**
 * What a node emits for a stack: maps 1:1 to the function's candidate value.
 * Exactly one field is set; the others are declared `undefined` so a reader can
 * test `value.percent !== undefined` without casts.
 */
export type EmittedValue =
  | { percent: number; fixedPerItem?: undefined; fixedTotal?: undefined }
  | { fixedPerItem: number; percent?: undefined; fixedTotal?: undefined }
  | { fixedTotal: number; percent?: undefined; fixedPerItem?: undefined };
export type ShippingValue =
  | { percent: number; fixedTotal?: undefined }
  | { fixedTotal: number; percent?: undefined };

export interface PlanComponent {
  /** The rule's id, or `tier:<setId>` for a quantity tier (module "tiers"). */
  ruleId: string;
  method: DiscountMethod;
  module: PlanModule;
  /** What this rule contributes, minor units (components sum to the stack amount). */
  amount: number;
}

export interface PlanStack {
  /** In rank order (amount desc, priority desc, id asc); one unless Pro stacking. */
  components: PlanComponent[];
  amount: number;
  /** The rule whose node emits this stack: a code rule when there is one, else the highest priority. */
  ownerRuleId: string;
  ownerMethod: DiscountMethod;
  value: EmittedValue;
  message: string;
}

export interface PlanLine {
  lineId: string;
  productId: string;
  variantId: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  excluded: "outlet" | "gift" | null;
  product: PlanStack | null;
  /** Set only when margin protection lowered this line's product discount. */
  marginCapped?: PlanLineMarginCap;
  /**
   * Margin on: the line's product discount must reach the checkout EXACTLY — it
   * leaves less than 1 minor unit above the floor, or the line is in the base of
   * the order discount (plan-margin.ts markTightLines). The output then never
   * relaxes a rounding tie on it to a percent (Shopify may round 1 minor unit up).
   */
  marginTight?: true;
}

/** Why and by how much margin protection lowered a line's product discount. */
export interface PlanLineMarginCap {
  /** The product discount without protection, minor units. */
  before: number;
  /** What the line gets (0 = no product discount at all). */
  after: number;
  /** The lowest price of one item, minor units (after = max(0, subtotal − floorUnit × quantity)). */
  floorUnit: number;
  /** "cost": cost + minimum margin; "max_percent": no known cost, the maximum discount % applied. */
  basis: MarginBasis;
  /** basis "cost": the minimum margin that applied. */
  minMarginPercent?: number;
  /** basis "max_percent": the ceiling that applied. */
  maxDiscountPercent?: number;
  /** "collection" when a collection's own setting applied (Pro). */
  source: MarginSource;
}

export interface PlanOrder extends PlanStack {
  /** Subtotal after product discounts of the lines the order discount is taken from (margin-excluded lines left out). */
  base: number;
  /** Outlet, gift and margin-excluded lines, in cart order (the candidate's excludedCartLineIds). */
  excludedLineIds: string[];
  /** Lines margin protection left out because they are at their floor, in cart order ([] when none). */
  marginExcludedLineIds: string[];
  /** Set only when margin protection lowered the order discount: without it, and with it. */
  marginCapped?: { before: number; after: number };
  /**
   * Margin protection is on (and this is its order discount, sized to the
   * lines' floors): every node emits it as this exact `amount`, never as a
   * percent — the order base Shopify sees grows whenever some node's product
   * output is degraded, and a percent of it could undercut a floor
   * (function-output.ts). `value` still says what the rule is (a percent over
   * fewer lines stays a percent here).
   */
  marginProtected?: true;
}

export interface PlanShipping {
  ruleId: string;
  method: DiscountMethod;
  ownerRuleId: string;
  ownerMethod: DiscountMethod;
  value: ShippingValue;
  /** Always null: the function does not know the delivery cost (see CartPlanInput). */
  amount: number | null;
  message: string;
}

/**
 * One item group of a rule with per-item minimums (plan 2026-10-06 bod 8): the
 * pieces of one selected product (products target) or collection (collections
 * target) in the cart against that item's own minimum.
 */
export interface ItemMinimumOutcome {
  /** The tail of the item's GID (its number): the product's or the collection's, by the rule's target kind. */
  key: string;
  minimum: number;
  /** Pieces of the item in the cart (non-gift lines, outlet included). */
  count: number;
  reached: boolean;
  /** The cart lines that count toward it, cart order. */
  lineIds: string[];
}

export interface RuleOutcome {
  ruleId: string;
  name: string;
  method: DiscountMethod;
  discountClass: DiscountClass;
  state: RuleState;
  /** Minor units this rule contributes to the final plan (0 for shipping with an unknown cost). */
  amount: number;
  /** Lines where it contributes a product discount. */
  lineIds: string[];
  /** Entered codes of this rule, upper-case, entry order; the first one is the one that counts. */
  enteredCodes: string[];
  /** What describeRule needs to phrase the rule (explain.ts names unnamed rules with it). */
  describable: DescribableRule;
  /**
   * below_minimum: what is missing (minor units / items) and the minimum itself;
   * `scope: "entitled"` when only the rule's own lines count (absent = the cart).
   */
  missing?: { subtotal?: number; quantity?: number; minimumSubtotal?: number; minimumQuantity?: number; scope?: "entitled" };
  /**
   * Per-item minimums: the rule's item groups in this cart, in the order the
   * cart lines name them — set whenever the rule got as far as its minimums
   * (applied or not), so explain can say "Produkt B: v košíku 1 ks, sleva platí od 4 ks".
   */
  items?: ItemMinimumOutcome[];
  /** Schedule at day granularity (shop dates, inclusive). */
  startsOn?: string;
  endsOn?: string;
  /**
   * outranked: owners of the stacks that beat it (at most 3) — a rule id, or
   * `tier:<setId>` when a quantity tier beat it (MVP 3, plan.tiers).
   */
  betterRuleIds?: string[];
  /** combined: the rule whose node emits the stack it is part of. */
  combinedInto?: string;
}

export interface CodeOutcome {
  /** As entered, trimmed and upper-cased (customer input: render as text only). */
  code: string;
  /** The Won rule owning the code; null for a code this app does not manage. */
  ruleId: string | null;
  state: CodeState;
}

/**
 * One per gift tier of the payload, config order (MVP 4, R3). `earned`: its gift
 * line is free (`lineId`); `missing`: reached, no valid gift line in the cart;
 * `below`: not reached; `not_offered`: no threshold in the cart currency;
 * `not_combinable`: reached with a valid line, but the gift does not add up
 * with a discount the cart got (combine.ts) — the line stays paid.
 * `lineId` names the tier's first valid gift line when there is one. Whether the
 * customer declined it or it is out of stock only the storefront knows.
 */
export interface PlanGift {
  tierId: string;
  lineId?: string;
  state: "earned" | "missing" | "below" | "not_offered" | "not_combinable";
}

/** A gift tier's progress in the cart currency (R4), minor units. */
export interface PlanGiftProgress {
  tierId: string;
  threshold: number;
  remaining: number;
  reached: boolean;
  /** countOtherDiscounts on: the same after the discounts the plan gives the non-gift lines. */
  afterDiscounts?: { remaining: number; reached: boolean };
}

/**
 * What the storefront/admin should say (R2–R4): `market_missing_threshold`
 * (a reward without a threshold in the cart currency), `gift_not_earned` (a gift
 * line that is paid), `gift_extra_paid` (more than one gift item of a tier),
 * `code_loses_gift` (countOtherDiscounts: reached only before discounts),
 * `reward_not_combinable` (the free shipping of Milníky does not add up with a
 * discount the cart got), `gift_not_combinable` (the same for a gift).
 * `ruleId` = `reward:shipping` or `gift:<tierId>`.
 */
export interface PlanWarning {
  code: string;
  ruleId?: string;
}

// --- Quantity tiers (MVP 3, plan-tiers.ts) ------------------------------------------------------

/**
 * A tier set's state in the plan: the rule states that can apply to a set,
 * plus `below_tier` (no counting group reached an offered break). `disabled` =
 * the set has no break (e.g. a Pro set on Free, contract K1).
 */
export type TierState =
  | "applied"
  | "outranked"
  | "not_combinable"
  | "zero_value"
  | "disabled"
  | "currency_missing"
  | "no_target_lines"
  | "outlet_only"
  | "below_tier"
  | "margin_floor";

/** One break in the cart currency: a percent, or an amount off each item (minor units). */
export interface TierStep {
  minQty: number;
  percent: number | null;
  amount: number | null;
}

/** The lines counted together (K2) and what they reach. */
export interface TierGroupOutcome {
  /** "line": one line; "product": the lines of one product; "cart": every eligible line of the set. Cart order. */
  lineIds: string[];
  count: number;
  /** The highest offered break ≤ count, null = none. */
  reached: TierStep | null;
  /** The first offered break above count, null = none. */
  next: TierStep | null;
}

export interface TierOutcome {
  setId: string;
  /** The id its plan components carry: `tier:<setId>`. */
  ruleId: string;
  /** What counts toward minQty (K2). */
  countAcross: TierCountAcross;
  state: TierState;
  /** Minor units the set contributes to the final plan. */
  amount: number;
  /** Lines where it contributes a product discount. */
  lineIds: string[];
  /** Counting groups of its eligible lines (none for a set no eligible line uses). */
  groups: TierGroupOutcome[];
  /** outranked: owners of the stacks that beat it (at most 3). */
  betterRuleIds?: string[];
}

/** "Přidejte 1 ks a dostanete −15 %": the counting group closest to its next break (plan-tiers.ts tierHint). */
export interface TierHint {
  setId: string;
  lineIds: string[];
  count: number;
  /** Items to add. */
  missing: number;
  next: TierStep;
  /**
   * MVP 4: margin protection lowers the next tier on the first hinted line, so
   * the hint must not promise its value ("přidejte 1 ks → nižší cena").
   */
  marginCapped?: true;
}

/** Progress toward the rewards (MVP 4, R4) and the quantity tier hint (MVP 3, checked by re-planning in MVP 4). */
export interface PlanProgress {
  freeShipping?: { threshold: number; remaining: number; reached: boolean };
  gifts?: PlanGiftProgress[];
  tierHint?: TierHint;
}

export interface CartPlan {
  currency: string;
  locale: PlanLocale;
  /** The shop date schedules were evaluated on (null = unknown). */
  today: string | null;
  /** The campaign whose overrides were applied (null = none). */
  campaignId: string | null;
  lines: PlanLine[];
  order: PlanOrder | null;
  shipping: PlanShipping | null;
  /** One per readable rule, in config order. */
  rules: RuleOutcome[];
  /** One per tier set of the shop config (its order); [] when it has none. */
  tiers: TierOutcome[];
  /** One per entered code, in entry order. */
  codes: CodeOutcome[];
  gifts: PlanGift[];
  warnings: PlanWarning[];
  progress: PlanProgress;
  totals: { subtotal: number; productDiscount: number; orderDiscount: number; total: number };
  /** Set when nothing could be planned; the plan then emits nothing. */
  reason?: PlanFailure;
  /** Technical detail for logs (never shown to a customer). */
  error?: string;
}

export type PlanConfig = ReadonlyDeep<FunctionConfigPayload>;

/**
 * True when `value` has the shape `planCart` can plan from (tolerant: extra and
 * missing optional keys are fine, junk rules are skipped one by one). Lives here,
 * not in function-payload.ts, so the function bundle does not pull in the config
 * sanitizer just to check a shape.
 */
export function isFunctionConfigPayload(value: unknown): value is FunctionConfigPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const modules = (value as Record<string, unknown>).modules;
  if (typeof modules !== "object" || modules === null) return false;
  const codes = (modules as Record<string, unknown>).codes;
  return typeof codes === "object" && codes !== null && Array.isArray((codes as Record<string, unknown>).rules);
}

// --- What the checkout cannot evaluate (for the admin) ------------------------------------

/**
 * Segment targeting needs `customer.inAnySegment(segmentIds:)` — a query
 * ARGUMENT, which only the node's metafield variables can supply, and the node
 * variables carry no segment list. Until that exists, segment-targeted rules are
 * skipped by the engine (state `unsupported`) and the admin shows this gap.
 */
export const SEGMENT_TARGETING_SUPPORTED = false as const;

export type FunctionGap = "segment_targeting";

/** Features of a rule the discount function cannot evaluate yet ([] = fully supported). */
export function unsupportedInFunction(rule: { targeting?: { segments?: readonly string[]; markets?: readonly string[] } }): FunctionGap[] {
  return !SEGMENT_TARGETING_SUPPORTED && (rule.targeting?.segments?.length ?? 0) > 0 ? ["segment_targeting"] : [];
}

// --- Internal model (Rule, Candidate, WorkLine, StackContext: plan-internal.ts) ----------------

interface Scope {
  subtotal: number;
  quantity: number;
  lines: number;
  discountable: number;
}

/** The modules' lists (combine.ts), as masks of types (readCombine). */
interface ModuleMasks {
  tiers: number;
  rewards: number;
  outlet: number;
}

interface ActiveCampaign {
  id: string;
  patches: Map<string, Rec>;
  /** MVP 6.1 (L4): the campaign's own tier sets, when its `tiers` is an object — read INSTEAD of `modules.tiers`. */
  tiers: Rec | null;
}

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** Keys a campaign override may patch on a rule (mirrors the config sanitizer's OVERRIDE_FIELDS.rule). */
const RULE_OVERRIDE_KEYS = ["enabled", "name", "value", "target", "minimum", "targeting", "c", "x"] as const;

const MAX_BETTER_RULES = 3;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A finite amount ≥ 0 for the currency, floored, at most the config's money cap
 * (the sanitizer caps every stored amount; a hand-made payload is read the same
 * way by the Rust function, which could not hold a larger one exactly).
 */
function amountIn(money: unknown, currency: string): number | null {
  if (!isRecord(money)) return null;
  const v = money[currency];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(Math.min(v, CONFIG_LIMITS.moneyMinorUnits)) : null;
}

function clampPercent(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
}

function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : null;
}

const localDate = (v: unknown): string | null => (typeof v === "string" && DATE_RE.test(v) ? v : null);

function readRule(raw: Rec, currency: string, masks: ModuleMasks): Rule | null {
  const value = raw.value;
  if (!isRecord(value)) return null;
  let valueKind: ValueKind;
  let percent = 0;
  let fixed: number | null = null;
  let describedValue: DiscountRuleValue;
  if (value.kind === "percentage") {
    valueKind = "percentage";
    percent = clampPercent(value.percent);
    describedValue = { kind: "percentage", percent };
  } else if (value.kind === "fixed") {
    valueKind = "fixed";
    fixed = amountIn(value.amount, currency);
    describedValue = { kind: "fixed", amount: isRecord(value.amount) ? (value.amount as Record<string, number>) : {} };
  } else if (value.kind === "freeShipping") {
    valueKind = "freeShipping";
    describedValue = { kind: "freeShipping" };
  } else {
    return null;
  }
  const targetKind = isRecord(raw.target) ? raw.target.kind : undefined;
  if (!(DISCOUNT_TARGET_KINDS as readonly unknown[]).includes(targetKind)) return null;
  const target = targetKind as DiscountTargetKind;
  const cls: DiscountClass =
    valueKind === "freeShipping" || target === "shipping" ? "shipping" : target === "order" ? "order" : "product";
  const method: DiscountMethod = raw.method === "code" ? "code" : "automatic";
  const codeHashes = method === "code" ? (stringList(raw.codeHashes) ?? []) : [];
  // A generated batch travels as one more text of `codeHashes` (code-batch.ts): a text that reads as one is one.
  const codeBatches: ReadCodeBatch[] = [];
  for (const entry of codeHashes) {
    const batch = readCodeBatch(entry);
    if (batch) codeBatches.push(batch);
  }

  const minimum = isRecord(raw.minimum) ? raw.minimum : {};
  const subtotalMap = minimum.subtotal;
  const hasSubtotal = isRecord(subtotalMap) && Object.keys(subtotalMap).length > 0;
  const minSubtotal = hasSubtotal ? amountIn(subtotalMap, currency) : null;
  const minQuantity =
    typeof minimum.quantity === "number" && Number.isFinite(minimum.quantity) && minimum.quantity > 0
      ? Math.floor(minimum.quantity)
      : 0;
  const minScope: MinimumScope = minimum.scope === "entitled" ? "entitled" : "cart";
  // Schedules arrive as shop-local days (buildShopFunctionConfig converted them with
  // the shop's time zone). Fail closed: any schedule that is not exactly valid
  // `startsOn`/`endsOn` days — `{invalid: true}`, raw ISO strings, junk, `{}` — is
  // never read as "no schedule"; the rule gates as schedule_unknown.
  const scheduled = raw.schedule !== undefined && raw.schedule !== null;
  const schedule = isRecord(raw.schedule) ? raw.schedule : {};
  const scheduleKeys = Object.keys(schedule);
  const scheduleInvalid =
    scheduled &&
    (!isRecord(raw.schedule) ||
      scheduleKeys.length === 0 ||
      scheduleKeys.some((k) => (k !== "startsOn" && k !== "endsOn") || localDate(schedule[k]) === null));
  const targeting = isRecord(raw.targeting) ? raw.targeting : {};
  // Combining (combine.ts): an order discount of Milníky (the id prefix and the shape Milníky writes) is of the
  // type "rewards" and follows the Milníky list; any other rule has its own list `c` and exceptions `x` — the
  // rules it names (readExceptions); resolveRules turns the positions into ids once every rule is read.
  const milestone = isMilestoneRuleId(raw.id as string) && method === "automatic" && target === "order" && valueKind !== "freeShipping";
  const bit = milestone ? COMBINE_BIT.rewards : cls === "shipping" ? COMBINE_BIT.shipping : method === "code" ? COMBINE_BIT.code : COMBINE_BIT.automatic;
  const mask = milestone ? masks.rewards : maskOf(raw.c);

  return {
    id: raw.id as string,
    name: typeof raw.name === "string" ? raw.name : "",
    method,
    module: "codes",
    enabled: raw.enabled === true,
    cls,
    valueKind,
    percent,
    fixed,
    priority: typeof raw.priority === "number" && Number.isFinite(raw.priority) ? Math.floor(raw.priority) : 0,
    codeHashes,
    codeBatches,
    minSubtotal,
    minSubtotalMissing: hasSubtotal && minSubtotal === null,
    minQuantity,
    minEntitled: minScope === "entitled",
    scheduled,
    scheduleInvalid,
    startsOn: localDate(schedule.startsOn),
    endsOn: localDate(schedule.endsOn),
    markets: stringList(targeting.markets),
    segmentTargeted: unsupportedInFunction({ targeting: { segments: stringList(targeting.segments) ?? [] } }).length > 0,
    bit,
    mask,
    except: milestone ? [] : (readExceptions(raw.x) as string[]),
    ...(milestone ? { reward: "discount" as const } : {}),
    describable: {
      method,
      value: describedValue,
      target: { kind: target },
      ...(hasSubtotal || minQuantity > 0
        ? {
            minimum: {
              ...(hasSubtotal ? { subtotal: subtotalMap as Record<string, number> } : {}),
              quantity: minQuantity,
              ...(minScope === "entitled" ? { scope: minScope } : {}),
            },
          }
        : {}),
    },
    state: null,
    hadCandidate: false,
    lostTo: [],
    dropped: false,
    marginFloored: false,
  };
}

/**
 * `x` of a rule or of a campaign's patch (port spec): the rules it names as exceptions.
 *   - a TEXT (what the app ships in a patch): positions in the payload's rules, joined by commas. A part counts when it is
 *     1 to 5 ASCII digits; any other part (empty, a sign, a space, a letter, 6+ digits) names nothing;
 *   - a LIST (a payload made by hand): each whole number ≥ 0 below 65 536 is a position, each string a rule id;
 *     any other entry names nothing;
 *   - anything else: no exception.
 * A position is turned into the id of the rule read there by resolveRules.
 */
function readExceptions(x: unknown): (string | number)[] {
  if (typeof x === "string") {
    return x
      .split(",")
      .filter((part) => /^[0-9]{1,5}$/.test(part))
      .map(Number);
  }
  if (!Array.isArray(x)) return [];
  return x.filter((v): v is string | number => typeof v === "string" || (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 65536));
}

/** A mask given as a number (a rule's or a patch's `c`, `engine.mc`): a whole number 0–63; anything else is 0. */
const maskOf = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= COMBINE_ALL ? v : 0);

/** What `engine.cx` says: the modules' lists, and each rule's list and exceptions by its position in the payload's rules. */
interface CombineLists {
  masks: ModuleMasks;
  /** null = the payload has no `engine.cx`: a rule's own `c` and `x` are read (a payload made by hand). */
  rules: { mask: number; except: number[] }[] | null;
}

/**
 * How discounts add up, as the payload says it (port spec of config.rs `read_combine`).
 *
 * `engine.cx` a TEXT (what the app ships; function-payload.ts): "<tiers>.<rewards>.<outlet>|<rule 0>;<rule 1>;…".
 *   - before the first "|": the modules' masks, split at "."; each of the first three parts that is 1 or 2 ASCII
 *     digits and at most 63 is that number, any other part (missing, empty, a sign, a letter, 64 or more) is 0;
 *   - after it (no "|" = no rule has a list): one entry per rule, by position, split at ";". An entry is its
 *     mask, then — after its first ":" — its exceptions. The mask is read like a module's. The exceptions are
 *     positions split at ","; a part counts when it is 1 to 5 ASCII digits, any other names nothing. A rule
 *     past the last entry has the mask 0 and no exception.
 *   A rule's own `c` / `x` and `engine.mc` are then NOT read.
 * `engine.cx` anything else (absent, a payload written before 13 Oct 2026 or by hand): the modules' masks are
 * `engine.mc` = [tiers, rewards, outlet] (a whole number 0–63 each, else 0), and each rule says its own `c`, `x`.
 * THE RUST FUNCTION DOES NOT READ THIS SECOND FORM (its size limit; README "Accepted edge differences"): there a
 * payload without a text `engine.cx` adds nothing up. The app always ships the text.
 * Nothing said = 0: it adds up with nothing (fail closed, never more).
 */
function readCombine(config: Rec): CombineLists {
  const engine = isRecord(config.engine) ? config.engine : {};
  const digits = (text: string | undefined, max: number): number | null => (text !== undefined && text.length >= 1 && text.length <= max && /^[0-9]+$/.test(text) ? Number(text) : null);
  const textMask = (text: string | undefined) => {
    const n = digits(text, 2);
    return n !== null && n <= COMBINE_ALL ? n : 0;
  };
  if (typeof engine.cx === "string") {
    const bar = engine.cx.indexOf("|");
    const head = (bar === -1 ? engine.cx : engine.cx.slice(0, bar)).split(".");
    const rules =
      bar === -1
        ? []
        : engine.cx
            .slice(bar + 1)
            .split(";")
            .map((entry) => {
              const colon = entry.indexOf(":");
              const named = colon === -1 ? [] : entry.slice(colon + 1).split(",");
              return { mask: textMask(colon === -1 ? entry : entry.slice(0, colon)), except: named.map((part) => digits(part, 5)).filter((n): n is number => n !== null) };
            });
    return { masks: { tiers: textMask(head[0]), rewards: textMask(head[1]), outlet: textMask(head[2]) }, rules };
  }
  const mc = Array.isArray(engine.mc) ? engine.mc : [];
  return { masks: { tiers: maskOf(mc[0]), rewards: maskOf(mc[1]), outlet: maskOf(mc[2]) }, rules: null };
}

/** The discounts a sale line's price can take next to the sale: a product rule, a tier, an order discount (Milníky's included). */
const SALE_PRICE_TYPES = COMBINE_BIT.automatic | COMBINE_BIT.code | COMBINE_BIT.tiers | COMBINE_BIT.rewards;

/**
 * The longest Won code, UTF-16 units (`modules.codes.maxCodeLength`, audit
 * round 6): a whole number ≥ 0, at most CONFIG_LIMITS.codeLength; anything else
 * (a payload written before round 6) reads as that limit.
 */
export function readMaxCodeLength(config: Rec): number {
  const codes = isRecord(config.modules) && isRecord(config.modules.codes) ? config.modules.codes : {};
  const v = codes.maxCodeLength;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? Math.min(v, CONFIG_LIMITS.codeLength) : CONFIG_LIMITS.codeLength;
}

/** Market handle → countries, as the shared config ships them (enabled, targeted markets only). */
function readMarketCountries(config: Rec): Map<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>();
  if (!isRecord(config.marketCountries)) return out;
  for (const [handle, countries] of Object.entries(config.marketCountries)) {
    const list = stringList(countries);
    if (list) out.set(handle, new Set(list.map((c) => c.toUpperCase())));
  }
  return out;
}

// --- Stage: rules as they are right now ------------------------------------------------------

/**
 * The campaign whose overrides apply: the node says its window is live AND its
 * variables (campaign id + varsVersion) are the ones the shop config was built
 * with. Anything else — stale variables mid-sync, another campaign, no version —
 * plans without a campaign, deterministically (C4/C7).
 */
function activeCampaign(config: Rec, cart: NormalizedCart): ActiveCampaign | null {
  const node = cart.campaign;
  if (!node || !node.active || !node.id || !node.varsVersion) return null;
  if (config.campaignId !== node.id || config.campaignVarsVersion !== node.varsVersion) return null;
  const campaigns = Array.isArray(config.campaigns) ? config.campaigns : [];
  const campaign = campaigns.find((c): c is Rec => isRecord(c) && c.id === node.id && c.killed !== true);
  if (!campaign) return null;
  const patches = new Map<string, Rec>();
  for (const override of Array.isArray(campaign.overrides) ? campaign.overrides : []) {
    if (!isRecord(override) || typeof override.ruleId !== "string" || !isRecord(override.patch)) continue;
    const merged = patches.get(override.ruleId) ?? {};
    for (const key of RULE_OVERRIDE_KEYS) {
      if (key in override.patch) merged[key] = override.patch[key];
    }
    patches.set(override.ruleId, merged);
  }
  return { id: node.id, patches, tiers: isRecord(campaign.tiers) ? campaign.tiers : null };
}

function resolveRules(config: Rec, cart: NormalizedCart, { masks, rules: lists }: CombineLists) {
  const campaign = activeCampaign(config, cart);
  const raws = ((config.modules as Rec).codes as Rec).rules as unknown[];
  const rules: Rule[] = [];
  const retargeted = new Set<string>();
  const seen = new Set<string>();
  // The rule read at each position of the payload's list (an entry that is no rule, or a repeated id, has none).
  const idAt = new Map<number, string>();
  raws.forEach((raw, at) => {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "" || seen.has(raw.id)) return;
    const patch = campaign?.patches.get(raw.id);
    // With `engine.cx` the rule's list is its entry there (never its own keys); a campaign's patch goes over either.
    const own = lists ? { ...raw, c: lists[at]?.mask ?? 0, x: lists[at]?.except ?? [] } : raw;
    const rule = readRule(patch ? { ...own, ...patch } : own, cart.currency, masks);
    if (!rule) return;
    seen.add(rule.id);
    idAt.set(at, rule.id);
    if (patch && "target" in patch) retargeted.add(rule.id);
    rules.push(rule);
  });
  // Exceptions by position → by id; a position that holds no rule names nothing.
  for (const rule of rules) {
    if (rule.except.some((v) => typeof v !== "string")) {
      rule.except = (rule.except as (string | number)[]).map((v) => (typeof v === "number" ? idAt.get(v) : v)).filter((v): v is string => v !== undefined);
    }
  }
  return { campaign, rules, retargeted, byId: new Map(rules.map((r) => [r.id, r])) };
}

// --- Stage: codes ------------------------------------------------------------------------------

/**
 * Entered codes → code rules: by hash (a hand-typed code; the first rule
 * listing the hash), else by generated batch (code-batch.ts matchesCodeBatch;
 * the first batch in rule order, then batch order — the sanitizer lets no
 * batch's prefix start another's, so at most one can match). Only an entry
 * that is all ASCII once trimmed is tried against the batches (cart.ts
 * `ascii`): every character of a generated code is, and the function compares
 * bytes (ı → I and ſ → S upper-case INTO ASCII; such an entry is not taken).
 * The first entered code of a rule is the one that counts. Only the first MAX_ENTERED_CODES entries are matched (cart.ts
 * `consideredEntries`), and of those only an entry that can be a Won code
 * (audit rounds 6 and 7; UTF-16 units, the longest Won code = `readMaxCodeLength`):
 * - at most the longest Won code + ENTERED_CODE_PADDING long as entered, white
 *   space included (the Rust function neither trims nor upper-cases a longer one);
 * - its normalized form (trimmed, upper-cased) at most the longest Won code
 *   long: every Won code is, so a longer one cannot be one (ß → SS and ΐ → three
 *   characters count as long as they become; the Rust function stops hashing
 *   there).
 * Any other entry still counts as an entry.
 */
function matchCodes(rules: Rule[], cart: NormalizedCart, maxCodeLength: number) {
  const ownerByHash = new Map<string, Rule>();
  for (const rule of rules) {
    if (rule.method !== "code") continue;
    for (const hash of rule.codeHashes) if (!ownerByHash.has(hash)) ownerByHash.set(hash, rule);
  }
  const batchOwners = rules.filter((rule) => rule.method === "code" && rule.codeBatches.length > 0);
  const ownerByBatch = (code: string) => batchOwners.find((rule) => rule.codeBatches.some((batch) => matchesCodeBatch(batch, code)));
  const ownerOfCode = new Map<string, Rule>();
  const enteredByRule = new Map<string, string[]>();
  for (const { code, rawLength, ascii } of cart.consideredEntries) {
    if (code === "" || rawLength > maxCodeLength + ENTERED_CODE_PADDING || code.length > maxCodeLength) continue;
    const rule = ownerByHash.get(codeHash(code)) ?? (ascii && batchOwners.length > 0 ? ownerByBatch(code) : undefined);
    if (!rule) continue;
    ownerOfCode.set(code, rule);
    const list = enteredByRule.get(rule.id);
    if (!list) enteredByRule.set(rule.id, [code]);
    else if (!list.includes(code)) list.push(code);
  }
  return { ownerOfCode, enteredByRule };
}

// --- Stage: lines, exclusions, targeting, scopes ------------------------------------------------

const emptyScope = (): Scope => ({ subtotal: 0, quantity: 0, lines: 0, discountable: 0 });

/**
 * A line on sale (port spec, with combine.ts):
 *   - the variant flag `true` (the shop's rule): when the sale's list has none of SALE_PRICE_TYPES the line is
 *     `excluded: "outlet"` — out of every product and order discount, as before. Otherwise it is `sale`: it
 *     takes a quantity tier when the sale and the tiers add up (else `no` bit 1), and each product rule and
 *     order discount is asked on its own where it is used (addUp with the sale);
 *   - a numeric flag (the sale's own list, or a gift card): `no` = the classes it stays out of, whatever the
 *     shop's list says.
 */
function prepareLines(
  cart: NormalizedCart,
  outlet: CombineSide,
  tiers: CombineSide,
  campaignId: string | null,
  retargeted: ReadonlySet<string>,
  known: ReadonlyMap<string, Rule>,
) {
  const saleTakesSome = (outlet.mask & SALE_PRICE_TYPES) !== 0;
  const saleTakesTiers = saleTakesSome && addUp(outlet, tiers);
  const work: WorkLine[] = cart.lines.map((line) => {
    const targeting = lineTargeting(line, campaignId, retargeted, known);
    const sale = !line.gift && line.outlet && saleTakesSome;
    return {
      line,
      excluded: line.gift ? "gift" : line.outlet && !saleTakesSome ? "outlet" : null,
      no: line.gift ? 0 : sale && !saleTakesTiers ? OUTLET_ALLOW.tiers : line.outletNo,
      sale,
      ruleSet: targeting.ruleIds,
      plain: targeting.plain,
      items: targeting.items,
      product: null,
      floor: null,
      tier: null,
    };
  });
  const cartScope = emptyScope();
  const ruleScopes = new Map<string, Scope>();
  // Per-item minimum (step 2): each item group's pieces, and the rules some non-gift line names by an item ref.
  const groupCounts = new Map<string, number>();
  const itemRuleIds = new Set<string>();
  for (const w of work) {
    if (w.excluded === "gift") continue;
    for (const ref of w.items) {
      groupCounts.set(ref.group, (groupCounts.get(ref.group) ?? 0) + w.line.quantity);
      itemRuleIds.add(ref.ruleId);
    }
    const discountable = w.excluded === null ? 1 : 0;
    cartScope.subtotal += w.line.subtotal;
    cartScope.quantity += w.line.quantity;
    cartScope.lines += 1;
    cartScope.discountable += discountable;
    for (const id of w.ruleSet) {
      let s = ruleScopes.get(id);
      if (!s) ruleScopes.set(id, (s = emptyScope()));
      s.subtotal += w.line.subtotal;
      s.quantity += w.line.quantity;
      s.lines += 1;
      // A sale line that does not take a product rule gives it nothing to discount.
      const rule = known.get(id);
      s.discountable += rule?.cls === "product" && (w.no & OUTLET_ALLOW.product || (w.sale && !addUp(outlet, rule))) ? 0 : discountable;
    }
  }
  return { work, cartScope, ruleScopes, groupCounts, itemRuleIds };
}

// --- Stage: eligibility ---------------------------------------------------------------------------

interface GateContext {
  cart: NormalizedCart;
  marketCountries: Map<string, ReadonlySet<string>>;
  /** The whole cart (non-gift lines): what „minimum košíku“ is measured on. */
  cartScope: Scope;
}

function inMarket(rule: Rule, ctx: GateContext): boolean {
  const country = ctx.cart.countryCode;
  if (!rule.markets || !country) return false;
  return rule.markets.some((handle) => ctx.marketCountries.get(handle)?.has(country) === true);
}

/** Rule gate, in the order a merchant would ask "why not?". Returns null when eligible. */
function gate(rule: Rule, ctx: GateContext, targetScope: Scope, entered: boolean, itemRule: boolean): RuleState | null {
  const { cart, cartScope } = ctx;
  if (!rule.enabled) return "disabled";
  if (rule.method === "code" && !entered) return "code_not_entered";
  if (rule.scheduled) {
    // [spec] DAY granularity in shop time: the function reads only shop.localTime.date
    // without variables; exact-time windows are the Campaigns module's job (C4).
    if (!cart.today || rule.scheduleInvalid) return "schedule_unknown";
    if (rule.startsOn && cart.today < rule.startsOn) return "not_started";
    if (rule.endsOn && cart.today > rule.endsOn) return "ended";
  }
  if (rule.segmentTargeted) return "unsupported";
  if (rule.markets && !inMarket(rule, ctx)) return "market";
  if ((rule.valueKind === "fixed" && rule.fixed === null) || rule.minSubtotalMissing) return "currency_missing";
  if (targetScope.lines === 0) return "no_target_lines";
  if (rule.cls !== "shipping" && targetScope.discountable === 0) return "outlet_only";
  // [spec] „Minimum košíku“ = the WHOLE cart: every non-gift line at its
  // pre-discount price, outlet included (it is what the customer pays), whatever
  // the rule targets; the same for the quantity minimum. An "entitled" minimum
  // (a migrated native's semantics) counts only the product rule's own lines,
  // measured the same way; an order or shipping rule is entitled to the cart.
  const entitled = rule.minEntitled && rule.cls === "product";
  const scope = entitled ? targetScope : cartScope;
  const missingSubtotal = rule.minSubtotal !== null ? Math.max(0, rule.minSubtotal - scope.subtotal) : 0;
  const missingQuantity = rule.minQuantity > 0 ? Math.max(0, rule.minQuantity - scope.quantity) : 0;
  // Per-item minimum (step 3): the common quantity minimum of an item rule decides line by line, later.
  if (itemRule) rule.commonQuantityMissing = missingQuantity;
  if (missingSubtotal > 0 || (missingQuantity > 0 && !itemRule)) {
    rule.missing = {
      ...(missingSubtotal > 0 ? { subtotal: missingSubtotal, minimumSubtotal: rule.minSubtotal as number } : {}),
      ...(missingQuantity > 0 ? { quantity: missingQuantity, minimumQuantity: rule.minQuantity } : {}),
      ...(entitled ? { scope: "entitled" as const } : {}),
    };
    return "below_minimum";
  }
  return null;
}

function gateRules(
  rules: Rule[],
  ctx: GateContext,
  ruleScopes: Map<string, Scope>,
  enteredByRule: Map<string, string[]>,
  itemRuleIds: ReadonlySet<string>,
): void {
  const none = emptyScope();
  for (const rule of rules) {
    const targetScope = rule.cls === "product" ? (ruleScopes.get(rule.id) ?? none) : ctx.cartScope;
    rule.state = gate(rule, ctx, targetScope, enteredByRule.has(rule.id), rule.cls === "product" && itemRuleIds.has(rule.id));
  }
}

/**
 * Per-item minimum, steps 4 and 5 (the header's port spec): every eligible
 * item rule keeps only the lines whose item reached its minimum (or that list
 * it plainly while the common quantity minimum is reached); one that keeps no
 * line is below its minimum. Also records each item rule's groups for explain.
 */
function applyItemMinimums(rules: Rule[], work: WorkLine[], groupCounts: ReadonlyMap<string, number>, itemRuleIds: ReadonlySet<string>): void {
  if (itemRuleIds.size === 0) return;
  for (const rule of rules) {
    if (rule.cls !== "product" || !itemRuleIds.has(rule.id)) continue;
    const evaluated = rule.state === null || rule.state === "below_minimum";
    const commonMissing = rule.commonQuantityMissing ?? 0;
    const groups = new Map<string, ItemMinimumOutcome>();
    let kept = 0;
    let plainLines = 0;
    for (const w of work) {
      if (w.excluded === "gift" || !w.ruleSet.has(rule.id)) continue;
      const plain = w.plain.has(rule.id);
      if (plain) plainLines += 1;
      let reached = plain && commonMissing === 0;
      for (const ref of w.items) {
        if (ref.ruleId !== rule.id) continue;
        const count = groupCounts.get(ref.group) ?? 0;
        if (count >= ref.minimum) reached = true;
        const outcome = groups.get(ref.group);
        if (outcome) outcome.lineIds.push(w.line.id);
        else groups.set(ref.group, { key: ref.key, minimum: ref.minimum, count, reached: count >= ref.minimum, lineIds: [w.line.id] });
      }
      if (rule.state !== null) continue;
      if (reached) kept += 1;
      else w.ruleSet.delete(rule.id);
    }
    if (evaluated) rule.items = [...groups.values()];
    if (rule.state === null && kept === 0) {
      rule.state = "below_minimum";
      // What the plain lines lack (the item groups say the rest, `items`).
      if (plainLines > 0 && commonMissing > 0) {
        rule.missing = { quantity: commonMissing, minimumQuantity: rule.minQuantity, ...(rule.minEntitled ? { scope: "entitled" as const } : {}) };
      }
    }
  }
}

// --- Ranking and stacking ------------------------------------------------------------------

/** amount desc, then priority desc, then id asc (never config order). */
function byRank(a: Candidate, b: Candidate): number {
  if (a.amount !== b.amount) return b.amount - a.amount;
  if (a.rule.priority !== b.rule.priority) return b.rule.priority - a.rule.priority;
  return byId(a.rule, b.rule);
}

interface Picked {
  components: Candidate[]; // effective amounts, rank order
  total: number;
}


/** The types a product rule can be of: what a tier's list must name for the tier to stack with any of them. */
const LINE_RULE_TYPES = COMBINE_BIT.automatic | COMBINE_BIT.code;

/**
 * The most candidates of one target (a line, or the order) a stack is searched
 * among: its best-ranked ones ([spec], see the header and pick), a quantity
 * tier that can stack with a rule among them like a rule. A candidate ranked below them
 * is never part of a stack; it is "outranked".
 */
export const MAX_STACK_CANDIDATES = 6;

/**
 * The best stack for one target (a line, or the order): the single best
 * candidate, or — when candidates add up (combine.ts addUp) — the set in which
 * every two add up that saves the customer the most (greedy from every seed;
 * ties keep the earlier-ranked seed), searched among the MAX_STACK_CANDIDATES
 * best-ranked candidates only. Amounts are then capped at `cap` in rank order.
 */
function pick(positive: Candidate[], cap: number, stacking: boolean): Picked {
  if (positive.length > 1) positive.sort(byRank);
  let chosen: Candidate[] = [positive[0]];
  if (stacking && positive.length > 1) {
    // The stack cap: the rest can never be part of a stack (they stay in
    // `positive`, so buildStack still counts them as outranked). A quantity
    // tier that adds up with no rule candidate of the line can never stack
    // there, so it takes no place in the pool — as before 13 Oct 2026, when no
    // tier ever stacked: the pool is then the MAX_STACK_CANDIDATES best-ranked
    // RULE candidates (the tier still competes as a single candidate through
    // `bestTotal`). A rule always takes its place. (Its list is asked first:
    // without a rule type in it, no candidate has to be looked at.)
    const closed = (rule: Rule) => rule.module === "tiers" && ((rule.mask & LINE_RULE_TYPES) === 0 || !positive.some((c) => c.rule !== rule && addUp(rule, c.rule)));
    const open = positive.some((c) => closed(c.rule)) ? positive.filter((c) => !closed(c.rule)) : positive;
    const pool = open.length > MAX_STACK_CANDIDATES ? open.slice(0, MAX_STACK_CANDIDATES) : open;
    let bestTotal = Math.min(cap, positive[0].amount); // the best single candidate, such a tier included
    // A seed already inside an earlier greedy stack is skipped: it would mostly
    // rebuild the same stack, and without this the search is O(k³) per line when
    // many rules combine (the function runs under an instruction limit).
    const covered = new Set<Candidate>();
    for (const seed of pool) {
      if (covered.has(seed)) continue;
      const set = [seed];
      for (const c of pool) {
        if (c !== seed && set.every((s) => addUp(s.rule, c.rule))) set.push(c);
      }
      if (set.length === 1) continue;
      for (const c of set) covered.add(c);
      set.sort(byRank);
      const total = Math.min(cap, set.reduce((sum, c) => sum + c.amount, 0));
      if (total > bestTotal) {
        bestTotal = total;
        chosen = set;
      }
    }
  }
  const components: Candidate[] = [];
  let remaining = cap;
  for (const c of chosen) {
    const amount = Math.min(c.amount, remaining);
    if (amount <= 0) continue;
    components.push({ ...c, amount });
    remaining -= amount;
  }
  return { components, total: cap - remaining };
}

function buildStack(
  picked: Picked,
  positive: Candidate[],
  naturalValue: (single: Candidate) => EmittedValue,
  locale: PlanLocale,
  currency: string,
): PlanStack | null {
  if (picked.components.length === 0) return null;
  const owner = ownerOf(picked.components);
  const inStack = new Set(picked.components.map((c) => c.rule.id));
  for (const c of positive) {
    c.rule.hadCandidate = true;
    if (!inStack.has(c.rule.id) && c.rule.lostTo.length < MAX_BETTER_RULES && !c.rule.lostTo.includes(owner.id)) {
      c.rule.lostTo.push(owner.id);
    }
  }
  return {
    components: picked.components.map((c) => ({ ruleId: c.rule.id, method: c.rule.method, module: c.rule.module, amount: c.amount })),
    amount: picked.total,
    ownerRuleId: owner.id,
    ownerMethod: owner.method,
    value: picked.components.length === 1 ? naturalValue(picked.components[0]) : { fixedTotal: picked.total },
    // One candidate: its own message (a tier's is the break it reached). A stack: each one's name, a tier by
    // its plain name ("Množstevní sleva") — the sum has no single break to quote.
    message: picked.components.length === 1 ? candidateLabel(picked.components[0], locale, currency) : picked.components.map((c) => label(c.rule, locale, currency)).join(" + "),
  };
}

function productAmount(rule: Rule, line: NormalizedLine): number {
  if (rule.valueKind === "percentage") return Math.round((line.subtotal * rule.percent) / 100);
  if (rule.valueKind === "fixed" && rule.fixed !== null) return Math.min(rule.fixed, line.unitPrice) * line.quantity;
  return 0;
}

// --- Stage: product discounts --------------------------------------------------------------------

/** `fits` (the order stage's "order first" plan): only the rules and the tier it accepts are candidates. */
function planProducts(work: WorkLine[], ctx: StackContext, fits?: (rule: Rule) => boolean): void {
  for (const w of work) {
    if (w.excluded || (w.ruleSet.size === 0 && !w.tier)) continue;
    const positive: Candidate[] = [];
    for (const id of w.ruleSet) {
      const rule = ctx.byId.get(id);
      if (!rule || rule.cls !== "product" || rule.state !== null || w.no & OUTLET_ALLOW.product) continue;
      // A line on sale under the shop's rule takes only a rule that adds up with the sale.
      if (w.sale && !addUp(ctx.outlet, rule)) continue;
      if (fits && !fits(rule)) continue;
      const amount = productAmount(rule, w.line);
      if (amount > 0) positive.push({ rule, amount });
    }
    // The line's quantity tier (plan-tiers.ts): one more candidate, with its own value and message.
    if (w.tier && (!fits || fits(w.tier.rule))) positive.push(w.tier);
    if (positive.length === 0) continue;
    const unitPrice = w.line.unitPrice;
    w.product = buildStack(
      pick(positive, w.line.subtotal, ctx.stacking),
      positive,
      (single) =>
        single.value ??
        (single.rule.valueKind === "percentage"
          ? { percent: single.rule.percent }
          : { fixedPerItem: Math.min(single.rule.fixed ?? 0, unitPrice) }),
      ctx.locale,
      ctx.currency,
    );
  }
}

/** The rules and tiers whose product discount some line got, each once, in cart order of their first line. */
function appliedProducts(work: readonly WorkLine[], ctx: StackContext): Rule[] {
  const out: Rule[] = [];
  const seen = new Set<string>();
  for (const w of work) {
    if (w.line.gift) continue;
    for (const c of w.product?.components ?? []) {
      if (seen.has(c.ruleId)) continue;
      seen.add(c.ruleId);
      const rule = ctx.byId.get(c.ruleId);
      if (rule) out.push(rule);
    }
  }
  return out;
}

// --- Stage: order discount ---------------------------------------------------------------------

/**
 * The order discount (port spec; 13 Oct 2026, combine.ts).
 *
 * `applied` = the rules and tiers whose product discount some line got (after margin protection). An order
 * rule FITS when it adds up with every one of them. `sale lines` = the lines on sale under the shop's rule
 * that take something (`w.sale`) and are not out of the order discount by their own list.
 *
 * When every eligible order rule fits, the order discount simply goes next to the product discounts, as it
 * always did. When some does not, the customer gets the better of two plans:
 *   PRODUCTS FIRST  the product discounts as picked, and next to them the best stack of the order rules that fit;
 *   ORDER FIRST     the best stack of all eligible order rules, picked as if the cart had no product discount
 *                   (`lead`), and next to it, on every line, the best stack of the product rules and the tier
 *                   that add up with EVERY rule of that stack (picked again, margin protection applied again);
 *                   the order discount is then that same stack, taken from the lines after those discounts.
 * Each plan is tried with the sale lines out of the order discount's base and — when some of its order rules
 * add up with the sale — with the sale lines in it and only those rules. So up to four scenarios, in this order:
 *   1. products first, sale lines out      2. products first, sale lines in
 *   3. order first, sale lines out         4. order first, sale lines in
 * With margin protection on, each scenario's order discount is lowered on its own (protectOrder).
 * What the customer saves = the product discounts + the order discount of the scenario; the one that saves
 * the most wins, a tie keeps the lower number.
 *
 * After it: an eligible order rule left out of the winning scenario that would have given something is "not
 * combinable"; in 3 and 4 so is every product rule and tier that had a candidate and does not add up with
 * the order stack.
 */
function planOrderStage(rules: Rule[], tierRules: readonly Rule[], work: WorkLine[], ctx: StackContext, marginOn: boolean): PlanOrder | null {
  const eligible = rules.filter((r) => r.cls === "order" && r.state === null);
  if (eligible.length === 0) return null;
  const applied = appliedProducts(work, ctx);
  const fitting = applied.length === 0 ? eligible : eligible.filter((rule) => applied.every((p) => addUp(rule, p)));
  const saleLines = work.filter((w) => w.sale && w.excluded === null && (w.no & OUTLET_ALLOW.order) === 0);
  const withSale = (pool: Rule[]) => (saleLines.length > 0 ? pool.filter((rule) => addUp(ctx.outlet, rule)) : []);

  /** The best order stack of `pool`, on the lines after their product discounts (`alone`: on their full subtotals). */
  const orderOf = (pool: Rule[], saleIn: boolean, alone = false): PlanOrder | null => {
    for (const w of saleLines) w.no = saleIn ? w.no & ~OUTLET_ALLOW.order : w.no | OUTLET_ALLOW.order;
    const afterOf = alone ? (w: WorkLine) => w.line.subtotal : (w: WorkLine) => w.line.subtotal - (w.product?.amount ?? 0);
    let base = 0;
    for (const w of work) if (!outOfOrder(w)) base += afterOf(w);
    const positive = pool.map((rule) => ({ rule, amount: orderAmount(rule, base) })).filter((c) => c.amount > 0);
    if (positive.length === 0) return null;
    const stack = buildStack(
      pick(positive, base, ctx.stacking),
      positive,
      (single) => (single.rule.valueKind === "percentage" ? { percent: single.rule.percent } : { fixedTotal: single.amount }),
      ctx.locale,
      ctx.currency,
    );
    if (!stack) return null;
    const order: PlanOrder = { ...stack, base, excludedLineIds: work.filter(outOfOrder).map((w) => w.line.id), marginExcludedLineIds: [] };
    return marginOn ? protectOrder(order, work, afterOf, ctx) : order;
  };

  interface Scenario {
    pool: Rule[];
    orderFirst: boolean;
    saleIn: boolean;
  }
  const scenarios: Scenario[] = [{ pool: fitting, orderFirst: false, saleIn: false }];
  if (withSale(fitting).length > 0) scenarios.push({ pool: withSale(fitting), orderFirst: false, saleIn: true });
  if (fitting.length < eligible.length) {
    scenarios.push({ pool: eligible, orderFirst: true, saleIn: false });
    if (withSale(eligible).length > 0) scenarios.push({ pool: withSale(eligible), orderFirst: true, saleIn: true });
  }
  if (scenarios.length === 1) return finishOrder(orderOf(fitting, false), fitting);

  // Every scenario starts from the same state: what the product stage (and margin protection) left.
  const productRules = [...rules.filter((r) => r.cls === "product"), ...tierRules];
  const marked = [...productRules, ...eligible];
  const marks = marked.map((rule) => ({ hadCandidate: rule.hadCandidate, lostTo: [...rule.lostTo], marginFloored: rule.marginFloored }));
  const lines = work.map((w) => ({ product: w.product, marginCapped: w.marginCapped }));
  const restore = () => {
    marked.forEach((rule, i) => {
      rule.hadCandidate = marks[i].hadCandidate;
      rule.lostTo = [...marks[i].lostTo];
      rule.marginFloored = marks[i].marginFloored;
      rule.dropped = false;
    });
    work.forEach((w, i) => {
      w.product = lines[i].product;
      if (lines[i].marginCapped) w.marginCapped = lines[i].marginCapped;
      else delete w.marginCapped;
    });
  };
  const play = (scenario: Scenario): PlanOrder | null => {
    if (!scenario.orderFirst) return orderOf(scenario.pool, scenario.saleIn);
    // (The order rules the lead stack beat stay "outranked" by it.)
    const lead = orderOf(scenario.pool, scenario.saleIn, true);
    for (const rule of eligible) rule.marginFloored = false;
    const members = (lead?.components ?? []).map((c) => ctx.byId.get(c.ruleId) as Rule);
    const fits = (rule: Rule) => members.length > 0 && members.every((m) => addUp(rule, m));
    // The product discounts again, only what adds up with the whole order stack.
    const had = productRules.filter((rule) => rule.hadCandidate);
    for (const rule of productRules) {
      rule.hadCandidate = false;
      rule.lostTo = [];
      rule.marginFloored = false;
    }
    for (const w of work) {
      if (w.line.gift) continue;
      w.product = null;
      delete w.marginCapped;
    }
    planProducts(work, ctx, fits);
    if (marginOn) applyMarginProtection(work, ctx);
    for (const rule of had) {
      if (fits(rule)) continue;
      rule.hadCandidate = true;
      rule.dropped = true;
    }
    return members.length > 0 ? orderOf(members, scenario.saleIn) : null;
  };
  const productTotal = () => work.reduce((sum, w) => sum + (w.line.gift ? 0 : (w.product?.amount ?? 0)), 0);

  let chosen = 0;
  let best = -1;
  scenarios.forEach((scenario, i) => {
    restore();
    const saved = (play(scenario)?.amount ?? 0) + productTotal();
    if (saved > best) {
      best = saved;
      chosen = i;
    }
  });
  restore();
  const winner = scenarios[chosen];
  const order = play(winner);
  return finishOrder(order, winner.orderFirst ? (order?.components ?? []).map((c) => ctx.byId.get(c.ruleId) as Rule) : winner.pool);

  /** Marks the eligible order rules the winning scenario left out, where they would have given something. */
  function finishOrder(order: PlanOrder | null, pool: Rule[]): PlanOrder | null {
    if (pool.length === eligible.length) return order;
    const inPool = new Set(pool);
    let base = 0;
    for (const w of work) if (!outOfOrder(w)) base += w.line.subtotal - (w.product?.amount ?? 0);
    for (const rule of eligible) {
      if (inPool.has(rule) || rule.hadCandidate || orderAmount(rule, base) <= 0) continue;
      rule.hadCandidate = true;
      rule.dropped = true;
    }
    return order;
  }
}

// --- Stage: shipping -----------------------------------------------------------------------------

/**
 * One shipping winner. The function does not know the delivery cost, so
 * [spec] percent (free = 100 %) ranks above a fixed amount, larger first —
 * never by a cost only the TS side could see (audit MVP 1 drift #7).
 * A candidate takes part only when it adds up (combine.ts addUp) with every
 * product discount and tier some line got and with every order discount of the
 * plan: shipping has no amount to compare, so the discounts already given
 * stay and a shipping discount that does not go with them is dropped as "not
 * combinable" (the free shipping of Milníky: the warning
 * `reward_not_combinable`). It is never "outranked" by a winner that does not
 * apply either.
 */
function planShipping(
  rules: Rule[],
  work: WorkLine[],
  order: PlanOrder | null,
  ctx: StackContext,
  cart: NormalizedCart,
  reward: { value: ShippingValue; side: CombineSide } | null,
  warnings: PlanWarning[],
): PlanShipping | null {
  // The shipping reward (MVP 4, R2) ranks like a rule: automatic, priority 0, id `reward:shipping`.
  type ShipCandidate = { id: string; priority: number; rule: Rule | null; side: CombineSide; value: ShippingValue; key: number[] };
  const all: ShipCandidate[] = rules
    .filter((r) => r.cls === "shipping" && r.state === null)
    .map((rule): ShipCandidate | null => {
      const percent = rule.valueKind === "freeShipping" ? 100 : rule.valueKind === "percentage" ? rule.percent : null;
      const fixed = rule.valueKind === "fixed" ? (rule.fixed ?? 0) : null;
      const value: ShippingValue = percent !== null ? { percent } : { fixedTotal: fixed ?? 0 };
      const worth = percent !== null ? percent > 0 : (fixed ?? 0) > 0;
      const key = percent !== null ? [1, percent] : [0, fixed ?? 0];
      return worth ? { id: rule.id, priority: rule.priority, rule, side: rule, value, key } : null;
    })
    .filter((c): c is ShipCandidate => c !== null);
  if (reward) all.push({ id: SHIPPING_REWARD_ID, priority: 0, rule: null, side: reward.side, value: reward.value, key: [1, 100] });
  if (all.length === 0) return null;

  const given: CombineSide[] = appliedProducts(work, ctx);
  for (const c of order?.components ?? []) {
    const rule = ctx.byId.get(c.ruleId);
    if (rule) given.push(rule);
  }
  const candidates: ShipCandidate[] = [];
  for (const c of all) {
    if (c.rule) c.rule.hadCandidate = true;
    if (given.every((g) => addUp(c.side, g))) candidates.push(c);
    else if (c.rule) c.rule.dropped = true;
    else warnings.push({ code: "reward_not_combinable", ruleId: SHIPPING_REWARD_ID });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1] || b.priority - a.priority || byId(a, b));
  const [winner, ...losers] = candidates;
  for (const c of losers) if (c.rule && c.rule.lostTo.length < MAX_BETTER_RULES) c.rule.lostTo.push(winner.id);
  if (!winner.rule) {
    return {
      ruleId: SHIPPING_REWARD_ID,
      method: "automatic",
      ownerRuleId: SHIPPING_REWARD_ID,
      ownerMethod: "automatic",
      value: winner.value,
      amount: null,
      message: SHIPPING_REWARD_LABEL[cart.locale],
    };
  }
  return {
    ruleId: winner.rule.id,
    method: winner.rule.method,
    ownerRuleId: winner.rule.id,
    ownerMethod: winner.rule.method,
    value: winner.value,
    amount: null,
    message: label(winner.rule, cart.locale, cart.currency),
  };
}

// --- Stage: outcomes -----------------------------------------------------------------------------

function buildOutcomes(
  rules: Rule[],
  work: WorkLine[],
  order: PlanOrder | null,
  shipping: PlanShipping | null,
  cart: NormalizedCart,
  codes: ReturnType<typeof matchCodes>,
): { outcomes: RuleOutcome[]; codeOutcomes: CodeOutcome[] } {
  const contribution = new Map<string, { amount: number; lineIds: string[]; owner: boolean; combinedInto?: string }>();
  const credit = (ruleId: string, amount: number, owner: string, lineId?: string) => {
    let c = contribution.get(ruleId);
    if (!c) contribution.set(ruleId, (c = { amount: 0, lineIds: [], owner: false }));
    c.amount += amount;
    if (lineId) c.lineIds.push(lineId);
    if (ruleId === owner) c.owner = true;
    else if (c.combinedInto === undefined) c.combinedInto = owner;
  };
  for (const w of work) {
    if (!w.product) continue;
    for (const comp of w.product.components) credit(comp.ruleId, comp.amount, w.product.ownerRuleId, w.line.id);
  }
  for (const comp of order?.components ?? []) credit(comp.ruleId, comp.amount, order!.ownerRuleId);
  if (shipping) credit(shipping.ruleId, shipping.amount ?? 0, shipping.ownerRuleId);

  const outcomes: RuleOutcome[] = rules.map((rule) => {
    const c = contribution.get(rule.id);
    const state: RuleState =
      rule.state ??
      // dropped before outranked: a rule of the losing category could not have applied either way
      // not_combinable first: a category switch that dropped the rule decides, whatever margin did.
      // margin_floor: margin protection took a contribution it had won (alone or stacked) to 0.
      (c?.owner
        ? "applied"
        : c
          ? "combined"
          : rule.dropped
            ? "not_combinable"
            : rule.marginFloored
              ? "margin_floor"
              : rule.hadCandidate
                ? "outranked"
                : "zero_value");
    const out: RuleOutcome = {
      ruleId: rule.id,
      name: rule.name,
      method: rule.method,
      discountClass: rule.cls,
      state,
      amount: c?.amount ?? 0,
      lineIds: c?.lineIds ?? [],
      enteredCodes: codes.enteredByRule.get(rule.id) ?? [],
      // The payload has only code hashes: describe a code rule by the codes the
      // customer actually entered (describeRule caps each for display).
      describable: rule.method === "code" ? { ...rule.describable, codes: codes.enteredByRule.get(rule.id) ?? [] } : rule.describable,
    };
    if (state === "below_minimum" && rule.missing) out.missing = rule.missing;
    if (rule.items && rule.items.length > 0) out.items = rule.items;
    if (rule.startsOn) out.startsOn = rule.startsOn;
    if (rule.endsOn) out.endsOn = rule.endsOn;
    if (state === "outranked" && rule.lostTo.length > 0) out.betterRuleIds = [...rule.lostTo];
    if (state === "combined" && c?.combinedInto) out.combinedInto = c.combinedInto;
    return out;
  });
  const outcomeById = new Map(outcomes.map((o) => [o.ruleId, o]));

  const codeOutcomes: CodeOutcome[] = cart.enteredCodes.map((code, index) => {
    if (index >= cart.consideredCodes) return { code, ruleId: null, state: "over_limit" };
    const rule = codes.ownerOfCode.get(code);
    if (!rule) return { code, ruleId: null, state: "unknown" };
    if (codes.enteredByRule.get(rule.id)?.[0] !== code) return { code, ruleId: rule.id, state: "same_rule" };
    return { code, ruleId: rule.id, state: outcomeById.get(rule.id)!.state };
  });
  return { outcomes, codeOutcomes };
}

// --- The plan -------------------------------------------------------------------------------

function buildPlan(cart: NormalizedCart, shipped: Rec, opts: { hint: boolean } = { hint: true }): CartPlan {
  const { currency, locale } = cart;
  // 7 Oct 2026: the cart's own market's amounts stand in for its currency's (market-amounts.ts); everything below reads by currency.
  const config = marketAmountsView(shipped, cart);
  // Combining (combine.ts): the lists as the payload says them, and each module's discount as one side of the rule.
  const lists = readCombine(config);
  const masks = lists.masks;
  const outlet: CombineSide = { id: "outlet", bit: COMBINE_BIT.outlet, mask: masks.outlet, except: [] };
  const tierSide: CombineSide = { id: "tiers", bit: COMBINE_BIT.tiers, mask: masks.tiers, except: [] };
  const { campaign, rules, retargeted, byId: rulesById } = resolveRules(config, cart, lists);
  const codes = matchCodes(rules, cart, readMaxCodeLength(config));
  const { work, cartScope, ruleScopes, groupCounts, itemRuleIds } = prepareLines(cart, outlet, tierSide, campaign?.id ?? null, retargeted, rulesById);
  gateRules(rules, { cart, marketCountries: readMarketCountries(config), cartScope }, ruleScopes, codes.enteredByRule, itemRuleIds);
  applyItemMinimums(rules, work, groupCounts, itemRuleIds);
  // MVP 6.1 (L4): a live campaign that carries tier sets runs THEM, the base sets are not read at all; any other
  // run reads the base sets as shipped. Exactly one part is read (the function's budget counts on it).
  const tiers = prepareTiers(work, campaign?.tiers ?? (config.modules as Rec).tiers, locale, currency, masks.tiers);
  const byId = new Map(rulesById);
  for (const rule of tiers.rules) byId.set(rule.id, rule);

  const stacking = masks.tiers !== 0 || rules.some((r) => r.mask !== 0 || r.except.length > 0);
  const stackCtx: StackContext = { byId, stacking, outlet, locale, currency };
  planProducts(work, stackCtx);
  const margin = readMarginPayload((config.modules as Rec).margin);
  if (margin.enabled) {
    computeFloors(work, margin, cart);
    applyMarginProtection(work, stackCtx);
  }
  const order = planOrderStage(rules, tiers.rules, work, stackCtx, margin.enabled);
  if (margin.enabled) {
    if (order) order.marginProtected = true;
    markTightLines(work, order);
  }
  // Rewards (MVP 4): the base before every discount (R1); the gift goes on after margin and the
  // order stage, which never see a gift line (R3).
  const rewards = readRewardsPayload((config.modules as Rec).rewards);
  const base = rewardBase(work);
  const warnings: PlanWarning[] = [];
  const rewardShipping = shippingReward(rewards, base, currency);
  const shippingSide: CombineSide = { id: SHIPPING_REWARD_ID, bit: COMBINE_BIT.shipping, mask: masks.rewards, except: [], reward: "shipping" };
  const shipping = planShipping(rules, work, order, stackCtx, cart, rewardShipping ? { ...rewardShipping, side: shippingSide } : null, warnings);
  // The gift is free only when it adds up with every discount the cart got: product discounts and tiers, the
  // order discount, the shipping discount.
  const giftSide: CombineSide = { id: "gift", bit: COMBINE_BIT.rewards, mask: masks.rewards, except: [], reward: "gift" };
  const given: CombineSide[] = appliedProducts(work, stackCtx);
  for (const c of order?.components ?? []) given.push(byId.get(c.ruleId) as Rule);
  if (shipping) given.push(shipping.ruleId === SHIPPING_REWARD_ID ? shippingSide : (byId.get(shipping.ruleId) as Rule));
  const giftStage = planGifts(work, rewards, base, currency, locale, given.every((g) => addUp(giftSide, g)));
  const { outcomes, codeOutcomes } = buildOutcomes(rules, work, order, shipping, cart, codes);
  const afterBase =
    base - work.reduce((sum, w) => sum + (w.line.gift ? 0 : (w.product?.amount ?? 0)), 0) - (order?.amount ?? 0);
  const progress = rewardsProgress(rewards, base, afterBase, currency);
  if (!rewards.shipping?.[currency] && rewards.shipping) warnings.unshift({ code: "market_missing_threshold", ruleId: SHIPPING_REWARD_ID });
  warnings.push(...giftStage.warnings, ...progress.warnings);
  const hint = opts.hint ? checkedTierHint(tierHint(tiers, work), cart, config) : null;

  const lines: PlanLine[] = work.map((w) => ({
    lineId: w.line.id,
    productId: w.line.productId,
    variantId: w.line.variantId,
    quantity: w.line.quantity,
    unitPrice: w.line.unitPrice,
    subtotal: w.line.subtotal,
    excluded: w.excluded,
    product: w.product,
    ...(w.marginCapped ? { marginCapped: w.marginCapped } : {}),
    ...(w.marginTight ? { marginTight: true as const } : {}),
  }));
  const subtotal = cart.lines.reduce((sum, l) => sum + l.subtotal, 0);
  const productDiscount = lines.reduce((sum, l) => sum + (l.product?.amount ?? 0), 0);
  const orderDiscount = order?.amount ?? 0;

  return {
    currency,
    locale,
    today: cart.today,
    campaignId: campaign?.id ?? null,
    lines,
    order,
    shipping,
    rules: outcomes,
    tiers: tierOutcomes(tiers, work),
    codes: codeOutcomes,
    gifts: giftStage.gifts,
    warnings,
    progress: {
      ...(progress.freeShipping ? { freeShipping: progress.freeShipping } : {}),
      ...(progress.gifts ? { gifts: progress.gifts } : {}),
      ...(hint ? { tierHint: hint } : {}),
    },
    totals: { subtotal, productDiscount, orderDiscount, total: subtotal - productDiscount - orderDiscount },
  };
}

/**
 * MVP 3 debt (R4): the tier hint is kept only when the cart with the missing
 * items really gives the hinted line its set's tier — not when an exclusive
 * order discount, a better rule or the Free switches would win there. When
 * margin protection lowers it, the hint says so (`marginCapped`): the
 * storefront then promises a lower price, never a value.
 */
function checkedTierHint(hint: TierHint | null, cart: NormalizedCart, config: Rec): TierHint | null {
  if (!hint) return null;
  const target = hint.lineIds[0];
  const lines = cart.lines.map((l) =>
    l.id === target ? { ...l, quantity: l.quantity + hint.missing, subtotal: l.unitPrice * (l.quantity + hint.missing) } : l,
  );
  const plan = buildPlan({ ...cart, lines }, config, { hint: false });
  const line = plan.lines.find((l) => l.lineId === target);
  const tierId = tierCandidateId(hint.setId);
  if (!line?.product?.components.some((c) => c.ruleId === tierId)) return null;
  return line.marginCapped ? { ...hint, marginCapped: true } : hint;
}

function failedPlan(cart: NormalizedCart | null, reason: PlanFailure, error?: string): CartPlan {
  const lines: PlanLine[] = (cart?.lines ?? []).map((l) => ({
    lineId: l.id,
    productId: l.productId,
    variantId: l.variantId,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    subtotal: l.subtotal,
    excluded: l.gift ? "gift" : l.outlet ? "outlet" : null,
    product: null,
  }));
  const subtotal = lines.reduce((sum, l) => sum + l.subtotal, 0);
  return {
    currency: cart?.currency ?? "",
    locale: cart?.locale ?? "cs",
    today: cart?.today ?? null,
    campaignId: null,
    lines,
    order: null,
    shipping: null,
    rules: [],
    tiers: [],
    codes: [],
    gifts: [],
    warnings: [],
    progress: {},
    totals: { subtotal, productDiscount: 0, orderDiscount: 0, total: subtotal },
    reason,
    ...(error ? { error } : {}),
  };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Plan the discounts for one cart. Never throws: an unreadable cart is
 * `reason: "invalid_input"`, a missing/invalid shared config (e.g. a shop
 * metafield over 10 000 B arrives as `null`, C7) is `reason: "config_missing"`,
 * and either plan emits nothing — checkout is never blocked (principle 4).
 */
export function planCart(input: CartPlanInput, config: PlanConfig | null | undefined): CartPlan {
  let cart: NormalizedCart;
  try {
    cart = normalizeCart(input);
  } catch (e) {
    return failedPlan(null, "invalid_input", errorText(e));
  }
  if (!isFunctionConfigPayload(config)) return failedPlan(cart, "config_missing");
  try {
    return buildPlan(cart, config as unknown as Rec);
  } catch (e) {
    return failedPlan(cart, "internal_error", errorText(e));
  }
}
