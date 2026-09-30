// Quantity tiers in planCart (MVP 3, docs/plans/2026-09-30-won-discounts-mvp3.md,
// contracts K1/K2): the tier stage between the rule gate and the product stage,
// and what the admin and the storefront read about it (outcomes, counting
// groups, the "add N more" hint). The shop-config form and its tolerant reader
// are in tiers.ts.
//
// === PORT SPEC (the Rust function ports this 1:1; T2) =====================================
//
// Inputs: the cart (cart currency, lines in cart order), each line's product
// metafield `tierRef` (CartLineInput.tierRef) and the shop config's
// `modules.tiers` read by tiers.ts readTiersPayload for the cart currency (its
// header lists every reading rule).
//
// 1. Set of a line (K1). Gift lines have none. Else, by the metafield's
//    `tierRef` (fix round 2: fail closed on anything unusable):
//      absent, or JSON null  → the payload's `global` set, if any;
//      a string              → the set with exactly that id if the payload has
//                              it, else NONE ("" included: no set has that id);
//      any other JSON value  → NONE (a number, an object, an array, a bool).
//    Never the global set for a ref that is there but unusable. A line's set
//    is looked up by id in a map built once from the payload's sets (never a
//    scan over the sets per line).
// 2. Eligible lines = lines of a set that can take a product discount: not a
//    gift, and not outlet unless `engine.combination.outletWithAnything`
//    (plan.ts `excluded === null`). Only they count, and only they get a tier.
// 3. Counting groups of a set (its eligible lines, cart order; a group is
//    ordered by its first line):
//      "line"     one group per line;
//      "product"  one group per `productId` (the variants of a product together);
//      "cart"     one group of all of them (only the lines of THIS set).
//    count = Σ quantity over the group (integers).
// 4. Reached break = the break with the highest minQty ≤ count among the
//    OFFERED ones (a percent break always is; an amount break when it has an
//    amount in the cart currency, MKT-1). Breaks are ascending, so: walk them,
//    skip the not offered, the last with minQty ≤ count. None → no tier.
//    next = the first offered break with minQty > count (hint only, TS side).
// 5. Candidate on each line of a group with a reached break, id
//    `tier:<setId>` (TIER_CANDIDATE_PREFIX), method automatic, priority 0:
//      percent p:  amount = round(subtotal × p / 100) with JS Math.round
//                  semantics — engine/js.rs `round` — the same expression
//                  as a percentage rule; natural value {percent: p};
//      amount a:   perItem = min(a, unitPrice); amount = perItem × quantity;
//                  natural value {fixedPerItem: perItem}.
//    amount 0 → no candidate. message = describe.ts describeTierBreak of the
//    reached break in the cart locale and currency ("Od 3 ks −10 %",
//    "From 5 items −CZK 50 per item"; an amount break names the CONFIGURED
//    amount, not the one capped at the item price).
// 6. The product stage takes the tier candidate as one more candidate of the
//    line, next to its product rules: rank amount desc, priority desc, id asc
//    (plain string order of the ids: "a" < "tier:g" < "z"); the best one wins.
//    A tier is never part of a Pro stack (no rule can list it in
//    `combinesWith`) and takes NO place in the stack pool (fix round 2): the
//    pool is the MAX_STACK_CANDIDATES best-ranked RULE candidates of the line,
//    as without tiers; the search's starting total is the best single
//    candidate of the line, the tier included, so a Pro stack of rules beats
//    the tier only with a larger total (plan.ts pick). It then goes through
//    margin protection like any product stack (a capped tier is {fixedTotal:
//    headroom} with the same message), the Free product/order switch (the
//    losing category's candidates are dropped) and
//    the output (function-output.ts) unchanged. Its owner is the tier itself,
//    method automatic: ONLY the automatic node emits it.
// Campaign overrides never touch a tier (MVP 3; overrides of tier sets come
// in MVP 6). Outcomes, groups and the hint below are TS-only (admin,
// storefront): the function needs steps 1–6 alone.
// ===========================================================================================

import type { NormalizedLine, PlanLocale } from "./cart.ts";
import { type DescribableTierBreak, describeTierBreak } from "./describe.ts";
import type { EmittedValue, TierHint, TierOutcome, TierState, TierStep } from "./plan.ts";
import type { Candidate, Rule, WorkLine } from "./plan-internal.ts";
import { readTiersPayload, type TierBreakRead, type TierSetRead } from "./tiers.ts";

/** The id prefix of a tier candidate (`tier:<setId>`): never a rule id, those are `[A-Za-z0-9_-]`. */
export const TIER_CANDIDATE_PREFIX = "tier:";

export function tierCandidateId(setId: string): string {
  return `${TIER_CANDIDATE_PREFIX}${setId}`;
}

