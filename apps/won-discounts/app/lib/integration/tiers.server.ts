// Množstevní slevy, the server side of the admin module (MVP 3; spec §3 bod 3,
// contracts K1/K2/K5/K9). The routes call exactly these:
//   loadTiersScreen(ctx)      the module page (TiersScreenData): the sets as
//                             stored (Shopify titles for their products and
//                             collections — never an id on screen), what the
//                             plan does not run (core explainGate, BILL-1), the
//                             facts behind the honest sentences (margin on,
//                             product rules that compete, A1), the table on the
//                             product page and the storefront config's state
//                             (themes.server.ts), and the preview (theme tokens,
//                             the saved look, a real product);
//   tiersAction(ctx, form)    `intent=save`: the form parsed HERE (SEC-1, the
//                             same parser the screen's live draft uses), saved
//                             like every admin change (settings.server.ts
//                             saveConfigSection: lock, F12 on the tiers only,
//                             unreadable guard, saveAndSync);
//   loadTiersOverview(ctx)    the Přehled card: what the PLAN runs (§17c).
// Nothing a Free shop may not run is dropped from the STORED config (§14a): the
// Pro sets travel back as hidden fields and stay; the sync gates them (K1: on
// Free a scoped set is inert, its products never fall into the global set).

import type { DiscountRule, TierSet, WonDiscountsConfig } from "@won/core/discounts/config";
import { explainGate, gateConfigForPlan, type ProCapability } from "@won/core/discounts/plan-gate";

import { presetOf } from "../../components/model/appearance";
import { currencyCodes, currencyViews } from "../../components/model/markets";
import type { FormDataLike } from "../../components/model/rule-form";
import { readTiersForm, tierSetToConfig, tierSetView, TIERS_FIELD, TIERS_INTENT } from "../../components/model/tiers";
import type { GateNoteView, TierSetView, TiersOverviewView, TiersScreenData, UiResult } from "../../components/model/types";
import { loadConfig, type LoadedConfig } from "../config.server";
import { tierProductCounts } from "../sync/storefront";
import { graphqlOf, type ShopCtx } from "./context.server";
import { readSaveOptions, saveConfigSection, type SaveOptions } from "./settings.server";
import { ctxPlan, loadSyncView } from "./sync-status.server";
import { readMarketNames, readPreviewProduct, readShopContext, readStorefrontSync, readThemeLook } from "./themes.server";

/** The Pro capabilities of this module (plan-gate.ts): their gate sentences go on this page. */
const TIER_CAPABILITIES: readonly ProCapability[] = ["tier_set_scope", "tier_sets_extra", "tier_count_across_cart"];

// --- Titles -------------------------------------------------------------------------------------------------

/** Validated against Admin 2026-04 (Shopify dev MCP); nodes(ids) of ≤ 100 products / collections. */
export const TIER_TITLES_DOCUMENT = `#graphql
query WonTiersTitles($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on Product {
      id
      title
    }
    ... on Collection {
      id
      title
    }
  }
}`;

/** Product / collection titles by id (unknown ones are left out: the screen says "bez názvu"). */
async function tierTitles(ctx: ShopCtx, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    try {
      const result = await ctx.client.graphql<{ nodes?: ({ id?: string; title?: string } | null)[] }>(TIER_TITLES_DOCUMENT, { ids: unique.slice(i, i + 100) });
      for (const node of result.data?.nodes ?? []) if (node?.id && node.title) out.set(node.id, node.title);
    } catch (error) {
      if (error instanceof Response) throw error;
    }
  }
  return out;
}

function scopeIds(sets: readonly TierSet[]): string[] {
  return sets.flatMap((s) => (s.scope === "global" ? [] : [...(s.scope.productIds ?? []), ...(s.scope.collectionIds ?? [])]));
}

/** The global set first (the one the screen edits on top), the rest in config order. */
function screenOrder<T extends { scope: unknown }>(sets: readonly T[], isGlobal: (s: T) => boolean): T[] {
  const first = sets.find(isGlobal);
  return first ? [first, ...sets.filter((s) => s !== first)] : [...sets];
}

// --- Facts -----------------------------------------------------------------------------------------------------

/** A rule that gives a discount on products (A1: it competes with a tier on the same line; the better one wins). */
export function isProductRule(rule: Pick<DiscountRule, "enabled" | "value" | "target">): boolean {
  return rule.enabled && rule.value.kind !== "freeShipping" && (rule.target.kind === "products" || rule.target.kind === "collections");
}

/** Active product rules of the config the plan runs. */
export function competingProductRules(gated: WonDiscountsConfig): number {
  return gated.modules.codes.rules.filter(isProductRule).length;
}

/** Currencies of the stored tier amounts whose market is not enabled: kept as hidden fields and read back (§14a). */
function keptCurrencies(config: WonDiscountsConfig, enabled: readonly string[]): string[] {
  const out = new Set<string>();
  for (const set of config.modules.tiers.sets) {
    for (const b of set.breaks) for (const code of Object.keys(b.amountOff ?? {})) if (!enabled.includes(code)) out.add(code);
  }
  return [...out];
}

function gateNotesOf(config: WonDiscountsConfig, plan: "free" | "pro", locale: ShopCtx["locale"]): GateNoteView[] {
  const { stripped } = gateConfigForPlan(config, plan);
  return explainGate(
    stripped.filter((s) => TIER_CAPABILITIES.includes(s.capability)),
    locale,
  ).map((e) => ({ text: e.text }));
}

// --- The page -----------------------------------------------------------------------------------------------------

