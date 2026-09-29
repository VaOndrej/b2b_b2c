// The discount function's output (spec §3 "Emise per uzel", doctrine DATA-4):
// a node's NodeEmission → the operations Shopify receives. ONE implementation:
//   - the parity oracle: extensions/won-discounts-engine/tests/reference-adapter.js
//     maps every fixture and every random case with it, and the Rust function
//     (src/output.rs) must write exactly the same output;
//   - the admin "Vyzkoušet košík": checkoutPreview() says what the checkout will
//     actually apply per line, and warns when the output had to be degraded.
//
// Shopify refuses a function output over 20 kB (1 kB = 1000 B) for carts up to
// 200 lines — the limit scales with the line count above that
// (shopify.dev/docs/api/functions/2026-04, "Resource limits") — and then the
// node gives NO discount at all. So:
//   1. every product value is emitted exactly, in the most groupable form:
//      - a fixed amount per item equal to the unit price (the item is free) → 100 %;
//      - a Pro stack (fixed total T on a line of subtotal S, quantity q):
//        T = S → 100 %; a stack of whole percents P whose Math.round(S × ΣP / 100)
//        is T → ΣP %; T divisible by q → T / q per item; else T once on that line;
//      - a percent whose amount lands on half a minor unit (a rounding tie,
//        roundingTiePossible) → its exact amount instead: Shopify rounds the
//        decimal S × P / 100 itself and may round a tie the other way than
//        the plan's Math.round (audit MVP 1 drift #4). The same for a stack's
//        summed percent and for an order percent;
//   2. candidates with the same message and value share one candidate with
//      several targets (a fixed total on one line never groups: shared, it
//      would be applied ONCE across all its targets);
//   3. over the budget (19 000 B, scaled like Shopify's limit) every Pro stack
//      is emitted as its top rule's own value instead (it groups; the customer
//      keeps the larger part of the stack), then, as a last resort, the product
//      candidates that save the least are dropped until the output fits.
// Sizes are the UTF-8 bytes of the compact JSON (what JSON.stringify writes).
//
// Delivery: a percent applies to every delivery group; a FIXED amount goes to
// the first group only. Shopify's docs do not say that one fixed candidate on
// several groups is taken once, and the plan counts it once (audit MVP 1 drift
// #5): on a split shipment the customer gets the amount once, never N times.

import { normalizeCode } from "./cart.ts";
import { describeRule } from "./describe.ts";
import { emitForNode, type NodeEmission, type NodeRole, type ProductCandidate } from "./emit.ts";
import { fromMinorUnits, toMinorUnits } from "./money.ts";
import type { CartPlan, DiscountClass, PlanLine, PlanStack, RuleOutcome } from "./plan.ts";

/** Shopify's function output limit for carts up to 200 lines, bytes. */
export const OUTPUT_LIMIT_BYTES = 20000;
/** What the function allows itself, ≥ 5 % under the limit. */
export const OUTPUT_BUDGET_BYTES = 19000;

/** Shopify's output limit for a cart of `lineCount` lines (it scales with the line count above 200). */
export function outputLimit(lineCount: number): number {
  return Math.floor((OUTPUT_LIMIT_BYTES * Math.max(200, lineCount)) / 200);
}

/** The output budget for a cart of `lineCount` lines (Shopify scales its limits above 200 lines). */
export function outputBudget(lineCount: number): number {
  return Math.floor((OUTPUT_BUDGET_BYTES * Math.max(200, lineCount)) / 200);
}

/** UTF-8 bytes of the compact JSON of `value`. */
export function outputBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * True when `base × percent / 100` (minor units) may be a rounding tie: its
 * fraction is half a minor unit in decimal arithmetic, which is what Shopify
 * computes. The binary float can land a hair either side of .5 (2 750 × 1.4 % =
 * 38.49999999999999, 38.5 in decimal), so the test has a tolerance; a false
 * positive only costs grouping (the exact amount is emitted instead).
 * The Rust function evaluates the same IEEE expression (output.rs tie_possible).
 */
export function roundingTiePossible(base: number, percent: number): boolean {
  const exact = (base * percent) / 100;
  const fraction = exact - Math.floor(exact);
  return Math.abs(fraction - 0.5) <= 1e-7 * Math.max(1, exact);
}

// --- Output shapes ---------------------------------------------------------------------------

