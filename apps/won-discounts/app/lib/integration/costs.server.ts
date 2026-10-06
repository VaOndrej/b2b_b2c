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
//   Přehled's 24 h check catch up. No offline session (OQ4: the refresh token
//   expired or was revoked — unauthenticated.admin refreshes an expiring
//   access token by itself) is recorded for the admin ("open the app").
//   Our own writes (OQ3, checked 2026-09-29): shopify.dev says products/update
//   "occurs whenever a product is updated … or variants are … updated" and
//   does not exclude metafield writes, so the mirror's own variant metafield
//   writes may echo back as products/update. The echo cannot be told from a
//   merchant edit (the payload is id + updated_at only), so it is not
//   filtered: its re-read diffs against what Shopify now holds and writes
//   nothing, so the loop ends there (tests/lib/sync/costs.test.ts "OQ3"). The
//   bounded double work: one read of each written product's variants, or —
//   past COST_QUEUE_MAX echoes — one extra full pass that writes nothing.
//   MVP 3: the same mirror keeps each variant's `pdp` floor (contract K4 v2,
//   sync/costs.ts: {f, k}, price-independent) — inventory_items/update
//   recomputes it with the cost; products/update stays for the mirror itself
//   (new / deleted variants, the price the impact overview reads); the margin
//   settings (`k`) and a product's collections are the sync's triggers.
//   Admin: costMirrorView / costCoverage for the margin screen and Přehled.

import type { PrismaClient } from "../../generated/prisma/client";
import { adminClientFromApp, type AdminClient, type AppAdminGraphql } from "../admin-client.server";
import { loadConfig } from "../config.server";
import { ensureCostReconcileJob } from "../jobs/cost-reconcile.server";
import { costJobKind, costPassProgress, recordNoSession, startCostJob, type CostJobOutcome } from "../sync/cost-lane.server";
import { COST_NO_SESSION, COSTS_MAX_AGE_MS, loadCostState } from "../sync/costs";
import { shopLocalDateTime } from "../sync/sync.server";
import { errorText } from "../sync/transport";
import type { SyncLogger } from "../sync/types";
import type { CostCoverageView, CostMirrorView, UiText } from "../../components/model/types";
import { shortDetail } from "./sync-copy";
// Registers the impact recompute after every cost job (onCostJobSettled) wherever the mirror runs.
import "./margin-impact.server";

/** One mirror per shop at most this long after the first relevant webhook. */
export const COST_WEBHOOK_DEBOUNCE_MS = 5_000;
/**
 * Ids queued per shop before the queue collapses into ONE full pass (a bulk
 * import fires a webhook per product: past this, reading everything once is
 * cheaper than one lookup per id, and the queue stays bounded).
 */
export const COST_QUEUE_MAX = 250;
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
  /** What is queued for the shop (tests, support); `full` = collapsed into one full pass. */
  pending(shop: string): { inventoryItemIds: string[]; productIds: string[]; full: boolean };
  /** Flush the shop's queue now. */
  runNow(shop: string): Promise<CostRefreshOutcome>;
  /** Test hook: drop every timer and queue. */
  cancelAll(): void;
}

const quiet: SyncLogger = { info() {}, warn() {}, error() {} };

