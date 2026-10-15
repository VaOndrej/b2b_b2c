// Umístění na webu (balík E): reading the themes for where the app's pieces can go and where the merchant put a tag.
//
//   readThemeScan(ctx)  the live theme and its newest unpublished copies (at most 3, read_themes):
//                       - every Liquid file and every JSON template / section group: the `<won-discounts show="…">`
//                         tags in it (a "Custom Liquid" section keeps its code in the template's JSON), outside
//                         `{% comment %}`, `{% doc %}` and HTML comments;
//                       - the section and theme-block schemas: which take an app block (`"type": "@app"`), so the
//                         admin knows whether a place takes a block (model/theme-scan.ts BlockFits);
//                       - the live theme's tags → ShopSyncState.themeTags (core themeTagsPart, the config's `tg`);
//                         a change there is a resync (resyncIfPending "theme"), so the embed prints their HTML.
//
// Cost (14 Oct 2026, Admin 2026-04): one query lists a theme's files with their `checksumMd5` (`first` up to 2 500;
// Horizon has 262 Liquid files, 2.4 MB, Dawn 98, 1.1 MB). Bodies are read only for checksums this process has not
// seen, 50 names a query, paged when Shopify trims the answer for its size — and what a file holds is remembered by
// its checksum, so a copy of the live theme costs one query and a re-read costs one query a theme. At most
// MAX_BODY_QUERIES body queries a theme: beyond that the theme is marked incomplete and nothing is concluded from
// its absence. Every read degrades on its own (REL-1); an auth failure (a thrown Response) is passed on.

import { themeTagsPart, type StorefrontThemeTags } from "@won/core/discounts/storefront-config";

import { THEME_TAG } from "../../components/model/theme-tags";
import type { BlockFits, ScannedTag, ScannedTheme, ThemeScanView } from "../../components/model/theme-scan";
import type { PrismaClient } from "../../generated/prisma/client";
import type { AdminClient } from "../admin-client.server";
import { recordThemeTags } from "../sync/sync-state.server";
import { cachedRead, parseThemeJson } from "./themes.server";

// --- Reading one file (pure) -----------------------------------------------------------------------------------

/** Comments, doc blocks and schemas blanked out with their newlines kept, so a tag's line stays its line. */
export function blankComments(content: string): string {
  const blank = (match: string) => match.replace(/[^\n]/g, " ");
  return content
    .replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, blank)
    .replace(/\{%-?\s*doc\s*-?%\}[\s\S]*?\{%-?\s*enddoc\s*-?%\}/g, blank)
    .replace(/\{%-?\s*schema\s*-?%\}[\s\S]*?\{%-?\s*endschema\s*-?%\}/g, blank)
    .replace(/\{%-?\s*#[^%]*-?%\}/g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
}

/** A JSON file's text with the escapes a tag's markup gets inside a JSON string undone (newlines stay where they are). */
function unescapeJsonMarkup(content: string): string {
  return content
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u0027/gi, "'")
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/");
}

const TAG_OPEN = new RegExp(`<${THEME_TAG}\\b([^>]*)>`, "gi");
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

/** The `<won-discounts …>` tags of one file, in order, with their line. */
export function tagsIn(filename: string, content: string): ScannedTag[] {
  const text = blankComments(filename.endsWith(".json") ? unescapeJsonMarkup(content) : content);
  const out: ScannedTag[] = [];
  for (const match of text.matchAll(TAG_OPEN)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[1]!.matchAll(ATTR)) attrs[attr[1]!.toLowerCase()] = (attr[2] ?? attr[3] ?? attr[4] ?? "").trim();
    const line = text.slice(0, match.index).split("\n").length;
    out.push({
      show: attrs.show ?? "",
      ...(attrs.size !== undefined ? { size: attrs.size } : {}),
      ...(attrs.align !== undefined ? { align: attrs.align } : {}),
      ...(attrs.product !== undefined ? { product: attrs.product } : {}),
      file: filename,
      line,
    });
  }
  return out;
}

/** Does the section's / theme block's schema take app blocks (`{"type": "@app"}` among its blocks)? */
export function acceptsAppBlocks(content: string): boolean {
  const schema = /\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/.exec(content)?.[1];
  return schema !== undefined && /"type"\s*:\s*"@app"/.test(schema);
}