export type FunctionDiscountClass = "PRODUCT" | "ORDER" | "SHIPPING";

export type CandidateValue =
  | { percentage: { value: number } }
  | { fixedAmount: { amount: string; appliesToEachItem?: boolean } };

export interface ProductDiscountCandidateOutput {
  message: string;
  targets: { cartLine: { id: string } }[];
  value: CandidateValue;
}
export interface OrderDiscountCandidateOutput {
  message: string;
  targets: { orderSubtotal: { excludedCartLineIds: string[] } }[];
  value: CandidateValue;
}
export interface DeliveryDiscountCandidateOutput {
  message: string;
  targets: { deliveryGroup: { id: string } }[];
  value: CandidateValue;
}

export type CartLinesOperation =
  | { productDiscountsAdd: { candidates: ProductDiscountCandidateOutput[]; selectionStrategy: "ALL" } }
  | { orderDiscountsAdd: { candidates: OrderDiscountCandidateOutput[]; selectionStrategy: "FIRST" } };
export type DeliveryOperation = { deliveryDiscountsAdd: { candidates: DeliveryDiscountCandidateOutput[]; selectionStrategy: "ALL" } };

/** `cart.lines.discounts.generate.run` output. */
export interface CartLinesFunctionResult {
  operations: CartLinesOperation[];
}
/** `cart.delivery-options.discounts.generate.run` output. */
export interface DeliveryFunctionResult {
  operations: DeliveryOperation[];
}

export interface FunctionOutputInput {
  /** The node's plan (null: the node's role is unknown, it emits nothing). */
  plan: CartPlan | null;
  /** The node's discount classes: a candidate of another class would be refused. */
  classes: readonly string[];
  /** Cart lines in the function input (Shopify scales its output limit above 200). */
  lineCount: number;
  /** The cart's delivery groups, in input order (delivery target). */
  deliveryGroupIds?: readonly string[];
}

/** A line whose Pro stack was emitted as its top rule's value (over the budget). */
export interface DegradedStack {
  lineId: string;
  /** What the plan gives on the line, minor units. */
  planned: number;
  /** What the emitted top rule gives, minor units. */
  emitted: number;
}

/** A product candidate left out to fit the output budget. */
export interface DroppedCandidate {
  message: string;
  lineIds: string[];
  /** What it would have saved, minor units. */
  amount: number;
}

export interface MappedFunctionOutput {
  lines: CartLinesFunctionResult;
  delivery: DeliveryFunctionResult;
  /** True when the lines output is not the exact plan (stacks degraded or candidates dropped). */
  degraded: boolean;
  /** Bytes of the exact lines output, and of the one emitted. */
  exactBytes: number;
  bytes: number;
  budget: number;
  degradedStacks: DegradedStack[];
  droppedCandidates: DroppedCandidate[];
}

// --- Product candidates ------------------------------------------------------------------------

interface Mapped {
  /** Grouping key (null = never grouped). */
  key: string | null;
  value: CandidateValue;
}

interface Draft {
  message: string;
  targets: { cartLine: { id: string } }[];
  value: CandidateValue;
  /** What the candidate saves in total, minor units (orders the last-resort drop). */
  amount: number;
}

const percentValue = (value: number): Mapped => ({ key: `p${value}`, value: { percentage: { value } } });

const perItemValue = (minor: number, currency: string): Mapped => ({
  key: `e${minor}`,
  value: { fixedAmount: { amount: fromMinorUnits(minor, currency), appliesToEachItem: true } },
});

/** An exact amount on one line: the whole line → 100 %, divisible → per item, else once on that line. */
function exactAmount(total: number, line: PlanLine, currency: string): Mapped {
  if (total === line.subtotal) return percentValue(100);
  if (line.quantity > 0 && total % line.quantity === 0) return perItemValue(total / line.quantity, currency);
  return { key: null, value: { fixedAmount: { amount: fromMinorUnits(total, currency), appliesToEachItem: false } } };
}

function ruleOf(plan: CartPlan, ruleId: string): RuleOutcome | undefined {
  return plan.rules.find((r) => r.ruleId === ruleId);
}

