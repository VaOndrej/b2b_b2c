// Ochrana marže, the server side of the admin module (MVP 2; spec §3 bod 7,
// §4.5, A2). Task 4's routes call exactly these:
//   loadMarginScreen(ctx)             the module page (MarginScreenData);
//   readMarginForm(form)              the form, validated on the server (SEC-1);
//   saveMarginSettings(ctx, s, opts)  the admin save path (settings.server.ts
//                                     saveConfigSection: config lock → `busy`,
//                                     F12 version token → `base_changed`,
//                                     unreadable guard, saveAndSync) and then
//                                     the cost mirror: switched on → a full
//                                     pass in the background (`syncing.costs`),
//                                     switched off → its metafields cleared;
//   refreshCostsAction(ctx)           "Obnovit nákupní ceny": a full pass from
//                                     the start (never twice at once);
//   ruleMarginImpact(ctx, ruleId)     the editor's note ("Na N variantách se
//                                     sleva sníží…"; Free: no number);
// and loadMarginOverview for Přehled (AdminSignals.margin, ui-actions).
// The shop config is written at once when protection is switched on: until
// the mirror has written a variant's cost, that variant counts as "no cost"
// (the percent ceiling) — stricter than no protection, NOT necessarily
// stricter than its cost floor (audit P2-1: the margin screen and the Přehled
// card say so until the first pass has finished).
// Impact (Přehled zásahů, Pro only — BILL-1: a Free shop gets null, never the
// data) is computed IN THE BACKGROUND (margin-impact.server.ts) from the gated
// config, the mirror (VariantCost) and the product refs the sync wrote
// (ProductTargetIndex.value) with the core marginImpact — not from orders
// (that needs read_orders; MVP 7). Loaders only read the stored result.

import { CONFIG_LIMITS, type MarginModule } from "@won/core/discounts/config";
import { explainGate, gateConfigForPlan } from "@won/core/discounts/plan-gate";

import type { MessageKey } from "../../i18n";
import { COLLECTION_GID } from "../../components/model/ids";
import type { FormDataLike } from "../../components/model/rule-form";
import type {
  FieldError,
  MarginCollectionView,
  MarginOverviewView,
  MarginRuleImpactView,
  MarginScreenData,
  MarginSettingsView,
  UiResult,
} from "../../components/model/types";
import { loadConfig, type LoadedConfig } from "../config.server";
import { costJobKind, ensureCostsFresh, startCostJob, type CostLaneDeps } from "../sync/cost-lane.server";
import { saveConfigSection } from "./settings.server";
import type { ShopCtx } from "./context.server";
import { ensureCostReconcileJob } from "../jobs/cost-reconcile.server";
import { costCoverage, costMirrorView, offlineClient } from "./costs.server";
import { marginTooLargeOf } from "../sync/margin-fold";
import { impactConfigOf, impactView, readMarginImpact } from "./margin-impact.server";

export { clearMarginImpactCache, marginCatalogueReads, marginImpactIdle } from "./margin-impact.server";
export { marginTooLargeOf as marginTooLarge } from "../sync/margin-fold";
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
 * Titles are not trusted from the form ("" stands in; the page reads them).
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
    collections.push({ collectionId: id, title: "", minMarginPercent: cMin, maxDiscountPercent: cMax });
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
      title: titles.get(o.collectionId) ?? "", // never a GID: the screen says "Kolekce bez názvu"
      minMarginPercent: o.minMarginPercent ?? null,
      maxDiscountPercent: o.maxDiscountPercent ?? null,
    })),
  };
}

/** The cost lane with the request's Admin API client (background jobs outlive the request, like the product lane). */
function laneDeps(ctx: ShopCtx): CostLaneDeps {
  return { client: ctx.client, db: ctx.db, plan: () => ctxPlan(ctx), now: ctx.now, logger: ctx.logger };
}

// --- Save ------------------------------------------------------------------------------------------

/**
 * Save the margin settings through the admin's one save path
 * (settings.server.ts saveConfigSection: the config lock → `busy`, the F12
 * version token → `base_changed` only when ANOTHER writer changed the margin
 * settings meanwhile — a change elsewhere is applied on top —, the unreadable
 * guard, saveAndSync) and start what the cost mirror needs. `configVersion` =
 * the token the page loaded (MarginScreenData.configVersion).
 */
