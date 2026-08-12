// MVP12 — social-proof sale store. Persists ONLY anonymized sales (first name +
// city + product), serves a recent feed, and supports GDPR redaction by
// customer id. Retention is capped; nothing sensitive is ever stored.

import type { AnonymizedSale } from "@won/core/toasts/social-proof";

import type { PrismaClient } from "../generated/prisma/client";
import db from "../db.server";

export const SALE_RETENTION_DAYS = 30;
const RETENTION_MS = SALE_RETENTION_DAYS * 86_400_000;
/** Max feed size returned to a storefront. */
export const SALE_FEED_CAP = 20;

export interface SaleFeedItem {
  firstName: string | null;
  city: string | null;
  product: string | null;
  at: number;
}

function normalizeShop(shop: string): string {
  const s = String(shop ?? "").trim().toLowerCase();
  if (!s) throw new Error("shop is required");
  return s;
}

export function createSaleEventService(prisma: PrismaClient) {
  async function record(
    shop: string,
    sale: AnonymizedSale,
    orderId: string | null = null,
  ): Promise<void> {
    const normalizedShop = normalizeShop(shop);
    const data = {
      shop: normalizedShop,
      firstName: sale.firstName,
      city: sale.city,
      product: sale.productTitle,
      customerId: sale.customerId,
      at: new Date(sale.at),
    };
    if (orderId) {
      // WBH-2: one sale row per order even if the webhook redelivers.
      await prisma.saleEvent.upsert({
        where: { shop_orderId: { shop: normalizedShop, orderId } },
        create: { ...data, orderId },
        update: {},
      });
    } else {
      await prisma.saleEvent.create({ data });
    }
    await prisma.saleEvent
      .deleteMany({
        where: { shop: normalizedShop, at: { lt: new Date(Date.now() - RETENTION_MS) } },
      })
      .catch(() => {});
  }

  async function count(shop: string): Promise<number> {
    return prisma.saleEvent.count({ where: { shop: normalizeShop(shop) } });
  }

  /** Recent sales, newest first. `showName`/`showCity` null out suppressed fields. */
  async function recent(
    shop: string,
    opts: { limit?: number; showName?: boolean; showCity?: boolean } = {},
  ): Promise<SaleFeedItem[]> {
    const rows = await prisma.saleEvent.findMany({
      where: { shop: normalizeShop(shop) },
      orderBy: { at: "desc" },
      take: Math.min(SALE_FEED_CAP, Math.max(1, opts.limit ?? SALE_FEED_CAP)),
    });
    return rows.map((r) => ({
      firstName: opts.showName === false ? null : r.firstName,
      city: opts.showCity === false ? null : r.city,
      product: r.product,
      at: r.at.getTime(),
    }));
  }

  /** All stored rows for a customer (GDPR data_request). Anonymized already. */
  async function forCustomer(
    shop: string,
    customerId: string | number,
  ): Promise<SaleFeedItem[]> {
    const rows = await prisma.saleEvent.findMany({
      where: { shop: normalizeShop(shop), customerId: String(customerId) },
      orderBy: { at: "desc" },
    });
    return rows.map((r) => ({
      firstName: r.firstName,
      city: r.city,
      product: r.product,
      at: r.at.getTime(),
    }));
  }

  async function redactCustomer(shop: string, customerId: string | number): Promise<void> {
    await prisma.saleEvent.deleteMany({
      where: { shop: normalizeShop(shop), customerId: String(customerId) },
    });
  }

  async function deleteShopSales(shop: string): Promise<void> {
    await prisma.saleEvent.deleteMany({ where: { shop: normalizeShop(shop) } });
  }

  return { record, count, recent, forCustomer, redactCustomer, deleteShopSales };
}

const saleEventService = createSaleEventService(db);

export const recordSaleEvent = saleEventService.record;
export const countSaleEvents = saleEventService.count;
export const recentSaleEvents = saleEventService.recent;
export const salesForCustomer = saleEventService.forCustomer;
export const redactCustomerSales = saleEventService.redactCustomer;
export const deleteShopSales = saleEventService.deleteShopSales;
