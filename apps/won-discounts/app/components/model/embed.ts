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

/**
 * Where the card line can be SEEN (feedback 9 Oct 2026, bod 6): "Všechny produkty" on the live storefront — every
 * product is there, so the whole-store levels show on its cards. The storefront's own address when a product's
 * URL told it (the shop's domain), else the myshopify one (Shopify sends it on to the shop's domain).
 */
export function cardsStorefrontUrl(shop: string, productUrl?: string | null): string | null {
  try {
    if (productUrl) return `${new URL(productUrl).origin}/collections/all`;
  } catch {
    // not an address: the shop's own below
  }
  return SHOP_DOMAIN.test(shop) ? `https://${shop}/collections/all` : null;
}

/** The theme editor of the LIVE theme on the collection template: the cards as the theme draws them, editable. */
export function collectionEditorUrl(shop: string): string | null {
  return SHOP_DOMAIN.test(shop) ? `https://${shop}/admin/themes/current/editor?template=collection` : null;
}

/** The "Rewards progress" and "Campaign banner" blocks (feedback 2, body 5 a 7): any section of any template. */
export const REWARDS_PROGRESS_BLOCK_HANDLE = "rewards_progress";
export const CAMPAIGN_BLOCK_HANDLE = "campaign_banner";
/** The "Top bar" block (blocks/top_bar.liquid): the strip the merchant adds in the header group in the theme editor. */
export const TOP_BAR_BLOCK_HANDLE = "top_bar";
/**
 * The announcement strips of ONE thing each (7th round, bod 5; blocks/announcement_milestones.liquid and
 * announcement_campaign.liquid): what the app adds to the header now. "Top bar" stays for the themes that have it.
 */
export const ANNOUNCEMENT_MILESTONES_BLOCK_HANDLE = "announcement_milestones";
export const ANNOUNCEMENT_CAMPAIGN_BLOCK_HANDLE = "announcement_campaign";

/** The announcement strip that goes with a block: the campaign banner's is the campaign's, every other the Milestones'. */
export function announcementHandleOf(handle: string): string {
  return handle === CAMPAIGN_BLOCK_HANDLE ? ANNOUNCEMENT_CAMPAIGN_BLOCK_HANDLE : ANNOUNCEMENT_MILESTONES_BLOCK_HANDLE;
}

/** One-click links into the theme editor for a block that fits anywhere, and for the embed's top bar. */
export interface PlacementLinks {
  /** The product page: the block in its main section. */
  product: string | null;
  /** The home page: the block in a new Apps section. */
  home: string | null;
  /** The cart page: the block in its main section. */
  cart: string | null;
  /** The header group in the theme editor with the module's announcement strip ready to add (Add section → Apps does the same by hand). */
  topBar: string | null;
  /** The embed's settings: the fallback top bar for a theme whose header takes no app block. */
  topBarEmbed: string | null;
}

export function placementLinks(shop: string, apiKey: string, handle: string): PlacementLinks {
  if (!SHOP_DOMAIN.test(shop) || !apiKey) return { product: null, home: null, cart: null, topBar: null, topBarEmbed: null };
  const block = `${encodeURIComponent(apiKey)}/${handle}`;
  const editor = `https://${shop}/admin/themes/current/editor`;
  return {
    product: `${editor}?template=product&addAppBlockId=${block}&target=mainSection`,
    home: `${editor}?template=index&addAppBlockId=${block}&target=newAppsSection`,
    cart: `${editor}?template=cart&addAppBlockId=${block}&target=mainSection`,
    topBar: `${editor}?template=index&addAppBlockId=${encodeURIComponent(apiKey)}/${announcementHandleOf(handle)}&target=sectionGroup:header`,
    topBarEmbed: embedActivationUrl(shop, apiKey),
  };
}

/**
 * The theme editor WITHOUT adding anything, from a link that adds a block (feedback 10 Oct 2026, bod 6): a block
 * that is already in the theme is opened to be moved — following the add link again would put a second one in.
 * With the block's place known (`spot.select`) the editor opens with that block selected, so it is not looked for
 * in the tree (feedback 10 Oct 2026, 6th round). Shopify documents no such link: these are the parameters the
 * editor writes to its own address; an editor that does not know them opens the template as before.
 */
export function editorOpenUrl(addUrl: string | null | undefined, spot?: { select?: { section: string; block: string } } | null): string | null {
  if (!addUrl) return null;
  try {
    const url = new URL(addUrl);
    url.searchParams.delete("addAppBlockId");
    url.searchParams.delete("target");
    if (spot?.select) {
      url.searchParams.set("section", spot.select.section);
      url.searchParams.set("block", spot.select.block);
    }
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * An editor link with the product another editor link previews (feedback 10 Oct 2026, 7th round, bod 2): a link
 * that adds or opens the sale badge without it shows the editor's default product, which is rarely the one on
 * sale. `from` = a link that carries `previewPath`; without one the link stays as it is.
 */
export function editorOnProductOf(url: string | null | undefined, from: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const path = from ? new URL(from).searchParams.get("previewPath") : null;
    if (!path) return url;
    const out = new URL(url);
    out.searchParams.set("previewPath", path);
    return out.toString();
  } catch {
    return url;
  }
}

/**
 * What to say about where a block sits (types.ts PlacementSpot): a sentence, and whether it asks for a move.
 * Local shapes on purpose (this file imports nothing). A banner or a ladder below the second section of the home
 * page is seen only after scrolling; a block under the buy buttons of the product page is past the decision.
 */
export function spotAdvice(
  spot: ({ at: "page"; index: number; of: number } | { at: "product"; belowBuy: boolean }) | undefined,
): { key: "placement.spot.pageLow" | "placement.spot.pageTop" | "placement.spot.belowBuy" | "placement.spot.aboveBuy"; params: Record<string, number>; move: boolean } | null {
  if (!spot) return null;
  if (spot.at === "page") {
    const move = spot.index > 2;
    return { key: move ? "placement.spot.pageLow" : "placement.spot.pageTop", params: { index: spot.index, of: spot.of }, move };
  }
  return { key: spot.belowBuy ? "placement.spot.belowBuy" : "placement.spot.aboveBuy", params: {}, move: spot.belowBuy };
}

// --- Where a piece stands in the live theme (feedback 3, bod 5; doctrine §19c) --------------------------------
// Three states, the same for every placement: in the theme (green), missing (red, with the button that adds it)
// and not verified (grey, with "Zkontrolovat znovu"). Local types on purpose: this file imports nothing.

type Placement = "in_theme" | "missing" | "unknown";

/** A block the theme read looked for: found, not found, or not read (absent). */
export function placementOf(found: boolean | undefined): Placement {
  return found === undefined ? "unknown" : found ? "in_theme" : "missing";
}

/** Won switched on in the theme (the app embed). On only in an unpublished theme = missing in the live one. */
export function embedPlacement(state: "on" | "off" | "draft_only" | "unknown" | "no_scope"): Placement {
  return state === "on" ? "in_theme" : state === "off" || state === "draft_only" ? "missing" : "unknown";
}

/** The quantity table on the product page. */
export function blockPlacement(state: "on" | "off" | "unknown" | "no_scope"): Placement {
  return state === "on" ? "in_theme" : state === "off" ? "missing" : "unknown";
}
