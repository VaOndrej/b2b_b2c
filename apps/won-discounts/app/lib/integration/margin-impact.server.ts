// Přehled zásahů and the rule editor's margin note (MVP 2): where margin
// protection lowers the active discounts — core marginImpact over the whole
// catalogue (the cost mirror VariantCost + the refs the sync wrote,
// ProductTargetIndex.value), per rule: how many variants it lowers the rule
// on, and its top rows.
//
// Computed in the BACKGROUND, never inside a request (audit P3-5): reading the
// catalogue and planning every rule over every variant takes seconds on a
// large shop. A result is stored per shop with the state it was computed for
// — the gated config's runtime key, the currency, and the row count + last
// update of both tables (a pass, a webhook mirror or a product sync changes
// them). Who computes:
//   - after a cost job (a full pass, a webhook batch: cost-lane.server.ts
//     onCostJobSettled) and after a config save (config-write.server.ts), for
//     PRO shops only, per shop, coalesced — one computation at a time, the
//     latest request runs once after it, and two computations of a shop start
//     at least MARGIN_IMPACT_MIN_INTERVAL_MS (30 s) apart;
//   - a loader that finds the stored result out of date (a product sync, a
//     restart, a Free shop's editor note) schedules it the same way.
// Both sides compute for the same config (impactConfigOf: gated, too-large
// collections folded), so a loader's key never flip-flops.
// Loaders (the margin screen, the editor) only READ: two bounded aggregates
// for the state key, then the stored result — "ready", or "updating" (a
// recompute runs, the previous numbers are shown with "počítá se"), or
// "computing" (nothing computed yet). BILL-1: the rows reach only Pro
// (margin.server.ts); Free's editor note gets no number.
// Memory only, per process — the single-instance assumption of the whole sync
// (MVP 7 note): a restart recomputes on the first load or cost job.

import type { WonDiscountsConfig } from "@won/core/discounts/config";
import type { MarginVariant } from "@won/core/discounts/margin";
import { currencyExponent, toMinorUnits } from "@won/core/discounts/money";
import { gateConfigForPlan, type ShopPlan } from "@won/core/discounts/plan-gate";
import { variantKey } from "@won/core/discounts/targeting";

import type { PrismaClient } from "../../generated/prisma/client";
import type { AdminClient } from "../admin-client.server";
import { loadConfig } from "../config.server";
import { planOf } from "../plan.server";
import { onCostJobSettled } from "../sync/cost-lane.server";
import { parseCostValue } from "../sync/costs";
import { foldedForCheckout } from "../sync/margin-fold";
import { runtimeKey } from "../sync/runs";
import { canonicalJson, hashText } from "../sync/util";
import { impactRulesOf, type ImpactRead, type StoredImpactRules } from "./margin-impact-view";

export { impactView, MARGIN_IMPACT_ROWS_MAX, MARGIN_IMPACT_ROWS_PER_RULE } from "./margin-impact-view";

interface StoredImpact extends StoredImpactRules {
  key: string;
}

interface ImpactArgs {
  db: PrismaClient;
  shop: string;
  /** The config as the shop's plan runs it (gated). */
  config: WonDiscountsConfig;
  currency: string;
}

const stored = new Map<string, StoredImpact>();
const jobs = new Map<string, { done: Promise<void>; next: ImpactArgs | null }>();
let catalogueReads = 0;

/** Test hook: how many times the whole catalogue was read for the impact (process-wide). */
export function marginCatalogueReads(): number {
  return catalogueReads;
}

/** Test hook. */
export function clearMarginImpactCache(): void {
  stored.clear();
}

/** Refreshes of a shop still resolving what to compute (config, plan, currency) before they schedule. */
const refreshing = new Map<string, Set<Promise<void>>>();

/** Resolves when no impact computation of `shop` is running, queued or being prepared here (tests). */
export async function marginImpactIdle(shop: string): Promise<void> {
  for (;;) {
    const job = jobs.get(shop);
    const pending = [...(refreshing.get(shop) ?? [])];
    if (!job && pending.length === 0) return;
    await Promise.all([job?.done, ...pending]);
  }
}

