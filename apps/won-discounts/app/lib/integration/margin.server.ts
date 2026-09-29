// Ochrana marže, the server side of the admin module (MVP 2; spec §3 bod 7,
// §4.5, A2). Task 4's routes call exactly these:
//   loadMarginScreen(ctx)             the module page (MarginScreenData);
//   readMarginForm(form)              the form, validated on the server (SEC-1);
//   saveMarginSettings(ctx, s, opts)  the rule-save path (config lock → `busy`,
//                                     F12 version token → `base_changed`,
//                                     unreadable guard, saveAndSync) and then
//                                     the cost mirror: switched on → a full
//                                     pass in the background (`syncing.costs`),
//                                     switched off → its metafields cleared;
//   refreshCostsAction(ctx)           "Obnovit nákupní ceny": a full pass from
//                                     the start (never twice at once);
//   ruleMarginImpact(ctx, ruleId)     the editor's "Na N produktech se sleva
//                                     sníží na hranici marže";
// and loadMarginOverview for Přehled (AdminSignals.margin, ui-actions).
// The shop config is written at once when protection is switched on: until
// the mirror has written a variant's cost, that variant counts as "no cost"
// (the percent ceiling) — stricter than no protection, never a stale cost.
// Impact (Přehled zásahů, Pro only — BILL-1: a Free shop gets null, never the
// data) is computed from the gated config, the mirror (VariantCost) and the
// product refs the sync wrote (ProductTargetIndex.value) with the core
// marginImpact — not from orders (that needs read_orders; MVP 7).

import { createDefaultConfig, CONFIG_LIMITS, type MarginModule, type WonDiscountsConfig } from "@won/core/discounts/config";
import { buildMarginPayload, marginImpact, resolveMargin, type MarginVariant } from "@won/core/discounts/margin";
import { currencyExponent, toMinorUnits } from "@won/core/discounts/money";
import { explainGate, gateConfigForPlan } from "@won/core/discounts/plan-gate";
import { variantKey } from "@won/core/discounts/targeting";

import type { MessageKey } from "../../i18n";
import { COLLECTION_GID } from "../../components/model/ids";
import type { FormDataLike } from "../../components/model/rule-form";
import type {
  FieldError,
  MarginCollectionView,
  MarginImpactView,
  MarginOverviewView,
  MarginScreenData,
  MarginSettingsView,
  UiResult,
} from "../../components/model/types";
import { configVersionToken, loadConfig, type LoadedConfig } from "../config.server";
import { costJobKind, ensureCostsFresh, startCostJob, type CostLaneDeps } from "../sync/cost-lane.server";
import { canonicalJson, hashText } from "../sync/util";
import { lockedWrite, SAVE_ATTEMPTS, savedResult, writeAndSync } from "./config-write.server";
import type { ShopCtx } from "./context.server";
import { ensureCostReconcileJob } from "../jobs/cost-reconcile.server";
import { parseCostValue } from "../sync/costs";
import { runtimeKey } from "../sync/runs";
import { costCoverage, costMirrorView, offlineClient } from "./costs.server";
import { uiFailureFromSave } from "./results";
import { ctxPlan } from "./sync-status.server";

/**
 * Form error keys (app/i18n, cs + en):
 *   margin.error.percent             "Zadej 0 až {max} %." (params.max: 95 or 100)
 *   margin.error.collection          the collection id is not a Shopify collection
 *   margin.error.tooManyCollections  more than {max} collections
 */
export const MARGIN_FORM_ERRORS = {
  percent: "margin.error.percent",
  collection: "margin.error.collection",
  tooManyCollections: "margin.error.tooManyCollections",
} as const satisfies Record<string, MessageKey>;

const errorKey = (key: MessageKey): MessageKey => key;

/** Rows of the impact overview (the core keeps the top 50 per rule). */
export const MARGIN_IMPACT_ROWS = 50;

// --- The form -------------------------------------------------------------------------------------

const PERCENT_RE = /^\d{1,3}(?:[.,]\d{1,2})?$/;

