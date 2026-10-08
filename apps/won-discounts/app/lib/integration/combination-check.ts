// Kontrola kombinací (feedback 2026-10-06, bod 16): the app knows which discounts run, so it builds the common
// carts itself, plans them and says ahead where something will not go the way the page promises — above all where
// margin protection lowers a discount.
//
//   buildScenarios(config, facts)   the carts, only from what the config actually runs (at most SCENARIO_LIMIT;
//                                   combinations that come out as the same cart are one scenario):
//                                   the quantity discount alone; with a code; with an order discount; with free
//                                   shipping; with a gift step; a gift step with a code; with the discount steps
//                                   of Milníky (and those with a code); a product with its own tiers; a sale
//                                   variant with the rest; a campaign at its start; then the ladder in every
//                                   other market whose amounts are its own;
//   runScenario(config, s, facts)   ONE computation: try-cart-plan.ts planTryCartDetail — the same planCart on the
//                                   same payload as checkout and the manual cart. No second set of rules lives
//                                   here: the findings only READ the plan;
//   findingsOf(plan, preview)       what the plan says went otherwise than set up.
// The products are the shop's own, from what the app has stored (the cost mirror's prices and purchase costs, the
// refs the sync wrote): the one with the lowest margin, one with its own tiers, a variant on sale. A shop with no
// stored product gets a sample one, and the result says so. Prices in a market with another currency are
// converted with the rate the merchant's own amounts imply — an estimate, said as one.
// Pure: the facts are read by combination-check.server.ts (the database only — never Shopify).

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";
import type { CheckoutPreview } from "@won/core/discounts/function-output";
import { amountColumns, toAmountColumns } from "@won/core/discounts/market-amounts";
import { isMilestoneRule } from "@won/core/discounts/milestones";
import { currencyExponent } from "@won/core/discounts/money";
import type { CartPlan } from "@won/core/discounts/plan";
import { globalTierSet } from "@won/core/discounts/tiers";

import { firstRuleCode } from "../../components/model/try-cart-form";
import { planTryCartDetail, type PricedLine, type ProductRefs, type TryCartPlanDetail } from "./try-cart-plan";

/** Most scenarios a check runs (the page lists them all; each is one planCart). */
export const SCENARIO_LIMIT = 12;

export type ScenarioPart = "tiers" | "code" | "order" | "shipping" | "gift" | "steps" | "exception" | "outlet" | "campaign" | "market";

export type FindingKind =
  /** Margin protection lowered a discount or took it away. */
  | "margin"
  /** The discounts together passed the highest discount the merchant allows. */
  | "max"
  /** A discount does not apply because it does not combine with another. */
  | "not_combinable"
  /** The code takes the cart under a gift step: the gift is lost. */
  | "code_loses_gift"
  /** Of the discount steps reached only the higher one applies, or a code beat it. */
  | "step_superseded"
  /** Checkout shortens the discounts (too many for one cart). */
  | "checkout_cut";

export const FINDING_KINDS: readonly FindingKind[] = ["margin", "max", "not_combinable", "code_loses_gift", "step_superseded", "checkout_cut"];

/** Where the setting behind a finding is. */
export const FINDING_HREF: Readonly<Record<FindingKind, string>> = {
  margin: "/app/margin",
  max: "/app/margin",
  not_combinable: "/app/settings#combination",
  code_loses_gift: "/app/rewards#steps",
  step_superseded: "/app/rewards#steps",
  checkout_cut: "/app/discounts",
};

export interface ScenarioProduct {
  variantId: string;
  productId: string;
  title: string;
  /** One item, minor units of the SHOP currency. */
  unitPrice: number;
  /** Purchase cost of one item in major units and its currency (the cost mirror); absent = unknown. */
  unitCost?: number;
  unitCostCurrency?: string;
  /** The refs checkout reads for the product (the sync's index); absent = the product has none. */
  refs?: ProductRefs;
  /** Why it was picked. `sample` = not a product of the shop (it has none stored). */
  role: "lowMargin" | "exception" | "outlet" | "any" | "sample";
}

export interface ScenarioFacts {
  products: readonly ScenarioProduct[];
  shopCurrency: string;
  shopTimezone: string;
  /** Shop-local `YYYY-MM-DD` and `HH:MM:SS` now. */
  date: string;
  time: string;
  locale: "cs" | "en";
}