// --- The state key (bounded queries) ------------------------------------------------------------------

async function impactKey(db: PrismaClient, shop: string, config: WonDiscountsConfig, currency: string): Promise<string> {
  const [costs, index] = await Promise.all([
    db.variantCost.aggregate({ where: { shop }, _count: { _all: true }, _max: { updatedAt: true } }),
    db.productTargetIndex.aggregate({ where: { shop }, _count: { _all: true }, _max: { updatedAt: true } }),
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

// --- The computation (the whole catalogue: background only) ----------------------------------------

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
 */
async function marginVariants(db: PrismaClient, shop: string, currency: string): Promise<MarginVariant[]> {
  catalogueReads += 1;
  const [rows, index] = await Promise.all([
    db.variantCost.findMany({
      where: { shop },
      select: { productId: true, variantId: true, title: true, variantTitle: true, price: true, metafieldValue: true },
      orderBy: { variantId: "asc" },
    }),
    db.productTargetIndex.findMany({ where: { shop, value: { not: null } }, select: { productId: true, value: true } }),
  ]);
  const refs = new Map(index.map((row) => [row.productId, parseRefs(row.value)]));
  return rows.map((row) => {
    const r = refs.get(row.productId);
    const title = row.variantTitle ? `${row.title ?? ""} (${row.variantTitle})`.trim() : (row.title ?? "");
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

/** Computes (true) unless the stored result is already this state's. */
async function computeOnce(args: ImpactArgs): Promise<boolean> {
  const key = await impactKey(args.db, args.shop, args.config, args.currency);
  if (stored.get(args.shop)?.key === key) return false;
  const { rules, withoutCost } = impactRulesOf(args.config, await marginVariants(args.db, args.shop, args.currency), args.currency);
  stored.delete(args.shop);
  stored.set(args.shop, { key, rules, withoutCost });
  if (stored.size > 1_000) stored.delete(stored.keys().next().value as string);
  return true;
}

/** Computations of one shop start at least this far apart (a burst of webhook batches → one recompute; audit fix round 2). */
export const MARGIN_IMPACT_MIN_INTERVAL_MS = 30_000;
let minIntervalMs = MARGIN_IMPACT_MIN_INTERVAL_MS;
const lastComputedAt = new Map<string, number>();

/** Test hook: the minimum interval between two computations of a shop (default MARGIN_IMPACT_MIN_INTERVAL_MS). */
export function setMarginImpactMinInterval(ms: number): void {
  minIntervalMs = ms;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    (timer as { unref?: () => void }).unref?.();
  });

/**
 * Compute the shop's impact in the background (never awaited by a request).
 * Coalesced per shop: while one runs or waits, the latest request replaces
 * the queued one and runs once after it; two computations of a shop start at
 * least `minIntervalMs` apart; a state already computed is skipped.
 */
export function scheduleMarginImpact(args: ImpactArgs): Promise<void> {
  const running = jobs.get(args.shop);
  if (running) {
    running.next = args;
    return running.done;
  }
  const job: { done: Promise<void>; next: ImpactArgs | null } = { done: Promise.resolve(), next: null };
  job.done = (async () => {
    let current: ImpactArgs | null = args;
    try {
      while (current) {
        const delay = (lastComputedAt.get(args.shop) ?? Number.NEGATIVE_INFINITY) + minIntervalMs - Date.now();
        if (delay > 0) await wait(delay);
        if (job.next) {
          current = job.next; // the newest request that came in while waiting
          job.next = null;
        }
        try {
          if (await computeOnce(current)) {
            lastComputedAt.set(args.shop, Date.now());
            if (lastComputedAt.size > 1_000) lastComputedAt.delete(lastComputedAt.keys().next().value as string);
          }
        } catch (error) {
          console.error(`[won-margin] impact of ${args.shop}: ${error instanceof Error ? error.message : String(error)}`);
        }
        current = job.next;
        job.next = null;
      }
    } finally {
      jobs.delete(args.shop);
    }
  })();
  jobs.set(args.shop, job);
  return job.done;
}

/**
 * What a loader shows (bounded: the state key's two aggregates): the stored
 * result when it is the current state's; otherwise a background recompute is
 * scheduled and the previous result (if any) is returned as "updating".
 */
export async function readMarginImpact(args: ImpactArgs): Promise<ImpactRead> {
  const key = await impactKey(args.db, args.shop, args.config, args.currency);
  const hit = stored.get(args.shop) ?? null;
  if (hit && hit.key === key) return { impact: hit, status: "ready" };
  void scheduleMarginImpact(args);
  return { impact: hit, status: hit ? "updating" : "computing" };
}

// --- Triggers from outside a request -----------------------------------------------------------------

/** The currency the impact counts in outside a request: the mirror's (Shopify keeps unit costs in the shop currency), else Shopify's. */
async function backgroundCurrency(db: PrismaClient, shop: string, client: AdminClient | null): Promise<string> {
  const row = await db.variantCost.findFirst({ where: { shop, currency: { not: null } }, select: { currency: true } });
  if (row?.currency) return row.currency;
  if (!client) return "";
  try {
    const result = await client.graphql<{ shop?: { currencyCode?: string } }>(`#graphql
      query WonDiscountsShopContext { shop { currencyCode ianaTimezone } }`);
    const code = result.data?.shop?.currencyCode;
    return typeof code === "string" && /^[A-Z]{3}$/.test(code) ? code : "";
  } catch {
    return "";
  }
}

/**
 * The config the impact is computed for, on BOTH sides (a loader's state key
 * and the background computation — audit fix round 2: never a key that
 * flip-flops between "ready" and "updating"): the gated config as checkout
 * runs it, collections too large to read folded in (sync/margin-fold.ts).
 */
export function impactConfigOf(db: PrismaClient, shop: string, gated: WonDiscountsConfig): Promise<WonDiscountsConfig> {
  return foldedForCheckout(db, shop, gated);
}

/**
 * Recompute a shop's impact in the background after something changed (a
 * cost job, a config save) — only for a PRO shop (the overview and the
 * editor's count are Pro; Free's editor note, without a number, computes on
 * demand when the editor is opened), on or off (Pro's preview). Never throws.
 */
export function refreshMarginImpact(shop: string, deps: { db: PrismaClient; client?: AdminClient | null; plan?: (shop: string) => Promise<ShopPlan> }): Promise<void> {
  const run = prepareAndSchedule(shop, deps);
  const set = refreshing.get(shop) ?? new Set<Promise<void>>();
  set.add(run);
  refreshing.set(shop, set);
  void run.finally(() => {
    set.delete(run);
    if (set.size === 0 && refreshing.get(shop) === set) refreshing.delete(shop);
  });
  return run;
}

async function prepareAndSchedule(shop: string, deps: { db: PrismaClient; client?: AdminClient | null; plan?: (shop: string) => Promise<ShopPlan> }): Promise<void> {
  try {
    const loaded = await loadConfig(deps.db, shop);
    if (!loaded.exists || loaded.unreadable || loaded.readOnly) return;
    const plan = await (deps.plan ?? planOf)(shop);
    if (plan !== "pro") return;
    const config = await impactConfigOf(deps.db, shop, gateConfigForPlan(loaded.config, plan).config);
    const currency = await backgroundCurrency(deps.db, shop, deps.client ?? null);
    if (!currency) return;
    await scheduleMarginImpact({ db: deps.db, shop, config, currency });
  } catch (error) {
    console.error(`[won-margin] impact refresh of ${shop}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// A finished cost job (a full pass, a webhook batch, a retry) changed the mirror: recompute in the background.
onCostJobSettled((shop, deps) => {
  void refreshMarginImpact(shop, { db: deps.db, client: deps.client, plan: deps.plan });
});
