// Umístění na webu (balík E): what the theme read found, as the admin shows it. The server reads the themes
// (lib/integration/theme-scan.server.ts); this file is pure and imports nothing, so screens and tests share it.
//
//   - where an app block can go in the live theme (`fits`): the merchant picks a place, the app knows the way in;
//   - the `<won-discounts show="…">` tags in the live theme and in its copies, each with its file and line;
//   - the file a brief for an AI is about (`briefFileFor`), from the theme's own file names.

/** The places a row of the admin stands for. `drawer` (the cart drawer) takes no app block in any theme. */
export type WebPlace = "product" | "home" | "cart" | "header" | "card" | "drawer";

/** Can an app block go to the place in this theme? */
export type BlockFits = Record<WebPlace, boolean>;

export interface ScannedTag {
  /** The tag's `show` as written (a typo stays, so the admin can name it). */
  show: string;
  size?: string;
  align?: string;
  product?: string;
  file: string;
  /** 1-based line of the tag in the file (in a JSON file: of the string that holds it). */
  line: number;
}

export interface ScannedTheme {
  /** The numeric theme id (`/admin/themes/<id>`). */
  id: string;
  name: string;
  live: boolean;
  tags: ScannedTag[];
  /** Every Liquid / JSON file was read; false = a read failed or hit the bound (a tag may be missing). */
  complete: boolean;
}

export type ThemeScanView =
  | { state: "no_scope" }
  | { state: "unknown" }
  | {
      state: "ok";
      live: ScannedTheme & { fits: BlockFits; files: string[] };
      /** The newest unpublished copies (at most 3), tags only. */
      copies: ScannedTheme[];
    };

/** The `show` values the embed fills (theme-tags.ts THEME_TAGS). */
export const KNOWN_SHOWS = ["cart", "card-tier", "milestones", "campaign"] as const;
export type KnownShow = (typeof KNOWN_SHOWS)[number];

export function isKnownShow(show: string): show is KnownShow {
  return (KNOWN_SHOWS as readonly string[]).includes(show);
}

const DRAWER_FILE = /(^|\/)(cart-drawer|cart-notification|mini-cart|side-cart)[^/]*\.liquid$/i;
const CART_PAGE_FILE = /(^|\/)(main-cart[^/]*|cart[^/]*)\.(liquid|json)$/i;
const CARD_FILE = /(^|\/)_?(card-product|product-card|product-item|product-grid-item)[^/]*\.liquid$/i;
const HEADER_FILE = /(^|\/)(header[^/]*|announcement[^/]*)\.(liquid|json)$/i;
const PRODUCT_FILE = /(^|\/)(main-product|product-information|product)[^/]*\.(liquid|json)$/i;
const HOME_FILE = /(^|\/)index\.json$/i;

/** The place a tag in this file shows on, as far as the file's name tells; null = somewhere else. */
export function placeOfFile(file: string): WebPlace | null {
  if (DRAWER_FILE.test(file)) return "drawer";
  if (CARD_FILE.test(file)) return "card";
  if (HEADER_FILE.test(file)) return "header";
  if (CART_PAGE_FILE.test(file)) return "cart";
  if (HOME_FILE.test(file)) return "home";
  if (PRODUCT_FILE.test(file)) return "product";
  return null;
}

/**
 * The file a brief for an AI is about, by the theme's own file names (Dawn, Horizon and their kind first); null = no
 * file the app recognises (the brief then asks the merchant to name it).
 */
export function briefFileFor(place: WebPlace, files: readonly string[]): string | null {
  const first = (...names: string[]) => names.find((name) => files.includes(name)) ?? null;
  switch (place) {
    case "drawer":
      return first("snippets/cart-drawer.liquid", "sections/cart-drawer.liquid", "snippets/cart-notification.liquid") ?? (files.find((f) => DRAWER_FILE.test(f)) ?? null);
    case "card":
      return first("snippets/card-product.liquid", "snippets/product-card.liquid", "blocks/_product-card.liquid") ?? (files.find((f) => f.startsWith("snippets/") && CARD_FILE.test(f)) ?? null);
    case "cart":
      return first("sections/main-cart-footer.liquid", "sections/main-cart.liquid", "sections/main-cart-items.liquid", "templates/cart.liquid");
    case "header":
      return first("sections/announcement-bar.liquid", "sections/header-announcements.liquid", "sections/header.liquid", "layout/theme.liquid");
    case "product":
      return first("sections/main-product.liquid", "sections/product-information.liquid", "templates/product.liquid");
    case "home":
      return first("templates/index.liquid", "layout/theme.liquid");
  }
}

/** The theme's code editor on one file. Shopify documents no such link; it is the address its own editor uses. */
export function codeEditorUrl(shop: string, themeId: string, file: string | null): string | null {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop) || !/^\d+$/.test(themeId)) return null;
  const base = `https://${shop}/admin/themes/${themeId}`;
  return file ? `${base}?key=${encodeURIComponent(file)}` : base;
}

/** Where the tags for one `show` stand: in the live theme, only in a copy, or nowhere. */
export type TagPresence = { in: "live"; tags: ScannedTag[] } | { in: "copy"; theme: string; tags: ScannedTag[] } | { in: "none" };

export function tagPresence(scan: ThemeScanView, show: KnownShow, place?: WebPlace): TagPresence {
  if (scan.state !== "ok") return { in: "none" };
  const pick = (tags: readonly ScannedTag[]) => tags.filter((tag) => tag.show === show && (place === undefined || placeOfFile(tag.file) === place));
  const live = pick(scan.live.tags);
  if (live.length) return { in: "live", tags: live };
  for (const copy of scan.copies) {
    const found = pick(copy.tags);
    if (found.length) return { in: "copy", theme: copy.name, tags: found };
  }
  return { in: "none" };
}

/** Tags with a `show` the embed does not know (a typo): named in the admin so the merchant can fix them. */
export function unknownTags(scan: ThemeScanView): ScannedTag[] {
  return scan.state === "ok" ? scan.live.tags.filter((tag) => !isKnownShow(tag.show)) : [];
}
