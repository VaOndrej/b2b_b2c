// Milníky (dřív „Odměny za košík“), the server side of the admin module (MVP 4 contracts R1–R7; feedback 6 Oct
// 2026 bod 9: one ladder of steps — core milestones.ts says where each kind of step is stored).
//   loadRewardsScreen(ctx)   the page (RewardsScreenData): the stored ladder with Shopify names of the gift
//                            variants (never an id on screen), which steps the plan does not run (BILL-1), the
//                            market columns, the app embed (the cart panel needs it) and the placement links;
//   rewardsAction(ctx, form) `intent=save`: the form parsed HERE (SEC-1) against the stored markets and ladder,
//                            the plan's limit checked, kept steps taken from the stored config by id (§14a),
//                            saved like every admin change (saveConfigSection: lock, F12 on the ladder's parts,
//                            unreadable guard, saveAndSync);
//   rewardsOverviewOf(...)   the Přehled card: what the PLAN runs (§17c).

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import { isMilestoneRule, MILESTONE_LIMITS, milestoneSteps, milestonesOverLimit, withMilestones, type MilestoneStep } from "@won/core/discounts/milestones";
import { explainGate, gateConfigForPlan, type ProCapability } from "@won/core/discounts/plan-gate";

import { cartBlockAddUrl, placementLinks, REWARDS_PROGRESS_BLOCK_HANDLE } from "../../components/model/embed";
import { currenciesWithoutAmount, currencyCodes, currencyViews, enabledCurrencies } from "../../components/model/markets";
import { MILESTONES_INTENT, milestoneStepView, MS_FIELD, readMilestonesForm } from "../../components/model/milestones";
import type { FormDataLike } from "../../components/model/rule-form";
import { rewardsStatus } from "../../components/model/module-status";
import type { GateNoteView, RewardsOverviewView, RewardsScreenData, SyncView, UiResult } from "../../components/model/types";
import { loadConfig } from "../config.server";
import { loadAdminSignals } from "../ui-actions.server";
import { graphqlOf, type ShopCtx } from "./context.server";
import { readSaveOptions, saveConfigSection } from "./settings.server";
import { ctxPlan, loadSyncView } from "./sync-status.server";
import { readAmountSuggest, readMarketNames, readShopContext, readThemeLook } from "./themes.server";
import { resourceLabels } from "./titles.server";

const REWARD_CAPABILITIES: readonly ProCapability[] = ["milestone_steps", "gift_choices"];

/** Validated against Admin 2026-04 (Shopify dev MCP): ProductVariant.displayName ("Product - Variant"). */
export const GIFT_TITLES_DOCUMENT = `#graphql
query WonRewardsGiftTitles($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      id
      displayName
      title
      product {
        title
      }
    }
  }
}`;

function giftIds(config: WonDiscountsConfig): string[] {
  return [...new Set(config.modules.rewards.gifts.flatMap((g) => [...g.choices, ...(g.fallbackVariantId ? [g.fallbackVariantId] : [])]))];
}

async function giftTitles(ctx: ShopCtx, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    try {
      type Node = { id?: string; title?: string; product?: { title?: string } } | null;
      const result = await ctx.client.graphql<{ nodes?: Node[] }>(GIFT_TITLES_DOCUMENT, { ids: ids.slice(i, i + 100) });
      for (const node of result.data?.nodes ?? []) {
        if (!node?.id || !node.product?.title) continue;
        out.set(node.id, node.title && node.title !== "Default Title" ? `${node.product.title} — ${node.title}` : node.product.title);
      }
    } catch (error) {
      if (error instanceof Response) throw error;
    }
  }
  return out;
}

function gateNotesOf(config: WonDiscountsConfig, plan: "free" | "pro", locale: ShopCtx["locale"]): GateNoteView[] {
  const { stripped } = gateConfigForPlan(config, plan);
  return explainGate(
    stripped.filter((s) => REWARD_CAPABILITIES.includes(s.capability)),
    locale,
  ).map((e) => ({ text: e.text }));
}

