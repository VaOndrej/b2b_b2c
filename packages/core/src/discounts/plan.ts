// planCart — the one discount brain (spec §3, doctrine DATA-4). A pure,
// deterministic function of (cart, shared config) that every Won node in the
// discount function, the admin "Vyzkoušet košík" and later the storefront run
// unchanged; each node then emits only its own part (emit.ts).
//
// Stages (A1 defaults, spec §3 "Deterministické pořadí"), one function each:
//   resolveRules    campaign overrides (only when the node's campaign + varsVersion
//                   match the shop config, C4/C7) → the rules as they are now;
//   matchCodes      entered codes → code rules, by hash (code-hash.ts);
//   prepareLines    outlet lines out of product AND order discounts (unless
//                   `outletWithAnything`), gift lines out of everything,
//                   thresholds included; precomputed targeting per line;
//   gateRules       enabled, code entered, schedule (shop days), market
//                   (country), segment (unsupported), currency, targets,
//                   minimum (the WHOLE cart, [spec] „minimum košíku“, or the
//                   rule's own lines when its minimum scope is "entitled");
//   planProducts    per line the better one for the customer wins, never a sum
//                   (ties: priority desc, id asc); Pro `combinesWith` may stack;
//   applyMarginProtection  (MVP 2, only when `modules.margin` is on) each line's
//                   product allocation capped at its headroom above the floor
//                   (margin.ts), the stack cut in rank order, owner recomputed;
//   planOrderStage  on the subtotal AFTER product discounts [spec], better wins
//                   [spec]; the Free product-with-order switch; with margin on,
//                   protectOrder lowers it or leaves out lines at their floor;
//   planShipping    one winner (percent above fixed: the function knows no
//                   delivery cost); the Free product/order-with-shipping switches;
//                   margin protection never touches shipping;
//   buildOutcomes   per-rule and per-code states for explain/admin.
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
// Performance: O(lines × rules-per-line) + one sort per line; the Pro stacking
// search only runs on lines that actually have combinable candidates. Margin
// protection of the order discount is O(lines²) at worst (one pass over each
// candidate prefix: 200 lines ≈ 20 000 steps).

import { type CartPlanInput, type NormalizedCart, type NormalizedLine, normalizeCart, type PlanLocale } from "./cart.ts";
import { codeHash } from "./code-hash.ts";
import type { DiscountMethod, DiscountRuleValue, DiscountTargetKind, MinimumScope, ReadonlyDeep } from "./config.ts";
import { DEFAULT_CONFIG } from "./config/defaults.ts";
import { CONFIG_LIMITS } from "./config/limits.ts";
import { DISCOUNT_TARGET_KINDS } from "./config/enums.ts";
import { type DescribableRule, describeRule } from "./describe.ts";
import type { FunctionConfigPayload } from "./function-payload.ts";
import {
  costMinorUnits,
  type FunctionMarginPayload,
  type MarginBasis,
  marginFloorUnit,
  type MarginSettings,
  type MarginSource,
  readMarginPayload,
  resolveMargin,
} from "./margin.ts";
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
  | "schedule_unknown" // scheduled, but no shop date (or no shop-local schedule) to compare
  | "market" // Pro market targeting: the cart country is not in the rule's markets (or unknown)
  | "unsupported" // uses a feature the checkout cannot evaluate yet (segment targeting)
  | "currency_missing" // no amount / minimum for the cart currency (MKT-1)
  | "no_target_lines"
  | "outlet_only" // every line it targets is on outlet
  | "below_minimum"
  | "margin_floor"; // it had something to give, but margin protection took each of its winning contributions to 0

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
  /** Schedule at day granularity (shop dates, inclusive). */
  startsOn?: string;
  endsOn?: string;
  /** outranked: owners of the stacks that beat it (at most 3). */
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

interface WorkLine {
  line: NormalizedLine;
  excluded: "outlet" | "gift" | null;
  ruleSet: Set<string>;
  product: PlanStack | null;
  /** Margin on: the floor of a discountable line; null when margin is off or the line is excluded. */
  floor: LineFloor | null;
  marginCapped?: PlanLineMarginCap;
}

interface LineFloor {
  floorUnit: number;
  basis: MarginBasis;
  settings: MarginSettings;
}