/** "" → null; a number within 0–max (a comma decimal too) → it; anything else → undefined (invalid). */
function percentField(raw: FormDataEntryValue | null | undefined, max: number): number | null | undefined {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return null;
  if (!PERCENT_RE.test(text)) return undefined;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= max ? value : undefined;
}

/**
 * The margin form (SEC-1): `enabled` ("on" | absent), `minMarginPercent`
 * (empty = not set), `maxDiscountPercent` (required), and the collections as
 * repeated `collectionId[]`, `collectionMin[]`, `collectionMax[]` in the same
 * order (empty = the global value; a row with both empty is dropped, a
 * repeated collection keeps its first row). Error fields: the input's name,
 * collections as `collectionId[i]` / `collectionMin[i]` / `collectionMax[i]`.
 * Titles are not trusted from the form (the id stands in; the page reads them).
 */
export function readMarginForm(form: FormDataLike): { ok: true; settings: MarginSettingsView } | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];
  const enabledRaw = form.get("enabled");
  const enabled = typeof enabledRaw === "string" && ["on", "true", "1"].includes(enabledRaw.trim().toLowerCase());
  const min = percentField(form.get("minMarginPercent"), CONFIG_LIMITS.minMarginPercent);
  if (min === undefined) errors.push({ field: "minMarginPercent", key: errorKey(MARGIN_FORM_ERRORS.percent), params: { max: CONFIG_LIMITS.minMarginPercent } });
  const max = percentField(form.get("maxDiscountPercent"), 100);
  if (max === undefined || max === null) errors.push({ field: "maxDiscountPercent", key: errorKey(MARGIN_FORM_ERRORS.percent), params: { max: 100 } });

  const ids = form.getAll("collectionId[]");
  const mins = form.getAll("collectionMin[]");
  const maxes = form.getAll("collectionMax[]");
  const collections: MarginCollectionView[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += 1) {
    const raw = ids[i];
    const id = typeof raw === "string" ? raw.trim() : "";
    const cMin = percentField(mins[i], CONFIG_LIMITS.minMarginPercent);
    const cMax = percentField(maxes[i], 100);
    if (!COLLECTION_GID.test(id)) errors.push({ field: `collectionId[${i}]`, key: errorKey(MARGIN_FORM_ERRORS.collection) });
    if (cMin === undefined) errors.push({ field: `collectionMin[${i}]`, key: errorKey(MARGIN_FORM_ERRORS.percent), params: { max: CONFIG_LIMITS.minMarginPercent } });
    if (cMax === undefined) errors.push({ field: `collectionMax[${i}]`, key: errorKey(MARGIN_FORM_ERRORS.percent), params: { max: 100 } });
    if (!COLLECTION_GID.test(id) || cMin === undefined || cMax === undefined) continue;
    if ((cMin === null && cMax === null) || seen.has(id)) continue;
    seen.add(id);
    collections.push({ collectionId: id, title: id, minMarginPercent: cMin, maxDiscountPercent: cMax });
  }
  if (collections.length > CONFIG_LIMITS.marginOverrides) {
    errors.push({ field: "collectionId[]", key: errorKey(MARGIN_FORM_ERRORS.tooManyCollections), params: { max: CONFIG_LIMITS.marginOverrides } });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, settings: { enabled, minMarginPercent: min ?? null, maxDiscountPercent: max as number, collections } };
}

/** The save's form options: `configVersion` (F12 token; empty = none stored) and `replaceUnreadable` ("1"). */
export function readMarginSaveOptions(form: FormDataLike): { configVersion: string | null; replaceUnreadable: boolean } {
  const version = form.get("configVersion");
  return {
    configVersion: typeof version === "string" && version.trim() ? version.trim() : null,
    replaceUnreadable: form.get("replaceUnreadable") === "1",
  };
}

// --- Settings ↔ module -------------------------------------------------------------------------------