/** The page's data from the stored config on this plan (pure: the dev harness renders the same). */
export function rewardsScreenFacts(
  stored: WonDiscountsConfig,
  opts: { plan: "free" | "pro"; locale: ShopCtx["locale"]; titles: ReadonlyMap<string, string> },
): Pick<RewardsScreenData, "steps" | "overLimit" | "limit" | "limitPro" | "countOther" | "productWithOrder" | "marginOn" | "gateNotes"> {
  return {
    steps: milestoneSteps(stored).map((step) => milestoneStepView(step, opts.titles)),
    overLimit: milestonesOverLimit(stored, opts.plan).map((step) => step.id),
    limit: MILESTONE_LIMITS[opts.plan],
    limitPro: MILESTONE_LIMITS.pro,
    countOther: stored.modules.rewards.countOtherDiscounts,
    productWithOrder: stored.engine.combination.productWithOrder,
    marginOn: stored.modules.margin.enabled,
    gateNotes: gateNotesOf(stored, opts.plan, opts.locale),
  };
}

export async function loadRewardsScreen(ctx: ShopCtx, opts: { scopes: string; fresh?: boolean }): Promise<RewardsScreenData> {
  const graphql = graphqlOf(ctx);
  const loaded = await loadConfig(ctx.db, ctx.shop);
  const stored = loaded.config;
  const [plan, shopContext, marketNames, titles, signals, look] = await Promise.all([
    ctxPlan(ctx),
    readShopContext(graphql),
    readMarketNames(graphql, ctx.shop, opts.scopes),
    giftTitles(ctx, giftIds(stored)),
    loadAdminSignals({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql, fresh: opts.fresh }),
    // Which placements the live theme already has (the read Množstevní slevy shares, cached 60 s).
    readThemeLook(ctx, { scopes: opts.scopes, fresh: opts.fresh }),
  ]);
  const sync = await loadSyncView(ctx, loaded, shopContext.timezone);
  return {
    plan,
    configVersion: loaded.version ?? null,
    currencies: currencyViews(stored.markets, { shopCurrency: shopContext.currencyCode, marketNames }),
    ...rewardsScreenFacts(stored, { plan, locale: ctx.locale, titles }),
    status: rewardsSectionStatus(stored, plan, shopContext.currencyCode || stored.markets.find((m) => m.enabled)?.currency || "", sync),
    embed: signals.embed,
    cartBlockAddUrl: cartBlockAddUrl(ctx.shop, ctx.apiKey),
    placements: placementLinks(ctx.shop, ctx.apiKey, REWARDS_PROGRESS_BLOCK_HANDLE),
    placed: look.placements,
    suggest: await readAmountSuggest(graphql, ctx.shop, opts.scopes, shopContext.currencyCode),
  };
}

/** The state of the ladder: the same function, on the same view, as the home tile (model/module-status.ts). */
export function rewardsSectionStatus(config: WonDiscountsConfig, plan: "free" | "pro", currency: string, sync: SyncView): NonNullable<RewardsScreenData["status"]> {
  return rewardsStatus(rewardsOverviewOf(config, plan, currency), sync);
}

/** What the page edits (F12 compares it): the rewards module and the order rules that are steps of the ladder. */
function ladderPart(config: WonDiscountsConfig): unknown {
  return { rewards: config.modules.rewards, rules: config.modules.codes.rules.filter(isMilestoneRule) };
}

