// Gift cards never take a discount (decided 10 Oct 2026: a 1 000 Kč card bought for 700 Kč and spent as 1 000 Kč
// is money given away). The checkout function cannot ask Shopify whether a line is a gift card — its input query
// is at the cost limit (extensions/won-discounts-engine/README.md) — so the app says it on the variant: the
// variant metafield `outlet` = 0 (core cart.ts NEVER_DISCOUNTED_FLAG: "takes none of the discount classes",
// held even when sales combine with anything). The function already reads that key for sales.
//
//   syncGiftCards(transport)  every gift card product of the shop (Admin `products(query: "gift_card:true")`,
//                             checked again on `isGiftCard`): each variant without the flag gets it. One step
//                             for the sync run; a failure is a failed step, never a thrown sync.
// Idempotent: a flagged variant is not written again. A product that stops being a gift card keeps the flag
// until a sale of it ends (outlet.server.ts writeOutletFlag) — Shopify does not let a product change that.
// The storefront does not wait for this: its blocks ask Liquid (`product.gift_card?`).

import { NEVER_DISCOUNTED_FLAG } from "@won/core/discounts/cart";

import { OUTLET_VARIANT_KEY, WON_NAMESPACE } from "./graphql";
import { errorText, userErrorText, type Transport, type UserErrorLike } from "./transport";
import type { SyncStep } from "./types";

/** Shopify takes at most 25 metafields in one metafieldsSet. */
const WRITE_BATCH = 25;
/** Pages of 4 gift card products (the query's cost limit): a shop with more than 200 is not one this guard was written for. */
const MAX_PAGES = 50;

interface GiftCardPage {
  products?: {
    nodes?: ({ id?: string; isGiftCard?: boolean; variants?: { nodes?: ({ id?: string; flag?: { jsonValue?: unknown } | null } | null)[] } } | null)[];
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  };
}

/** The gift card variants of a page that do not carry the flag yet (pure). */
export function unflaggedGiftCardVariants(page: GiftCardPage): string[] {
  const out: string[] = [];
  for (const product of page.products?.nodes ?? []) {
    if (product?.isGiftCard !== true) continue;
    for (const variant of product.variants?.nodes ?? []) {
      if (variant?.id && variant.flag?.jsonValue !== NEVER_DISCOUNTED_FLAG) out.push(variant.id);
    }
  }
  return out;
}

export async function syncGiftCards(transport: Transport): Promise<SyncStep> {
  try {
    const todo: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data: GiftCardPage = await transport.call("giftCardVariants", { after, namespace: WON_NAMESPACE, key: OUTLET_VARIANT_KEY });
      todo.push(...unflaggedGiftCardVariants(data));
      after = data.products?.pageInfo?.hasNextPage ? (data.products.pageInfo.endCursor ?? null) : null;
      if (!after) break;
    }
    for (let i = 0; i < todo.length; i += WRITE_BATCH) {
      const data: { metafieldsSet: { userErrors: UserErrorLike[] } } = await transport.call("metafieldsSet", {
        metafields: todo.slice(i, i + WRITE_BATCH).map((ownerId) => ({ ownerId, namespace: WON_NAMESPACE, key: OUTLET_VARIANT_KEY, type: "json", value: JSON.stringify(NEVER_DISCOUNTED_FLAG) })),
      });
      const refused = userErrorText(data.metafieldsSet.userErrors);
      if (refused) return { step: "gift_cards", ok: false, detail: `gift cards kept out of discounts: ${refused}` };
    }
    return { step: "gift_cards", ok: true, detail: todo.length > 0 ? `${todo.length} gift card variant(s) marked as never discounted` : "gift cards are marked as never discounted (or the shop has none)" };
  } catch (error) {
    if (error instanceof Response) throw error;
    return { step: "gift_cards", ok: false, detail: `gift cards kept out of discounts: ${errorText(error)}` };
  }
}