function toModule(settings: MarginSettingsView): MarginModule {
  return {
    enabled: settings.enabled,
    global: {
      maxDiscountPercent: settings.maxDiscountPercent,
      ...(settings.minMarginPercent !== null ? { minMarginPercent: settings.minMarginPercent } : {}),
    },
    perCollection: settings.collections.map((c) => ({
      collectionId: c.collectionId,
      ...(c.minMarginPercent !== null ? { minMarginPercent: c.minMarginPercent } : {}),
      ...(c.maxDiscountPercent !== null ? { maxDiscountPercent: c.maxDiscountPercent } : {}),
    })),
  };
}

function toSettings(margin: MarginModule, titles: ReadonlyMap<string, string>): MarginSettingsView {
  return {
    enabled: margin.enabled === true,
    minMarginPercent: margin.global.minMarginPercent ?? null,
    maxDiscountPercent: margin.global.maxDiscountPercent,
    collections: margin.perCollection.map((o) => ({
      collectionId: o.collectionId,
      title: titles.get(o.collectionId) ?? o.collectionId,
      minMarginPercent: o.minMarginPercent ?? null,
      maxDiscountPercent: o.maxDiscountPercent ?? null,
    })),
  };
}

const marginKey = (margin: MarginModule | undefined) => canonicalJson(margin ?? createDefaultConfig().modules.margin);

/**
 * The margin settings of the config version the form was loaded from (F12
 * token = the hash of the stored row; ConfigVersion keeps every saved row).
 * null token = no config was stored; undefined = the version is unknown.
 */