/** The section types a JSON template / section group uses (its `sections.*.type`). */
function sectionTypesIn(content: string): string[] {
  const data = parseThemeJson(content);
  if (typeof data !== "object" || data === null || Array.isArray(data)) return [];
  const sections = (data as { sections?: unknown }).sections;
  if (typeof sections !== "object" || sections === null) return [];
  const out: string[] = [];
  for (const section of Object.values(sections as Record<string, unknown>)) {
    const type = typeof section === "object" && section !== null ? (section as { type?: unknown }).type : undefined;
    if (typeof type === "string" && /^[\w-]+$/.test(type) && !out.includes(type)) out.push(type);
  }
  return out;
}

/** The handles of this app's blocks a JSON template / section group holds, enabled, at any depth (Horizon nests blocks). */
function appBlocksIn(content: string): string[] {
  const data = parseThemeJson(content);
  const out: string[] = [];
  const walk = (node: unknown, depth: number) => {
    if (depth > 12 || typeof node !== "object" || node === null) return;
    const rec = node as { disabled?: unknown; type?: unknown; blocks?: unknown; sections?: unknown };
    if (rec.disabled === true) return;
    const handle = typeof rec.type === "string" ? /^shopify:\/\/apps\/[^/]+\/blocks\/([\w-]+)\//.exec(rec.type)?.[1] : undefined;
    if (handle && !out.includes(handle)) out.push(handle);
    for (const child of [rec.blocks, rec.sections]) if (typeof child === "object" && child !== null) for (const value of Object.values(child)) walk(value, depth + 1);
  };
  walk(data, 0);
  return out;
}

/** What the app keeps of one file: no content, only what it found. */
export interface FileFacts {
  tags: ScannedTag[];
  /** A Liquid section / theme block whose schema takes app blocks. */
  app: boolean;
  /** JSON: the section types it uses. */
  sections: string[];
  /** JSON: the app blocks in it by handle (any app's: the handle is checked against this app's by the caller). */
  appBlocks: string[];
  /** The cart drawer the cart script finds by itself (won-discounts-cart.js DRAWERS: both positions), or absent. */
  drawer?: "horizon" | "dawn";
}

/**
 * Is this the cart drawer of Horizon or Dawn, with every element the cart script places its panel in (above the
 * checkout button and at the top)? Zásuvka košíku, varianta 1 (15 Oct 2026): only these two are placed by themselves.
 */
export function drawerOf(filename: string, content: string): "horizon" | "dawn" | undefined {
  if (filename !== "snippets/cart-drawer.liquid") return undefined;
  if (content.includes("<cart-drawer-component") && content.includes('class="cart-drawer__summary"') && content.includes('class="cart-drawer__content"')) return "horizon";
  if (content.includes('id="CartDrawer"') && content.includes('class="drawer__footer"') && content.includes("<cart-drawer-items")) return "dawn";
  return undefined;
}

export function factsOf(filename: string, content: string): FileFacts {
  const json = filename.endsWith(".json");
  const drawer = drawerOf(filename, content);
  return { tags: tagsIn(filename, content), app: !json && acceptsAppBlocks(content), sections: json ? sectionTypesIn(content) : [], appBlocks: json ? appBlocksIn(content) : [], ...(drawer ? { drawer } : {}) };
}

/**
 * Where an app block can go in a theme, from its files' facts: a JSON product / cart template whose sections take
 * app blocks (a template whose sections do not still takes an Apps section, so the page counts), a JSON home page,
 * the header group, a product card that is a theme block taking app blocks (Horizon). The cart drawer never.
 */
export function blockFitsOf(files: ReadonlyMap<string, FileFacts>): BlockFits {
  const template = (name: string) => files.has(`templates/${name}.json`);
  return {
    product: template("product"),
    home: template("index"),
    cart: template("cart"),
    header: files.has("sections/header-group.json"),
    card: [...files].some(([name, facts]) => facts.app && /^(blocks|sections)\/_?product-card[^/]*\.liquid$/.test(name)),
    drawer: false,
  };
}

/** Where each app block handle is (the files that hold it, JSON templates and section groups). */
export function appBlocksByFile(files: ReadonlyMap<string, FileFacts>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [name, facts] of files) for (const handle of facts.appBlocks) (out[handle] ??= []).push(name);
  for (const list of Object.values(out)) list.sort();
  return out;
}

/** The live theme's tags as the storefront config's `tg` (core themeTagsPart: sizes in order, unknown → compact). */
export function themeTagsOfScan(tags: readonly ScannedTag[]): StorefrontThemeTags | null {
  const found = {
    milestones: tags.filter((tag) => tag.show === "milestones").map((tag) => tag.size ?? ""),
    campaign: tags.some((tag) => tag.show === "campaign"),
    card: tags.some((tag) => tag.show === "card-tier"),
    tiers: tags.some((tag) => tag.show === "tiers"),
    outlet: tags.some((tag) => tag.show === "outlet"),
  };
  return themeTagsPart(found).tg ?? null;
}