/**
 * What the page says about the stored config on this plan (pure; the dev
 * harness renders the screen from the same function): the sets as the screen
 * edits them (the global one first, Shopify titles), the gate sentences, and
 * the facts behind the honest sentences — from the config the PLAN runs.
 */
export function tiersScreenFacts(
  stored: WonDiscountsConfig,
  opts: { plan: "free" | "pro"; locale: ShopCtx["locale"]; titles: ReadonlyMap<string, string>; syncable: boolean },
): Pick<TiersScreenData, "sets" | "gateNotes" | "marginOn" | "competingRules"> {
  const gated = gateConfigForPlan(stored, opts.plan).config;
  return {
    sets: screenOrder(stored.modules.tiers.sets, (s) => s.scope === "global").map((s) => tierSetView(s, opts.titles)),
    gateNotes: gateNotesOf(stored, opts.plan, opts.locale),
    marginOn: opts.syncable && gated.modules.margin.enabled === true,
    competingRules: competingProductRules(gated),
  };
}

export async function loadTiersScreen(ctx: ShopCtx, opts: { scopes: string; fresh?: boolean }): Promise<TiersScreenData> {
  const graphql = graphqlOf(ctx);
  const loaded = await loadConfig(ctx.db, ctx.shop);
  const stored = loaded.config;
  const [plan, shopContext, marketNames, look, titles] = await Promise.all([
    ctxPlan(ctx),
    readShopContext(graphql),
    readMarketNames(graphql, ctx.shop, opts.scopes),
    readThemeLook(ctx, { scopes: opts.scopes, fresh: opts.fresh }),
    tierTitles(ctx, scopeIds(stored.modules.tiers.sets)),
  ]);
  const timezone = shopContext.timezone;
  const sync = await loadSyncView(ctx, loaded, timezone);
  const [storefront, product, counts] = await Promise.all([
    readStorefrontSync(ctx, { configVersion: loaded.version, sync, timezone }),
    // A product the whole-store set applies to (no Pro tierRef), never one that gets another set (review fix 2).
    readPreviewProduct(ctx, null),
    // Pro only (BILL-1): how many products each Pro set reaches, from the index the sync wrote.
    plan === "pro" ? tierProductCounts(ctx.db, ctx.shop).then((c) => c.bySet, () => null) : Promise.resolve(null),
  ]);
  const syncable = loaded.exists && !loaded.unreadable && !loaded.readOnly;
  return {
    plan,
    shopCurrency: shopContext.currencyCode ?? "",
    configVersion: loaded.version ?? null,
    currencies: currencyViews(stored.markets, { shopCurrency: shopContext.currencyCode, marketNames }),
    ...tiersScreenFacts(stored, { plan, locale: ctx.locale, titles, syncable }),
    block: look.block,
    storefront,
    preview: { tokens: look.tokens, preset: presetOf(stored.storefront.appearancePreset), product },
    productsWithSets: counts,
    outletWithAnything: stored.engine.combination.outletWithAnything === true,
  };
}

/**
 * Save the page's sets (config order; the global set without tiers is not
 * stored — it would only shadow nothing). F12 compares the tiers module only.
 */
export function saveTiers(ctx: ShopCtx, sets: readonly TierSetView[], opts: SaveOptions): Promise<UiResult> {
  const next = sets.filter((s) => !(s.scope.kind === "global" && s.breaks.length === 0)).map(tierSetToConfig);
  return saveConfigSection(ctx, {
    ...opts,
    path: "modules.tiers",
    pick: (config) => config.modules.tiers,
    apply: (config) => ({ ...config, modules: { ...config.modules, tiers: { ...config.modules.tiers, sets: next } } }),
  });
}

/** The Množstevní slevy action: `intent=save`, the form parsed on the server (SEC-1) against the stored markets. */
export async function tiersAction(ctx: ShopCtx, form: FormDataLike): Promise<UiResult> {
  if (form.get(TIERS_FIELD.intent) !== TIERS_INTENT.save) return { ok: false, reason: "bad_request" };
  const [loaded, shopContext] = await Promise.all([loadConfig(ctx.db, ctx.shop), readShopContext(graphqlOf(ctx))]);
  const currencies = currencyCodes(currencyViews(loaded.config.markets, { shopCurrency: shopContext.currencyCode }));
  const parsed = readTiersForm(form, { currencies, keptCurrencies: keptCurrencies(loaded.config, currencies) });
  if (parsed.errors.length > 0) return { ok: false, reason: "invalid", errors: parsed.errors };
  return saveTiers(ctx, parsed.sets, readSaveOptions(form));
}

// --- Přehled --------------------------------------------------------------------------------------------------------

/** The Přehled card: the whole-store set and how many Pro sets the PLAN runs (§17c), and the table's state. */
export async function loadTiersOverview(
  ctx: ShopCtx,
  loaded: Pick<LoadedConfig, "config">,
  opts: { scopes: string },
): Promise<TiersOverviewView> {
  const [plan, look] = await Promise.all([ctxPlan(ctx), readThemeLook(ctx, { scopes: opts.scopes })]);
  return tiersOverviewOf(loaded.config, plan, look.block);
}

/** The Přehled card from the stored config on this plan (pure; the harness uses it too). */
export function tiersOverviewOf(config: WonDiscountsConfig, plan: "free" | "pro", block: TiersOverviewView["block"]): TiersOverviewView {
  const gated = gateConfigForPlan(config, plan).config;
  const withTiers = gated.modules.tiers.sets.filter((s) => s.breaks.length > 0);
  const global = withTiers.find((s) => s.scope === "global") ?? null;
  return {
    sets: withTiers.filter((s) => s.scope !== "global").length,
    global: global ? tierSetView(global, new Map()) : null,
    block,
  };
}
