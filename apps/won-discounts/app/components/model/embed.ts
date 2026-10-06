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

/** The card block's handle (blocks/card_tiers.liquid, MVP 7 BETA). */
export const CARD_BLOCK_HANDLE = "card_tiers";

/**
 * MVP 7 (M8): the theme editor on the collection template with the card block ready to add. Themes whose product
 * card takes app blocks (Horizon) let the merchant drop it into the card; others get the line from the embed.
 */
export function cardBlockAddUrl(shop: string, apiKey: string): string | null {
  if (!SHOP_DOMAIN.test(shop) || !apiKey) return null;
  return `https://${shop}/admin/themes/current/editor?template=collection&addAppBlockId=${encodeURIComponent(apiKey)}/${CARD_BLOCK_HANDLE}&target=mainSection`;
}

/** The "Rewards progress" and "Campaign banner" blocks (feedback 2, body 5 a 7): any section of any template. */
export const REWARDS_PROGRESS_BLOCK_HANDLE = "rewards_progress";
export const CAMPAIGN_BLOCK_HANDLE = "campaign_banner";

/** One-click links into the theme editor for a block that fits anywhere, and for the embed's top bar. */
export interface PlacementLinks {
  /** The product page: the block in its main section. */
  product: string | null;
  /** The home page: the block in a new Apps section. */
  home: string | null;
  /** The cart page: the block in its main section. */
  cart: string | null;
  /** The embed's settings (the top bar is switched on there). */
  topBar: string | null;
}

export function placementLinks(shop: string, apiKey: string, handle: string): PlacementLinks {
  if (!SHOP_DOMAIN.test(shop) || !apiKey) return { product: null, home: null, cart: null, topBar: null };
  const block = `${encodeURIComponent(apiKey)}/${handle}`;
  const editor = `https://${shop}/admin/themes/current/editor`;
  return {
    product: `${editor}?template=product&addAppBlockId=${block}&target=mainSection`,
    home: `${editor}?template=index&addAppBlockId=${block}&target=newAppsSection`,
    cart: `${editor}?template=cart&addAppBlockId=${block}&target=mainSection`,
    topBar: embedActivationUrl(shop, apiKey),
  };
}
