// Shopify ids and discount codes as the admin accepts them from a form (SEC-1):
// one definition shared by every parser (rule editor, try-cart, native moves).

export const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d{1,20}$/;
export const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/;
export const COLLECTION_GID = /^gid:\/\/shopify\/Collection\/\d{1,20}$/;
export const NATIVE_DISCOUNT_GID = /^gid:\/\/shopify\/(?:DiscountNode|DiscountCodeNode|DiscountAutomaticNode)\/\d{1,20}$/;
export const BACKUP_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * What a merchant typed into a codes field → codes as Shopify treats them:
 * split on new lines, commas and semicolons, trimmed, upper-cased (codes are
 * case-insensitive), each once, in the typed order.
 */
export function splitCodes(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[\n,;]+/)) {
    const code = part.trim().toUpperCase();
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}
