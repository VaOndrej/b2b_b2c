// Výprodej (MVP 5, contract O6): which variants of which product the product metafield must flag as `outlet`
// — every run not ended whose prices may still be on sale (starting / active / ending before its prices came
// back; `endedAt` marks prices restored). Read from the app DB by every product pass (products.ts) and by the
// sale's own lane (integration/outlet.server.ts), so neither ever drops a flag the other wrote.
import { outletList } from "@won/core/discounts/outlet";

import type { PrismaClient } from "../../generated/prisma/client";

/** Product GID → its flagged variant GIDs (sorted), for one shop. */
export async function outletVariantsByProduct(db: Pick<PrismaClient, "outletRun">, shop: string, productIds?: readonly string[]): Promise<Map<string, string[]>> {
  const rows = await db.outletRun.findMany({
    where: {
      shop,
      status: { in: ["starting", "active", "ending"] },
      endedAt: null,
      ...(productIds ? { productId: { in: [...productIds] } } : {}),
    },
    select: { productId: true, variantId: true },
  });
  const byProduct = new Map<string, string[]>();
  for (const row of rows) byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), row.variantId]);
  for (const [productId, variants] of byProduct) byProduct.set(productId, outletList(variants));
  return byProduct;
}