/** ΣP when every component of the stack is a whole-percent rule, else null. */
function wholePercentSum(plan: CartPlan, stack: PlanStack): number | null {
  let sum = 0;
  for (const component of stack.components) {
    const value = ruleOf(plan, component.ruleId)?.describable.value;
    if (value?.kind !== "percentage" || !Number.isInteger(value.percent)) return null;
    sum += value.percent;
  }
  return sum;
}

/** One emitted product candidate → its exact output value, in the most groupable form. */
function exactProductValue(c: ProductCandidate, line: PlanLine, plan: CartPlan): Mapped {
  const currency = plan.currency;
  if (c.percent !== undefined) {
    return roundingTiePossible(line.subtotal, c.percent) ? exactAmount(c.amount, line, currency) : percentValue(c.percent);
  }
  if (c.fixedPerItem !== undefined) {
    return c.fixedPerItem === line.unitPrice ? percentValue(100) : perItemValue(c.fixedPerItem, currency);
  }
  const total = c.fixedTotal;
  if (total === line.subtotal) return percentValue(100);
  const percent = line.product ? wholePercentSum(plan, line.product) : null;
  if (percent !== null && Math.round((line.subtotal * percent) / 100) === total && !roundingTiePossible(line.subtotal, percent)) {
    return percentValue(percent);
  }
  return exactAmount(total, line, currency);
}

/**
 * A Pro stack emitted as its top rule's own value (the first component, which
 * the stack never caps): the rule's percent (its exact amount on a tie), or its
 * fixed amount per item.
 */
function topRuleValue(line: PlanLine, plan: CartPlan): Mapped & { message: string; amount: number } {
  const stack = line.product as PlanStack;
  const top = stack.components[0];
  const rule = ruleOf(plan, top.ruleId) as RuleOutcome;
  const message = rule.name || describeRule(rule.describable, plan.locale, plan.currency, { short: true });
  const value = rule.describable.value;
  if (value.kind === "percentage") {
    const mapped = roundingTiePossible(line.subtotal, value.percent) ? exactAmount(top.amount, line, plan.currency) : percentValue(value.percent);
    return { ...mapped, message, amount: top.amount };
  }
  const perItem = top.amount / line.quantity;
  const mapped = perItem === line.unitPrice ? percentValue(100) : perItemValue(perItem, plan.currency);
  return { ...mapped, message, amount: top.amount };
}

/**
 * The node's product candidates, grouped. Each emitted candidate is matched to
 * its plan line (the emission follows the plan's line order).
 */
function productDrafts(emission: NodeEmission, plan: CartPlan, degradeStacks: boolean, degraded: DegradedStack[] | null): Draft[] {
  const out: Draft[] = [];
  const shared = new Map<string, Draft>();
  let next = 0;
  for (const c of emission.productCandidates) {
    while (next < plan.lines.length && !(plan.lines[next].lineId === c.lineId && plan.lines[next].product)) next += 1;
    const line = plan.lines[next];
    next += 1;
    if (!line?.product) continue;
    const stacked = line.product.components.length > 1;
    const mapped =
      degradeStacks && stacked ? topRuleValue(line, plan) : { ...exactProductValue(c, line, plan), message: c.message, amount: c.amount };
    if (degradeStacks && stacked && degraded) degraded.push({ lineId: c.lineId, planned: c.amount, emitted: mapped.amount });
    const target = { cartLine: { id: c.lineId } };
    const key = mapped.key === null ? null : JSON.stringify([mapped.message, mapped.key]);
    const existing = key === null ? undefined : shared.get(key);
    if (existing) {
      existing.targets.push(target);
      existing.amount += mapped.amount;
      continue;
    }
    const draft: Draft = { message: mapped.message, targets: [target], value: mapped.value, amount: mapped.amount };
    out.push(draft);
    if (key !== null) shared.set(key, draft);
  }
  return out;
}

/** Order / delivery values have no per-item variant. */
function totalValue(value: { percent?: number; fixedTotal?: number }, currency: string): CandidateValue | null {
  if (value.percent !== undefined) return { percentage: { value: value.percent } };
  if (value.fixedTotal !== undefined) return { fixedAmount: { amount: fromMinorUnits(value.fixedTotal, currency) } };
  return null;
}

function cartLinesResult(products: Draft[], orderOperations: CartLinesOperation[]): CartLinesFunctionResult {
  const operations: CartLinesOperation[] = [];
  // Every candidate targets different lines (≤ 1 product allocation per line), so all apply.
  if (products.length > 0) {
    operations.push({
      productDiscountsAdd: {
        candidates: products.map(({ message, targets, value }) => ({ message, targets, value })),
        selectionStrategy: "ALL",
      },
    });
  }
  return { operations: [...operations, ...orderOperations] };
}