async function marginAtVersion(ctx: Pick<ShopCtx, "db" | "shop">, token: string | null): Promise<MarginModule | undefined> {
  if (token === null) return createDefaultConfig().modules.margin;
  const versions = await ctx.db.configVersion.findMany({
    where: { shop: ctx.shop },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: { data: true },
  });
  for (const version of versions) {
    if (configVersionToken(version.data) !== token) continue;
    try {
      const parsed = JSON.parse(version.data) as { modules?: { margin?: MarginModule } };
      return parsed.modules?.margin ?? createDefaultConfig().modules.margin;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The cost lane with the request's Admin API client (background jobs outlive the request, like the product lane). */
function laneDeps(ctx: ShopCtx): CostLaneDeps {
  return { client: ctx.client, db: ctx.db, plan: () => ctxPlan(ctx), now: ctx.now, logger: ctx.logger };
}

// --- Save ------------------------------------------------------------------------------------------

/**
 * Save the margin settings the same way a rule is saved (see the header) and
 * start what the cost mirror needs. `configVersion` = the token the page
 * loaded (MarginScreenData.configVersion): another writer's save in between is
 * applied on top only when it left the margin settings as the page saw them.
 */
export async function saveMarginSettings(
  ctx: ShopCtx,
  settings: MarginSettingsView,
  opts: { configVersion: string | null; replaceUnreadable?: boolean },
): Promise<UiResult> {
  return lockedWrite<UiResult>(ctx, { ok: false, reason: "busy" }, async () => {
    const replaceUnreadable = opts.replaceUnreadable === true;
    for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt += 1) {
      const loaded = await loadConfig(ctx.db, ctx.shop);
      if (loaded.readOnly) return { ok: false, reason: "newer_schema" };
      if (loaded.unreadable && !replaceUnreadable) return { ok: false, reason: "unreadable_config" };
      if (!loaded.unreadable && loaded.version !== opts.configVersion) {
        // F12: saved meanwhile — fine only when the margin settings are still the ones the page showed.
        const base = await marginAtVersion(ctx, opts.configVersion);
        if (base === undefined || marginKey(base) !== marginKey(loaded.config.modules.margin)) return { ok: false, reason: "base_changed" };
      }
      const wasEnabled = !loaded.unreadable && loaded.config.modules.margin.enabled === true;
      const next: WonDiscountsConfig = { ...loaded.config, modules: { ...loaded.config.modules, margin: toModule(settings) } };
      const res = await writeAndSync(ctx, next, { replaceUnreadable, expectedVersion: loaded.version });
      if (!res.save.ok && res.save.reason === "base_changed") continue;
      if (!res.save.ok) return uiFailureFromSave(res.save);
      const result = savedResult({ ...res, save: res.save }, "saved", "modules.margin", ctx.locale);
      const enabled = res.save.config.modules.margin.enabled === true;
      let costs = false;
      if (enabled && !wasEnabled) {
        // Switched on: every variant's cost from the start (the config already treats unknown costs strictly).
        void startCostJob(ctx.shop, laneDeps(ctx), { kind: "full", restart: true });
        costs = true;
      } else if (enabled) {
        const started = await ensureCostsFresh(ctx.shop, laneDeps(ctx), true);
        costs = started === "started_full" || costJobKind(ctx.shop) === "full";
      } else if (wasEnabled) {
        void startCostJob(ctx.shop, laneDeps(ctx), { kind: "clear" });
      }
      if (costs && result.ok) return { ...result, syncing: { ...(result.syncing ?? {}), costs: true } };
      return result;
    }
    return { ok: false, reason: "base_changed" };
  });
}

/** "Obnovit nákupní ceny": a full pass from the start while protection is on (a running one is left to finish). */
export async function refreshCostsAction(ctx: ShopCtx): Promise<UiResult> {
  const { enabled } = await gatedMargin(ctx);
  if (!enabled) return { ok: true, message: "synced" };
  if (costJobKind(ctx.shop) !== "full") void startCostJob(ctx.shop, laneDeps(ctx), { kind: "full", restart: true });
  return { ok: true, message: "synced", syncing: { costs: true } };
}

// --- Loads ---------------------------------------------------------------------------------------

async function gatedMargin(ctx: ShopCtx, loaded?: Pick<LoadedConfig, "config" | "exists" | "unreadable" | "readOnly">) {
  const [stored, plan] = await Promise.all([loaded ? Promise.resolve(loaded) : loadConfig(ctx.db, ctx.shop), ctxPlan(ctx)]);
  const gate = gateConfigForPlan(stored.config, plan);
  const syncable = stored.exists && !stored.unreadable && !stored.readOnly;
  return { stored, plan, gate, gated: gate.config, enabled: syncable && gate.config.modules.margin.enabled === true, syncable };
}

/** The shop currency (Shopify), else the currency of the mirror's costs (always the shop currency), else "". */
async function shopCurrencyOf(ctx: ShopCtx): Promise<string> {
  try {
    const result = await ctx.client.graphql<{ shop?: { currencyCode?: string } }>(`#graphql
      query WonDiscountsShopContext { shop { currencyCode ianaTimezone } }`);
    const code = result.data?.shop?.currencyCode;
    if (typeof code === "string" && /^[A-Z]{3}$/.test(code)) return code;
  } catch (error) {
    if (error instanceof Response) throw error;
  }
  const row = await ctx.db.variantCost.findFirst({ where: { shop: ctx.shop, currency: { not: null } }, select: { currency: true } });
  return row?.currency ?? "";
}

async function shopTimezoneOf(ctx: ShopCtx): Promise<string | null> {
  const row = await ctx.db.shopSyncState.findUnique({ where: { shop: ctx.shop }, select: { timezone: true } });
  return row?.timezone ?? null;
}

/** Validated against Admin 2026-04 (Shopify dev MCP); nodes(ids) of ≤ 100 collections. */
export const COLLECTION_TITLES_DOCUMENT = `query WonMarginCollectionTitles($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on Collection {
      id
      title
    }
  }
}`;

async function collectionTitles(ctx: ShopCtx, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  try {
    const result = await ctx.client.graphql<{ nodes: ({ __typename?: string; id?: string; title?: string } | null)[] }>(COLLECTION_TITLES_DOCUMENT, {
      ids: [...new Set(ids)].slice(0, 100),
    });
    for (const node of result.data?.nodes ?? []) {
      if (node?.__typename === "Collection" && node.id && node.title) out.set(node.id, node.title);
    }
  } catch (error) {
    if (error instanceof Response) throw error;
  }
  return out;
}

/** Minor units of a decimal amount (costs may carry more decimals than prices: rounded). */
function minorOf(amount: string | null, currency: string): number | null {
  if (amount === null) return null;
  const exact = toMinorUnits(amount, currency);
  if (exact !== null) return exact;
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 10 ** currencyExponent(currency)) : null;
}

interface ProductRefs {
  ruleIds: string[];
  variantRuleIds: Record<string, string[]>;
  marginRefs: string[];
}

function parseRefs(value: string | null): ProductRefs {
  const empty = { ruleIds: [], variantRuleIds: {}, marginRefs: [] };
  if (!value) return empty;
  try {
    const parsed = JSON.parse(value) as { ruleIds?: unknown; variantRuleIds?: unknown; marginRefs?: unknown };
    const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const variantRuleIds: Record<string, string[]> = {};
    if (parsed.variantRuleIds && typeof parsed.variantRuleIds === "object" && !Array.isArray(parsed.variantRuleIds)) {
      for (const [k, v] of Object.entries(parsed.variantRuleIds as Record<string, unknown>)) variantRuleIds[k] = strings(v);
    }
    return { ruleIds: strings(parsed.ruleIds), variantRuleIds, marginRefs: strings(parsed.marginRefs) };
  } catch {
    return empty;
  }
}

/**
 * The mirror + the product refs the sync wrote → the core's variants (shop
 * currency, minor units). The cost is the CONFIRMED metafield value — what
 * checkout reads — never a cost the mirror has not got into Shopify yet.
 * Reads the whole catalogue: only ever called through impactOf (cached).
 */
async function marginVariants(ctx: Pick<ShopCtx, "db" | "shop">, currency: string): Promise<MarginVariant[]> {
  catalogueReads += 1;
  const [rows, index] = await Promise.all([
    ctx.db.variantCost.findMany({
      where: { shop: ctx.shop },
      select: { productId: true, variantId: true, title: true, variantTitle: true, price: true, metafieldValue: true },
      orderBy: { variantId: "asc" },
    }),
    ctx.db.productTargetIndex.findMany({ where: { shop: ctx.shop, value: { not: null } }, select: { productId: true, value: true } }),
  ]);
  const refs = new Map(index.map((row) => [row.productId, parseRefs(row.value)]));
  return rows.map((row) => {
    const r = refs.get(row.productId);
    const title = row.variantTitle ? `${row.title ?? row.productId} (${row.variantTitle})` : (row.title ?? row.productId);
    const confirmed = parseCostValue(row.metafieldValue);
    return {
      productId: row.productId,
      variantId: row.variantId,
      title,
      price: minorOf(row.price, currency) ?? 0,
      cost: confirmed && confirmed.cur === currency ? minorOf(String(confirmed.cost), currency) : null,
      ruleRefs: r ? [...r.ruleIds, ...(r.variantRuleIds[variantKey(row.variantId)] ?? [])] : [],
      marginRefs: r?.marginRefs ?? [],
    };
  });
}

// --- The impact, computed once per (config, mirror) ------------------------------------------------
// Přehled zásahů and the rule editor's count both need marginImpact over the
// whole catalogue. It is computed once per state — the gated config, the shop
// currency and the mirror + product-ref tables as their row count and last
// update say (a pass, a webhook mirror or a product sync changes them) — and
// kept in memory per shop; every other load reads the cached result.

interface ImpactEntry {
  key: string;
  view: MarginImpactView;
  /** Rule id → variants where protection lowers it (product and order rules). */
  counts: Map<string, number>;
}

const impactCache = new Map<string, ImpactEntry>();
let catalogueReads = 0;

/** Test hook: how many times the whole catalogue was read for the impact (process-wide). */
export function marginCatalogueReads(): number {
  return catalogueReads;
}

/** Test hook. */
export function clearMarginImpactCache(): void {
  impactCache.clear();
}

async function impactKey(ctx: Pick<ShopCtx, "db" | "shop">, config: WonDiscountsConfig, currency: string): Promise<string> {
  const [costs, index] = await Promise.all([
    ctx.db.variantCost.aggregate({ where: { shop: ctx.shop }, _count: { _all: true }, _max: { updatedAt: true } }),
    ctx.db.productTargetIndex.aggregate({ where: { shop: ctx.shop }, _count: { _all: true }, _max: { updatedAt: true } }),
  ]);
  return hashText(
    canonicalJson({
      config: runtimeKey(config),
      currency,
      costs: [costs._count._all, costs._max.updatedAt?.toISOString() ?? null],
      index: [index._count._all, index._max.updatedAt?.toISOString() ?? null],
    }),
  );
}

function impactViewOf(config: WonDiscountsConfig, variants: readonly MarginVariant[], currency: string): ImpactEntry["view"] & { counts: Map<string, number> } {
  const impact = marginImpact(config, variants, currency);
  const names = new Map(config.modules.codes.rules.map((rule) => [rule.id, rule.name || rule.id]));
  const payload = buildMarginPayload({ ...config.modules.margin, enabled: true }, currency);
  const marginRefsOf = new Map(variants.map((v) => [v.variantId, v.marginRefs]));
  const sourceOf = (variantId: string) => resolveMargin(payload, marginRefsOf.get(variantId) ?? [])?.source ?? "global";
  const rows = impact.rules
    .filter((rule) => rule.discountClass === "product")
    .flatMap((rule) =>
      rule.capped.map((c) => ({
        ruleId: rule.ruleId,
        ruleName: names.get(rule.ruleId) ?? rule.ruleId,
        productId: c.productId,
        variantId: c.variantId,
        title: c.title,
        wanted: c.wanted,
        allowed: c.allowed,
        basis: c.basis,
        source: sourceOf(c.variantId),
      })),
    )
    .sort((a, b) => b.wanted - b.allowed - (a.wanted - a.allowed) || (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0))
    .slice(0, MARGIN_IMPACT_ROWS);
  const orderRules = impact.rules
    .filter((rule) => rule.discountClass === "order" && rule.variants > 0)
    .map((rule) => ({ ruleId: rule.ruleId, ruleName: names.get(rule.ruleId) ?? rule.ruleId, variantsBelow: rule.variants }));
  return { rows, orderRules, withoutCost: impact.withoutCost, counts: new Map(impact.rules.map((rule) => [rule.ruleId, rule.variants])) };
}

/** The impact for the gated config: from the cache when the state is unchanged, else computed once and cached. */
async function impactOf(ctx: Pick<ShopCtx, "db" | "shop">, config: WonDiscountsConfig, currency: string): Promise<ImpactEntry> {
  const key = await impactKey(ctx, config, currency);
  const hit = impactCache.get(ctx.shop);
  if (hit && hit.key === key) return hit;
  const { counts, ...view } = impactViewOf(config, await marginVariants(ctx, currency), currency);
  const entry: ImpactEntry = { key, view, counts };
  impactCache.delete(ctx.shop);
  impactCache.set(ctx.shop, entry);
  if (impactCache.size > 1_000) impactCache.delete(impactCache.keys().next().value as string);
  return entry;
}

/** Přehled zásahů (Pro): where protection lowers the active discounts (config + mirror; cached per state). */
export async function marginImpactView(ctx: Pick<ShopCtx, "db" | "shop">, config: WonDiscountsConfig, currency: string): Promise<MarginImpactView> {
  return (await impactOf(ctx, config, currency)).view;
}

/** The currency the margin screen and the Přehled card both count in: the one the caller read, else the shop's. */
async function marginCurrency(ctx: ShopCtx, known?: string | null): Promise<string> {
  return known && /^[A-Z]{3}$/.test(known) ? known : shopCurrencyOf(ctx);
}

/**
 * The module page. Loading it also starts what the mirror needs (a due full
 * pass, a clear after switching off — in the background, never twice) and
 * makes sure the daily reconcile runs in this process.
 */
export async function loadMarginScreen(ctx: ShopCtx): Promise<MarginScreenData> {
  ensureCostReconcileJob(ctx.db, { clientFor: offlineClient });
  const loaded = await loadConfig(ctx.db, ctx.shop);
  const [margin, shopCurrency, timezone] = await Promise.all([gatedMargin(ctx, loaded), marginCurrency(ctx), shopTimezoneOf(ctx)]);
  const { stored, plan, gate, gated, enabled, syncable } = margin;
  const titles = await collectionTitles(ctx, stored.config.modules.margin.perCollection.map((o) => o.collectionId));
  if (syncable) await ensureCostsFresh(ctx.shop, laneDeps(ctx), enabled).catch(() => undefined);
  const [mirror, coverage] = await Promise.all([
    costMirrorView({ db: ctx.db, shop: ctx.shop, now: ctx.now }, { enabled, timezone }),
    costCoverage(ctx.db, ctx.shop, shopCurrency || null),
  ]);
  const gateNotes = explainGate(
    gate.stripped.filter((s) => s.capability === "margin_per_collection"),
    ctx.locale,
  ).map((e) => ({ text: e.text, ...(e.ruleId !== undefined ? { ruleId: e.ruleId } : {}) }));
  return {
    plan,
    shopCurrency,
    configVersion: loaded.version ?? null,
    settings: toSettings(stored.config.modules.margin, titles),
    mirror,
    coverage,
    impact: plan === "pro" && shopCurrency ? await marginImpactView(ctx, gated, shopCurrency) : null,
    gateNotes,
  };
}

/**
 * On how many variants protection lowers this rule (the editor's note), or
 * null while protection is off. 0 for a rule it never lowers (or an unknown id).
 * Read from the cached impact (never the whole catalogue per editor load when
 * nothing changed).
 * Ruling (MVP 2 review): the count is given on Free too — it is safety
 * information about the merchant's own rule, not the Pro overview; the
 * overview itself (rows, which variants and why) stays Pro (BILL-1).
 */
export async function ruleMarginImpact(ctx: ShopCtx, ruleId: string): Promise<number | null> {
  const { gated, enabled } = await gatedMargin(ctx);
  if (!enabled) return null;
  const currency = await marginCurrency(ctx);
  if (!currency) return 0;
  return (await impactOf(ctx, gated, currency)).counts.get(ruleId) ?? 0;
}

/**
 * Přehled card (AdminSignals.margin): the settings in force (gated), products
 * without a cost (the same currency and query as the margin screen), the
 * mirror. `trigger` (Přehled) starts what the mirror needs and makes sure the
 * daily reconcile runs in this process. `shopCurrency` = what the page read.
 */
export async function loadMarginOverview(
  ctx: ShopCtx,
  loaded: Pick<LoadedConfig, "config" | "exists" | "unreadable" | "readOnly">,
  opts: { timezone: string | null; trigger: boolean; shopCurrency?: string | null },
): Promise<MarginOverviewView> {
  ensureCostReconcileJob(ctx.db, { clientFor: offlineClient });
  const { gated, enabled, syncable } = await gatedMargin(ctx, loaded);
  if (opts.trigger && syncable) await ensureCostsFresh(ctx.shop, laneDeps(ctx), enabled).catch(() => undefined);
  const [mirror, coverage] = await Promise.all([
    costMirrorView({ db: ctx.db, shop: ctx.shop, now: ctx.now }, { enabled, timezone: opts.timezone }),
    enabled ? marginCurrency(ctx, opts.shopCurrency).then((currency) => costCoverage(ctx.db, ctx.shop, currency || null)) : Promise.resolve(null),
  ]);
  const margin = gated.modules.margin;
  return {
    enabled,
    minMarginPercent: margin.global.minMarginPercent ?? null,
    maxDiscountPercent: margin.global.maxDiscountPercent,
    productsWithoutCost: coverage ? coverage.productsWithoutCost : null,
    mirror,
  };
}
