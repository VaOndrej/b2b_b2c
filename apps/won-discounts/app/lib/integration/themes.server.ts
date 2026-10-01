// The live theme and the storefront config, as the Množstevní slevy / Vzhled
// screens and the Přehled card need them (MVP 3):
//
//   readThemeLook(ctx)       ONE read of the MAIN theme (read_themes):
//                            config/settings_data.json → ThemeTokensView for the
//                            faithful preview (C5 fallback: the theme's own fonts,
//                            colors and radius; the preview then runs the SAME
//                            CSS as the storefront), templates/product*.json →
//                            is the quantity_tiers app block there (TiersBlockView,
//                            with the addAppBlockId deep link when it is not).
//                            Cached per shop for SIGNAL_CACHE_TTL_MS like the
//                            embed check (the same cache, cachedRead below);
//   readStorefrontSync(ctx)  the app-data metafield `won_discounts/storefront_config`
//                            (K5) → StorefrontSyncView: its `cv` against the
//                            stored config's version token (F12, the token the
//                            sync writes into `cv`);
//   readPreviewProduct(ctx)  a real product for the preview and "Zobrazit na
//                            mém webu" (for a Pro set: one it applies to).
//
// Every read degrades on its own (REL-1): a failed read is "unknown", never an
// error page; an auth failure (a thrown Response) is passed on so the route can
// re-authenticate. Theme values reach a `style` only through the strict
// patterns below (hex / rgb() colors, font handles of letters and digits).
// Queries validated against Admin API 2026-04 with the Shopify dev MCP.

import { tiersBlockAddUrl } from "../../components/model/embed";
import type { MarketNames } from "../../components/model/markets";
import { toMinorUnits } from "@won/core/discounts/money";

import type {
  PreviewProductView,
  StorefrontSyncView,
  SyncView,
  ThemeTokensView,
  TiersBlockView,
  TierScopeView,
} from "../../components/model/types";
import type { AdminClient } from "../admin-client.server";
import { canReadMarkets } from "../sync/save-and-sync.server";
import { shopLocalDateTime } from "../sync/sync.server";

// --- The short per-shop read cache (shared with the embed check in ui-actions.server.ts) ----------------

/** How long a theme / market read is reused (PERF-1, API-3): a reload doesn't re-read themes. */
export const SIGNAL_CACHE_TTL_MS = 60_000;

const signalCache = new Map<string, { at: number; value: unknown }>();

/** `load()` once per `key` within SIGNAL_CACHE_TTL_MS (`fresh` re-reads). */
export async function cachedRead<T>(key: string, load: () => Promise<T>, opts: { fresh?: boolean; now?: number } = {}): Promise<T> {
  const now = opts.now ?? Date.now();
  const hit = signalCache.get(key);
  if (!opts.fresh && hit && now - hit.at < SIGNAL_CACHE_TTL_MS) return hit.value as T;
  const value = await load();
  signalCache.set(key, { at: now, value });
  if (signalCache.size > 5000) signalCache.delete(signalCache.keys().next().value as string);
  return value;
}

/** Test hook: forget every cached read. */
export function clearReadCache(): void {
  signalCache.clear();
}

// --- Shop context and market names (every admin screen; moved here from ui-actions.server.ts) ----------------

/** Admin GraphQL as a plain function (`admin.graphql` adapted by the route; a fake in tests). */
export type AdminGraphqlFn = (query: string, variables?: Record<string, unknown>) => Promise<unknown>;

export interface ShopContext {
  currencyCode: string | null;
  /** IANA zone, e.g. "Europe/Prague". */
  timezone: string | null;
}

/** Shop currency + time zone (schedule days, "today" in Vyzkoušet košík). Degrades to nulls (REL-1). */
export async function readShopContext(graphql: AdminGraphqlFn): Promise<ShopContext> {
  try {
    const json = (await graphql(`#graphql
      query WonDiscountsShopContext { shop { currencyCode ianaTimezone } }`)) as {
      data?: { shop?: { currencyCode?: unknown; ianaTimezone?: unknown } };
    };
    const shop = json?.data?.shop;
    const currency = typeof shop?.currencyCode === "string" && /^[A-Z]{3}$/.test(shop.currencyCode) ? shop.currencyCode : null;
    const tz = typeof shop?.ianaTimezone === "string" && shop.ianaTimezone ? shop.ianaTimezone : null;
    return { currencyCode: currency, timezone: tz };
  } catch {
    return { currencyCode: null, timezone: null };
  }
}

/**
 * The shop's market names by handle (read_markets — an OPTIONAL scope, item 9),
 * so the admin shows "Česko", not "cz" (§4c). Without the scope (known from
 * the session), or when the read fails, {} — the UI then falls back to the handle.
 */
