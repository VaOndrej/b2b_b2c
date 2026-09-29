// The cost mirror in the running app (margin protection, MVP 2): webhooks,
// the debounced per-shop mirror, and what the admin shows about it.
//
//   Webhooks (shopify.app.toml, HMAC checked by authenticate.webhook, WBH-1):
//     inventory_items/update → /webhooks/costs (include_fields id, cost,
//         updated_at, admin_graphql_api_id; read_products covers it, changelog
//         2025-03-31): the inventory item is queued;
//     products/create, products/update → /webhooks/targeting (MVP 1 route):
//         the product is queued (its variants' prices, a new variant);
//     products/delete → /webhooks/targeting: the product's rows are dropped.
//   Only while margin protection is on in the stored config (no mirror while
//   off). The handler never calls Shopify: it answers 2xx at once and is
//   idempotent (WBH-2: a repeated delivery queues the same id once; the
//   mirror re-reads the CURRENT state, so a late or out-of-order delivery
//   never writes an old cost).
//   The queue is flushed ONE debounced time per shop (COST_WEBHOOK_DEBOUNCE_MS)
//   as an "items" job of the shop's cost lane (sync/cost-lane.server.ts),
//   with the shop's offline Admin API session. A restart loses what was
//   queued; the daily reconcile (jobs/cost-reconcile.server.ts) and the
//   Přehled's 24 h check catch up.
//   Admin: costMirrorView / costCoverage for the margin screen and Přehled.

import type { PrismaClient } from "../../generated/prisma/client";
import { adminClientFromApp, type AdminClient, type AppAdminGraphql } from "../admin-client.server";
import { loadConfig } from "../config.server";
import { ensureCostReconcileJob } from "../jobs/cost-reconcile.server";
import { costJobKind, costPassProgress, startCostJob, type CostJobOutcome } from "../sync/cost-lane.server";
import { COSTS_MAX_AGE_MS, loadCostState } from "../sync/costs";
import { shopLocalDateTime } from "../sync/sync.server";
import { errorText } from "../sync/transport";
import type { SyncLogger } from "../sync/types";
import type { CostCoverageView, CostMirrorView } from "../../components/model/types";
import { shortDetail } from "./sync-copy";

/** One mirror per shop at most this long after the first relevant webhook. */
export const COST_WEBHOOK_DEBOUNCE_MS = 5_000;
/** Products without a cost shown as a sample on the margin screen. */
export const COVERAGE_SAMPLE = 20;

export type CostTopic = "inventory_items/update" | "products/create" | "products/update" | "products/delete";
const COST_TOPICS: readonly CostTopic[] = ["inventory_items/update", "products/create", "products/update", "products/delete"];

/** "INVENTORY_ITEMS_UPDATE" (authenticate.webhook) or "inventory_items/update" → the topic; else null. */
export function costTopic(topic: string): CostTopic | null {
  const normalized = topic.trim().toLowerCase().replace(/[_/](create|update|delete)$/, "/$1");
  return (COST_TOPICS as readonly string[]).includes(normalized) ? (normalized as CostTopic) : null;
}

/** The resource GID of a delivery (admin_graphql_api_id, else the numeric id). */
function gidOf(kind: "InventoryItem" | "Product", payload: unknown): string | null {
  const p = (payload ?? {}) as { admin_graphql_api_id?: unknown; id?: unknown };
  if (typeof p.admin_graphql_api_id === "string" && p.admin_graphql_api_id.startsWith(`gid://shopify/${kind}/`)) return p.admin_graphql_api_id;
  if ((typeof p.id === "number" && Number.isSafeInteger(p.id) && p.id > 0) || (typeof p.id === "string" && /^\d+$/.test(p.id))) {
    return `gid://shopify/${kind}/${p.id}`;
  }
  return null;
}

/** Margin protection is on in the stored config (the mirror's gate; the job re-checks it gated when it runs). */
export async function storedMarginOn(db: PrismaClient, shop: string): Promise<boolean> {
  const loaded = await loadConfig(db, shop);
  return loaded.exists && !loaded.unreadable && !loaded.readOnly && loaded.config.modules.margin.enabled === true;
}

export interface CostWork {
  inventoryItemIds?: readonly string[];
  productIds?: readonly string[];
}

export interface CostWebhookDeps {
  db: PrismaClient;
  /** Queue work for the shop's debounced mirror. */
  note: (shop: string, work: CostWork) => void;
}

