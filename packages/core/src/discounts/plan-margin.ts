// Margin protection stages of planCart (MVP 2, spec §3 bod 7, §4.5): the
// floors of the lines, the product-stage cap, the order-stage search and the
// lines the output must emit exactly. plan.ts calls them only when the shared
// config's margin is ON; the arithmetic lives in margin.ts. The Rust function
// ports this file 1:1 (engine/plan.rs + engine/margin.rs): same stages, same
// float expressions in the same order.

import type { NormalizedCart } from "./cart.ts";
import { costMinorUnits, type FunctionMarginPayload, marginFloorUnit, type MarginSettings, resolveMargin } from "./margin.ts";
import type { EmittedValue, PlanOrder, PlanStack } from "./plan.ts";
import { type Candidate, label, orderAmount, ownerOf, type Rule, type StackContext, type WorkLine } from "./plan-internal.ts";

// --- Floors and the product stage ----------------------------------------------------------------

export type MarginOn = Extract<FunctionMarginPayload, { enabled: true }>;

/** The floor of every discountable line (margin.ts): its settings, its cost in the cart currency, its lowest item price. */
export function computeFloors(work: WorkLine[], margin: MarginOn, cart: NormalizedCart): void {
  for (const w of work) {
    if (w.excluded !== null) continue;
    const settings = resolveMargin(margin, w.line.marginRefs) as MarginSettings;
    const costMinor = costMinorUnits(
      w.line.unitCost ?? undefined,
      w.line.unitCostCurrency ?? undefined,
      cart.shopToCartRate ?? undefined,
      cart.currency,
      margin.cur,
    );
    const { floorUnit, basis } = marginFloorUnit({
      unitPrice: w.line.unitPrice,
      costMinor,
      minMarginPercent: settings.minMarginPercent,
      maxDiscountPercent: settings.maxDiscountPercent,
    });
    w.floor = { floorUnit, basis, settings };
  }
}

/**
 * Components (rank order) cut down to `total`, in rank order: each keeps what
 * fits in what is left. A rule left with nothing is marked margin-floored.
 */
function cutInRankOrder(components: Candidate[], total: number): Candidate[] {
  const kept: Candidate[] = [];
  let remaining = total;
  for (const c of components) {
    const amount = Math.min(c.amount, remaining);
    if (amount > 0) {
      kept.push({ rule: c.rule, amount });
      remaining -= amount;
    } else {
      c.rule.marginFloored = true;
    }
  }
  return kept;
}

/** A stack rebuilt from what margin protection left of it: owner (ownerOf) and message recomputed. */
function restack(kept: Candidate[], value: EmittedValue, ctx: StackContext): PlanStack {
  const owner = ownerOf(kept);
  return {
    components: kept.map((c) => ({ ruleId: c.rule.id, method: c.rule.method, module: "codes", amount: c.amount })),
    amount: kept.reduce((sum, c) => sum + c.amount, 0),
    ownerRuleId: owner.id,
    ownerMethod: owner.method,
    value,
    message: kept.map((c) => label(c.rule, ctx.locale, ctx.currency)).join(" + "),
  };
}

/**
 * Each line's product allocation (the winner stack planProducts picked) at most
 * its headroom = max(0, subtotal − floorUnit × quantity). A larger one is cut in
 * rank order and emitted as that exact total ({fixedTotal}); no headroom → no
 * product discount on the line. Cutting after the pick keeps it monotone and
 * deterministic (a rule never wins a line only because another was capped).
 */
export function applyMarginProtection(work: WorkLine[], ctx: StackContext): void {
  for (const w of work) {
    const stack = w.product;
    const floor = w.floor;
    if (!stack || !floor) continue;
    const headroom = Math.max(0, w.line.subtotal - floor.floorUnit * w.line.quantity);
    if (stack.amount <= headroom) continue;
    const kept = cutInRankOrder(
      stack.components.map((c) => ({ rule: ctx.byId.get(c.ruleId) as Rule, amount: c.amount })),
      headroom,
    );
    w.product = kept.length > 0 ? restack(kept, { fixedTotal: headroom }, ctx) : null;
    w.marginCapped = {
      before: stack.amount,
      after: headroom,
      floorUnit: floor.floorUnit,
      basis: floor.basis,
      ...(floor.basis === "cost"
        ? { minMarginPercent: floor.settings.minMarginPercent }
        : { maxDiscountPercent: floor.settings.maxDiscountPercent }),
      source: floor.settings.source,
    };
  }
}

