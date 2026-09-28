// planCart — the one discount brain (spec §3, doctrine DATA-4). A pure,
// deterministic function of (cart, shared config) that every Won node in the
// discount function, the admin "Vyzkoušet košík" and later the storefront run
// unchanged; each node then emits only its own part (emit.ts).
//
// Order of work (A1 defaults, spec §3 "Deterministické pořadí"):
//   0. campaign overrides (only when the node's campaign + varsVersion match the
//      shop config, C4/C7) → rules as they are right now;
//   1. outlet lines are out of product AND order discounts (unless
//      `engine.combination.outletWithAnything`); 2. gift lines are out of
//      everything, thresholds included;
//   3. product discounts: per line the better one for the customer wins, never a
//      sum (ties: priority desc, id asc); Pro `combinesWith` may stack rules,
//      emitted as ONE value by the node of the highest-priority component;
//   4. order discounts: on the subtotal AFTER product discounts [spec], the
//      better one wins [spec]; 6. shipping: the best shipping candidate;
//   7. margin protection — MVP 2 hook, identity for now.
//   Free per-category switches (`engine.combination.*`) make product+order,
//   product+shipping, order+shipping exclusive when turned off.
//
// Money is integer minor units of the cart currency. A currency without a value
// (fixed amount, minimum) takes the rule out of play (MKT-1, principle 6).
// Performance: O(lines × rules-per-line) + one sort per line; the Pro stacking
// search only runs on lines that actually have combinable candidates.

import { type CartPlanInput, type NormalizedCart, type NormalizedLine, normalizeCart, normalizeCode, type PlanLocale } from "./cart.ts";
import type { DiscountMethod, DiscountRuleValue, DiscountTargetKind, ReadonlyDeep } from "./config.ts";
import { DEFAULT_CONFIG } from "./config/defaults.ts";
import { DISCOUNT_TARGET_KINDS } from "./config/enums.ts";
import { type DescribableRule, describeRule } from "./describe.ts";
import type { FunctionConfigPayload } from "./function-payload.ts";
import { lineRuleIds } from "./targeting.ts";

// --- Public plan shape ------------------------------------------------------------------

export type DiscountClass = "product" | "order" | "shipping";
/** Which module produced an allocation. MVP 3 adds "tiers", MVP 4 "rewards". */
export type PlanModule = "codes";

export type RuleState =
  | "applied" // its node emits (part of) the plan
  | "combined" // its value is inside a Pro stack another rule's node emits
  | "outranked" // it had something to give but a better discount won everywhere
  | "not_combinable" // dropped by a per-category switch (engine.combination)
  | "zero_value" // eligible but worth nothing here (0 %, 0 amount, empty base)
  | "disabled"
  | "code_not_entered"
  | "not_started"
  | "ended"
  | "schedule_unknown" // scheduled, but the plan got no shop date
  | "market" // Pro market targeting excludes this market (or it is unknown)
  | "segment" // Pro segment targeting excludes this customer
  | "currency_missing" // no amount / minimum for the cart currency (MKT-1)
  | "no_target_lines"
  | "outlet_only" // every line it targets is on outlet
  | "below_minimum";

export type CodeState = RuleState | "same_rule" | "unknown";

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
  /** The rule whose node emits this stack: highest priority, then id asc. */
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
  /** MVP 2 slot: set when margin protection lowered the product discount. */
  marginCapped?: { before: number; after: number };
}

export interface PlanOrder extends PlanStack {
  /** Subtotal of the discountable lines after product discounts (what the order discount is taken from). */
  base: number;
  /** Outlet and gift lines, in cart order (the candidate's excludedCartLineIds). */
  excludedLineIds: string[];
}