export type CostWebhookOutcome =
  | { handled: "queued"; id: string }
  | { handled: "rows_deleted"; productId: string; count: number }
  | { handled: "ignored"; reason: string };

/** One delivery (see the header). Fast (DB only) and idempotent. */
export async function handleCostWebhook(deps: CostWebhookDeps, delivery: { shop: string; topic: string; payload: unknown }): Promise<CostWebhookOutcome> {
  const topic = costTopic(delivery.topic);
  if (!topic) return { handled: "ignored", reason: `not a cost topic: ${delivery.topic}` };
  const kind = topic === "inventory_items/update" ? "InventoryItem" : "Product";
  const gid = gidOf(kind, delivery.payload);
  if (!gid) return { handled: "ignored", reason: "no resource id in the payload" };
  if (topic === "products/delete") {
    const { count } = await deps.db.variantCost.deleteMany({ where: { shop: delivery.shop, productId: gid } });
    return { handled: "rows_deleted", productId: gid, count };
  }
  if (!(await storedMarginOn(deps.db, delivery.shop))) return { handled: "ignored", reason: "margin protection is off" };
  deps.note(delivery.shop, topic === "inventory_items/update" ? { inventoryItemIds: [gid] } : { productIds: [gid] });
  return { handled: "queued", id: gid };
}

// --- The debounced mirror ---------------------------------------------------------------------------

export interface CostRefresherDeps {
  db: PrismaClient;
  /** The shop's Admin API client (offline session), or null when it has none (uninstalled). */
  clientFor: (shop: string) => Promise<AdminClient | null>;
  delayMs?: number;
  logger?: SyncLogger;
  now?: () => Date;
}

export type CostRefreshOutcome = { done: "nothing" } | { done: "no_session" } | { done: "job"; outcome: CostJobOutcome };

export interface CostRefresher {
  /** Queue work and start the shop's debounce window (later calls fold into it). */
  note(shop: string, work: CostWork): void;
  scheduled(shop: string): boolean;
  /** What is queued for the shop (tests, support). */
  pending(shop: string): { inventoryItemIds: string[]; productIds: string[] };
  /** Flush the shop's queue now. */
  runNow(shop: string): Promise<CostRefreshOutcome>;
  /** Test hook: drop every timer and queue. */
  cancelAll(): void;
}

const quiet: SyncLogger = { info() {}, warn() {}, error() {} };

export function createCostRefresher(deps: CostRefresherDeps): CostRefresher {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const queued = new Map<string, { items: Set<string>; products: Set<string> }>();
  const logger = deps.logger ?? quiet;
  const runNow = async (shop: string): Promise<CostRefreshOutcome> => {
    const timer = timers.get(shop);
    if (timer) clearTimeout(timer);
    timers.delete(shop);
    const work = queued.get(shop);
    queued.delete(shop);
    if (!work || work.items.size + work.products.size === 0) return { done: "nothing" };
    const client = await deps.clientFor(shop);
    if (!client) {
      logger.warn(`costs ${shop}: no Admin API session, the queued mirror was dropped`);
      return { done: "no_session" };
    }
    const outcome = await startCostJob(shop, { client, db: deps.db, now: deps.now, logger }, {
      kind: "items",
      inventoryItemIds: [...work.items],
      productIds: [...work.products],
    });
    return { done: "job", outcome };
  };
  return {
    note(shop, work) {
      const entry = queued.get(shop) ?? { items: new Set<string>(), products: new Set<string>() };
      for (const id of work.inventoryItemIds ?? []) entry.items.add(id);
      for (const id of work.productIds ?? []) entry.products.add(id);
      queued.set(shop, entry);
      if (queued.size > 10_000) queued.delete(queued.keys().next().value as string);
      if (timers.has(shop)) return;
      const timer = setTimeout(() => {
        timers.delete(shop);
        runNow(shop).catch((error: unknown) => logger.error(`costs ${shop}: ${errorText(error)}`));
      }, deps.delayMs ?? COST_WEBHOOK_DEBOUNCE_MS);
      (timer as { unref?: () => void }).unref?.();
      timers.set(shop, timer);
    },
    scheduled: (shop) => timers.has(shop),
    pending: (shop) => ({ inventoryItemIds: [...(queued.get(shop)?.items ?? [])], productIds: [...(queued.get(shop)?.products ?? [])] }),
    runNow,
    cancelAll() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      queued.clear();
    },
  };
}