/** What a tier is called where a rule shows its name (a set has no name). */
export const TIER_LABEL: Readonly<Record<PlanLocale, string>> = { cs: "Množstevní sleva", en: "Quantity discount" };

interface Group {
  lines: WorkLine[];
  count: number;
  reached: TierBreakRead | null;
  next: TierBreakRead | null;
}

interface SetWork {
  set: TierSetRead;
  rule: Rule;
  /** Non-gift lines whose set this is, cart order. */
  lines: WorkLine[];
  eligible: number;
  groups: Group[];
  reachedAny: boolean;
}

export interface TierStage {
  sets: SetWork[];
  /** One pseudo-rule per set (the candidates' `rule`): ranking, margin, outcomes. */
  rules: Rule[];
}

function tierRule(set: TierSetRead, locale: PlanLocale): Rule {
  return {
    id: tierCandidateId(set.id),
    name: TIER_LABEL[locale],
    method: "automatic",
    module: "tiers",
    enabled: true,
    cls: "product",
    valueKind: "percentage",
    percent: 0,
    fixed: null,
    priority: 0,
    codeHashes: [],
    minSubtotal: null,
    minSubtotalMissing: false,
    minQuantity: 0,
    minEntitled: false,
    scheduled: false,
    scheduleInvalid: false,
    startsOn: null,
    endsOn: null,
    markets: null,
    segmentTargeted: false,
    combines: [],
    describable: { method: "automatic", value: { kind: "percentage", percent: 0 }, target: { kind: "products" } },
    state: null,
    hadCandidate: false,
    lostTo: [],
    dropped: false,
    marginFloored: false,
  };
}

function groupsOf(count: TierSetRead["count"], eligible: WorkLine[]): WorkLine[][] {
  if (count === "line") return eligible.map((w) => [w]);
  if (count === "cart") return eligible.length > 0 ? [eligible] : [];
  const byProduct = new Map<string, WorkLine[]>();
  for (const w of eligible) {
    const group = byProduct.get(w.line.productId);
    if (group) group.push(w);
    else byProduct.set(w.line.productId, [w]);
  }
  return [...byProduct.values()];
}

/** The reached break (highest offered minQty ≤ count) and the next offered one. Breaks are ascending. */
function breaksAround(breaks: readonly TierBreakRead[], count: number): { reached: TierBreakRead | null; next: TierBreakRead | null } {
  let reached: TierBreakRead | null = null;
  for (const b of breaks) {
    if (!b.offered) continue;
    if (b.minQty > count) return { reached, next: b };
    reached = b;
  }
  return { reached, next: null };
}

/** A break or step (engine form: percent or amount in the cart currency) as describe.ts reads it. */
export function tierStepBreak(b: { minQty: number; percent: number | null; amount: number | null }, currency: string): DescribableTierBreak {
  return b.percent !== null ? { minQty: b.minQty, percent: b.percent } : { minQty: b.minQty, amountOff: { [currency]: b.amount ?? 0 } };
}

/** What break `b` takes off `line` (step 5), before margin protection. */
function amountOn(b: TierBreakRead, line: NormalizedLine): { amount: number; value: EmittedValue } {
  if (b.percent !== null) return { amount: Math.round((line.subtotal * b.percent) / 100), value: { percent: b.percent } };
  const perItem = Math.min(b.amount ?? 0, line.unitPrice);
  return { amount: perItem * line.quantity, value: { fixedPerItem: perItem } };
}

/**
 * Steps 1–5 of the port spec: every line's tier candidate (`w.tier`), and per
 * set its lines and counting groups for the outcomes. Before planProducts.
 */
export function prepareTiers(work: WorkLine[], raw: unknown, locale: PlanLocale, currency: string): TierStage {
  const tiers = readTiersPayload(raw, currency);
  const sets: SetWork[] = [];
  const bySetId = new Map<string, SetWork>();
  for (const set of tiers.sets.values()) {
    const sw: SetWork = { set, rule: tierRule(set, locale), lines: [], eligible: 0, groups: [], reachedAny: false };
    sets.push(sw);
    bySetId.set(set.id, sw);
  }
  if (sets.length === 0) return { sets, rules: [] };
  const globalSet = tiers.global === null ? undefined : bySetId.get(tiers.global);
  for (const w of work) {
    if (w.excluded === "gift") continue;
    const sw = w.line.tierRef !== null ? bySetId.get(w.line.tierRef) : globalSet;
    if (sw) sw.lines.push(w);
  }
  for (const sw of sets) {
    const eligible = sw.lines.filter((w) => w.excluded === null);
    sw.eligible = eligible.length;
    const labels = new Map<number, string>();
    for (const lines of groupsOf(sw.set.count, eligible)) {
      let count = 0;
      for (const w of lines) count += w.line.quantity;
      const { reached, next } = breaksAround(sw.set.breaks, count);
      sw.groups.push({ lines, count, reached, next });
      if (!reached) continue;
      sw.reachedAny = true;
      let text = labels.get(reached.minQty);
      if (text === undefined) labels.set(reached.minQty, (text = describeTierBreak(tierStepBreak(reached, currency), { locale, currency })));
      for (const w of lines) {
        const { amount, value } = amountOn(reached, w.line);
        w.tier = amount > 0 ? { rule: sw.rule, amount, value, label: text } : null;
      }
    }
  }
  return { sets, rules: sets.map((sw) => sw.rule) };
}