export interface PlanShipping {
  ruleId: string;
  method: DiscountMethod;
  ownerRuleId: string;
  ownerMethod: DiscountMethod;
  value: ShippingValue;
  /** Minor units when the delivery cost is known (CartPlanInput.shippingAmount), else null. */
  amount: number | null;
  message: string;
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
  /** below_minimum: what is missing (minor units / items) and the minimum itself. */
  missing?: { subtotal?: number; quantity?: number; minimumSubtotal?: number; minimumQuantity?: number };
  /** Schedule at day granularity (shop dates, inclusive). */
  startsOn?: string;
  endsOn?: string;
  /** outranked: owners of the stacks that beat it (at most 3). */
  betterRuleIds?: string[];
  /** combined: the rule whose node emits the stack it is part of. */
  combinedInto?: string;
}

export interface CodeOutcome {
  /** As entered, trimmed and upper-cased. */
  code: string;
  /** The Won rule owning the code; null for a code Won does not manage. */
  ruleId: string | null;
  state: CodeState;
}

/** MVP 4 slot (rewards). */
export interface PlanGift {
  tierId: string;
  lineId?: string;
  state: "earned" | "missing" | "declined" | "out_of_stock" | "not_offered";
}

/** Later-MVP slot (e.g. code_loses_gift, market_missing_threshold). */
export interface PlanWarning {
  code: string;
  ruleId?: string;
}

/** MVP 4 slot (free shipping / gift progress, tier hints). */
export interface PlanProgress {
  freeShipping?: { remaining: number; reached: boolean };
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

// --- Internal model ------------------------------------------------------------------------

type ValueKind = "percentage" | "fixed" | "freeShipping";

interface Rule {
  id: string;
  name: string;
  method: DiscountMethod;
  enabled: boolean;
  cls: DiscountClass;
  valueKind: ValueKind;
  percent: number;
  /** Fixed amount in the cart currency; null = no value for it. */
  fixed: number | null;
  priority: number;
  codes: string[];
  minSubtotal: number | null;
  minSubtotalMissing: boolean;
  minQuantity: number;
  startsOn: string | null;
  endsOn: string | null;
  markets: string[] | null;
  segments: string[] | null;
  /** Pro combinesWith as written on this rule (the relation is made symmetric in partnersOf). */
  combines: string[];
  describable: DescribableRule;
  // evaluation
  state: RuleState | null; // null = eligible so far
  missing?: RuleOutcome["missing"];
  hadCandidate: boolean;
  lostTo: string[];
  dropped: boolean;
}

interface Candidate {
  rule: Rule;
  amount: number;
}

interface Scope {
  subtotal: number;
  quantity: number;
  lines: number;
  discountable: number;
}

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** Keys a campaign override may patch on a rule (mirrors the config sanitizer's OVERRIDE_FIELDS.rule). */
const RULE_OVERRIDE_KEYS = ["enabled", "name", "value", "target", "minimum", "targeting", "combinesWith"] as const;

const MAX_BETTER_RULES = 3;

function amountIn(money: unknown, currency: string): number | null {
  if (!isRecord(money)) return null;
  const v = money[currency];
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

function clampPercent(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
}

const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/;

/** The calendar date written in an ISO date-time (the shop's offset, as the admin writes it). */
function startDate(v: unknown): string | null {
  return typeof v === "string" ? (DATETIME_RE.exec(v)?.[1] ?? null) : null;
}

/** Last live day of a schedule end: its date, or the day before when it ends exactly at midnight. */
function endDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = DATETIME_RE.exec(v);
  if (!m) return null;
  const midnight = m[2] === "00" && m[3] === "00" && (m[4] ?? "00") === "00" && /^0*$/.test(m[5] ?? "");
  if (!midnight) return m[1];
  const [y, mo, d] = m[1].split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d - 1)).toISOString().slice(0, 10);
}

function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : null;
}

