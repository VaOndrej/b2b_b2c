// MVP11 — real aggregate event store. Records genuine cart-adds (storefront
// beacon) and orders (orders/create webhook), then serves recent timestamps so
// the storefront can count "X in the last N hours" from real data. No PII here.

import type { PrismaClient } from "../generated/prisma/client";
import db from "../db.server";

export type ToastEventKind = "order" | "cart_add";

/** Keep at most this many days of events; older rows are pruned opportunistically. */
export const EVENT_RETENTION_DAYS = 30;
const RETENTION_MS = EVENT_RETENTION_DAYS * 86_400_000;
/** Hard cap on timestamps returned to the storefront (privacy + payload size). */
export const AGGREGATE_TIMESTAMP_CAP = 1000;

function normalizeShop(shop: string): string {
  const s = String(shop ?? "").trim().toLowerCase();
  if (!s) throw new Error("shop is required");
  return s;
}

export function createToastEventService(prisma: PrismaClient) {
  async function record(
    shop: string,
    kind: ToastEventKind,
    quantity = 1,
    at: Date = new Date(),
  ): Promise<void> {
    const normalizedShop = normalizeShop(shop);
    const qty = Number.isFinite(quantity) ? Math.max(1, Math.round(quantity)) : 1;
    await prisma.toastEvent.create({
      data: { shop: normalizedShop, kind, quantity: qty, at },
    });
    // Opportunistic retention prune (cheap; indexed on at).
    await prisma.toastEvent
      .deleteMany({
        where: { shop: normalizedShop, at: { lt: new Date(at.getTime() - RETENTION_MS) } },
      })
      .catch(() => {});
  }

  /** Recent event timestamps (epoch ms) for a kind within `windowMs`, newest first. */
  async function recentTimestamps(
    shop: string,
    kind: ToastEventKind,
    windowMs: number,
    now: number = Date.now(),
  ): Promise<number[]> {
    const normalizedShop = normalizeShop(shop);
    const since = new Date(now - Math.max(0, windowMs));
    const rows = await prisma.toastEvent.findMany({
      where: { shop: normalizedShop, kind, at: { gte: since } },
      select: { at: true },
      orderBy: { at: "desc" },
      take: AGGREGATE_TIMESTAMP_CAP,
    });
    return rows.map((r) => r.at.getTime());
  }

  async function deleteShopEvents(shop: string): Promise<void> {
    await prisma.toastEvent.deleteMany({ where: { shop: normalizeShop(shop) } });
  }

  return { record, recentTimestamps, deleteShopEvents };
}

const toastEventService = createToastEventService(db);

export const recordToastEvent = toastEventService.record;
export const recentToastEventTimestamps = toastEventService.recentTimestamps;
export const deleteShopEvents = toastEventService.deleteShopEvents;