export async function readMarketNames(graphql: AdminGraphqlFn, shop: string, scopes?: string | null): Promise<MarketNames> {
  if (!canReadMarkets(scopes)) return {};
  return cachedRead(`markets:${shop}`, async () => {
    try {
      const json = (await graphql(`#graphql
        query WonDiscountsMarketNames { markets(first: 50) { nodes { handle name } } }`)) as {
        data?: { markets?: { nodes?: { handle?: unknown; name?: unknown }[] } };
      };
      const out: Record<string, string> = {};
      for (const node of json?.data?.markets?.nodes ?? []) {
        if (typeof node?.handle === "string" && typeof node?.name === "string" && node.name.trim()) out[node.handle] = node.name;
      }
      return out;
    } catch {
      return {};
    }
  });
}

// --- Parsing theme files (pure) -----------------------------------------------------------------------

/** A theme JSON file → its value. Shopify prepends a generated `/* … *\/` comment that is not JSON; junk → null. */
export function parseThemeJson(content: string | null | undefined): unknown {
  if (typeof content !== "string" || content.trim() === "") return null;
  const text = content.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** Only colors that are safe in a `style` attribute: #rgb[a] / #rrggbb[aa] / rgb[a](numbers). */
const SAFE_COLOR = /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|rgba?\(\s*[\d.]+%?\s*,?\s*[\d.]+%?\s*,?\s*[\d.]+%?\s*(?:[,/]\s*[\d.]+%?\s*)?\))$/i;
const LIQUID_REF = /^\{\{\s*settings\.([A-Za-z0-9_]+)(?:\.([A-Za-z0-9_]+))?\s*\}\}$/;
/** Shopify font handles: `inter_n4`, `dm_sans_i7`. */
const FONT_HANDLE = /^([a-z0-9]+(?:_[a-z0-9]+)*)_[nio][1-9]$/;

/** A color setting, following Horizon's Liquid references (`{{ settings.color_palette.foreground }}`) a few levels. */
function colorOf(value: unknown, current: Rec, depth = 0): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const ref = LIQUID_REF.exec(text);
  if (ref && depth < 3) {
    const first = current[ref[1]!];
    return colorOf(ref[2] ? (isRec(first) ? first[ref[2]] : undefined) : first, current, depth + 1);
  }
  return SAFE_COLOR.test(text) ? text : null;
}

/** `inter_n4` → "Inter", `dm_sans_n4` → "Dm Sans" (CSS family names are case-insensitive). */
function fontOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = FONT_HANDLE.exec(value.trim());
  if (!m) return null;
  return m[1]!
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function numberOf(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,3}(?:\.\d+)?$/.test(value.trim()) ? Number(value) : Number.NaN;
  return Number.isFinite(n) && n >= 0 && n <= 200 ? n : null;
}

/** settings_data.json's `current` (a preset name when the theme was never customised → that preset). */
function currentSettings(data: unknown): Rec | null {
  if (!isRec(data)) return null;
  const current = data.current;
  if (isRec(current)) return current;
  if (typeof current === "string" && isRec(data.presets) && isRec(data.presets[current])) return data.presets[current] as Rec;
  return null;
}

/** The product template's main section `color_scheme` setting (Dawn), if any. */
function productScheme(template: string | null | undefined): string | null {
  const data = parseThemeJson(template);
  if (!isRec(data) || !isRec(data.sections)) return null;
  const main = data.sections.main;
  const scheme = isRec(main) && isRec(main.settings) ? main.settings.color_scheme : undefined;
  return typeof scheme === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(scheme) ? scheme : null;
}

/**
 * The theme's look for the preview: body / heading font, text and background
 * color (Horizon: the palette the page colors reference; Dawn: the color scheme
 * of the product section, else the first scheme), the input radius (what the
 * block's CSS uses for its corners) and the body text size. `blockAccent` = the block's own `accent` setting — the only
 * accent the storefront CSS uses (default: the text color, `currentColor`).
 * null when settings_data cannot be read.
 */