export function createCostRefresher(deps: CostRefresherDeps): CostRefresher {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const queued = new Map<string, { items: Set<string>; products: Set<string>; full: boolean }>();
  const logger = deps.logger ?? quiet;
  const runNow = async (shop: string): Promise<CostRefreshOutcome> => {
    const timer = timers.get(shop);
    if (timer) clearTimeout(timer);
    timers.delete(shop);
    const work = queued.get(shop);
    queued.delete(shop);
    if (!work || (!work.full && work.items.size + work.products.size === 0)) return { done: "nothing" };
    const client = await deps.clientFor(shop);
    if (!client) {
      logger.warn(`costs ${shop}: no Admin API session, the queued mirror was dropped`);
      // OQ4: recorded for the admin ("open the app"); the next load with a session runs a full pass.
      await recordNoSession(deps.db, shop, (deps.now ?? (() => new Date()))()).catch(() => false);
      return { done: "no_session" };
    }
    const lane = { client, db: deps.db, now: deps.now, logger };
    const outcome = work.full
      ? await startCostJob(shop, lane, { kind: "full" })
      : await startCostJob(shop, lane, { kind: "items", inventoryItemIds: [...work.items], productIds: [...work.products] });
    return { done: "job", outcome };
  };
  return {
    note(shop, work) {
      const entry = queued.get(shop) ?? { items: new Set<string>(), products: new Set<string>(), full: false };
      if (!entry.full) {
        for (const id of work.inventoryItemIds ?? []) entry.items.add(id);
        for (const id of work.productIds ?? []) entry.products.add(id);
        if (entry.items.size + entry.products.size > COST_QUEUE_MAX) {
          entry.full = true;
          entry.items.clear();
          entry.products.clear();
        }
      }
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
    pending: (shop) => {
      const entry = queued.get(shop);
      return { inventoryItemIds: [...(entry?.items ?? [])], productIds: [...(entry?.products ?? [])], full: entry?.full ?? false };
    },
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
    return adminClientFromApp(admin as unknown as AppAdminGraphql, shop);
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

/** Shopify's / the transport's own words, as a secondary detail after the Czech sentence (§4c; never the whole sentence). */
function detailOf(error: string): UiText[] {
  const detail = shortDetail(error.replace(/gid:\/\/shopify\/[A-Za-z]+\/\d+/g, "…"));
  return detail ? [{ key: "margin.mirror.detail", params: { detail } }] : [];
}

/**
 * Why the last full pass failed, in the admin language (audit P3-2): no
 * offline session ("open the app"), a failed READ of the costs, or writes
 * that did not get through — never the generic "not written to Shopify".
 */
function passProblems(error: string): UiText[] {
  if (error === COST_NO_SESSION) return [{ key: "margin.mirror.reauth" }];
  const key = error.includes("costs.read") || error === "" ? "margin.mirror.readFailed" : "margin.mirror.writeFailed";
  return [{ key }, ...detailOf(error)];
}

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
    return { state: "failed", at: local(new Date(state.pending.failedAt), opts.timezone), problems: passProblems(state.pending.error ?? "") };
  }
  // Variants whose cost Shopify refused (the pass completed; they are retried after a back-off).
  const refused = await ctx.db.variantCost.count({ where: { shop: ctx.shop, writeError: { not: null } } });
  if (refused > 0) {
    const latest = await ctx.db.variantCost.findFirst({
      where: { shop: ctx.shop, writeError: { not: null } },
      orderBy: [{ writeFailedAt: "desc" }, { variantId: "asc" }],
      select: { title: true, variantTitle: true, writeError: true, writeFailedAt: true },
    });
    // Titles only, never a raw GID (§4c): a variant without a product title is named by its variant title, else not at all.
    const name = latest?.title ? (latest.variantTitle ? `${latest.title} (${latest.variantTitle})` : latest.title) : (latest?.variantTitle ?? null);
    return {
      state: "failed",
      at: local(latest?.writeFailedAt ?? now, opts.timezone),
      problems: [
        name ? { key: "margin.mirror.refused", params: { n: refused, title: name } } : { key: "margin.mirror.refusedUntitled", params: { n: refused } },
        ...detailOf(latest?.writeError ?? ""),
      ],
    };
  }
  if (state.scannedAt && state.cursor === null && now.getTime() - state.scannedAt.getTime() < COSTS_MAX_AGE_MS) {
    return { state: "fresh", at: local(state.scannedAt, opts.timezone) };
  }
  return { state: "stale", at: state.scannedAt ? local(state.scannedAt, opts.timezone) : null };
}

/**
 * How many variants / products have a cost (A2: the admin says how many do
 * not), from the mirror — bounded queries only (counts, one grouped page of
 * COVERAGE_SAMPLE products), never the whole catalogue per page load. A row
 * has a cost when its `cost` is set (the mirror stores only usable costs) in
 * the shop currency. Null until the first full pass finished.
 */
export async function costCoverage(db: PrismaClient, shop: string, shopCurrency?: string | null): Promise<CostCoverageView | null> {
  const state = await loadCostState(db, shop);
  if (!state.scannedAt) return null;
  const currency = shopCurrency ? shopCurrency.toUpperCase() : null;
  const withCost = { shop, cost: { not: null }, ...(currency ? { currency } : {}) };
  const withoutCost = { shop, OR: [{ cost: null }, ...(currency ? [{ currency: { not: currency } }] : [])] };
  const [variants, variantsWithCost, distinct, grouped] = await Promise.all([
    db.variantCost.count({ where: { shop } }),
    db.variantCost.count({ where: withCost }),
    currency
      ? db.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(DISTINCT "productId") AS n FROM "VariantCost" WHERE "shop" = ${shop} AND ("cost" IS NULL OR "currency" IS NULL OR "currency" <> ${currency})`
      : db.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(DISTINCT "productId") AS n FROM "VariantCost" WHERE "shop" = ${shop} AND "cost" IS NULL`,
    db.variantCost.groupBy({
      by: ["productId"],
      where: withoutCost,
      _count: { _all: true },
      orderBy: [{ _count: { productId: "desc" } }, { productId: "asc" }],
      take: COVERAGE_SAMPLE,
    }),
  ]);
  const ids = grouped.map((g) => g.productId);
  const titled = ids.length
    ? await db.variantCost.findMany({ where: { shop, productId: { in: ids } }, distinct: ["productId"], select: { productId: true, title: true } })
    : [];
  // Never a raw GID as a title (audit fix round 2): "" = untitled, the screen says "Produkt bez názvu".
  const titles = new Map(titled.map((row) => [row.productId, row.title?.trim() ?? ""]));
  return {
    variants,
    variantsWithCost,
    productsWithoutCost: Number(distinct[0]?.n ?? 0),
    sample: grouped.map((g) => ({ productId: g.productId, title: titles.get(g.productId) ?? "", variantsWithoutCost: g._count._all })),
  };
}