// --- The order stage ---------------------------------------------------------------------------------

/** One line of the order-stage search (searchOrderSets), given in cart order. */
export interface OrderSetLine {
  /** a_i: the line after its product discount (> 0). */
  after: number;
  /** s_i: the line before it (its subtotal). */
  before: number;
  /** h_i = max(0, a_i − floorUnit × q − 1): what it can give, 1 minor unit kept for rounding. */
  headroom: number;
}

/** A candidate set I and what it allows. */
export interface OrderSetResult {
  /** Indices into the searched lines (cart order), ascending. */
  members: number[];
  /** D(I) = min(wanted(I), D_max(I)). */
  amount: number;
  /** S_I = Σ a_i over I. */
  base: number;
  /** wanted(I): the order discount recomputed at base S_I. */
  wanted: number;
}

const NO_SET: OrderSetResult = { members: [], amount: 0, base: 0, wanted: 0 };

/**
 * The best prefix set of ONE ordering: the lines sorted by `keys` descending
 * (ties: cart order); a candidate is every prefix that ends where the key
 * changes (lines with an equal key enter together), and the full set. For each:
 *   S = Σ a_i, S0 = Σ s_i,
 *   D_max = min over i of min(floor((h_i × S) / a_i), floor((h_i × S0) / s_i)),
 *   D = min(wantedAt(S), D_max);
 * the largest D wins, a tie goes to the larger set.
 */
function bestPrefixSet(lines: readonly OrderSetLine[], keys: readonly number[], wantedAt: (base: number) => number): OrderSetResult {
  const order = lines.map((_, i) => i).sort((x, y) => (keys[x] !== keys[y] ? keys[y] - keys[x] : x - y));
  let best = NO_SET;
  let base = 0;
  let baseBefore = 0;
  for (let j = 0; j < order.length; j++) {
    base += lines[order[j]].after;
    baseBefore += lines[order[j]].before;
    if (j + 1 < order.length && keys[order[j + 1]] === keys[order[j]]) continue;
    let limit = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= j; i++) {
      const l = lines[order[i]];
      const byAfter = Math.floor((l.headroom * base) / l.after);
      const byBefore = Math.floor((l.headroom * baseBefore) / l.before);
      limit = Math.min(limit, byAfter, byBefore);
    }
    const wanted = wantedAt(base);
    const amount = Math.min(wanted, limit);
    if (amount >= best.amount) best = { members: order.slice(0, j + 1), amount, base, wanted };
  }
  return { ...best, members: [...best.members].sort((x, y) => x - y) };
}

/**
 * The order-stage search (protectOrder): the prefix sets of TWO orderings —
 * k = h/s (headroom per pre-discount price) and k = h/a (headroom per price
 * after the product discount) — each searched as bestPrefixSet does. The better
 * D of the two wins; a tie goes to the larger set; a tie again to the h/s one.
 * `lines` in cart order (the members index into it); every a_i > 0.
 */
export function searchOrderSets(
  lines: readonly OrderSetLine[],
  wantedAt: (base: number) => number,
): { byBefore: OrderSetResult; byAfter: OrderSetResult; best: OrderSetResult } {
  const byBefore = bestPrefixSet(lines, lines.map((l) => l.headroom / l.before), wantedAt);
  const byAfter = bestPrefixSet(lines, lines.map((l) => l.headroom / l.after), wantedAt);
  const afterWins =
    byAfter.amount > byBefore.amount || (byAfter.amount === byBefore.amount && byAfter.members.length > byBefore.members.length);
  return { byBefore, byAfter, best: afterWins ? byAfter : byBefore };
}