export function themeTokensFrom(input: {
  themeName: string | null;
  settingsData: string | null;
  productTemplate?: string | null;
  blockAccent?: string | null;
}): ThemeTokensView | null {
  const current = currentSettings(parseThemeJson(input.settingsData));
  if (!current) return null;
  let colorText = colorOf(current.page_text_color, current);
  let colorBackground = colorOf(current.page_background_color, current);
  const palette = current.color_palette;
  if (isRec(palette)) {
    colorText ??= colorOf(palette.foreground, current);
    colorBackground ??= colorOf(palette.background, current);
  }
  const schemes = current.color_schemes;
  if (isRec(schemes)) {
    const name = productScheme(input.productTemplate);
    const scheme = (name && isRec(schemes[name]) ? schemes[name] : schemes[Object.keys(schemes)[0] ?? ""]) as unknown;
    const settings = isRec(scheme) && isRec(scheme.settings) ? scheme.settings : null;
    if (settings) {
      colorText ??= colorOf(settings.text ?? settings.foreground, current);
      colorBackground ??= colorOf(settings.background, current);
    }
  }
  const bodyScale = numberOf(current.body_scale);
  const paragraph = numberOf(current.type_size_paragraph);
  return {
    themeName: input.themeName && input.themeName.trim() ? input.themeName.trim() : null,
    fontBody: fontOf(current.type_body_font),
    fontHeading: fontOf(current.type_heading_font ?? current.type_header_font),
    colorText,
    colorBackground,
    colorAccent: colorOf(input.blockAccent, current),
    // The input radius: the one the storefront CSS takes (--style-border-radius-inputs on Horizon, --inputs-radius on Dawn).
    radius: numberOf(current.inputs_border_radius ?? current.inputs_radius),
    fontSize: paragraph ?? (bodyScale !== null ? Math.round(16 * (bodyScale / 100) * 10) / 10 : null),
  };
}

const TIERS_BLOCK_TYPE = "/blocks/quantity_tiers/";

/** Every enabled block of a section / block, however deep (Horizon nests blocks in blocks). */
function* enabledBlocks(node: Rec): Generator<Rec> {
  const blocks = node.blocks;
  if (!isRec(blocks)) return;
  for (const block of Object.values(blocks)) {
    if (!isRec(block) || block.disabled === true) continue;
    yield block;
    yield* enabledBlocks(block);
  }
}

/**
 * Is the quantity_tiers app block on a product template (type
 * `shopify://apps/<app>/blocks/quantity_tiers/<uuid>`, contract F-T3)? Enabled
 * block in an enabled section only; with its `accent` setting when it has one.
 */
export function tiersBlockIn(templates: readonly { filename: string; content: string | null }[]): { on: boolean; accent: string | null; template: string | null } {
  for (const file of templates) {
    if (!/^templates\/product(?:\.[^/]+)?\.json$/.test(file.filename)) continue;
    const data = parseThemeJson(file.content);
    if (!isRec(data) || !isRec(data.sections)) continue;
    for (const section of Object.values(data.sections)) {
      if (!isRec(section) || section.disabled === true) continue;
      for (const block of enabledBlocks(section)) {
        if (typeof block.type !== "string" || !block.type.includes(TIERS_BLOCK_TYPE)) continue;
        const accent = isRec(block.settings) && typeof block.settings.accent === "string" && SAFE_COLOR.test(block.settings.accent.trim()) ? block.settings.accent.trim() : null;
        return { on: true, accent, template: file.filename };
      }
    }
  }
  return { on: false, accent: null, template: null };
}

// --- Reading the MAIN theme ------------------------------------------------------------------------------------

/** Validated against Admin 2026-04 (Shopify dev MCP); needs read_themes. */
export const THEME_LOOK_DOCUMENT = `#graphql
query WonTiersThemeLook {
  themes(roles: [MAIN], first: 1) {
    nodes {
      id
      name
      files(filenames: ["config/settings_data.json", "templates/product*.json"], first: 50) {
        nodes {
          filename
          body {
            ... on OnlineStoreThemeFileBodyText {
              content
            }
          }
        }
      }
    }
  }
}`;

export interface ThemeLook {
  tokens: ThemeTokensView | null;
  block: TiersBlockView;
}

interface LookCtx {
  shop: string;
  client: Pick<AdminClient, "graphql">;
  apiKey: string;
}