function readRule(raw: Rec, currency: string): Rule | null {
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
  const codes = method === "code" && Array.isArray(raw.codes)
    ? raw.codes.filter((c): c is string => typeof c === "string").map(normalizeCode).filter(Boolean)
    : [];

  const minimum = isRecord(raw.minimum) ? raw.minimum : {};
  const subtotalMap = minimum.subtotal;
  const hasSubtotal = isRecord(subtotalMap) && Object.keys(subtotalMap).length > 0;
  const minSubtotal = hasSubtotal ? amountIn(subtotalMap, currency) : null;
  const minQuantity =
    typeof minimum.quantity === "number" && Number.isFinite(minimum.quantity) && minimum.quantity > 0
      ? Math.floor(minimum.quantity)
      : 0;
  const schedule = isRecord(raw.schedule) ? raw.schedule : {};
  const targeting = isRecord(raw.targeting) ? raw.targeting : {};
  const name = typeof raw.name === "string" ? raw.name : "";

  return {
    id: raw.id as string,
    name,
    method,
    enabled: raw.enabled === true,
    cls,
    valueKind,
    percent,
    fixed,
    priority: typeof raw.priority === "number" && Number.isFinite(raw.priority) ? Math.floor(raw.priority) : 0,
    codes,
    minSubtotal,
    minSubtotalMissing: hasSubtotal && minSubtotal === null,
    minQuantity,
    startsOn: startDate(schedule.startsAt),
    endsOn: endDate(schedule.endsAt),
    markets: stringList(targeting.markets),
    segments: stringList(targeting.segments),
    combines: isRecord(raw.combinesWith) ? (stringList(raw.combinesWith.ruleIds) ?? []) : [],
    describable: {
      method,
      codes,
      value: describedValue,
      target: { kind: target },
      ...(hasSubtotal || minQuantity > 0
        ? { minimum: { ...(hasSubtotal ? { subtotal: subtotalMap as Record<string, number> } : {}), quantity: minQuantity } }
        : {}),
    },
    state: null,
    hadCandidate: false,
    lostTo: [],
    dropped: false,
  };
}

interface ActiveCampaign {
  id: string;
  patches: Map<string, Rec>;
}

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
  return { id: node.id, patches };
}

function readRules(config: Rec, currency: string, campaign: ActiveCampaign | null) {
  const modules = config.modules as Rec;
  const raws = (modules.codes as Rec).rules as unknown[];
  const rules: Rule[] = [];
  const retargeted = new Set<string>();
  const seen = new Set<string>();
  for (const raw of raws) {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "" || seen.has(raw.id)) continue;
    const patch = campaign?.patches.get(raw.id);
    const rule = readRule(patch ? { ...raw, ...patch } : raw, currency);
    if (!rule) continue;
    seen.add(rule.id);
    if (patch && "target" in patch) retargeted.add(rule.id);
    rules.push(rule);
  }
  return { rules, retargeted };
}

function readEngine(config: Rec) {
  const defaults = DEFAULT_CONFIG.engine.combination;
  const engine = isRecord(config.engine) ? config.engine : {};
  const c = isRecord(engine.combination) ? engine.combination : {};
  const flag = (key: keyof typeof defaults, fallback: boolean) => (typeof c[key] === "boolean" ? (c[key] as boolean) : fallback);
  return {
    outletWithAnything: flag("outletWithAnything", defaults.outletWithAnything),
    productWithOrder: flag("productWithOrder", defaults.productWithOrder),
    productWithShipping: flag("productWithShipping", defaults.productWithShipping),
    orderWithShipping: flag("orderWithShipping", defaults.orderWithShipping),
  };
}

// --- Ranking and stacking ------------------------------------------------------------------

/** amount desc, then priority desc, then id asc (never config order). */
function byRank(a: Candidate, b: Candidate): number {
  if (a.amount !== b.amount) return b.amount - a.amount;
  if (a.rule.priority !== b.rule.priority) return b.rule.priority - a.rule.priority;
  return a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0;
}

