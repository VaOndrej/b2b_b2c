// Odměny za košík, the server side of the admin module (MVP 4; contracts R1–R7).
//   loadRewardsScreen(ctx)   the page (RewardsScreenData): the stored rewards with
//                            Shopify names of the gift variants (never an id on
//                            screen), the gate sentences for this plan (BILL-1),
//                            the market currencies, the app embed (the cart panel
//                            needs it) and the cart block deep link;
//   rewardsAction(ctx, form) `intent=save`: the form parsed HERE (SEC-1) against
//                            the stored markets, kept tiers taken from the stored
//                            config by id (§14a), saved like every admin change
//                            (saveConfigSection: lock, F12 on modules.rewards,
//                            unreadable guard, saveAndSync);
//   rewardsOverviewOf(...)   the Přehled card: what the PLAN runs (§17c).

import type { GiftTier, WonDiscountsConfig } from "@won/core/discounts/config";
import { explainGate, gateConfigForPlan, type ProCapability } from "@won/core/discounts/plan-gate";

import { cartBlockAddUrl } from "../../components/model/embed";
import { currencyCodes, currencyViews } from "../../components/model/markets";
import { giftTierView, readRewardsForm, REWARDS_FIELD, REWARDS_INTENT } from "../../components/model/rewards";
import type { FormDataLike } from "../../components/model/rule-form";
import type { GateNoteView, RewardsOverviewView, RewardsScreenData, UiResult } from "../../components/model/types";
import { loadConfig } from "../config.server";
import { loadAdminSignals } from "../ui-actions.server";
import { graphqlOf, type ShopCtx } from "./context.server";
import { readSaveOptions, saveConfigSection } from "./settings.server";
import { ctxPlan } from "./sync-status.server";
import { readMarketNames, readShopContext } from "./themes.server";

const REWARD_CAPABILITIES: readonly ProCapability[] = ["gift_ladder", "gift_choices"];

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
): Pick<RewardsScreenData, "shipping" | "gifts" | "countOther" | "gateNotes"> {
  const rewards = stored.modules.rewards;
  return {
    shipping: rewards.freeShipping ? { ...rewards.freeShipping.threshold } : null,
    gifts: rewards.gifts.map((g) => giftTierView(g, opts.titles)),
    countOther: rewards.countOtherDiscounts,
    gateNotes: gateNotesOf(stored, opts.plan, opts.locale),
  };
}

export async function loadRewardsScreen(ctx: ShopCtx, opts: { scopes: string; fresh?: boolean }): Promise<RewardsScreenData> {
  const graphql = graphqlOf(ctx);
  const loaded = await loadConfig(ctx.db, ctx.shop);
  const stored = loaded.config;
  const [plan, shopContext, marketNames, titles, signals] = await Promise.all([
    ctxPlan(ctx),
    readShopContext(graphql),
    readMarketNames(graphql, ctx.shop, opts.scopes),
    giftTitles(ctx, giftIds(stored)),
    loadAdminSignals({ shop: ctx.shop, scopes: opts.scopes, apiKey: ctx.apiKey, graphql, fresh: opts.fresh }),
  ]);
  return {
    plan,
    configVersion: loaded.version ?? null,
    currencies: currencyViews(stored.markets, { shopCurrency: shopContext.currencyCode, marketNames }),
    ...rewardsScreenFacts(stored, { plan, locale: ctx.locale, titles }),
    embed: signals.embed,
    cartBlockAddUrl: cartBlockAddUrl(ctx.shop, ctx.apiKey),
  };
}

/** Stored amounts in currencies whose market is off: kept (§14a). */
function keptAmounts(amounts: Readonly<Record<string, number>> | undefined, enabled: readonly string[]): Record<string, number> {
  return Object.fromEntries(Object.entries(amounts ?? {}).filter(([code]) => !enabled.includes(code)));
}

/** The Odměny action: `intent=save`, parsed on the server (SEC-1), saved through saveConfigSection. */
export async function rewardsAction(ctx: ShopCtx, form: FormDataLike): Promise<UiResult> {
  if (form.get(REWARDS_FIELD.intent) !== REWARDS_INTENT.save) return { ok: false, reason: "bad_request" };
  const [loaded, shopContext] = await Promise.all([loadConfig(ctx.db, ctx.shop), readShopContext(graphqlOf(ctx))]);
  const stored = loaded.config.modules.rewards;
  const enabled = currencyCodes(currencyViews(loaded.config.markets, { shopCurrency: shopContext.currencyCode }));
  const byId = new Map<string, GiftTier>(stored.gifts.map((g) => [g.id, g]));
  const parsed = readRewardsForm(form, {
    currencies: enabled,
    kept: {
      shipping: keptAmounts(stored.freeShipping?.threshold, enabled),
      tiers: new Map(stored.gifts.map((g) => [g.id, keptAmounts(g.threshold, enabled)])),
    },
    keep: (id) => byId.get(id),
  });
  if (parsed.errors.length > 0) return { ok: false, reason: "invalid", errors: parsed.errors };
  return saveConfigSection(ctx, {
    ...readSaveOptions(form),
    path: "modules.rewards",
    pick: (config) => config.modules.rewards,
    apply: (config) => ({ ...config, modules: { ...config.modules, rewards: parsed.rewards } }),
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
  return rewardsOverviewOf(loaded.config, plan, currency);
}

/** The Přehled card: free shipping and the gift thresholds the PLAN runs, in the shop currency (§17c). */
export function rewardsOverviewOf(config: WonDiscountsConfig, plan: "free" | "pro", currency: string): RewardsOverviewView {
  const rewards = gateConfigForPlan(config, plan).config.modules.rewards;
  return {
    shipping: rewards.freeShipping?.threshold[currency] ?? null,
    gifts: rewards.gifts.map((g) => g.threshold[currency] ?? null),
    currency,
  };
}