function hasScope(scopes: string | null | undefined, scope: string): boolean {
  return (scopes ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes(scope);
}

async function loadThemeLook(ctx: LookCtx): Promise<ThemeLook> {
  const addUrl = tiersBlockAddUrl(ctx.shop, ctx.apiKey);
  try {
    const result = await ctx.client.graphql<{
      themes?: { nodes?: { name?: string; files?: { nodes?: { filename?: string; body?: { content?: string } | null }[] } }[] };
    }>(THEME_LOOK_DOCUMENT);
    const theme = result.data?.themes?.nodes?.[0];
    if (!theme) return { tokens: null, block: { state: "unknown", addUrl } };
    const files = (theme.files?.nodes ?? [])
      .filter((f): f is { filename: string; body?: { content?: string } | null } => typeof f?.filename === "string")
      .map((f) => ({ filename: f.filename, content: typeof f.body?.content === "string" ? f.body.content : null }));
    const settings = files.find((f) => f.filename === "config/settings_data.json")?.content ?? null;
    const templates = files.filter((f) => f.filename.startsWith("templates/product"));
    const found = tiersBlockIn(templates);
    const mainTemplate = templates.find((f) => f.filename === (found.template ?? "templates/product.json"))?.content ?? null;
    const themeName = typeof theme.name === "string" ? theme.name : null;
    const tokens = themeTokensFrom({ themeName, settingsData: settings, productTemplate: mainTemplate, blockAccent: found.accent });
    if (templates.length === 0) return { tokens, block: { state: "unknown", addUrl } };
    return { tokens, block: found.on ? { state: "on", themeName: themeName ?? "" } : { state: "off", addUrl } };
  } catch (error) {
    if (error instanceof Response) throw error;
    return { tokens: null, block: { state: "unknown", addUrl } };
  }
}

/** The live theme's look + the block (see the header). Without read_themes: nothing is read. */
export async function readThemeLook(ctx: LookCtx, opts: { scopes: string | null | undefined; fresh?: boolean }): Promise<ThemeLook> {
  if (!hasScope(opts.scopes, "read_themes")) return { tokens: null, block: { state: "no_scope" } };
  return cachedRead(`theme-look:${ctx.shop}`, () => loadThemeLook(ctx), { fresh: opts.fresh });
}

// --- The storefront config metafield (K5) --------------------------------------------------------------------

/** Validated against Admin 2026-04 (Shopify dev MCP). App-data metafields use a plain namespace (K5). */
export const STOREFRONT_CONFIG_DOCUMENT = `#graphql
query WonTiersStorefrontConfig {
  currentAppInstallation {
    metafield(namespace: "won_discounts", key: "storefront_config") {
      jsonValue
      updatedAt
    }
  }
}`;

/** The state line from the facts (pure; see StorefrontSyncView). */
export function storefrontSyncViewOf(input: {
  metafield: { cv: string | null; updatedAt: string | null } | null;
  configVersion: string | null;
  sync: SyncView;
  timezone: string | null;
}): StorefrontSyncView {
  const { metafield, configVersion, sync } = input;
  const current = metafield !== null && metafield.cv !== null && configVersion !== null && metafield.cv === configVersion;
  if (current) {
    const at = metafield.updatedAt ? new Date(metafield.updatedAt) : null;
    return { state: "synced", at: at && !Number.isNaN(at.getTime()) ? shopLocalDateTime(at, input.timezone ?? "UTC") : "" };
  }
  if (sync.state === "error") return { state: "failed", at: sync.at, problems: sync.problems ?? [], previous: metafield !== null };
  return metafield === null ? { state: "missing" } : { state: "pending" };
}

/** The metafield as Shopify holds it now (`cv` + when it was written); read failures → unknown. */
export async function readStorefrontSync(
  ctx: { client: Pick<AdminClient, "graphql"> },
  input: { configVersion: string | null; sync: SyncView; timezone: string | null },
): Promise<StorefrontSyncView> {
  try {
    const result = await ctx.client.graphql<{ currentAppInstallation?: { metafield?: { jsonValue?: unknown; updatedAt?: string } | null } | null }>(
      STOREFRONT_CONFIG_DOCUMENT,
    );
    if (result.data?.currentAppInstallation === undefined || result.data.currentAppInstallation === null) return { state: "unknown" };
    const field = result.data.currentAppInstallation.metafield ?? null;
    const value = field ? (typeof field.jsonValue === "string" ? parseThemeJson(field.jsonValue) : field.jsonValue) : null;
    const cv = isRec(value) && typeof value.cv === "string" ? value.cv : null;
    return storefrontSyncViewOf({
      metafield: field ? { cv, updatedAt: typeof field.updatedAt === "string" ? field.updatedAt : null } : null,
      ...input,
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    return { state: "unknown" };
  }
}

// --- A real product for the preview ---------------------------------------------------------------------------

const PREVIEW_FIELDS = `id
      title
      handle
      onlineStoreUrl
      variants(first: 1) {
        nodes {
          price
        }
      }`;

const SHOP_FIELDS = `shop {
    currencyCode
    currencyFormats {
      moneyFormat
    }
  }`;

/**
 * Validated against Admin 2026-04 (Shopify dev MCP); needs read_products. Up to
 * 10 recent active products with the product metafield the sync writes: the
 * whole-store set's preview takes one WITHOUT a Pro `tierRef` (a product with
 * one gets its own set, or — an inert set on Free, or junk — no tier at all).
 */
export const PREVIEW_PRODUCT_DOCUMENT = `#graphql
query WonTiersPreviewProduct($query: String) {
  ${SHOP_FIELDS}
  products(first: 10, query: $query, sortKey: UPDATED_AT, reverse: true) {
    nodes {
      ${PREVIEW_FIELDS}
      wonRefs: metafield(namespace: "$app:won_discounts", key: "product") {
        value
      }
    }
  }
}`;

export const PREVIEW_PRODUCT_BY_ID_DOCUMENT = `#graphql
query WonTiersPreviewProductById($id: ID!) {
  ${SHOP_FIELDS}
  product(id: $id) {
    ${PREVIEW_FIELDS}
  }
}`;

export const PREVIEW_COLLECTION_PRODUCT_DOCUMENT = `#graphql
query WonTiersPreviewCollectionProduct($id: ID!) {
  ${SHOP_FIELDS}
  collection(id: $id) {
    products(first: 1) {
      nodes {
        ${PREVIEW_FIELDS}
      }
    }
  }
}`;

interface RawProduct {
  id?: string;
  title?: string;
  onlineStoreUrl?: string | null;
  variants?: { nodes?: { price?: string }[] };
  wonRefs?: { value?: string | null } | null;
}

/** The product metafield names a Pro tier set (any `tierRef` key: a set of its own, or no tier at all). */
function hasTierRef(product: RawProduct): boolean {
  const value = product.wonRefs?.value;
  if (typeof value !== "string" || value === "") return false;
  const parsed = parseThemeJson(value);
  return isRec(parsed) && Object.prototype.hasOwnProperty.call(parsed, "tierRef");
}
interface RawShop {
  currencyCode?: string;
  currencyFormats?: { moneyFormat?: string };
}

function previewProductOf(shop: RawShop | undefined, product: RawProduct | null | undefined): PreviewProductView | null {
  const currency = shop?.currencyCode;
  const price = product?.variants?.nodes?.[0]?.price;
  if (!product?.id || typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency) || typeof price !== "string") return null;
  const unitPrice = toMinorUnits(price, currency);
  if (unitPrice === null) return null;
  const url = typeof product.onlineStoreUrl === "string" && /^https:\/\//.test(product.onlineStoreUrl) ? product.onlineStoreUrl : null;
  const moneyFormat = typeof shop?.currencyFormats?.moneyFormat === "string" ? shop.currencyFormats.moneyFormat : null;
  return { productId: product.id, title: product.title ?? "", unitPrice, currency, url, moneyFormat };
}

/**
 * A real product the SHOWN set applies to, for the preview and "Zobrazit na
 * mém webu" (review fix 2): for a Pro set the first of its products (else a
 * product of its first collection); for the whole-store set one of the 10 most
 * recently updated active products that has no Pro `tierRef` (K1: a product
 * with one never gets the whole-store set). `url` = its Online Store URL (null
 * when it is not published there). null when there is none to show or the read
 * failed — the preview then shows its labelled sample product.
 */
export async function readPreviewProduct(ctx: { client: Pick<AdminClient, "graphql"> }, scope?: TierScopeView | null): Promise<PreviewProductView | null> {
  try {
    if (scope?.kind === "selection" && scope.products.length > 0) {
      const r = await ctx.client.graphql<{ shop?: RawShop; product?: RawProduct | null }>(PREVIEW_PRODUCT_BY_ID_DOCUMENT, { id: scope.products[0]!.id });
      const found = previewProductOf(r.data?.shop, r.data?.product);
      if (found) return found;
    }
    if (scope?.kind === "selection" && scope.collections.length > 0) {
      const r = await ctx.client.graphql<{ shop?: RawShop; collection?: { products?: { nodes?: RawProduct[] } } | null }>(PREVIEW_COLLECTION_PRODUCT_DOCUMENT, {
        id: scope.collections[0]!.id,
      });
      const found = previewProductOf(r.data?.shop, r.data?.collection?.products?.nodes?.[0]);
      if (found) return found;
    }
    if (scope?.kind === "selection") return null;
    const r = await ctx.client.graphql<{ shop?: RawShop; products?: { nodes?: RawProduct[] } }>(PREVIEW_PRODUCT_DOCUMENT, { query: "status:active" });
    for (const node of r.data?.products?.nodes ?? []) {
      if (hasTierRef(node)) continue;
      const found = previewProductOf(r.data?.shop, node);
      if (found) return found;
    }
    return null;
  } catch (error) {
    if (error instanceof Response) throw error;
    return null;
  }
}