/** Owner of a stack: highest priority, then id asc. */
function ownerOf(components: Candidate[]): Rule {
  let owner = components[0].rule;
  for (const { rule } of components) {
    if (rule.priority > owner.priority || (rule.priority === owner.priority && rule.id < owner.id)) owner = rule;
  }
  return owner;
}

/**
 * Symmetric Pro combinesWith relation [spec]: A stacks with B if either lists the
 * other (the merchant edits one rule and expects it to work). Only ever consulted
 * between candidates of the same class on the same target.
 */
function partnersOf(rules: Rule[]): Map<string, Set<string>> {
  const partners = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    let set = partners.get(a);
    if (!set) partners.set(a, (set = new Set()));
    set.add(b);
  };
  const known = new Set(rules.map((r) => r.id));
  for (const rule of rules) {
    for (const other of rule.combines) {
      if (!known.has(other)) continue;
      link(rule.id, other);
      link(other, rule.id);
    }
  }
  return partners;
}

interface Picked {
  components: Candidate[]; // effective amounts, rank order
  total: number;
}

/**
 * The best stack for one target (a line, or the order): the single best
 * candidate, or — when Pro combinesWith links candidates — the combinable set
 * that saves the customer the most (greedy from every linked seed; ties keep the
 * earlier-ranked seed). Amounts are then capped at `cap` in rank order.
 */