export interface Scenario {
  id: string;
  parts: ScenarioPart[];
  /** The market the cart is from: its amount column (`EUR@sk`), currency, handle and a country of it. */
  market: { key: string; currency: string; handle: string; country: string | null };
  lines: { product: ScenarioProduct; quantity: number }[];
  /** The codes entered, and the rules they belong to (the manual form ticks those). */
  codes: string[];
  ruleIds: string[];
  date: string;
  time: string;
  /** The code or the campaign the scenario is named by. */
  code?: string;
  campaign?: string;
  /** Shop currency → the market's currency, when they differ: implied by the merchant's own amounts. */
  rate?: number;
}

export interface ScenarioResult {
  scenario: Scenario;
  findings: FindingKind[];
  detail: TryCartPlanDetail;
}

const SAMPLE: ScenarioProduct = { variantId: "gid://shopify/ProductVariant/0", productId: "gid://shopify/Product/0", title: "", unitPrice: 0, role: "sample" };

/** A sample product for a shop with none stored: 500 in the shop currency's major unit. */
function sampleProduct(shopCurrency: string): ScenarioProduct {
  return { ...SAMPLE, unitPrice: 500 * 10 ** currencyExponent(shopCurrency) };
}

const QUANTITY_MAX = 999;

/** Items of `unitPrice` that make a cart worth at least `amount` (and at least `min` items). */
function quantityFor(amount: number, unitPrice: number, min: number): number {
  const needed = unitPrice > 0 ? Math.ceil(amount / unitPrice) : min;
  return Math.max(1, Math.min(QUANTITY_MAX, Math.max(min, needed)));
}

/**
 * The scenarios of a config (the GATED one: what the shop's plan runs). Only combinations whose every part is in
 * force; [] when nothing runs. Deterministic for the same config and facts.
 */