export async function saveMarginSettings(
  ctx: ShopCtx,
  settings: MarginSettingsView,
  opts: { configVersion: string | null; replaceUnreadable?: boolean },
): Promise<UiResult> {
  return saveConfigSection(ctx, {
    ...opts,
    path: "modules.margin",
    pick: (config) => config.modules.margin,
    apply: (config) => ({ ...config, modules: { ...config.modules, margin: toModule(settings) } }),
    after: async ({ before, config, result }) => {
      const wasEnabled = !before.unreadable && before.config.modules.margin.enabled === true;
      const enabled = config.modules.margin.enabled === true;
      let costs = false;
      if (enabled && !wasEnabled) {
        // Switched on: every variant's cost from the start. Until it is written, checkout applies the percent
        // ceiling to a variant — stricter than no protection, not necessarily than its cost floor (the admin says so).
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
    },
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

/** The currency the margin screen and the Přehled card both count in: the one the caller read, else the shop's. */
async function marginCurrency(ctx: ShopCtx, known?: string | null): Promise<string> {
  return known && /^[A-Z]{3}$/.test(known) ? known : shopCurrencyOf(ctx);
}

/**
 * The module page. Loading it also starts what the mirror needs (a due full
 * pass, a clear after switching off — in the background, never twice) and
 * makes sure the daily reconcile runs in this process. The impact (Pro) is
 * READ from what the background computed (margin-impact.server.ts: never the
 * whole catalogue in this request), narrowed to `focusRuleId` here (`?rule=`).
 */
export async function loadMarginScreen(ctx: ShopCtx, opts: { focusRuleId?: string | null } = {}): Promise<MarginScreenData> {
  ensureCostReconcileJob(ctx.db, { clientFor: offlineClient });
  const loaded = await loadConfig(ctx.db, ctx.shop);
  const [margin, shopCurrency, timezone] = await Promise.all([gatedMargin(ctx, loaded), marginCurrency(ctx), shopTimezoneOf(ctx)]);
  const { stored, plan, gate, gated, enabled, syncable } = margin;
  const titles = await collectionTitles(ctx, stored.config.modules.margin.perCollection.map((o) => o.collectionId));
  if (syncable) await ensureCostsFresh(ctx.shop, laneDeps(ctx), enabled).catch(() => undefined);
  const [mirror, coverage, tooLarge] = await Promise.all([
    costMirrorView({ db: ctx.db, shop: ctx.shop, now: ctx.now }, { enabled, timezone }),
    costCoverage(ctx.db, ctx.shop, shopCurrency || null),
    plan === "pro" && enabled ? marginTooLargeOf(ctx.db, ctx.shop) : Promise.resolve([]),
  ]);
  const gateNotes = explainGate(
    gate.stripped.filter((s) => s.capability === "margin_per_collection"),
    ctx.locale,
  ).map((e) => ({ text: e.text, ...(e.ruleId !== undefined ? { ruleId: e.ruleId } : {}) }));
  // The impact is what checkout runs: a collection too large to read is folded into the whole store's values (P1-1);
  // the same config the background computes for (impactConfigOf), whether protection is on or off.
  const running = await impactConfigOf(ctx.db, ctx.shop, gated);
  const impact =
    plan === "pro" && shopCurrency
      ? impactView(await readMarginImpact({ db: ctx.db, shop: ctx.shop, config: running, currency: shopCurrency }), running, opts.focusRuleId)
      : null;
  return {
    plan,
    shopCurrency,
    configVersion: loaded.version ?? null,
    settings: toSettings(stored.config.modules.margin, titles),
    mirror,
    coverage,
    impact,
    gateNotes,
    tooLarge,
  };
}

/**
 * The rule editor's margin note: protection lowers this (saved) rule on some
 * variants — null while protection is off, or where it lowers nothing. READ
 * from the background result (never the whole catalogue per editor load);
 * `computing` while no result exists yet, `updating` while a newer one runs.
 * Pro gets the count (variants, the same number Přehled zásahů gives the
 * rule); Free gets NO number — "přehled zásahů" is Pro (rozhodnuti.md), the
 * note only says protection lowers the rule somewhere, with the Pro preview.
 */
export async function ruleMarginImpact(ctx: ShopCtx, ruleId: string): Promise<MarginRuleImpactView | null> {
  const { gated, enabled, plan } = await gatedMargin(ctx);
  if (!enabled) return null;
  const currency = await marginCurrency(ctx);
  if (!currency) return null;
  const read = await readMarginImpact({ db: ctx.db, shop: ctx.shop, config: await impactConfigOf(ctx.db, ctx.shop, gated), currency });
  if (!read.impact) return { state: "computing" };
  const rule = read.impact.rules.find((r) => r.ruleId === ruleId);
  if (!rule || rule.variants === 0) return null;
  const state = read.status === "ready" ? "ready" : "updating";
  return plan === "pro" ? { state, discountClass: rule.discountClass, variants: rule.variants } : { state, discountClass: rule.discountClass };
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
  const { gated, enabled, syncable, plan } = await gatedMargin(ctx, loaded);
  if (opts.trigger && syncable) await ensureCostsFresh(ctx.shop, laneDeps(ctx), enabled).catch(() => undefined);
  const [mirror, coverage, tooLarge] = await Promise.all([
    costMirrorView({ db: ctx.db, shop: ctx.shop, now: ctx.now }, { enabled, timezone: opts.timezone }),
    enabled ? marginCurrency(ctx, opts.shopCurrency).then((currency) => costCoverage(ctx.db, ctx.shop, currency || null)) : Promise.resolve(null),
    enabled && plan === "pro" ? marginTooLargeOf(ctx.db, ctx.shop) : Promise.resolve([]),
  ]);
  const margin = gated.modules.margin;
  return {
    enabled,
    minMarginPercent: margin.global.minMarginPercent ?? null,
    maxDiscountPercent: margin.global.maxDiscountPercent,
    productsWithoutCost: coverage ? coverage.productsWithoutCost : null,
    mirror,
    ...(tooLarge.length > 0 ? { tooLarge } : {}),
  };
}
