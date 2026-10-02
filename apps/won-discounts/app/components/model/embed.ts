// Theme-editor deep links. Shopify accepts the app's client id (API key) in
// both, so the links need no extension UUID (shopify.dev "Configure theme app
// extensions" → deep linking, verified with the Shopify dev MCP 2026-09-30):
//   - app-embed activation (onboarding step 3, Přehled): `activateAppId`;
//   - the quantity-tier app block (MVP 3, §13): `addAppBlockId={api_key}/{handle}`
//     with `template=product` and `target=mainSection` (the section with id
//     "main" — Horizon's and Dawn's product section). The merchant sees the
//     block in the editor and saves it there.

export const EMBED_BLOCK_HANDLE = "won_discounts_embed";

/** The storefront app block (extensions/won-discounts-storefront/blocks/quantity_tiers.liquid). */
export const TIERS_BLOCK_HANDLE = "quantity_tiers";

const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export function embedActivationUrl(shop: string, apiKey: string): string | null {
  if (!SHOP_DOMAIN.test(shop) || !apiKey) return null;
  return `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${encodeURIComponent(apiKey)}/${EMBED_BLOCK_HANDLE}`;
}

/** "Přidat tabulku na stránku produktu": the theme editor on the product template with the block added to its main section. */
export function tiersBlockAddUrl(shop: string, apiKey: string): string | null {
  if (!SHOP_DOMAIN.test(shop) || !apiKey) return null;
  return `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=${encodeURIComponent(apiKey)}/${TIERS_BLOCK_HANDLE}&target=mainSection`;
}

/** The cart page block (extensions/won-discounts-storefront/blocks/cart_rewards.liquid, MVP 4). */
export const CART_BLOCK_HANDLE = "cart_rewards";

/** "Přidat blok do stránky košíku": the theme editor on the cart template with the block added to its main section. */
export function cartBlockAddUrl(shop: string, apiKey: string): string | null {
  if (!SHOP_DOMAIN.test(shop) || !apiKey) return null;
  return `https://${shop}/admin/themes/current/editor?template=cart&addAppBlockId=${encodeURIComponent(apiKey)}/${CART_BLOCK_HANDLE}&target=mainSection`;
}

/** The sale badge block (extensions/won-discounts-storefront/blocks/outlet_badge.liquid, MVP 5). */
export const OUTLET_BLOCK_HANDLE = "outlet_badge";

/** "Přidat štítek výprodeje": the theme editor on the product template with the block added to its main section. */
export function outletBlockAddUrl(shop: string, apiKey: string): string | null {
  if (!SHOP_DOMAIN.test(shop) || !apiKey) return null;
  return `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=${encodeURIComponent(apiKey)}/${OUTLET_BLOCK_HANDLE}&target=mainSection`;
}