let appRefresher: CostRefresher | null = null;

const appLogger: SyncLogger = {
  info: (message) => console.info(`[won-costs] ${message}`),
  warn: (message) => console.warn(`[won-costs] ${message}`),
  error: (message) => console.error(`[won-costs] ${message}`),
};

/** The shop's offline Admin API client (`unauthenticated.admin`, loaded lazily), or null. */
export async function offlineClient(shop: string): Promise<AdminClient | null> {
  try {
    const { unauthenticated } = await import("../../shopify.server");
    const { admin } = await unauthenticated.admin(shop);
    return adminClientFromApp(admin as unknown as AppAdminGraphql);
  } catch {
    return null;
  }
}

/**
 * The process-wide refresher of the running app (the first caller's DB). The
 * daily reconcile job is started with it (idempotent; never under tests).
 */
export function appCostRefresher(db: PrismaClient): CostRefresher {
  ensureCostReconcileJob(db, { clientFor: offlineClient });
  if (!appRefresher) appRefresher = createCostRefresher({ db, clientFor: offlineClient, logger: appLogger });
  return appRefresher;
}

// --- What the admin shows ------------------------------------------------------------------------

const local = (date: Date, timezone: string | null) => shopLocalDateTime(date, timezone ?? "UTC");

/** The mirror's state (margin screen, Přehled card). Times shop-local. */
export async function costMirrorView(
  ctx: { db: PrismaClient; shop: string; now?: () => Date },
  opts: { enabled: boolean; timezone: string | null },
): Promise<CostMirrorView> {
  if (!opts.enabled) return { state: "off" };
  const now = (ctx.now ?? (() => new Date()))();
  const state = await loadCostState(ctx.db, ctx.shop);
  if (costJobKind(ctx.shop) === "full") {
    const p = costPassProgress(ctx.shop) ?? (state.pending && !state.pending.failedAt ? state.pending : null);
    return { state: "running", done: p?.done ?? 0, total: p?.total ?? null, since: local(p ? new Date(p.since) : now, opts.timezone) };
  }
  if (state.pending?.failedAt) {
    return {
      state: "failed",
      at: local(new Date(state.pending.failedAt), opts.timezone),
      problems: [{ key: "sync.problem.other", params: { detail: shortDetail(state.pending.error ?? "") } }],
    };
  }
  if (state.scannedAt && state.cursor === null && now.getTime() - state.scannedAt.getTime() < COSTS_MAX_AGE_MS) {
    return { state: "fresh", at: local(state.scannedAt, opts.timezone) };
  }
  return { state: "stale", at: state.scannedAt ? local(state.scannedAt, opts.timezone) : null };
}

/** A cost the engine can use: a number > 0 (in the shop currency when it is known). */
export function hasCost(row: { cost: string | null; currency: string | null }, shopCurrency?: string | null): boolean {
  if (row.cost === null) return false;
  const amount = Number(row.cost);
  if (!Number.isFinite(amount) || amount <= 0) return false;
  return !shopCurrency || !row.currency || row.currency.toUpperCase() === shopCurrency.toUpperCase();
}

/**
 * How many variants / products have a cost (A2: the admin says how many do
 * not), from the mirror. Null when the mirror never ran (no rows, no pass).
 */
export async function costCoverage(db: PrismaClient, shop: string, shopCurrency?: string | null): Promise<CostCoverageView | null> {
  const rows = await db.variantCost.findMany({ where: { shop }, select: { productId: true, title: true, cost: true, currency: true } });
  if (rows.length === 0) {
    const state = await loadCostState(db, shop);
    if (!state.scannedAt) return null;
  }
  const products = new Map<string, { title: string; without: number }>();
  let withCost = 0;
  for (const row of rows) {
    if (hasCost(row, shopCurrency)) {
      withCost += 1;
      continue;
    }
    const entry = products.get(row.productId) ?? { title: row.title ?? row.productId, without: 0 };
    entry.without += 1;
    products.set(row.productId, entry);
  }
  const sample = [...products]
    .sort(([a, x], [b, y]) => y.without - x.without || x.title.localeCompare(y.title) || (a < b ? -1 : a > b ? 1 : 0))
    .slice(0, COVERAGE_SAMPLE)
    .map(([productId, { title, without }]) => ({ productId, title, variantsWithoutCost: without }));
  return { variants: rows.length, variantsWithCost: withCost, productsWithoutCost: products.size, sample };
}
