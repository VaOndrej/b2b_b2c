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

import { presetOf, readAppearanceForm } from "../../components/model/appearance";
import { currenciesWithoutAmount, currencyCodes, currencyViews, enabledCurrencies } from "../../components/model/markets";
import type { FormDataLike } from "../../components/model/rule-form";
import { readTiersForm, tierPayloadUse, tierSetToConfig, tierSetView, TIERS_FIELD, TIERS_INTENT } from "../../components/model/tiers";
import { tiersGlobalStatus, tiersSetsStatus } from "../../components/model/module-status";
import type { AppearancePresetView, FieldError, GateNoteView, SyncView, TierSetView, TiersOverviewView, TiersScreenData, UiResult } from "../../components/model/types";
import { previewLookOf, withAppearancePreset } from "./appearance.server";
import { loadConfig, type LoadedConfig } from "../config.server";
import { MAX_COLLECTION_PRODUCTS } from "../sync/products";
import { tierProductCounts } from "../sync/storefront";
import { graphqlOf, type ShopCtx } from "./context.server";
import { readSaveOptions, saveConfigSection, type SaveOptions } from "./settings.server";
import { ctxPlan, loadSyncView } from "./sync-status.server";
import { readAmountSuggest, readMarketNames, readPreviewProduct, readShopContext, readStorefrontSync, readThemeLook } from "./themes.server";

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
    suggest: await readAmountSuggest(graphql, ctx.shop, opts.scopes, shopContext.currencyCode),
    ...tiersScreenFacts(stored, { plan, locale: ctx.locale, titles, syncable }),
    block: look.block,
    status: tiersSectionStatus(stored, plan, look.block, sync),
    storefront,
    preview: { tokens: look.tokens, preset: presetOf(stored.storefront.appearancePreset), product, look: previewLookOf(stored, plan) },
    productsWithSets: counts,
    outletWithAnything: stored.engine.combination.outletWithAnything === true,
  };
}

/** The state of the page's two sections: the same functions, on the same view, as the home tile (model/module-status.ts). */
export function tiersSectionStatus(config: WonDiscountsConfig, plan: "free" | "pro", block: TiersOverviewView["block"], sync: SyncView): NonNullable<TiersScreenData["status"]> {
  const overview = tiersOverviewOf(config, plan, block);
  return { global: tiersGlobalStatus(overview, sync), sets: tiersSetsStatus(overview, sync, plan) };
}

/**
 * The sets to store from the page's (config order). `keep` = sets the page did not edit
 * (TIERS_FIELD.kept), saved as STORED, never round-tripped through the form
 * (§14a, audit P3-4). The first whole-store set without tiers is dropped only
 * when it is the only one: with a dormant second whole-store set after it, it
 * stays as a set WITHOUT tiers — otherwise that set would silently become the
 * whole store's (K1, audit P3-2).
 */
export function nextTierSets(sets: readonly TierSetView[], keep?: ReadonlyMap<string, TierSet>): TierSet[] {
  const globals = sets.filter((s) => s.scope.kind === "global");
  return sets
    .filter((s) => !(s === globals[0] && globals.length === 1 && s.breaks.length === 0 && !keep?.has(s.id)))
    .map((s) => keep?.get(s.id) ?? tierSetToConfig(s));
}

/**
 * Save the page's sets (nextTierSets) like every admin change (saveConfigSection: lock, F12, saveAndSync).
 * `preset` = the look picked in the page's preview (already validated): written to
 * config.storefront.appearancePreset, the one field Vzhled writes too — then F12 covers the look as well (a look
 * changed in another tab meanwhile → base_changed). Without it the look is not touched and F12 is on the tiers only.
 */
export function saveTiers(
  ctx: ShopCtx,
  sets: readonly TierSetView[],
  opts: SaveOptions & { keep?: ReadonlyMap<string, TierSet>; preset?: AppearancePresetView },
): Promise<UiResult> {
  const next = nextTierSets(sets, opts.keep);
  const preset = opts.preset;
  return saveConfigSection(ctx, {
    configVersion: opts.configVersion,
    ...(opts.replaceUnreadable !== undefined ? { replaceUnreadable: opts.replaceUnreadable } : {}),
    path: "modules.tiers",
    pick: (config) => (preset === undefined ? config.modules.tiers : { tiers: config.modules.tiers, preset: presetOf(config.storefront.appearancePreset) }),
    apply: (config) => {
      const withTiers = { ...config, modules: { ...config.modules, tiers: { ...config.modules.tiers, sets: next } } };
      return preset === undefined ? withTiers : withAppearancePreset(withTiers, preset);
    },
  });
}