interface EngineFlags {
  outletWithAnything: boolean;
  productWithOrder: boolean;
  productWithShipping: boolean;
  orderWithShipping: boolean;
}

interface ActiveCampaign {
  id: string;
  patches: Map<string, Rec>;
}

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** Keys a campaign override may patch on a rule (mirrors the config sanitizer's OVERRIDE_FIELDS.rule). */
const RULE_OVERRIDE_KEYS = ["enabled", "name", "value", "target", "minimum", "targeting", "combinesWith"] as const;

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
  const codeHashes = method === "code" ? (stringList(raw.codeHashes) ?? []) : [];

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

  return {
    id: raw.id as string,
    name: typeof raw.name === "string" ? raw.name : "",
    method,
    enabled: raw.enabled === true,
    cls,
    valueKind,
    percent,
    fixed,
    priority: typeof raw.priority === "number" && Number.isFinite(raw.priority) ? Math.floor(raw.priority) : 0,
    codeHashes,
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
    combines: isRecord(raw.combinesWith) ? (stringList(raw.combinesWith.ruleIds) ?? []) : [],
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

function readEngine(config: Rec): EngineFlags {
  const defaults = DEFAULT_CONFIG.engine.combination;
  const engine = isRecord(config.engine) ? config.engine : {};
  const c = isRecord(engine.combination) ? engine.combination : {};
  const flag = (key: keyof EngineFlags) => (typeof c[key] === "boolean" ? (c[key] as boolean) : defaults[key]);
  return {
    outletWithAnything: flag("outletWithAnything"),
    productWithOrder: flag("productWithOrder"),
    productWithShipping: flag("productWithShipping"),
    orderWithShipping: flag("orderWithShipping"),
  };
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
  return { id: node.id, patches };
}

function resolveRules(config: Rec, cart: NormalizedCart) {
  const campaign = activeCampaign(config, cart);
  const raws = ((config.modules as Rec).codes as Rec).rules as unknown[];
  const rules: Rule[] = [];
  const retargeted = new Set<string>();
  const seen = new Set<string>();
  for (const raw of raws) {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "" || seen.has(raw.id)) continue;
    const patch = campaign?.patches.get(raw.id);
    const rule = readRule(patch ? { ...raw, ...patch } : raw, cart.currency);
    if (!rule) continue;
    seen.add(rule.id);
    if (patch && "target" in patch) retargeted.add(rule.id);
    rules.push(rule);
  }
  return { campaign, rules, retargeted, byId: new Map(rules.map((r) => [r.id, r])) };
}

// --- Stage: codes ------------------------------------------------------------------------------

/** Entered codes → code rules by hash; the first entered code of a rule is the one that counts. */
function matchCodes(rules: Rule[], cart: NormalizedCart) {
  const ownerByHash = new Map<string, Rule>();
  for (const rule of rules) {
    if (rule.method !== "code") continue;
    for (const hash of rule.codeHashes) if (!ownerByHash.has(hash)) ownerByHash.set(hash, rule);
  }
  const ownerOfCode = new Map<string, Rule>();
  const enteredByRule = new Map<string, string[]>();
  for (const code of cart.enteredCodes) {
    const rule = ownerByHash.get(codeHash(code));
    if (!rule) continue;
    ownerOfCode.set(code, rule);
    const list = enteredByRule.get(rule.id);
    if (list) list.push(code);
    else enteredByRule.set(rule.id, [code]);
  }
  return { ownerOfCode, enteredByRule };
}

// --- Stage: lines, exclusions, targeting, scopes ------------------------------------------------

const emptyScope = (): Scope => ({ subtotal: 0, quantity: 0, lines: 0, discountable: 0 });

function prepareLines(cart: NormalizedCart, engine: EngineFlags, campaignId: string | null, retargeted: ReadonlySet<string>) {
  const work: WorkLine[] = cart.lines.map((line) => ({
    line,
    excluded: line.gift ? "gift" : line.outlet && !engine.outletWithAnything ? "outlet" : null,
    ruleSet: lineRuleIds(line, campaignId, retargeted),
    product: null,
    floor: null,
  }));
  const cartScope = emptyScope();
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
      if (!s) ruleScopes.set(id, (s = emptyScope()));
      s.subtotal += w.line.subtotal;
      s.quantity += w.line.quantity;
      s.lines += 1;
      s.discountable += discountable;
    }
  }
  return { work, cartScope, ruleScopes };
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
function gate(rule: Rule, ctx: GateContext, targetScope: Scope, entered: boolean): RuleState | null {
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
  if (missingSubtotal > 0 || missingQuantity > 0) {
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
): void {
  const none = emptyScope();
  for (const rule of rules) {
    const targetScope = rule.cls === "product" ? (ruleScopes.get(rule.id) ?? none) : ctx.cartScope;
    rule.state = gate(rule, ctx, targetScope, enteredByRule.has(rule.id));
  }
}

// --- Ranking and stacking ------------------------------------------------------------------

/** amount desc, then priority desc, then id asc (never config order). */
function byRank(a: Candidate, b: Candidate): number {
  if (a.amount !== b.amount) return b.amount - a.amount;
  if (a.rule.priority !== b.rule.priority) return b.rule.priority - a.rule.priority;
  return byId(a.rule, b.rule);
}

/**
 * Owner of a stack (whose node emits it): among the CODE components when there
 * is one — so the code shows as applied and Shopify counts its use — else among
 * all; highest priority, then id asc. (A stack is only ever of one class.)
 */
function ownerOf(components: Candidate[]): Rule {
  const codes = components.filter((c) => c.rule.method === "code");
  const pool = codes.length > 0 ? codes : components;
  let owner = pool[0].rule;
  for (const { rule } of pool) {
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
  return {
    components: picked.components.map((c) => ({ ruleId: c.rule.id, method: c.rule.method, module: "codes", amount: c.amount })),
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

// --- Stage: product discounts --------------------------------------------------------------------

interface StackContext {
  byId: Map<string, Rule>;
  partners: Map<string, Set<string>>;
  locale: PlanLocale;
  currency: string;
}

function planProducts(work: WorkLine[], ctx: StackContext): void {
  for (const w of work) {
    if (w.excluded || w.ruleSet.size === 0) continue;
    const positive: Candidate[] = [];
    for (const id of w.ruleSet) {
      const rule = ctx.byId.get(id);
      if (!rule || rule.cls !== "product" || rule.state !== null) continue;
      const amount = productAmount(rule, w.line);
      if (amount > 0) positive.push({ rule, amount });
    }
    if (positive.length === 0) continue;
    const unitPrice = w.line.unitPrice;
    w.product = buildStack(
      pick(positive, w.line.subtotal, ctx.partners),
      positive,
      (single) =>
        single.rule.valueKind === "percentage"
          ? { percent: single.rule.percent }
          : { fixedPerItem: Math.min(single.rule.fixed ?? 0, unitPrice) },
      ctx.locale,
      ctx.currency,
    );
  }
}

// --- Stage: margin protection, product discounts (MVP 2) ------------------------------------------

type MarginOn = Extract<FunctionMarginPayload, { enabled: true }>;

/** The floor of every discountable line (margin.ts): its settings, its cost in the cart currency, its lowest item price. */
function computeFloors(work: WorkLine[], margin: MarginOn, cart: NormalizedCart): void {
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
function applyMarginProtection(work: WorkLine[], ctx: StackContext): void {
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

// --- Stage: order discount ---------------------------------------------------------------------

/** A line that can carry an order discount under margin protection (protectOrder). */
interface OrderLine {
  w: WorkLine;
  /** Cart position (ties in the ordering). */
  index: number;
  /** a: the line after its product discount (> 0). */
  after: number;
  /** s: the line before it (its subtotal). */
  before: number;
  /** h = max(0, a − floorUnit × q − 1): what it can give, 1 minor unit kept for rounding. */
  headroom: number;
  /** k = h / s: the ordering key. */
  ratio: number;
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
 * Candidate sets: the lines with a_i > 0 sorted by k_i = h_i / s_i descending
 * (ties: cart order), every prefix that ends where k changes, and the full set.
 * The largest D wins, a tie goes to the larger set; its lines outside I are
 * margin-excluded (excludedCartLineIds). D = wanted(I) keeps the natural value
 * (a percent stays a percent, now over fewer lines); a lower D is {fixedTotal: D},
 * taken from the components in rank order. D = 0 → no order discount. Lines with
 * a_i = 0 carry nothing either way and are never excluded.
 */
function protectOrder(order: PlanOrder | null, work: WorkLine[], afterOf: (w: WorkLine) => number, ctx: StackContext): PlanOrder | null {
  if (!order) return null;
  const lines: OrderLine[] = [];
  for (let index = 0; index < work.length; index++) {
    const w = work[index];
    if (w.excluded !== null || !w.floor) continue;
    const after = afterOf(w);
    if (after <= 0) continue;
    const before = w.line.subtotal;
    const headroom = Math.max(0, after - w.floor.floorUnit * w.line.quantity - 1);
    lines.push({ w, index, after, before, headroom, ratio: headroom / before });
  }
  lines.sort((x, y) => (x.ratio !== y.ratio ? y.ratio - x.ratio : x.index - y.index));

  const components = order.components.map((c) => ctx.byId.get(c.ruleId) as Rule);
  const wantedAt = (base: number): number => {
    let sum = 0;
    for (const rule of components) sum += orderAmount(rule, base);
    return Math.min(sum, base);
  };
  let best = { size: 0, amount: 0, base: 0, wanted: 0 };
  let base = 0;
  let baseBefore = 0;
  for (let j = 0; j < lines.length; j++) {
    base += lines[j].after;
    baseBefore += lines[j].before;
    if (j + 1 < lines.length && lines[j + 1].ratio === lines[j].ratio) continue;
    let limit = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= j; i++) {
      const l = lines[i];
      const byAfter = Math.floor((l.headroom * base) / l.after);
      const byBefore = Math.floor((l.headroom * baseBefore) / l.before);
      limit = Math.min(limit, byAfter, byBefore);
    }
    const wanted = wantedAt(base);
    const amount = Math.min(wanted, limit);
    if (amount >= best.amount) best = { size: j + 1, amount, base, wanted };
  }

  if (best.amount <= 0) {
    for (const rule of components) rule.marginFloored = true;
    return null;
  }
  if (best.size === lines.length && best.amount === best.wanted) return order; // nothing to protect
  const left = new Set(lines.slice(best.size).map((l) => l.w));
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

function planOrderStage(rules: Rule[], work: WorkLine[], engine: EngineFlags, ctx: StackContext, marginOn: boolean): PlanOrder | null {
  const orderRules = rules.filter((r) => r.cls === "order" && r.state === null);
  const excludedLineIds = work.filter((w) => w.excluded !== null).map((w) => w.line.id);
  const planAt = (base: number): PlanOrder | null => {
    const positive = orderRules.map((rule) => ({ rule, amount: orderAmount(rule, base) })).filter((c) => c.amount > 0);
    if (positive.length === 0) return null;
    const stack = buildStack(
      pick(positive, base, ctx.partners),
      positive,
      (single) => (single.rule.valueKind === "percentage" ? { percent: single.rule.percent } : { fixedTotal: single.amount }),
      ctx.locale,
      ctx.currency,
    );
    return stack ? { ...stack, base, excludedLineIds, marginExcludedLineIds: [] } : null;
  };
  const productTotal = work.reduce((sum, w) => sum + (w.product?.amount ?? 0), 0);
  const discountableSubtotal = work.reduce((sum, w) => sum + (w.excluded === null ? w.line.subtotal : 0), 0);
  // [spec] The order discount is taken from the subtotal AFTER product discounts.
  if (engine.productWithOrder) {
    const order = planAt(discountableSubtotal - productTotal);
    return marginOn ? protectOrder(order, work, (w) => w.line.subtotal - (w.product?.amount ?? 0), ctx) : order;
  }

  // Exclusive (Free switch off): the better scenario for the customer wins, a tie
  // keeps products. Every rule of the losing category that had something to give
  // is "not combinable". Margin on: both scenarios are protected (the order-only
  // one on the lines' full subtotals).
  let orderOnly = planAt(discountableSubtotal);
  if (marginOn) orderOnly = protectOrder(orderOnly, work, (w) => w.line.subtotal, ctx);
  const orderWins = orderOnly !== null && orderOnly.amount > productTotal;
  const losing: DiscountClass = orderWins ? "product" : "order";
  for (const rule of rules) if (rule.cls === losing && rule.hadCandidate) rule.dropped = true;
  if (orderWins) {
    for (const w of work) {
      w.product = null;
      delete w.marginCapped;
    }
  }
  return orderWins ? orderOnly : null;
}

// --- Stage: shipping -----------------------------------------------------------------------------

/**
 * One shipping winner. The function does not know the delivery cost, so
 * [spec] percent (free = 100 %) ranks above a fixed amount, larger first —
 * never by a cost only the TS side could see (audit MVP 1 drift #7). When a
 * Free switch forbids shipping next to the product/order discounts that apply,
 * EVERY shipping candidate is dropped as not combinable — none is "outranked"
 * by a winner that does not apply either.
 */
function planShipping(
  rules: Rule[],
  work: WorkLine[],
  order: PlanOrder | null,
  engine: EngineFlags,
  cart: NormalizedCart,
): PlanShipping | null {
  const candidates = rules
    .filter((r) => r.cls === "shipping" && r.state === null)
    .map((rule) => {
      const percent = rule.valueKind === "freeShipping" ? 100 : rule.valueKind === "percentage" ? rule.percent : null;
      const fixed = rule.valueKind === "fixed" ? (rule.fixed ?? 0) : null;
      const value: ShippingValue = percent !== null ? { percent } : { fixedTotal: fixed ?? 0 };
      const worth = percent !== null ? percent > 0 : (fixed ?? 0) > 0;
      const key = percent !== null ? [1, percent] : [0, fixed ?? 0];
      return { rule, value, worth, key };
    })
    .filter((c) => c.worth)
    .sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1] || b.rule.priority - a.rule.priority || byId(a.rule, b.rule));
  if (candidates.length === 0) return null;

  for (const c of candidates) c.rule.hadCandidate = true;
  const blocked = (!engine.productWithShipping && work.some((w) => w.product)) || (!engine.orderWithShipping && order !== null);
  if (blocked) {
    for (const c of candidates) c.rule.dropped = true;
    return null;
  }
  const [winner, ...losers] = candidates;
  for (const c of losers) if (c.rule.lostTo.length < MAX_BETTER_RULES) c.rule.lostTo.push(winner.rule.id);
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
      // margin_floor: its winning contributions were all taken to 0 by margin protection.
      (c?.owner
        ? "applied"
        : c
          ? "combined"
          : rule.marginFloored
            ? "margin_floor"
            : rule.dropped
              ? "not_combinable"
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
    if (rule.startsOn) out.startsOn = rule.startsOn;
    if (rule.endsOn) out.endsOn = rule.endsOn;
    if (state === "outranked" && rule.lostTo.length > 0) out.betterRuleIds = [...rule.lostTo];
    if (state === "combined" && c?.combinedInto) out.combinedInto = c.combinedInto;
    return out;
  });
  const outcomeById = new Map(outcomes.map((o) => [o.ruleId, o]));

  const codeOutcomes: CodeOutcome[] = cart.enteredCodes.map((code) => {
    const rule = codes.ownerOfCode.get(code);
    if (!rule) return { code, ruleId: null, state: "unknown" };
    if (codes.enteredByRule.get(rule.id)?.[0] !== code) return { code, ruleId: rule.id, state: "same_rule" };
    return { code, ruleId: rule.id, state: outcomeById.get(rule.id)!.state };
  });
  return { outcomes, codeOutcomes };
}

// --- The plan -------------------------------------------------------------------------------

function buildPlan(cart: NormalizedCart, config: Rec): CartPlan {
  const { currency, locale } = cart;
  const engine = readEngine(config);
  const { campaign, rules, retargeted, byId: rulesById } = resolveRules(config, cart);
  const codes = matchCodes(rules, cart);
  const { work, cartScope, ruleScopes } = prepareLines(cart, engine, campaign?.id ?? null, retargeted);
  gateRules(rules, { cart, marketCountries: readMarketCountries(config), cartScope }, ruleScopes, codes.enteredByRule);

  const stackCtx: StackContext = { byId: rulesById, partners: partnersOf(rules), locale, currency };
  planProducts(work, stackCtx);
  const margin = readMarginPayload((config.modules as Rec).margin);
  if (margin.enabled) {
    computeFloors(work, margin, cart);
    applyMarginProtection(work, stackCtx);
  }
  const order = planOrderStage(rules, work, engine, stackCtx, margin.enabled);
  const shipping = planShipping(rules, work, order, engine, cart);
  const { outcomes, codeOutcomes } = buildOutcomes(rules, work, order, shipping, cart, codes);

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
    codes: codeOutcomes,
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