function pick(positive: Candidate[], cap: number, partners: Map<string, Set<string>>): Picked {
  if (positive.length > 1) positive.sort(byRank);
  let chosen: Candidate[] = [positive[0]];
  if (partners.size > 0 && positive.length > 1) {
    let bestTotal = Math.min(cap, positive[0].amount);
    // A seed already inside an earlier greedy stack is skipped: it would mostly
    // rebuild the same stack, and without this the search is O(k³) per line when
    // many rules combine (the function runs under an instruction limit).
    const covered = new Set<Candidate>();
    for (const seed of positive) {
      const mine = partners.get(seed.rule.id);
      if (!mine || covered.has(seed)) continue;
      const set = [seed];
      for (const c of positive) {
        if (c === seed || !mine.has(c.rule.id)) continue;
        if (set.every((s) => s === seed || partners.get(s.rule.id)?.has(c.rule.id))) set.push(c);
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
    components.push({ rule: c.rule, amount });
    remaining -= amount;
  }
  return { components, total: cap - remaining };
}

// --- The plan -------------------------------------------------------------------------------

interface WorkLine {
  line: NormalizedLine;
  excluded: "outlet" | "gift" | null;
  ruleSet: Set<string>;
  product: PlanStack | null;
}

function label(rule: Rule, locale: PlanLocale, currency: string): string {
  return rule.name || describeRule(rule.describable, locale, currency, { short: true });
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
  const components: PlanComponent[] = picked.components.map((c) => ({
    ruleId: c.rule.id,
    method: c.rule.method,
    module: "codes",
    amount: c.amount,
  }));
  return {
    components,
    amount: picked.total,
    ownerRuleId: owner.id,
    ownerMethod: owner.method,
    value: picked.components.length === 1 ? naturalValue(picked.components[0]) : { fixedTotal: picked.total },
    message: picked.components.map((c) => label(c.rule, locale, currency)).join(" + "),
  };
}

function productAmount(rule: Rule, line: NormalizedLine): number {
  if (rule.valueKind === "percentage") return Math.round((line.subtotal * rule.percent) / 100);
  if (rule.valueKind === "fixed" && rule.fixed !== null) return Math.min(rule.fixed, line.unitPrice) * line.quantity;
  return 0;
}

function orderAmount(rule: Rule, base: number): number {
  if (rule.valueKind === "percentage") return Math.round((base * rule.percent) / 100);
  if (rule.valueKind === "fixed" && rule.fixed !== null) return Math.min(rule.fixed, base);
  return 0;
}

/** Rule gate, in the order a merchant would ask "why not?". Returns null when eligible. */
function gate(rule: Rule, cart: NormalizedCart, scope: Scope, entered: boolean): RuleState | null {
  if (!rule.enabled) return "disabled";
  if (rule.method === "code" && !entered) return "code_not_entered";
  if (rule.startsOn || rule.endsOn) {
    // [spec] DAY granularity in shop time: the function reads only shop.localTime.date
    // without variables; exact-time windows are the Campaigns module's job (C4).
    if (!cart.today) return "schedule_unknown";
    if (rule.startsOn && cart.today < rule.startsOn) return "not_started";
    if (rule.endsOn && cart.today > rule.endsOn) return "ended";
  }
  if (rule.markets && (!cart.marketHandle || !rule.markets.includes(cart.marketHandle))) return "market";
  if (rule.segments && (!cart.segments || !rule.segments.some((s) => cart.segments?.has(s)))) return "segment";
  if ((rule.valueKind === "fixed" && rule.fixed === null) || rule.minSubtotalMissing) return "currency_missing";
  if (scope.lines === 0) return "no_target_lines";
  if (rule.cls !== "shipping" && scope.discountable === 0) return "outlet_only";
  // [spec] Minimum = pre-discount price and quantity of the non-gift lines the rule
  // targets (all of them for order/shipping), outlet included: it is what the
  // customer pays for those goods (same reading as the rewards threshold, A1.1).
  const missingSubtotal = rule.minSubtotal !== null ? Math.max(0, rule.minSubtotal - scope.subtotal) : 0;
  const missingQuantity = rule.minQuantity > 0 ? Math.max(0, rule.minQuantity - scope.quantity) : 0;
  if (missingSubtotal > 0 || missingQuantity > 0) {
    rule.missing = {
      ...(missingSubtotal > 0 ? { subtotal: missingSubtotal, minimumSubtotal: rule.minSubtotal as number } : {}),
      ...(missingQuantity > 0 ? { quantity: missingQuantity, minimumQuantity: rule.minQuantity } : {}),
    };
    return "below_minimum";
  }
  return null;
}

/** MVP 2 hook (A1.7 margin protection): lowers product allocations to the margin floor. Identity for now. */
function applyMarginProtection(lines: WorkLine[]): WorkLine[] {
  return lines;
}

function buildPlan(cart: NormalizedCart, config: Rec): CartPlan {
  const { currency, locale } = cart;
  const engine = readEngine(config);
  const campaign = activeCampaign(config, cart);
  const { rules, retargeted } = readRules(config, currency, campaign);
  const byId = new Map(rules.map((r) => [r.id, r]));

  // Codes → rules (code rules only; a code belongs to one rule — the sanitizer guarantees it).
  const codeOwner = new Map<string, Rule>();
  for (const rule of rules) {
    if (rule.method !== "code") continue;
    for (const code of rule.codes) if (!codeOwner.has(code)) codeOwner.set(code, rule);
  }
  const enteredByRule = new Map<string, string[]>();
  for (const code of cart.enteredCodes) {
    const rule = codeOwner.get(code);
    if (!rule) continue;
    const list = enteredByRule.get(rule.id);
    if (list) list.push(code);
    else enteredByRule.set(rule.id, [code]);
  }

  // Lines, exclusions, targeting, scopes.
  const work: WorkLine[] = cart.lines.map((line) => ({
    line,
    excluded: line.gift ? "gift" : line.outlet && !engine.outletWithAnything ? "outlet" : null,
    ruleSet: lineRuleIds(line, campaign?.id ?? null, retargeted),
    product: null,
  }));
  const cartScope: Scope = { subtotal: 0, quantity: 0, lines: 0, discountable: 0 };
  const ruleScopes = new Map<string, Scope>();
  for (const w of work) {
    if (w.excluded === "gift") continue;
    const discountable = w.excluded === null ? 1 : 0;
    cartScope.subtotal += w.line.subtotal;
    cartScope.quantity += w.line.quantity;
    cartScope.lines += 1;
    cartScope.discountable += discountable;
    for (const id of w.ruleSet) {
      let s = ruleScopes.get(id);
      if (!s) ruleScopes.set(id, (s = { subtotal: 0, quantity: 0, lines: 0, discountable: 0 }));
      s.subtotal += w.line.subtotal;
      s.quantity += w.line.quantity;
      s.lines += 1;
      s.discountable += discountable;
    }
  }
  const emptyScope: Scope = { subtotal: 0, quantity: 0, lines: 0, discountable: 0 };
  for (const rule of rules) {
    const scope = rule.cls === "product" ? (ruleScopes.get(rule.id) ?? emptyScope) : cartScope;
    rule.state = gate(rule, cart, scope, enteredByRule.has(rule.id));
  }

  const partners = partnersOf(rules);

  // 3. Product discounts, per line.
  for (const w of work) {
    if (w.excluded || w.ruleSet.size === 0) continue;
    const positive: Candidate[] = [];
    for (const id of w.ruleSet) {
      const rule = byId.get(id);
      if (!rule || rule.cls !== "product" || rule.state !== null) continue;
      const amount = productAmount(rule, w.line);
      if (amount > 0) positive.push({ rule, amount });
    }
    if (positive.length === 0) continue;
    const unitPrice = w.line.unitPrice;
    w.product = buildStack(
      pick(positive, w.line.subtotal, partners),
      positive,
      (single) =>
        single.rule.valueKind === "percentage"
          ? { percent: single.rule.percent }
          : { fixedPerItem: Math.min(single.rule.fixed ?? 0, unitPrice) },
      locale,
      currency,
    );
  }
  applyMarginProtection(work);

  // 4. Order discount, on the subtotal after product discounts [spec].
  const orderRules = rules.filter((r) => r.cls === "order" && r.state === null);
  const excludedLineIds = work.filter((w) => w.excluded !== null).map((w) => w.line.id);
  const planOrder = (base: number): PlanOrder | null => {
    const positive = orderRules.map((rule) => ({ rule, amount: orderAmount(rule, base) })).filter((c) => c.amount > 0);
    if (positive.length === 0) return null;
    const stack = buildStack(
      pick(positive, base, partners),
      positive,
      (single) => (single.rule.valueKind === "percentage" ? { percent: single.rule.percent } : { fixedTotal: single.amount }),
      locale,
      currency,
    );
    return stack ? { ...stack, base, excludedLineIds } : null;
  };
  const productTotal = work.reduce((sum, w) => sum + (w.product?.amount ?? 0), 0);
  const discountableSubtotal = work.reduce((sum, w) => sum + (w.excluded === null ? w.line.subtotal : 0), 0);
  let order: PlanOrder | null;
  if (engine.productWithOrder) {
    order = planOrder(discountableSubtotal - productTotal);
  } else {
    // Exclusive (Free switch off): the better scenario for the customer wins, a tie keeps products.
    // Every rule of the losing category that had something to give is "not combinable".
    const orderOnly = planOrder(discountableSubtotal);
    const orderWins = orderOnly !== null && orderOnly.amount > productTotal;
    const losing: DiscountClass = orderWins ? "product" : "order";
    for (const rule of rules) if (rule.cls === losing && rule.hadCandidate) rule.dropped = true;
    if (orderWins) for (const w of work) w.product = null;
    order = orderWins ? orderOnly : null;
  }

  // 6. Shipping: one winner. With a known delivery cost by amount; otherwise
  // [spec] percent (free = 100 %) ranks above a fixed amount, larger first.
  let shipping: PlanShipping | null = null;
  const shipCost = cart.shippingAmount;
  const shipCandidates = rules
    .filter((r) => r.cls === "shipping" && r.state === null)
    .map((rule) => {
      const percent = rule.valueKind === "freeShipping" ? 100 : rule.valueKind === "percentage" ? rule.percent : null;
      const fixed = rule.valueKind === "fixed" ? (rule.fixed ?? 0) : null;
      const amount =
        shipCost === null ? null : percent !== null ? Math.round((shipCost * percent) / 100) : Math.min(fixed ?? 0, shipCost);
      const value: ShippingValue =
        percent !== null ? { percent } : { fixedTotal: shipCost === null ? (fixed ?? 0) : Math.min(fixed ?? 0, shipCost) };
      const worth = percent !== null ? percent > 0 : (fixed ?? 0) > 0;
      const key = amount !== null ? [amount, 0] : percent !== null ? [1, percent] : [0, fixed ?? 0];
      return { rule, value, amount, worth, key };
    })
    .filter((c) => c.worth)
    .sort(
      (a, b) =>
        b.key[0] - a.key[0] ||
        b.key[1] - a.key[1] ||
        b.rule.priority - a.rule.priority ||
        (a.rule.id < b.rule.id ? -1 : a.rule.id > b.rule.id ? 1 : 0),
    );
  if (shipCandidates.length > 0) {
    const [winner, ...losers] = shipCandidates;
    for (const c of shipCandidates) c.rule.hadCandidate = true;
    for (const c of losers) if (c.rule.lostTo.length < MAX_BETTER_RULES) c.rule.lostTo.push(winner.rule.id);
    const blocked = (!engine.productWithShipping && work.some((w) => w.product)) || (!engine.orderWithShipping && order !== null);
    if (blocked) {
      winner.rule.dropped = true;
    } else {
      shipping = {
        ruleId: winner.rule.id,
        method: winner.rule.method,
        ownerRuleId: winner.rule.id,
        ownerMethod: winner.rule.method,
        value: winner.value,
        amount: winner.amount,
        message: label(winner.rule, locale, currency),
      };
    }
  }

  // Outcomes from the FINAL stacks.
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
      // (dropped before outranked: a rule of the losing category could not have applied either way)
      (c?.owner ? "applied" : c ? "combined" : rule.dropped ? "not_combinable" : rule.hadCandidate ? "outranked" : "zero_value");
    const out: RuleOutcome = {
      ruleId: rule.id,
      name: rule.name,
      method: rule.method,
      discountClass: rule.cls,
      state,
      amount: c?.amount ?? 0,
      lineIds: c?.lineIds ?? [],
      enteredCodes: enteredByRule.get(rule.id) ?? [],
      describable: rule.describable,
    };
    if (state === "below_minimum" && rule.missing) out.missing = rule.missing;
    if (rule.startsOn) out.startsOn = rule.startsOn;
    if (rule.endsOn) out.endsOn = rule.endsOn;
    if (state === "outranked" && rule.lostTo.length > 0) out.betterRuleIds = [...rule.lostTo];
    if (state === "combined" && c?.combinedInto) out.combinedInto = c.combinedInto;
    return out;
  });
  const outcomeById = new Map(outcomes.map((o) => [o.ruleId, o]));

  const codes: CodeOutcome[] = cart.enteredCodes.map((code) => {
    const rule = codeOwner.get(code);
    if (!rule) return { code, ruleId: null, state: "unknown" };
    if (enteredByRule.get(rule.id)?.[0] !== code) return { code, ruleId: rule.id, state: "same_rule" };
    return { code, ruleId: rule.id, state: outcomeById.get(rule.id)!.state };
  });

  const lines: PlanLine[] = work.map((w) => ({
    lineId: w.line.id,
    productId: w.line.productId,
    variantId: w.line.variantId,
    quantity: w.line.quantity,
    unitPrice: w.line.unitPrice,
    subtotal: w.line.subtotal,
    excluded: w.excluded,
    product: w.product,
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
    codes,
    gifts: [],
    warnings: [],
    progress: {},
    totals: { subtotal, productDiscount, orderDiscount, total: subtotal - productDiscount - orderDiscount },
  };
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