// --- Outcomes, groups and the hint (TS only) -------------------------------------------------------

const step = (b: TierBreakRead | null): TierStep | null => (b ? { minQty: b.minQty, percent: b.percent, amount: b.amount } : null);

function stateOf(sw: SetWork, contributes: boolean): TierState {
  // No line first (fix round 2): a set the cart does not use is not about this cart at all.
  if (sw.lines.length === 0) return "no_target_lines";
  if (sw.set.breaks.length === 0) return "disabled";
  if (!sw.set.breaks.some((b) => b.offered)) return "currency_missing";
  if (sw.eligible === 0) return "outlet_only";
  if (!sw.reachedAny) return "below_tier";
  if (contributes) return "applied";
  // Like a rule: a category switch decides first, then margin protection, then a better discount.
  if (sw.rule.dropped) return "not_combinable";
  if (sw.rule.marginFloored) return "margin_floor";
  return sw.rule.hadCandidate ? "outranked" : "zero_value";
}

/** One outcome per set of the payload (payload order), after the plan's product, margin and order stages. */
export function tierOutcomes(stage: TierStage, work: readonly WorkLine[]): TierOutcome[] {
  if (stage.sets.length === 0) return [];
  const contribution = new Map<string, { amount: number; lineIds: string[] }>();
  for (const w of work) {
    for (const c of w.product?.components ?? []) {
      if (c.module !== "tiers") continue;
      let entry = contribution.get(c.ruleId);
      if (!entry) contribution.set(c.ruleId, (entry = { amount: 0, lineIds: [] }));
      entry.amount += c.amount;
      entry.lineIds.push(w.line.id);
    }
  }
  return stage.sets.map((sw) => {
    const c = contribution.get(sw.rule.id);
    const state = stateOf(sw, c !== undefined);
    const out: TierOutcome = {
      setId: sw.set.id,
      ruleId: sw.rule.id,
      countAcross: sw.set.count,
      state,
      amount: c?.amount ?? 0,
      lineIds: c?.lineIds ?? [],
      groups: sw.groups.map((g) => ({ lineIds: g.lines.map((w) => w.line.id), count: g.count, reached: step(g.reached), next: step(g.next) })),
    };
    if (state === "outranked" && sw.rule.lostTo.length > 0) out.betterRuleIds = [...sw.rule.lostTo];
    return out;
  });
}

/**
 * progress.tierHint (MVP 4 slot): the counting group closest to its next
 * offered break (fewest items missing; ties: the group whose first line comes
 * first), among those where that break would give MORE than a line of the
 * group gets now — measured on its current quantities, capped at the line's
 * margin headroom — and whose set the Free product/order switch did not drop
 * (the order discount won: more items would not change that). Null when none.
 */
export function tierHint(stage: TierStage, work: readonly WorkLine[]): TierHint | null {
  if (stage.sets.length === 0) return null;
  const position = new Map(work.map((w, i) => [w, i]));
  let best: { hint: TierHint; first: number } | null = null;
  for (const sw of stage.sets) {
    if (sw.rule.dropped) continue;
    for (const g of sw.groups) {
      const next = g.next;
      if (!next || g.lines.length === 0) continue;
      const gains = g.lines.some((w) => {
        const wanted = amountOn(next, w.line).amount;
        const headroom = w.floor ? Math.max(0, w.line.subtotal - w.floor.floorUnit * w.line.quantity) : wanted;
        return Math.min(wanted, headroom) > (w.product?.amount ?? 0);
      });
      if (!gains) continue;
      const missing = next.minQty - g.count;
      const first = position.get(g.lines[0]) ?? 0;
      if (best && (missing > best.hint.missing || (missing === best.hint.missing && first >= best.first))) continue;
      best = {
        hint: { setId: sw.set.id, lineIds: g.lines.map((w) => w.line.id), count: g.count, missing, next: step(next)! },
        first,
      };
    }
  }
  return best?.hint ?? null;
}