export function buildScenarios(config: WonDiscountsConfig, facts: ScenarioFacts): Scenario[] {
  const columns = amountColumns(config.markets);
  const countryOf = (handle: string) => config.markets.find((m) => m.handle === handle)?.countries?.[0] ?? null;
  const marketOf = (c: { key: string; currency: string; handle: string }) => ({ ...c, country: countryOf(c.handle) });
  const home = marketOf(columns.find((c) => c.currency === facts.shopCurrency) ?? { key: facts.shopCurrency, currency: facts.shopCurrency, handle: "" });
  const amountIn = (money: Record<string, number> | undefined | null, key: string) => {
    const value = columns.length > 0 ? toAmountColumns(money, config.markets)[key] : money?.[key];
    return typeof value === "number" && value > 0 ? value : null;
  };

  const rules = config.modules.codes.rules.filter((rule) => rule.enabled);
  const own = rules.filter((rule) => !isMilestoneRule(rule));
  const codeOf = (rule: DiscountRule) => firstRuleCode(rule);
  const codeRule = own.find((rule) => rule.method === "code" && codeOf(rule) !== undefined);
  const orderRule = own.find((rule) => rule.method === "automatic" && rule.target.kind === "order");
  const shippingRule = own.find((rule) => rule.method === "automatic" && rule.value.kind === "freeShipping");
  const steps = rules.filter((rule) => isMilestoneRule(rule));
  const tiers = globalTierSet(config.modules.tiers.sets);
  const tierQty = tiers && tiers.breaks.length > 0 ? Math.min(...tiers.breaks.map((b) => b.minQty)) : 1;
  const hasTiers = tiers !== undefined && tiers !== null && tiers.breaks.length > 0;
  const rewards = config.modules.rewards;

  const main = facts.products.find((p) => p.role === "lowMargin") ?? facts.products.find((p) => p.role === "any") ?? facts.products[0] ?? sampleProduct(facts.shopCurrency);
  const exception = facts.products.find((p) => p.role === "exception");
  const outlet = facts.products.find((p) => p.role === "outlet");

  const out: Scenario[] = [];
  /** The cart itself: two scenarios with the same one are ONE scenario that holds the parts of both. */
  const cartKey = (s: Scenario) => JSON.stringify([s.market.key, s.lines.map((l) => [l.product.variantId, l.quantity]), s.codes, s.date, s.time]);
  const add = (id: string, parts: ScenarioPart[], lines: Scenario["lines"], extra: Partial<Scenario> = {}) => {
    const next: Scenario = { id, parts, market: home, lines, codes: [], ruleIds: [], date: facts.date, time: facts.time, ...extra };
    const same = out.find((s) => cartKey(s) === cartKey(next));
    if (same) same.parts = [...same.parts, ...parts.filter((part) => !same.parts.includes(part))];
    else if (out.length < SCENARIO_LIMIT) out.push(next);
  };
  /** The main product, as many items as reach `amount` in the home market (and the first tier). */
  const cartOf = (amount: number | null) => [{ product: main, quantity: quantityFor(amount ?? 0, main.unitPrice, tierQty) }];
  const withCode = codeRule ? { codes: [codeOf(codeRule)!], ruleIds: [codeRule.id], code: codeOf(codeRule)! } : null;
  const base: ScenarioPart[] = hasTiers ? ["tiers"] : [];

  if (hasTiers) add("tiers", ["tiers"], cartOf(null));
  if (withCode) add("code", [...base, "code"], cartOf(amountIn(codeRule!.minimum?.subtotal, home.key)), withCode);
  if (orderRule) add("order", [...base, "order"], cartOf(amountIn(orderRule.minimum?.subtotal, home.key)));
  const shippingAt = amountIn(rewards.freeShipping?.threshold, home.key) ?? (shippingRule ? (amountIn(shippingRule.minimum?.subtotal, home.key) ?? 0) : null);
  if (shippingAt !== null) add("shipping", [...base, "shipping"], cartOf(shippingAt));
  const giftAt = rewards.gifts.map((gift) => amountIn(gift.threshold, home.key)).filter((v): v is number => v !== null).sort((a, b) => a - b)[0] ?? null;
  if (giftAt !== null) add("gift", [...base, "gift"], cartOf(giftAt));
  if (giftAt !== null && withCode) add("gift-code", ["gift", "code"], cartOf(giftAt), withCode);
  const stepAmounts = steps.map((rule) => amountIn(rule.minimum?.subtotal, home.key)).filter((v): v is number => v !== null);
  const stepsAt = stepAmounts.length > 0 ? Math.max(...stepAmounts) : null;
  if (stepsAt !== null) add("steps", [...base, "steps"], cartOf(stepsAt));
  if (stepsAt !== null && withCode) add("steps-code", ["steps", "code"], cartOf(stepsAt), withCode);
  // A product with its own tiers: only while the plan runs such a set (on Free it is inert).
  const ownTiers = config.modules.tiers.sets.filter((set) => set.scope !== "global" && set.breaks.length > 0);
  if (exception && ownTiers.length > 0) add("exception", ["exception"], [{ product: exception, quantity: Math.max(5, ...ownTiers.flatMap((set) => set.breaks.map((b) => b.minQty))) }]);
  // A variant on sale next to what else runs (alone it has nothing to combine with).
  const rest: ScenarioPart[] = [...base, ...(withCode ? (["code"] as const) : [])];
  if (outlet && rest.length > 0) {
    add("outlet", ["outlet", ...rest], [{ product: outlet, quantity: tierQty }, ...(outlet.variantId !== main.variantId ? cartOf(stepsAt ?? giftAt ?? shippingAt) : [])], withCode ?? {});
  }
  // The campaign that starts next (or runs): the cart as it will be planned in its first minute.
  const campaign = config.campaigns
    .filter((c) => !c.killed && c.window.end > `${facts.date}T${facts.time}`)
    .sort((a, b) => (a.window.start < b.window.start ? -1 : 1))[0];
  if (campaign) {
    const [day, clock = "00:00"] = campaign.window.start.split("T");
    add(`campaign-${campaign.id}`, ["campaign", ...base], cartOf(stepsAt ?? giftAt ?? shippingAt), { date: day!, time: `${clock.slice(0, 5)}:00`, campaign: campaign.name });
  }
  // Every other market whose ladder has its own amounts: the same ladder there, priced with the rate those amounts imply.
  const ladder = [rewards.freeShipping?.threshold, ...rewards.gifts.map((g) => g.threshold), ...steps.map((r) => r.minimum?.subtotal)];
  for (const column of columns) {
    if (column.key === home.key) continue;
    const there = ladder.map((money) => ({ here: amountIn(money, home.key), there: amountIn(money, column.key) })).filter((x): x is { here: number | null; there: number } => x.there !== null);
    if (there.length === 0) continue;
    const pair = there.find((x) => x.here !== null);
    const rate = column.currency === home.currency ? 1 : pair ? (pair.there / pair.here!) * 10 ** (currencyExponent(home.currency) - currencyExponent(column.currency)) : null;
    if (rate === null || !Number.isFinite(rate) || rate <= 0) continue;
    const top = Math.max(...there.map((x) => x.there));
    const price = Math.max(1, Math.round(main.unitPrice * rate * 10 ** (currencyExponent(column.currency) - currencyExponent(home.currency))));
    add(`market-${column.key}`, ["market", ...(steps.length > 0 ? (["steps"] as const) : rewards.gifts.length > 0 ? (["gift"] as const) : (["shipping"] as const))], [{ product: main, quantity: quantityFor(top, price, tierQty) }], {
      market: marketOf(column),
      ...(column.currency === home.currency ? {} : { rate }),
    });
  }
  return out;
}

