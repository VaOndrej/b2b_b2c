// App-embed activation (onboarding step 3, Přehled): one click opens the theme
// editor with the Won Discounts embed switched on. Shopify accepts the app's
// client id (API key) in `activateAppId`, so the link needs no extension UUID.

export const EMBED_BLOCK_HANDLE = "won_discounts_embed";

export function embedActivationUrl(shop: string, apiKey: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop) || !apiKey) return null;
  return `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${encodeURIComponent(apiKey)}/${EMBED_BLOCK_HANDLE}`;
}
