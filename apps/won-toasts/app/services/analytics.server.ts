// MVP13 — analytics store. Records raw toast lifecycle events (storefront
// beacon) and rolls them up via @won/core into per-rule metrics and per-variant
// A/B stats. No PII, no attributed revenue — an assist, not a proven cause.

import {
  aggregateEvents,
  summarizeByRule,
  type LifecycleEvent,
  type RuleCounters,
  type RuleMetrics,
} from "@won/core/toasts/analytics";
import type { VariantStat } from "@won/core/toasts/experiments";
import {
  scrubEvent,
  rollupEvents,
  mergeCounters,
  dateKeyUTC,
  emptyRollupCounters,
  type RawToastEvent,
  type RollupCounters,
} from "@won/core/toasts/insights";
import {
  computeBenchmark,
  type StoreTypeRates,
  type TypeBenchmark,
} from "@won/core/toasts/benchmarks";
import { hashToken } from "@won/core/toasts/experiments";

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import db from "../db.server";

// MVP13a decision #1: raw events are short-lived (30 days, debug only); the daily
// rollup is what the dashboard reads and is kept far longer (365 days).
export const ANALYTICS_RETENTION_DAYS = 30;
export const ROLLUP_RETENTION_DAYS = 365;
const RETENTION_MS = ANALYTICS_RETENTION_DAYS * 86_400_000;
const ROLLUP_RETENTION_MS = ROLLUP_RETENTION_DAYS * 86_400_000;

/** One rollup row as read back for the dashboard/advisor. */
export interface RollupRecord {
  date: string;
  dims: { type: string; device: string; pageType: string; customerState: string; abVariant: number };
  counters: RollupCounters;
}
export const LIFECYCLE_TYPES: readonly LifecycleEvent[] = [
  "impression",
  "click",
  "dismiss",
  "undo",
];

function normalizeShop(shop: string): string {
  const s = String(shop ?? "").trim().toLowerCase();
  if (!s) throw new Error("shop is required");
  return s;
}