// --- Reading a theme -------------------------------------------------------------------------------------------

/** The files a tag or a schema can be in: Liquid, JSON templates and section groups (validated, Admin 2026-04). */
export const THEME_SCAN_PATTERNS = ["layout/*.liquid", "sections/*.liquid", "sections/*.json", "snippets/*.liquid", "blocks/*.liquid", "templates/*.liquid", "templates/*.json", "templates/customers/*.liquid"];

export const THEME_SCAN_THEMES_DOCUMENT = `#graphql
query WonThemeScanThemes {
  themes(roles: [MAIN, UNPUBLISHED], first: 50) {
    nodes {
      id
      name
      role
      updatedAt
    }
  }
}`;

export const THEME_SCAN_INDEX_DOCUMENT = `#graphql
query WonThemeScanIndex($id: ID!, $after: String) {
  theme(id: $id) {
    files(filenames: ${JSON.stringify(THEME_SCAN_PATTERNS)}, first: 2500, after: $after) {
      nodes {
        filename
        checksumMd5
        size
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

export const THEME_SCAN_BODIES_DOCUMENT = `#graphql
query WonThemeScanBodies($id: ID!, $filenames: [String!]!, $after: String) {
  theme(id: $id) {
    files(filenames: $filenames, first: 50, after: $after) {
      nodes {
        filename
        checksumMd5
        body {
          ... on OnlineStoreThemeFileBodyText {
            content
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}`;

/** Copies read besides the live theme (the newest by `updatedAt`). */
export const MAX_COPIES = 3;
/** Pages of the file list a theme (2 500 names each). */
const MAX_INDEX_QUERIES = 4;
/** Body queries a theme: 50 names each, more when Shopify trims an answer. */
export const MAX_BODY_QUERIES = 30;
const NAMES_PER_QUERY = 50;

/** What a file holds, by its checksum (and its kind: a JSON and a Liquid file are read differently). */
const factsByChecksum = new Map<string, FileFacts>();
const MAX_REMEMBERED = 20_000;

/** Test hook: forget what every file held. */
export function clearThemeScanMemory(): void {
  factsByChecksum.clear();
}

function rememberedKey(filename: string, checksum: string | null): string | null {
  return checksum ? `${checksum}:${filename.endsWith(".json") ? "json" : "liquid"}` : null;
}

/** The facts a file of another name had (the tags named after this file). */
function asFile(facts: FileFacts, filename: string): FileFacts {
  return { ...facts, tags: facts.tags.map((tag) => ({ ...tag, file: filename })) };
}

type Graphql = Pick<AdminClient, "graphql">;
type FilesPage<N> = { theme?: { files?: { nodes?: N[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } | null } | null };

/** One theme: every file's facts, and whether every file was read. */
export async function scanTheme(client: Graphql, themeGid: string): Promise<{ files: Map<string, FileFacts>; complete: boolean }> {
  const index: { filename: string; checksum: string | null }[] = [];
  let after: string | null = null;
  let complete = true;
  for (let page = 0; ; page += 1) {
    if (page === MAX_INDEX_QUERIES) {
      complete = false;
      break;
    }
    const result: { data?: FilesPage<{ filename?: unknown; checksumMd5?: unknown }> | null } = await client.graphql(THEME_SCAN_INDEX_DOCUMENT, { id: themeGid, after });
    const files = result.data?.theme?.files;
    if (!files) return { files: new Map(), complete: false };
    for (const node of files.nodes ?? []) {
      if (typeof node?.filename === "string") index.push({ filename: node.filename, checksum: typeof node.checksumMd5 === "string" && node.checksumMd5 ? node.checksumMd5 : null });
    }
    if (!files.pageInfo?.hasNextPage || !files.pageInfo.endCursor) break;
    after = files.pageInfo.endCursor;
  }

  const out = new Map<string, FileFacts>();
  const unread: string[] = [];
  for (const { filename, checksum } of index) {
    const key = rememberedKey(filename, checksum);
    const known = key ? factsByChecksum.get(key) : undefined;
    if (known) out.set(filename, asFile(known, filename));
    else unread.push(filename);
  }

  let queries = 0;
  for (let i = 0; i < unread.length && complete; i += NAMES_PER_QUERY) {
    const names = unread.slice(i, i + NAMES_PER_QUERY);
    let cursor: string | null = null;
    for (;;) {
      if (queries === MAX_BODY_QUERIES) {
        complete = false;
        break;
      }
      queries += 1;
      const result: { data?: FilesPage<{ filename?: unknown; checksumMd5?: unknown; body?: { content?: unknown } | null }> | null } = await client.graphql(THEME_SCAN_BODIES_DOCUMENT, {
        id: themeGid,
        filenames: names,
        after: cursor,
      });
      const files = result.data?.theme?.files;
      if (!files) {
        complete = false;
        break;
      }
      for (const node of files.nodes ?? []) {
        if (typeof node?.filename !== "string" || typeof node.body?.content !== "string") continue;
        const facts = factsOf(node.filename, node.body.content);
        out.set(node.filename, facts);
        const key = rememberedKey(node.filename, typeof node.checksumMd5 === "string" ? node.checksumMd5 : null);
        if (key) {
          if (factsByChecksum.size >= MAX_REMEMBERED) factsByChecksum.delete(factsByChecksum.keys().next().value as string);
          factsByChecksum.set(key, facts);
        }
      }
      if (!files.pageInfo?.hasNextPage || !files.pageInfo.endCursor) break;
      cursor = files.pageInfo.endCursor;
    }
  }
  if (out.size < index.length) complete = false;
  return { files: out, complete };
}

function themeOf(node: { id: string; name: string; live: boolean }, scanned: { files: Map<string, FileFacts>; complete: boolean }): ScannedTheme {
  const tags = [...scanned.files.values()].flatMap((facts) => facts.tags);
  return { id: node.id.split("/").pop() ?? node.id, name: node.name, live: node.live, tags, complete: scanned.complete };
}

async function loadThemeScan(client: Graphql): Promise<ThemeScanView> {
  try {
    const listed: { data?: { themes?: { nodes?: { id?: unknown; name?: unknown; role?: unknown; updatedAt?: unknown }[] } } | null } = await client.graphql(THEME_SCAN_THEMES_DOCUMENT);
    const nodes = (listed.data?.themes?.nodes ?? []).filter((n): n is { id: string; name: string; role: string; updatedAt?: unknown } => typeof n?.id === "string" && typeof n?.role === "string" && typeof n?.name === "string");
    const main = nodes.find((n) => n.role.toUpperCase() === "MAIN");
    if (!main) return { state: "unknown" };
    const copies = nodes
      .filter((n) => n.role.toUpperCase() === "UNPUBLISHED")
      .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
      .slice(0, MAX_COPIES);
    // The live theme first: a copy of it then costs only its file list.
    const live = await scanTheme(client, main.id);
    if (live.files.size === 0) return { state: "unknown" };
    const copyThemes: ScannedTheme[] = [];
    for (const copy of copies) {
      try {
        copyThemes.push(themeOf({ ...copy, live: false }, await scanTheme(client, copy.id)));
      } catch (error) {
        if (error instanceof Response) throw error;
        // A copy that cannot be read is left out; the live theme still answers.
      }
    }
    return {
      state: "ok",
      live: {
        ...themeOf({ ...main, live: true }, live),
        fits: blockFitsOf(live.files),
        files: [...live.files.keys()].sort(),
        blocks: appBlocksByFile(live.files),
        drawer: [...live.files.values()].find((facts) => facts.drawer)?.drawer ?? null,
      },
      copies: copyThemes,
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    return { state: "unknown" };
  }
}

function hasThemesScope(scopes: string | null | undefined): boolean {
  return (scopes ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes("read_themes");
}

export interface ThemeScanCtx {
  shop: string;
  client: Graphql;
  db: PrismaClient;
}

/**
 * The themes as the admin's placement rows need them (see the header), cached per shop like every theme read. A
 * complete read of the live theme also records its tags (ShopSyncState.themeTags); `tagsChanged` = they differ from
 * the stored ones, so the caller can resync (resyncIfPending) and the storefront config gets the new `tg`.
 */
export async function readThemeScan(ctx: ThemeScanCtx, opts: { scopes: string | null | undefined; fresh?: boolean; now?: () => Date }): Promise<{ scan: ThemeScanView; tagsChanged: boolean }> {
  if (!hasThemesScope(opts.scopes)) return { scan: { state: "no_scope" }, tagsChanged: false };
  const scan = await cachedRead(`theme-scan:${ctx.shop}`, () => loadThemeScan(ctx.client), { fresh: opts.fresh });
  if (scan.state !== "ok" || !scan.live.complete) return { scan, tagsChanged: false };
  try {
    const tagsChanged = await recordThemeTags(ctx.db, ctx.shop, themeTagsOfScan(scan.live.tags), (opts.now ?? (() => new Date()))());
    return { scan, tagsChanged };
  } catch {
    // bookkeeping only: the rows still show what was found
    return { scan, tagsChanged: false };
  }
}
