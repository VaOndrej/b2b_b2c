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

import type { PrismaClient } from "../generated/prisma/client";
import db from "../db.server";

export const ANALYTICS_RETENTION_DAYS = 60;
const RETENTION_MS = ANALYTICS_RETENTION_DAYS * 86_400_000;
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

  async function deleteShopAnalytics(shop: string): Promise<void> {
    await prisma.analyticsEvent.deleteMany({ where: { shop: normalizeShop(shop) } });
  }

  return { record, summarize, counters, variantStats, deleteShopAnalytics };
}

const analyticsService = createAnalyticsService(db);

export const recordAnalyticsEvent = analyticsService.record;
export const summarizeAnalytics = analyticsService.summarize;
export const analyticsCounters = analyticsService.counters;
export const analyticsVariantStats = analyticsService.variantStats;
export const deleteShopAnalytics = analyticsService.deleteShopAnalytics;