export function createAnalyticsService(prisma: PrismaClient) {
  async function record(
    shop: string,
    ruleId: string,
    type: LifecycleEvent,
    variant = 0,
  ): Promise<void> {
    const normalizedShop = normalizeShop(shop);
    if (!ruleId || !LIFECYCLE_TYPES.includes(type)) return;
    await prisma.analyticsEvent.create({
      data: {
        shop: normalizedShop,
        ruleId: String(ruleId).slice(0, 80),
        type,
        variant: Number.isFinite(variant) ? Math.max(0, Math.round(variant)) : 0,
      },
    });
    await prisma.analyticsEvent
      .deleteMany({
        where: { shop: normalizedShop, at: { lt: new Date(Date.now() - RETENTION_MS) } },
      })
      .catch(() => {});
  }

  async function loadEvents(shop: string, windowMs: number) {
    const since = new Date(Date.now() - Math.max(0, windowMs));
    return prisma.analyticsEvent.findMany({
      where: { shop: normalizeShop(shop), at: { gte: since } },
      select: { ruleId: true, type: true, variant: true },
    });
  }

  /** Per-rule metrics over a window (default 30 days). */
  async function summarize(
    shop: string,
    windowMs = 30 * 86_400_000,
  ): Promise<Record<string, RuleMetrics>> {
    const rows = await loadEvents(shop, windowMs);
    return summarizeByRule(
      rows.map((r) => ({ ruleId: r.ruleId, type: r.type as LifecycleEvent })),
    );
  }

  /** Raw per-rule counters (for the AI advisor context). */
  async function counters(
    shop: string,
    windowMs = 30 * 86_400_000,
  ): Promise<Record<string, RuleCounters>> {
    const rows = await loadEvents(shop, windowMs);
    return aggregateEvents(
      rows.map((r) => ({ ruleId: r.ruleId, type: r.type as LifecycleEvent })),
    );
  }

  /** Per-variant impression/click stats for one rule (A/B winner picking). */
  async function variantStats(
    shop: string,
    ruleId: string,
    windowMs = 30 * 86_400_000,
  ): Promise<VariantStat[]> {
    const rows = await loadEvents(shop, windowMs);
    const byVariant = new Map<number, VariantStat>();
    for (const r of rows) {
      if (r.ruleId !== ruleId) continue;
      const v = byVariant.get(r.variant) ?? {
        variant: r.variant,
        impressions: 0,
        clicks: 0,
      };
      if (r.type === "impression") v.impressions += 1;
      else if (r.type === "click") v.clicks += 1;
      byVariant.set(r.variant, v);
    }
    return Array.from(byVariant.values());
  }

  // ---- MVP13a: rich atom ingest + daily rollup ----

  /**
   * Batch-ingest scrubbed lifecycle atoms from the storefront beacon. Every event
   * passes the PII scrub (unknown/PII keys dropped) before it touches storage;
   * raw rows are written for debug and the daily rollup (what the dashboard reads)
   * is upserted per (date, type, segment). Best-effort retention prune of both.
   */
  async function recordAtoms(
    shop: string,
    events: readonly unknown[],
    now: number = Date.now(),
  ): Promise<void> {
    const normalizedShop = normalizeShop(shop);
    if (!Array.isArray(events) || events.length === 0) return;

    const clean: RawToastEvent[] = [];
    for (const raw of events.slice(0, 200)) {
      const scrubbed = scrubEvent(raw);
      if (scrubbed) clean.push(scrubbed);
    }
    if (clean.length === 0) return;

    const at = new Date(now);
    // Raw rows (short-lived).
    await prisma.analyticsEvent.createMany({
      data: clean.map((e) => ({
        shop: normalizedShop,
        ruleId: (e.ruleId ?? e.dims.type ?? "unknown").slice(0, 80),
        variant: typeof e.dims.abVariant === "number" ? e.dims.abVariant : 0,
        type: e.atom,
        dims: e.dims as unknown as Prisma.InputJsonValue,
        dwellMs: e.dwellMs ?? null,
        at,
      })),
    });

    // Roll the batch up and merge into existing rows for the day.
    const date = dateKeyUTC(at);
    const rows = rollupEvents(clean.map((e) => ({ ...e, date })));
    for (const row of rows) {
      const where = {
        shop_date_type_device_pageType_customerState_abVariant: {
          shop: normalizedShop,
          date: row.date,
          type: row.dims.type,
          device: row.dims.device,
          pageType: row.dims.pageType,
          customerState: row.dims.customerState,
          abVariant: row.dims.abVariant,
        },
      };
      const existing = await prisma.toastRollup.findUnique({ where }).catch(() => null);
      const merged = mergeCounters(
        (existing?.counters as Partial<RollupCounters>) ?? emptyRollupCounters(),
        row.counters,
      );
      await prisma.toastRollup.upsert({
        where,
        create: {
          shop: normalizedShop,
          date: row.date,
          type: row.dims.type,
          device: row.dims.device,
          pageType: row.dims.pageType,
          customerState: row.dims.customerState,
          abVariant: row.dims.abVariant,
          counters: merged as unknown as Prisma.InputJsonValue,
        },
        update: { counters: merged as unknown as Prisma.InputJsonValue },
      });
    }

    // Opportunistic retention prune (indexed on at / date).
    await prisma.analyticsEvent
      .deleteMany({ where: { shop: normalizedShop, at: { lt: new Date(now - RETENTION_MS) } } })
      .catch(() => {});
    await prisma.toastRollup
      .deleteMany({
        where: { shop: normalizedShop, date: { lt: dateKeyUTC(now - ROLLUP_RETENTION_MS) } },
      })
      .catch(() => {});
  }

  /** Read daily rollups from `sinceDate` (inclusive, YYYY-MM-DD) for the dashboard. */
  async function readRollups(shop: string, sinceDate: string): Promise<RollupRecord[]> {
    const rows = await prisma.toastRollup.findMany({
      where: { shop: normalizeShop(shop), date: { gte: sinceDate } },
      orderBy: [{ date: "asc" }, { type: "asc" }],
    });
    return rows.map((r) => ({
      date: r.date,
      dims: {
        type: r.type,
        device: r.device,
        pageType: r.pageType,
        customerState: r.customerState,
        abVariant: r.abVariant,
      },
      counters: r.counters as unknown as RollupCounters,
    }));
  }

  // ---- MVP13d: cross-store benchmarks (k-anonymity, opt-out) ----

  /** This shop's own per-type rates over the window (for percentile ranking). */
  async function ownTypeRates(
    shop: string,
    sinceDate: string,
  ): Promise<Record<string, { readRate: number; ctr: number; dismissRate: number }>> {
    const rows = await prisma.toastRollup.findMany({
      where: { shop: normalizeShop(shop), date: { gte: sinceDate } },
      select: { type: true, counters: true },
    });
    const byType = new Map<string, RollupCounters>();
    for (const r of rows) {
      const prev = byType.get(r.type) ?? emptyRollupCounters();
      byType.set(r.type, mergeCounters(prev, r.counters as Partial<RollupCounters>));
    }
    const out: Record<string, { readRate: number; ctr: number; dismissRate: number }> = {};
    for (const [type, c] of byType) {
      if (!(c.shown > 0)) continue;
      out[type] = { readRate: c.readThrough / c.shown, ctr: c.clicks / c.shown, dismissRate: c.dismiss / c.shown };
    }
    return out;
  }

  /**
   * Anonymous cross-store benchmark over ALL shops' rollups. Opted-out shops are
   * excluded; a type is only reported when ≥ minStores shops contributed it
   * (k-anonymity). No shop domain/id leaves this function — shops are keyed by an
   * opaque hash and only aggregate percentiles are returned.
   */
  async function crossStoreBenchmark(
    sinceDate: string,
    minStores = 10,
    industry?: string,
  ): Promise<Record<string, TypeBenchmark>> {
    const rollups = await prisma.toastRollup.findMany({
      where: { date: { gte: sinceDate } },
      select: { shop: true, type: true, counters: true },
    });
    const cfgRows = await prisma.toastAppConfig.findMany({
      select: { shop: true, benchmarkOptOut: true, industry: true },
    });
    const optOut = new Map(cfgRows.map((r) => [r.shop, !!r.benchmarkOptOut]));
    const industryOf = new Map(cfgRows.map((r) => [r.shop, r.industry ?? undefined]));

    const byShopType = new Map<string, Map<string, RollupCounters>>();
    for (const r of rollups) {
      let m = byShopType.get(r.shop);
      if (!m) byShopType.set(r.shop, (m = new Map()));
      const prev = m.get(r.type) ?? emptyRollupCounters();
      m.set(r.type, mergeCounters(prev, r.counters as Partial<RollupCounters>));
    }

    const stores: StoreTypeRates[] = [];
    for (const [shop, m] of byShopType) {
      const byType: StoreTypeRates["byType"] = {};
      for (const [type, c] of m) {
        if (!(c.shown > 0)) continue;
        byType[type] = { readRate: c.readThrough / c.shown, ctr: c.clicks / c.shown, dismissRate: c.dismiss / c.shown };
      }
      stores.push({
        shopHash: String(hashToken(shop)),
        optOut: optOut.get(shop) ?? false,
        industry: industryOf.get(shop),
        byType,
      });
    }
    return computeBenchmark(stores, { minStores, industry });
  }

  async function getBenchmarkOptOut(shop: string): Promise<boolean> {
    const row = await prisma.toastAppConfig.findUnique({
      where: { shop: normalizeShop(shop) },
      select: { benchmarkOptOut: true },
    });
    return !!row?.benchmarkOptOut;
  }

  async function setBenchmarkOptOut(shop: string, optOut: boolean): Promise<void> {
    await prisma.toastAppConfig
      .update({ where: { shop: normalizeShop(shop) }, data: { benchmarkOptOut: optOut } })
      .catch(() => {});
  }

  async function getBenchmarkIndustry(shop: string): Promise<string | null> {
    const row = await prisma.toastAppConfig.findUnique({
      where: { shop: normalizeShop(shop) },
      select: { industry: true },
    });
    return row?.industry ?? null;
  }

  async function setBenchmarkIndustry(shop: string, industry: string | null): Promise<void> {
    const clean = industry ? industry.trim().slice(0, 40) || null : null;
    await prisma.toastAppConfig
      .update({ where: { shop: normalizeShop(shop) }, data: { industry: clean } })
      .catch(() => {});
  }

  async function deleteShopAnalytics(shop: string): Promise<void> {
    const normalizedShop = normalizeShop(shop);
    await prisma.analyticsEvent.deleteMany({ where: { shop: normalizedShop } });
    await prisma.toastRollup.deleteMany({ where: { shop: normalizedShop } }).catch(() => {});
  }

  return {
    record,
    summarize,
    counters,
    variantStats,
    recordAtoms,
    readRollups,
    ownTypeRates,
    crossStoreBenchmark,
    getBenchmarkOptOut,
    setBenchmarkOptOut,
    getBenchmarkIndustry,
    setBenchmarkIndustry,
    deleteShopAnalytics,
  };
}

const analyticsService = createAnalyticsService(db);

export const recordAnalyticsEvent = analyticsService.record;
export const summarizeAnalytics = analyticsService.summarize;
export const analyticsCounters = analyticsService.counters;
export const analyticsVariantStats = analyticsService.variantStats;
export const recordAtoms = analyticsService.recordAtoms;
export const readRollups = analyticsService.readRollups;
export const ownTypeRates = analyticsService.ownTypeRates;
export const crossStoreBenchmark = analyticsService.crossStoreBenchmark;
export const getBenchmarkOptOut = analyticsService.getBenchmarkOptOut;
export const setBenchmarkOptOut = analyticsService.setBenchmarkOptOut;
export const getBenchmarkIndustry = analyticsService.getBenchmarkIndustry;
export const setBenchmarkIndustry = analyticsService.setBenchmarkIndustry;
export const deleteShopAnalytics = analyticsService.deleteShopAnalytics;