/** The scenario's lines as the planner takes them: priced in the market's currency. */
export function scenarioLines(scenario: Scenario, facts: Pick<ScenarioFacts, "shopCurrency">): PricedLine[] {
  const from = currencyExponent(facts.shopCurrency);
  const to = currencyExponent(scenario.market.currency);
  return scenario.lines.map(({ product, quantity }) => ({
    variantId: product.variantId,
    productId: product.productId,
    title: product.title,
    quantity,
    unitPrice: scenario.rate === undefined ? product.unitPrice : Math.max(1, Math.round(product.unitPrice * scenario.rate * 10 ** (to - from))),
    collectionIds: [],
    ...(product.unitCost !== undefined && product.unitCostCurrency ? { unitCost: product.unitCost, unitCostCurrency: product.unitCostCurrency } : {}),
    ...(product.role === "outlet" ? { outlet: true } : {}),
  }));
}

/** What the plan says went otherwise than set up — read off the plan, never computed again. */
export function findingsOf(plan: CartPlan, preview: CheckoutPreview): FindingKind[] {
  const found = new Set<FindingKind>();
  const caps = plan.lines.map((line) => line.marginCapped).filter((cap) => cap !== undefined);
  if (caps.some((cap) => cap.basis === "max_percent")) found.add("max");
  if (
    caps.some((cap) => cap.basis === "cost") ||
    plan.order?.marginCapped !== undefined ||
    (plan.order?.marginExcludedLineIds.length ?? 0) > 0 ||
    plan.rules.some((rule) => rule.state === "margin_floor") ||
    plan.tiers.some((tier) => tier.state === "margin_floor")
  ) {
    found.add("margin");
  }
  if (plan.rules.some((rule) => rule.state === "not_combinable") || plan.tiers.some((tier) => tier.state === "not_combinable") || plan.warnings.some((w) => w.code === "reward_not_combinable")) found.add("not_combinable");
  if (plan.warnings.some((w) => w.code === "code_loses_gift")) found.add("code_loses_gift");
  // A discount step of Milníky that had something to give and lost: to the higher step, or to a code.
  if (plan.rules.some((rule) => rule.ruleId.startsWith("ms-") && rule.state === "outranked")) found.add("step_superseded");
  if (preview.degraded || preview.shortfall > 0 || preview.droppedCandidates.length > 0) found.add("checkout_cut");
  return FINDING_KINDS.filter((kind) => found.has(kind));
}

/** Plan one scenario: the same planTryCartDetail the manual cart runs. */
export function runScenario(config: WonDiscountsConfig, scenario: Scenario, facts: ScenarioFacts): ScenarioResult {
  const refs = new Map<string, ProductRefs>();
  for (const { product } of scenario.lines) if (product.refs) refs.set(product.productId, product.refs);
  const detail = planTryCartDetail(config, {
    lines: scenarioLines(scenario, facts),
    currency: scenario.market.currency,
    countryCode: scenario.market.country,
    codes: scenario.codes,
    date: scenario.date,
    time: scenario.time,
    shopTimezone: facts.shopTimezone,
    locale: facts.locale,
    shopCurrency: facts.shopCurrency,
    shopToCartRate: scenario.rate ?? 1,
    ...(scenario.rate !== undefined ? { rateEstimated: true } : {}),
    productRefs: refs,
  });
  return { scenario, findings: findingsOf(detail.plan, detail.preview), detail };
}

/** Every scenario of the config, planned. */
export function runScenarios(config: WonDiscountsConfig, facts: ScenarioFacts): ScenarioResult[] {
  return buildScenarios(config, facts).map((scenario) => runScenario(config, scenario, facts));
}