/**
 * NodeEmission → the node's function output for both targets: the lines target
 * (product + order candidates of the node's classes, within the output budget)
 * and the delivery target (the shipping winner on the delivery groups). Plus
 * what the budget cost: degraded Pro stacks and dropped candidates.
 */
export function mapToFunctionOutput(emission: NodeEmission, input: FunctionOutputInput): MappedFunctionOutput {
  const { plan, classes } = input;
  const budget = outputBudget(input.lineCount);
  const none: MappedFunctionOutput = {
    lines: { operations: [] },
    delivery: { operations: [] },
    degraded: false,
    exactBytes: outputBytes({ operations: [] }),
    bytes: outputBytes({ operations: [] }),
    budget,
    degradedStacks: [],
    droppedCandidates: [],
  };
  if (plan === null) return none;
  const currency = plan.currency;

  const orderOperations: CartLinesOperation[] = [];
  if (classes.includes("ORDER")) {
    const candidates: OrderDiscountCandidateOutput[] = [];
    for (const c of emission.orderCandidates) {
      const base = plan.order?.base ?? 0;
      const value =
        c.percent !== undefined && roundingTiePossible(base, c.percent)
          ? { fixedAmount: { amount: fromMinorUnits(c.amount, currency) } }
          : totalValue(c, currency);
      if (!value) continue;
      candidates.push({ message: c.message, targets: [{ orderSubtotal: { excludedCartLineIds: [...c.excludedLineIds] } }], value });
    }
    if (candidates.length > 0) orderOperations.push({ orderDiscountsAdd: { candidates, selectionStrategy: "FIRST" } });
  }

  const delivery: DeliveryFunctionResult = { operations: [] };
  const groups = input.deliveryGroupIds ?? [];
  if (classes.includes("SHIPPING") && groups.length > 0) {
    const candidates: DeliveryDiscountCandidateOutput[] = [];
    for (const c of emission.deliveryCandidates) {
      const value = totalValue(c, currency);
      if (!value) continue;
      const targeted = c.percent !== undefined ? groups : groups.slice(0, 1);
      candidates.push({ message: c.message, targets: targeted.map((id) => ({ deliveryGroup: { id } })), value });
    }
    if (candidates.length > 0) delivery.operations.push({ deliveryDiscountsAdd: { candidates, selectionStrategy: "ALL" } });
  }

  let products = classes.includes("PRODUCT") ? productDrafts(emission, plan, false, null) : [];
  const exact = cartLinesResult(products, orderOperations);
  const exactBytes = outputBytes(exact);
  if (exactBytes <= budget) {
    return { ...none, lines: exact, delivery, exactBytes, bytes: exactBytes };
  }
  const degradedStacks: DegradedStack[] = [];
  products = productDrafts(emission, plan, true, degradedStacks);
  const droppedCandidates: DroppedCandidate[] = [];
  let result = cartLinesResult(products, orderOperations);
  while (products.length > 0 && outputBytes(result) > budget) {
    // Last resort: drop the candidate that saves the least (ties: the later one).
    let drop = 0;
    for (let k = 1; k < products.length; k += 1) if (products[k].amount <= products[drop].amount) drop = k;
    const [dropped] = products.splice(drop, 1);
    droppedCandidates.push({ message: dropped.message, lineIds: dropped.targets.map((t) => t.cartLine.id), amount: dropped.amount });
    result = cartLinesResult(products, orderOperations);
  }
  return {
    lines: result,
    delivery,
    degraded: true,
    exactBytes,
    bytes: outputBytes(result),
    budget,
    degradedStacks: degradedStacks.filter((s) => s.emitted !== s.planned),
    droppedCandidates,
  };
}

// --- What the checkout applies (admin "Vyzkoušet košík") ------------------------------------------

export interface CheckoutPreviewNode {
  role: NodeRole;
  /** The code that triggers a code node (its rule's first entered code); null for the automatic node. */
  triggeringCode: string | null;
  output: MappedFunctionOutput;
}

