// Milníky (feedback 6 Oct 2026, body 9 a 10): ONE ladder of steps by the value of the cart. A step is an amount
// per market and one reward: free shipping, a free gift, or a discount off the whole order.
//
// Nothing new is stored and the checkout function is not touched. The ladder is a VIEW of what the config
// already holds, so a config stored before Milníky reads as steps as it is, and saving it back unchanged
// writes the same config (the gift tiers in ladder order):
//   free shipping        modules.rewards.freeShipping             (at most one step)
//   a free gift          modules.rewards.gifts[]                  (one step per gift tier)
//   an order discount    modules.codes.rules[], id "ms-…"         (an automatic order rule with a minimum
//                                                                 subtotal of the whole cart)
// The order discount is an ordinary rule to the engine: it competes in the order stage like every other order
// discount (the better one wins, never a sum — so of two reached discount steps only the higher applies), it is
// lowered by margin protection and it follows the "product with order" switch. Its minimum is the same base the
// gift and shipping thresholds use: the non-gift lines before every discount (plan.ts gate "minimum košíku" =
// plan-rewards.ts rewardBase).
//
// Limits (rozhodnuto 6. 10. 2026): Free runs the first 2 steps of the ladder, Pro 6. plan-gate.ts drops the rest
// from what a Free shop ships; the stored config keeps them (§14a).

import type { DiscountRule, GiftTier, MarketSetting, ReadonlyDeep, WonDiscountsConfig } from "./config/types.ts";
import { amountColumns, toAmountColumns } from "./market-amounts.ts";
import type { MoneyByCurrency } from "./money.ts";

/** The id prefix of the order rules that are steps of the ladder. */
export const MILESTONE_RULE_PREFIX = "ms-";
/** The ladder id of the free-shipping step (there is one at most; it has no id of its own in the config). */
export const MILESTONE_SHIPPING_ID = "shipping";
/** Steps a shop runs on its plan. */
export const MILESTONE_LIMITS = Object.freeze({ free: 2, pro: 6 });

export type MilestoneKind = "shipping" | "gift" | "discount";

export type MilestoneDiscountValue = { kind: "percentage"; percent: number } | { kind: "fixed"; amount: MoneyByCurrency };

export type MilestoneStep =
  | { kind: "shipping"; id: typeof MILESTONE_SHIPPING_ID; threshold: MoneyByCurrency }
  | { kind: "gift"; id: string; threshold: MoneyByCurrency; choices: string[]; fallbackVariantId?: string }
  | { kind: "discount"; id: string; threshold: MoneyByCurrency; value: MilestoneDiscountValue };

type RuleLike = ReadonlyDeep<Pick<DiscountRule, "id" | "method" | "value" | "target">>;

/**
 * True for an order rule that is a step of the ladder: the id prefix AND the shape Milníky writes (automatic,
 * the whole order, a percentage or a fixed amount). A rule with the prefix and another shape is an ordinary
 * discount — it stays on "Slevy a kódy", never hidden from both pages.
 */
export function isMilestoneRule(rule: RuleLike): boolean {
  return rule.id.startsWith(MILESTONE_RULE_PREFIX) && rule.method === "automatic" && rule.target.kind === "order" && (rule.value.kind === "percentage" || rule.value.kind === "fixed");
}

/** The order rule of a discount step: automatic, enabled, the whole cart must reach the threshold. */
export function milestoneRule(step: { id: string; threshold: MoneyByCurrency; value: MilestoneDiscountValue }): DiscountRule {
  return {
    id: step.id,
    enabled: true,
    // No name: the checkout then says what the discount is ("Sleva 5 %", describeRule), in the buyer's language.
    name: "",
    method: "automatic",
    value: step.value.kind === "percentage" ? { kind: "percentage", percent: step.value.percent } : { kind: "fixed", amount: { ...step.value.amount } },
    target: { kind: "order" },
    minimum: { subtotal: { ...step.threshold }, scope: "cart" },
  };
}

type Markets = readonly Pick<MarketSetting, "handle" | "currency" | "enabled">[];

/** The amount key the ladder is sorted by: the first enabled market's column (the first column of the admin's table). */
export function milestoneSortKey(markets: Markets): string | null {
  return amountColumns(markets)[0]?.key ?? null;
}

const KIND_ORDER: Record<MilestoneKind, number> = { shipping: 0, gift: 1, discount: 2 };