/** Validated against Admin 2026-04 (Shopify dev MCP): the size of collections a Pro set picks (the sync reads at most 10 000). */
export const COLLECTION_SIZES_DOCUMENT = `#graphql
query WonTiersCollectionSizes($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on Collection {
      id
      title
      productsCount {
        count
        precision
      }
    }
  }
}`;

/**
 * Audit P2-3 (SEC-3: a dangerous state is unsavable): a Pro set may not pick a
 * collection the sync cannot read — more than MAX_COLLECTION_PRODUCTS products
 * (or a count Shopify only gives as "at least"), or collections that together
 * exceed it — its products would silently get the whole-store set. Checked for
 * the collections a set ADDS against the stored config (an unrelated save is
 * never blocked by a collection that grew since; the sync keeps such a set's
 * products where they were). A size Shopify does not give → refused too (fail
 * closed: the merchant tries again).
 */
async function collectionSizeErrors(ctx: ShopCtx, sets: readonly TierSetView[], stored: readonly TierSet[]): Promise<FieldError[]> {
  const before = new Map(stored.map((s) => [s.id, new Set(s.scope === "global" ? [] : (s.scope.collectionIds ?? []))]));
  const added = sets
    .filter((s): s is TierSetView & { scope: Extract<TierSetView["scope"], { kind: "selection" }> } => s.scope.kind === "selection")
    .map((s) => ({ set: s, ids: s.scope.collections.map((c) => c.id).filter((id) => !before.get(s.id)?.has(id)) }))
    .filter((x) => x.ids.length > 0);
  if (added.length === 0) return [];
  const sizes = new Map<string, { count: number; exact: boolean; title: string }>();
  const ids = [...new Set(added.flatMap((x) => x.set.scope.collections.map((c) => c.id)))];
  try {
    for (let i = 0; i < ids.length; i += 100) {
      const result = await ctx.client.graphql<{ nodes?: ({ id?: string; title?: string | null; productsCount?: { count: number; precision: string } | null } | null)[] }>(
        COLLECTION_SIZES_DOCUMENT,
        { ids: ids.slice(i, i + 100) },
      );
      for (const node of result.data?.nodes ?? []) {
        if (node?.id && node.productsCount) {
          sizes.set(node.id, { count: node.productsCount.count, exact: node.productsCount.precision === "EXACT", title: node.title ?? "" });
        }
      }
    }
  } catch (error) {
    if (error instanceof Response) throw error;
    return added.map((x) => ({ field: TIERS_FIELD.collection(x.set.id), key: "tiers.error.collectionSizeUnknown" }));
  }
  const errors: FieldError[] = [];
  for (const { set, ids: newIds } of added) {
    const field = TIERS_FIELD.collection(set.id);
    const limit = MAX_COLLECTION_PRODUCTS;
    const big = newIds.map((id) => ({ id, size: sizes.get(id) })).find(({ size }) => size && (!size.exact || size.count > limit));
    if (big?.size) {
      errors.push(
        big.size.title.trim()
          ? { field, key: "tiers.error.collectionTooLarge", params: { collection: big.size.title, limit } }
          : { field, key: "tiers.error.collectionTooLargeUntitled", params: { limit } },
      );
      continue;
    }
    // A collection deleted meanwhile has no size: the sync reports it; nothing to measure here.
    const total = set.scope.collections.reduce((sum, c) => sum + (sizes.get(c.id)?.count ?? 0), 0);
    if (total > limit) errors.push({ field, key: "tiers.error.collectionsTooLarge", params: { limit } });
  }
  return errors;
}

/**
 * The Množstevní slevy action: `intent=save`, the form parsed on the server
 * (SEC-1) against the stored markets; kept sets taken from the stored config by
 * id (audit P3-4); a new Pro collection the sync could not read refused (P2-3);
 * tiers over the checkout's room for them refused (the 550 B cap, audit).
 */