/** The Milníky action: `intent=save`, parsed on the server (SEC-1), saved through saveConfigSection. */
export async function rewardsAction(ctx: ShopCtx, form: FormDataLike): Promise<UiResult> {
  if (form.get(MS_FIELD.intent) !== MILESTONES_INTENT.save) return { ok: false, reason: "bad_request" };
  const [loaded, shopContext, plan] = await Promise.all([loadConfig(ctx.db, ctx.shop), readShopContext(graphqlOf(ctx)), ctxPlan(ctx)]);
  const columns = currencyCodes(currencyViews(loaded.config.markets, { shopCurrency: shopContext.currencyCode }));
  const stored = new Map<string, MilestoneStep>(milestoneSteps(loaded.config).map((step) => [step.id, step]));
  // The plan's limit is checked here too (the UI's "Přidat stupeň" is not the gate): Free 2 steps, Pro 6.
  const parsed = readMilestonesForm(form, { columns, stored, plan });
  if (parsed.errors.length > 0) return { ok: false, reason: "invalid", errors: parsed.errors };
  return saveConfigSection(ctx, {
    ...readSaveOptions(form),
    path: "modules.rewards",
    pick: ladderPart,
    apply: (config) => withMilestones({ ...config, modules: { ...config.modules, rewards: { ...config.modules.rewards, countOtherDiscounts: parsed.countOther } } }, parsed.steps),
  });
}

// --- Přehled ----------------------------------------------------------------------------------------------

/** The Přehled card for this plan, in the shop currency (the page read it; else the first market's). */
export async function loadRewardsOverview(
  ctx: ShopCtx,
  loaded: { config: WonDiscountsConfig },
  opts: { shopCurrency?: string | null },
): Promise<RewardsOverviewView> {
  const plan = await ctxPlan(ctx);
  const currency = opts.shopCurrency || loaded.config.markets.find((m) => m.enabled)?.currency || "";
  const view = rewardsOverviewOf(loaded.config, plan, currency);
  // P4: each threshold's gift by name (its first choice; the card says how many more there are to choose from).
  const gifts = gateConfigForPlan(loaded.config, plan).config.modules.rewards.gifts;
  const firstChoices = gifts.map((g) => g.choices[0] ?? null);
  const ids = firstChoices.filter((id): id is string => !!id);
  if (ids.length === 0) return view;
  const labels = await resourceLabels(ctx, ids);
  return { ...view, giftNames: firstChoices.map((id) => (id ? (labels[id]?.title ?? null) : null)) };
}

/** The Přehled card: the steps of the ladder the PLAN runs, in the shop currency (§17c). */
export function rewardsOverviewOf(config: WonDiscountsConfig, plan: "free" | "pro", currency: string): RewardsOverviewView {
  const gated = gateConfigForPlan(config, plan).config;
  const rewards = gated.modules.rewards;
  const discountRules = gated.modules.codes.rules.filter((rule) => rule.enabled && isMilestoneRule(rule));
  // N2: a step without an amount in the currency of an enabled market is not offered there — the tile has to say so.
  const currencies = enabledCurrencies(config.markets, currency);
  const missing = {
    shipping: rewards.freeShipping ? currenciesWithoutAmount([rewards.freeShipping.threshold], currencies) : [],
    gifts: rewards.gifts.map((g) => currenciesWithoutAmount([g.threshold], currencies)),
    // A discount step needs the cart value and — a fixed amount — the discount itself in the market's currency.
    discounts: discountRules.map((rule) => currenciesWithoutAmount([rule.minimum?.subtotal ?? {}, ...(rule.value.kind === "fixed" ? [rule.value.amount] : [])], currencies)),
  };
  const discounts = discountRules.map((rule) => ({
    amount: rule.minimum?.subtotal?.[currency] ?? null,
    ...(rule.value.kind === "percentage" ? { percent: rule.value.percent } : rule.value.kind === "fixed" ? { off: rule.value.amount[currency] ?? null } : {}),
  }));
  return {
    shipping: rewards.freeShipping?.threshold[currency] ?? null,
    gifts: rewards.gifts.map((g) => g.threshold[currency] ?? null),
    currency,
    ...(discounts.length > 0 ? { discounts } : {}),
    ...(missing.shipping.length > 0 || missing.gifts.some((g) => g.length > 0) || missing.discounts.some((d) => d.length > 0) ? { missing } : {}),
  };
}