/**
 * The steps in ladder order: by the amount of the first enabled market, lowest first (a shop with no market yet:
 * by the first amount key its steps have). A step without that amount goes after them, in the stored order —
 * amounts of two currencies are never compared. Ties: shipping, gift, discount, then the stored order.
 * Works on a stored config and on one expanded to the admin's columns alike.
 */
export function sortMilestones<S extends { kind: MilestoneKind; threshold: MoneyByCurrency }>(steps: readonly S[], markets: Markets): S[] {
  const key = milestoneSortKey(markets) ?? steps.flatMap((step) => Object.keys(step.threshold))[0] ?? null;
  const amountOf = (step: S): number | undefined => {
    if (key === null) return undefined;
    const value = toAmountColumns(step.threshold, markets)[key];
    return typeof value === "number" ? value : undefined;
  };
  return steps
    .map((step, index) => ({ step, index, at: amountOf(step) }))
    .sort((a, b) => {
      if (a.at === undefined || b.at === undefined) return (a.at === undefined ? 1 : 0) - (b.at === undefined ? 1 : 0) || a.index - b.index;
      return a.at - b.at || KIND_ORDER[a.step.kind] - KIND_ORDER[b.step.kind] || a.index - b.index;
    })
    .map((x) => x.step);
}

type ConfigLike = ReadonlyDeep<Pick<WonDiscountsConfig, "markets">> & {
  modules: { rewards: ReadonlyDeep<WonDiscountsConfig["modules"]["rewards"]>; codes: { rules: readonly ReadonlyDeep<DiscountRule>[] } };
};

/** The ladder of a config: every stored reward and every milestone rule as a step, in ladder order. */
export function milestoneSteps(config: ConfigLike): MilestoneStep[] {
  const steps: MilestoneStep[] = [];
  const rewards = config.modules.rewards;
  if (rewards.freeShipping) steps.push({ kind: "shipping", id: MILESTONE_SHIPPING_ID, threshold: { ...rewards.freeShipping.threshold } });
  for (const gift of rewards.gifts) {
    steps.push({
      kind: "gift",
      id: gift.id,
      threshold: { ...gift.threshold },
      choices: [...gift.choices],
      ...(gift.fallbackVariantId ? { fallbackVariantId: gift.fallbackVariantId } : {}),
    });
  }
  for (const rule of config.modules.codes.rules) {
    if (!isMilestoneRule(rule)) continue;
    const value: MilestoneDiscountValue =
      rule.value.kind === "percentage" ? { kind: "percentage", percent: rule.value.percent } : { kind: "fixed", amount: { ...(rule.value as { amount: MoneyByCurrency }).amount } };
    steps.push({ kind: "discount", id: rule.id, threshold: { ...(rule.minimum?.subtotal ?? {}) }, value });
  }
  return sortMilestones(steps, config.markets as Markets);
}

/** The ids of the steps past a plan's limit, in ladder order (what a Free shop does not run). */
export function milestonesOverLimit(config: ConfigLike, plan: "free" | "pro"): MilestoneStep[] {
  return milestoneSteps(config).slice(MILESTONE_LIMITS[plan]);
}

/**
 * The config with `steps` as its ladder: free shipping and the gifts into `modules.rewards` (the gifts in ladder
 * order), the discount steps as milestone rules AFTER the shop's other rules (ladder order). Every rule that is
 * not a milestone rule, and everything else in the config, is kept as it is.
 */
export function withMilestones<C extends ConfigLike>(config: C, steps: readonly MilestoneStep[]): C {
  const ordered = sortMilestones(steps, config.markets as Markets);
  const shipping = ordered.find((s) => s.kind === "shipping");
  const gifts: GiftTier[] = [];
  const rules: DiscountRule[] = [];
  for (const step of ordered) {
    if (step.kind === "gift") {
      gifts.push({ id: step.id, threshold: { ...step.threshold }, choices: [...step.choices], ...(step.fallbackVariantId ? { fallbackVariantId: step.fallbackVariantId } : {}) });
    } else if (step.kind === "discount") {
      rules.push(milestoneRule(step));
    }
  }
  const { freeShipping: _dropped, ...rest } = config.modules.rewards as WonDiscountsConfig["modules"]["rewards"];
  return {
    ...config,
    modules: {
      ...config.modules,
      rewards: { ...rest, gifts, ...(shipping ? { freeShipping: { threshold: { ...shipping.threshold } } } : {}) },
      codes: { ...config.modules.codes, rules: [...config.modules.codes.rules.filter((r) => !isMilestoneRule(r)), ...rules] },
    },
  };
}