export interface CheckoutPreview {
  /** Every Won node that runs for this cart: the automatic one, and one per entered Won code rule. */
  nodes: CheckoutPreviewNode[];
  /** Per plan line: the product discount planned and what the emitted operations take off, minor units. */
  lines: { lineId: string; planned: number; applied: number }[];
  order: { planned: number; applied: number };
  /** True when some node's output is not the exact plan (over the output budget). */
  degraded: boolean;
  degradedStacks: DegradedStack[];
  droppedCandidates: DroppedCandidate[];
  /** Planned product + order discount the checkout will not apply, minor units (0 unless degraded). */
  shortfall: number;
}

const CLASS_OF: Record<DiscountClass, FunctionDiscountClass> = { product: "PRODUCT", order: "ORDER", shipping: "SHIPPING" };

/** What one product candidate takes off one line (Shopify's arithmetic; ties are never emitted as a percent). */
function appliedOnLine(value: CandidateValue, line: PlanLine, currency: string): number {
  if ("percentage" in value) return Math.round((line.subtotal * value.percentage.value) / 100);
  const amount = toMinorUnits(value.fixedAmount.amount, currency) ?? 0;
  if (value.fixedAmount.appliesToEachItem) return Math.min(amount, line.unitPrice) * line.quantity;
  return Math.min(amount, line.subtotal);
}

/**
 * The plan as the checkout will apply it: every node's output mapped exactly as
 * the function maps it (automatic node with all classes; each entered Won code
 * rule's node with its rule's class), and per line what those operations take
 * off. `degraded` + `shortfall` say when the output budget made the checkout
 * give less than the plan — the admin must then say so instead of showing the
 * plan's numbers as what the customer gets.
 */
export function checkoutPreview(plan: CartPlan, opts: { lineCount?: number; deliveryGroupIds?: readonly string[] } = {}): CheckoutPreview {
  const lineCount = opts.lineCount ?? plan.lines.length;
  const nodes: CheckoutPreviewNode[] = [];
  const run = (role: NodeRole, triggeringCode: string | null, classes: readonly string[]) => {
    const emission = emitForNode(plan, role, triggeringCode);
    nodes.push({ role, triggeringCode, output: mapToFunctionOutput(emission, { plan, classes, lineCount, deliveryGroupIds: opts.deliveryGroupIds }) });
  };
  run({ kind: "automatic" }, null, ["PRODUCT", "ORDER", "SHIPPING"]);
  for (const rule of plan.rules) {
    if (rule.method !== "code" || rule.enteredCodes.length === 0) continue;
    run({ kind: "code", ruleId: rule.ruleId }, normalizeCode(rule.enteredCodes[0]), [CLASS_OF[rule.discountClass]]);
  }

  const byId = new Map(plan.lines.map((l) => [l.lineId, l]));
  const applied = new Map<string, number>();
  let orderApplied = 0;
  for (const node of nodes) {
    for (const op of node.output.lines.operations) {
      if ("productDiscountsAdd" in op) {
        for (const c of op.productDiscountsAdd.candidates) {
          for (const t of c.targets) {
            const line = byId.get(t.cartLine.id);
            if (line) applied.set(line.lineId, (applied.get(line.lineId) ?? 0) + appliedOnLine(c.value, line, plan.currency));
          }
        }
      } else {
        for (const c of op.orderDiscountsAdd.candidates) {
          const base = plan.order?.base ?? 0;
          orderApplied +=
            "percentage" in c.value
              ? Math.round((base * c.value.percentage.value) / 100)
              : Math.min(toMinorUnits(c.value.fixedAmount.amount, plan.currency) ?? 0, base);
        }
      }
    }
  }
  const lines = plan.lines.map((l) => ({ lineId: l.lineId, planned: l.product?.amount ?? 0, applied: applied.get(l.lineId) ?? 0 }));
  const order = { planned: plan.order?.amount ?? 0, applied: orderApplied };
  const planned = lines.reduce((s, l) => s + l.planned, 0) + order.planned;
  const got = lines.reduce((s, l) => s + l.applied, 0) + order.applied;
  return {
    nodes,
    lines,
    order,
    degraded: nodes.some((n) => n.output.degraded),
    degradedStacks: nodes.flatMap((n) => n.output.degradedStacks),
    droppedCandidates: nodes.flatMap((n) => n.output.droppedCandidates),
    shortfall: Math.max(0, planned - got),
  };
}
