// Won Toasts — Phase 8 trust-data bridge (pure mapping).
//
// The Shopify-shape → domain and domain → metafield transforms, kept free of any
// server/Shopify imports so they can be unit-tested directly. The I/O + Pro-gate
// live in popularity.server.ts, which imports these.

import type { ProductSale } from "@won/core/toasts/popularity";

export interface OrderLineNode {
  quantity?: number | null;
  product?: { id?: string | null } | null;
}
export interface OrderNode {
  createdAt?: string | null;
  lineItems?: { edges?: Array<{ node?: OrderLineNode | null } | null> | null } | null;
}

export interface MetafieldInput {
  ownerId: string;
  namespace: string;
  key: string;
  type: string;
  value: string;
}

/** Flatten order nodes into `ProductSale` records (one per line item with a
 *  product + positive quantity + parseable date). Pure, no I/O, no PII. */
export function ordersToSales(
  orders: ReadonlyArray<OrderNode | null | undefined>,
): ProductSale[] {
  const out: ProductSale[] = [];
  for (const order of orders) {
    if (!order) continue;
    const at = order.createdAt ? Date.parse(order.createdAt) : Number.NaN;
    if (!Number.isFinite(at)) continue;
    for (const edge of order.lineItems?.edges ?? []) {
      const line = edge?.node;
      const productId = line?.product?.id;
      const quantity = Number(line?.quantity);
      if (!productId || !Number.isFinite(quantity) || quantity <= 0) continue;
      out.push({ productId, quantity, at });
    }
  }
  return out;
}

/** Map popularity rows to `won.*` product metafield-write inputs (pure). */
export function popularityToMetafields(
  rows: ReadonlyArray<{ productId: string; soldUnits: number; isBestseller: boolean }>,
): MetafieldInput[] {
  const mf: MetafieldInput[] = [];
  for (const r of rows) {
    mf.push(
      { ownerId: r.productId, namespace: "won", key: "units_sold_30d", type: "number_integer", value: String(r.soldUnits) },
      { ownerId: r.productId, namespace: "won", key: "bestseller", type: "boolean", value: r.isBestseller ? "true" : "false" },
    );
  }
  return mf;
}