export async function tiersAction(ctx: ShopCtx, form: FormDataLike): Promise<UiResult> {
  if (form.get(TIERS_FIELD.intent) !== TIERS_INTENT.save) return { ok: false, reason: "bad_request" };
  const [loaded, shopContext] = await Promise.all([loadConfig(ctx.db, ctx.shop), readShopContext(graphqlOf(ctx))]);
  const stored = loaded.config.modules.tiers.sets;
  const storedById = new Map(stored.map((s) => [s.id, s]));
  const currencies = currencyCodes(currencyViews(loaded.config.markets, { shopCurrency: shopContext.currencyCode }));
  const parsed = readTiersForm(form, {
    currencies,
    keptCurrencies: keptCurrencies(loaded.config, currencies),
    keep: (id) => {
      const set = storedById.get(id);
      return set ? tierSetView(set, new Map()) : undefined;
    },
  });
  if (parsed.errors.length > 0) return { ok: false, reason: "invalid", errors: parsed.errors };
  // The look picked in the preview: the same parser as Vzhled (one of the four, SEC-1); a form without the field leaves it.
  let preset: AppearancePresetView | undefined;
  if (form.get(TIERS_FIELD.preset) !== null) {
    const look = readAppearanceForm(form);
    if (!look.ok) return { ok: false, reason: "invalid", errors: look.errors };
    preset = look.preset;
  }
  const sizeErrors = await collectionSizeErrors(
    ctx,
    parsed.sets.filter((s) => !parsed.kept.includes(s.id)),
    stored,
  );
  if (sizeErrors.length > 0) return { ok: false, reason: "invalid", errors: sizeErrors };
  const keep = new Map(parsed.kept.map((id) => [id, storedById.get(id)!]));
  // The checkout's room for tiers (CONFIG_LIMITS.tierPayloadBytes, audit): refused with what to do, never "bytes".
  const use = tierPayloadUse(nextTierSets(parsed.sets, keep));
  if (!use.fits) return { ok: false, reason: "invalid", errors: [{ field: TIERS_FIELD.set, key: "tiers.error.tooLarge", params: { percent: use.percent } }] };
  return saveTiers(ctx, parsed.sets, { ...readSaveOptions(form), keep, ...(preset !== undefined ? { preset } : {}) });
}

// --- Přehled --------------------------------------------------------------------------------------------------------

/** The Přehled card: the whole-store set and how many Pro sets the PLAN runs (§17c), and the table's state. */
export async function loadTiersOverview(
  ctx: ShopCtx,
  loaded: Pick<LoadedConfig, "config">,
  opts: { scopes: string },
): Promise<TiersOverviewView> {
  const [plan, look] = await Promise.all([ctxPlan(ctx), readThemeLook(ctx, { scopes: opts.scopes })]);
  const view = tiersOverviewOf(loaded.config, plan, look.block);
  // P4: what the own sets are for, by name.
  const own = gateConfigForPlan(loaded.config, plan).config.modules.tiers.sets.filter((s) => s.breaks.length > 0 && s.scope !== "global");
  const ids = own.flatMap((s) => (s.scope === "global" ? [] : [...(s.scope.productIds ?? []), ...(s.scope.collectionIds ?? [])]));
  if (ids.length === 0) return view;
  const titles = await tierTitles(ctx, ids);
  const setNames = [...new Set(ids.map((id) => titles.get(id)).filter((title): title is string => !!title))];
  return setNames.length > 0 ? { ...view, setNames } : view;
}

/** The Přehled card from the stored config on this plan (pure; the harness uses it too). */
export function tiersOverviewOf(config: WonDiscountsConfig, plan: "free" | "pro", block: TiersOverviewView["block"]): TiersOverviewView {
  const gated = gateConfigForPlan(config, plan).config;
  const withTiers = gated.modules.tiers.sets.filter((s) => s.breaks.length > 0);
  const global = withTiers.find((s) => s.scope === "global") ?? null;
  // N2: a level with an amount per piece and no amount in the currency of an enabled market is not offered there.
  const currencies = enabledCurrencies(config.markets);
  const missingOf = (set: TierSet) => currenciesWithoutAmount(set.breaks.flatMap((b) => (b.amountOff ? [b.amountOff] : [])), currencies);
  const missing = {
    global: global ? missingOf(global) : [],
    sets: withTiers.filter((s) => s.scope !== "global").map(missingOf).filter((codes) => codes.length > 0),
  };
  return {
    sets: withTiers.filter((s) => s.scope !== "global").length,
    global: global ? tierSetView(global, new Map()) : null,
    block,
    ...(missing.global.length > 0 || missing.sets.length > 0 ? { missing } : {}),
  };
}