/**
 * Margin protection of the order discount. Shopify spreads an order discount
 * over its lines proportionally but does not say on which base, so the plan is
 * safe for both: after product discounts (a_i) and before them (s_i), each
 * line keeping 1 minor unit for rounding. For a set I of lines:
 *   S_I = Σ a_i, S0_I = Σ s_i,
 *   D_max(I) = min over i ∈ I of min(floor(h_i × S_I / a_i), floor(h_i × S0_I / s_i))
 *   (each float expression evaluated exactly in that order),
 *   wanted(I) = the picked stack's components recomputed at base S_I
 *   (Σ orderAmount(rule, S_I), capped at S_I), D(I) = min(wanted(I), D_max(I)).
 * Candidate sets: searchOrderSets over the lines with a_i > 0 (both orderings,
 * h/s and h/a). Its lines outside the winning I are margin-excluded
 * (excludedCartLineIds). D = wanted(I) keeps the natural value (a percent stays
 * a percent in the plan, now over fewer lines); a lower D is {fixedTotal: D},
 * taken from the components in rank order. D = 0 → no order discount. Lines
 * with a_i = 0 carry nothing either way and are never excluded.
 */
export function protectOrder(order: PlanOrder | null, work: WorkLine[], afterOf: (w: WorkLine) => number, ctx: StackContext): PlanOrder | null {
  if (!order) return null;
  const carrying: WorkLine[] = [];
  const lines: OrderSetLine[] = [];
  for (const w of work) {
    if (w.excluded !== null || !w.floor) continue;
    const after = afterOf(w);
    if (after <= 0) continue;
    carrying.push(w);
    lines.push({ after, before: w.line.subtotal, headroom: Math.max(0, after - w.floor.floorUnit * w.line.quantity - 1) });
  }

  const components = order.components.map((c) => ctx.byId.get(c.ruleId) as Rule);
  const wantedAt = (base: number): number => {
    let sum = 0;
    for (const rule of components) sum += orderAmount(rule, base);
    return Math.min(sum, base);
  };
  const { best } = searchOrderSets(lines, wantedAt);

  if (best.amount <= 0) {
    for (const rule of components) rule.marginFloored = true;
    return null;
  }
  if (best.members.length === lines.length && best.amount === best.wanted) return order; // nothing to protect
  const inSet = new Set(best.members.map((i) => carrying[i]));
  const left = new Set(carrying.filter((w) => !inSet.has(w)));
  // The components at the winning base, in their rank order, capped at it; then cut to D.
  let remaining = best.base;
  const atBase: Candidate[] = components.map((rule) => {
    const amount = Math.max(0, Math.min(orderAmount(rule, best.base), remaining));
    remaining -= amount;
    return { rule, amount };
  });
  const kept = cutInRankOrder(atBase, best.amount);
  const natural = best.amount === best.wanted;
  const value: EmittedValue =
    natural && kept.length === 1
      ? kept[0].rule.valueKind === "percentage"
        ? { percent: kept[0].rule.percent }
        : { fixedTotal: kept[0].amount }
      : { fixedTotal: best.amount };
  return {
    ...restack(kept, value, ctx),
    base: best.base,
    excludedLineIds: work.filter((w) => w.excluded !== null || left.has(w)).map((w) => w.line.id),
    marginExcludedLineIds: work.filter((w) => left.has(w)).map((w) => w.line.id),
    ...(best.amount < order.amount ? { marginCapped: { before: order.amount, after: best.amount } } : {}),
  };
}

// --- Lines the output must emit exactly ------------------------------------------------------------

/**
 * Margin on, after the order stage: flag the lines whose product discount must
 * reach the checkout exactly — function-output.ts never relaxes a rounding tie
 * on them to a percent (Shopify rounds the decimal itself and may take 1 minor
 * unit more than the plan):
 *   - no minor unit left above the floor after the product discount
 *     (subtotal − product − floorUnit × q < 1); or
 *   - the line is in the base of the order discount: a tie relaxed on ANY base
 *     line moves that base by a minor unit, and every base line's order share is
 *     sized to its floor with 1 minor unit kept for its own rounding only.
 * A line without a product discount has nothing to relax.
 */
export function markTightLines(work: WorkLine[], order: PlanOrder | null): void {
  const excluded = new Set(order?.excludedLineIds ?? []);
  for (const w of work) {
    if (!w.product || !w.floor) continue;
    const room = w.line.subtotal - w.product.amount - w.floor.floorUnit * w.line.quantity;
    const inOrderBase = order !== null && w.excluded === null && !excluded.has(w.line.id);
    if (room < 1 || inOrderBase) w.marginTight = true;
  }
}
