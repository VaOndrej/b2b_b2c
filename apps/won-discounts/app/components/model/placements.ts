// Umístění na webu (balík E, zadání: klient vybírá místo, ne způsob): every piece of every module and every place it
// can show, one row each, with the ONE way in this theme allows and a state that names its cause. Pure: the server
// gathers the facts (lib/integration/placements.server.ts), the page and the tests share the rows.
//
// The way in: an app block where the theme takes one (`fits`), else the `<won-discounts>` tag — the cart drawer
// always, a product card in a theme whose card takes no block (Dawn). Where a block goes, the tag is the merchant's
// choice ("Chci to jinde"); the button stays the block's.
// The state, first match wins:
//   tag_live   a tag for this piece in the live theme's file for this place;
//   in_theme   the block is in the live theme;
//   tag_copy   a tag only in an unpublished copy ("jen v kopii");
//   missing / unknown  as every placement row says it;
// and over a piece that is there: `embed_off` (a tag needs Won switched on: the embed fills it) and `nothing`
// (it is there, but the module has nothing to show now: no step, no campaign, card prices off).

import { placeOfFile, type KnownShow, type ScannedTag, type ThemeScanView, type WebPlace } from "./theme-scan";

/** The page's route; its forms post there (the dev harness posts to itself). */
export const PLACEMENTS_PATH = "/app/placements";


export type PlacementModule = "tiers" | "rewards" | "campaigns" | "outlet";

export type PieceKey = "tiersTable" | "cardTier" | "msHeader" | "msProduct" | "msDrawer" | "msCart" | "cpHeader" | "cpHome" | "cpProduct" | "outletBadge";

export interface PieceDef {
  key: PieceKey;
  module: PlacementModule;
  place: WebPlace;
  /** The tag that can stand in for the block here; null = none. */
  show: KnownShow | null;
}

/** The pieces in the order of the page: module by module, as the modules come in the nav. */
export const PIECES: readonly PieceDef[] = [
  { key: "tiersTable", module: "tiers", place: "product", show: "tiers" },
  { key: "cardTier", module: "tiers", place: "card", show: "card-tier" },
  { key: "msHeader", module: "rewards", place: "header", show: "milestones" },
  { key: "msProduct", module: "rewards", place: "product", show: "milestones" },
  { key: "msDrawer", module: "rewards", place: "drawer", show: "cart" },
  { key: "msCart", module: "rewards", place: "cart", show: "cart" },
  { key: "outletBadge", module: "outlet", place: "product", show: "outlet" },
  { key: "cpHeader", module: "campaigns", place: "header", show: "campaign" },
  { key: "cpHome", module: "campaigns", place: "home", show: "campaign" },
  { key: "cpProduct", module: "campaigns", place: "product", show: "campaign" },
];

export type EmbedStateLike = "on" | "off" | "draft_only" | "unknown" | "no_scope";

/** Does the module have something to show on the storefront now (the gated storefront config, server side)? */
export type PlacementContent = Record<PlacementModule, boolean> & { cards: boolean };

/** Why a piece that is on the web shows nothing now. */
export type NothingCause = "noSteps" | "noCampaign" | "noTiers" | "noSale" | "cardsOff";

export type PieceState =
  | { at: "tag_live"; tags: ScannedTag[] }
  | { at: "in_theme" }
  | { at: "tag_copy"; theme: string; tags: ScannedTag[] }
  | { at: "missing" }
  | { at: "unknown" };

export interface PieceRow extends PieceDef {
  /** The way in this theme: an app block, or the tag. */
  way: "block" | "tag";
  state: PieceState;
  /** Over a piece that is there: a tag the embed cannot fill (Won off), or nothing to show now. */
  cause: { kind: "embed_off"; draft: boolean } | { kind: "nothing"; why: NothingCause } | null;
}

/** The block facts the theme look already reads (ThemePlacements + the table + the card block). */
export type BlockFound = Partial<Record<PieceKey, boolean>>;

function nothingCause(def: PieceDef, content: PlacementContent): NothingCause | null {
  if (def.key === "cardTier") return !content.tiers ? "noTiers" : !content.cards ? "cardsOff" : null;
  if (content[def.module]) return null;
  return def.module === "rewards" ? "noSteps" : def.module === "campaigns" ? "noCampaign" : def.module === "tiers" ? "noTiers" : "noSale";
}

/** A tag counts for a piece when its file is the piece's place; a tag in any other file is a place of its own (otherTags). */
function tagsFor(tags: readonly ScannedTag[], def: PieceDef): ScannedTag[] {
  return def.show ? tags.filter((tag) => tag.show === def.show && placeOfFile(tag.file) === def.place) : [];
}

export function pieceRows(input: { scan: ThemeScanView; blocks: BlockFound; embed: EmbedStateLike; content: PlacementContent }): PieceRow[] {
  const { scan, blocks, embed, content } = input;
  const fits = scan.state === "ok" ? scan.live.fits : null;
  return PIECES.map((def) => {
    // Unknown theme: the block, as before the read existed; the drawer is a tag in every theme.
    const way: PieceRow["way"] = def.place === "drawer" ? "tag" : fits && !fits[def.place] && def.show ? "tag" : "block";
    const live = scan.state === "ok" ? tagsFor(scan.live.tags, def) : [];
    const copy = scan.state === "ok" ? scan.copies.map((theme) => ({ theme: theme.name, tags: tagsFor(theme.tags, def) })).find((c) => c.tags.length > 0) : undefined;
    const found = blocks[def.key];
    let state: PieceState;
    if (live.length) state = { at: "tag_live", tags: live };
    else if (found === true) state = { at: "in_theme" };
    else if (copy) state = { at: "tag_copy", theme: copy.theme, tags: copy.tags };
    else if (way === "tag" ? scan.state === "ok" && scan.live.complete : found === false) state = { at: "missing" };
    else state = { at: "unknown" };
    let cause: PieceRow["cause"] = null;
    if (state.at === "tag_live" && (embed === "off" || embed === "draft_only")) cause = { kind: "embed_off", draft: embed === "draft_only" };
    else if (state.at === "tag_live" || state.at === "in_theme") {
      const why = nothingCause(def, content);
      if (why) cause = { kind: "nothing", why };
    }
    return { ...def, way, state, cause };
  });
}

/** Tags in the live theme no row stands for: another file (a place of the merchant's own), or a `show` Won does not know. */
export function otherTags(scan: ThemeScanView): ScannedTag[] {
  if (scan.state !== "ok") return [];
  return scan.live.tags.filter((tag) => !PIECES.some((def) => def.show === tag.show && placeOfFile(tag.file) === def.place));
}

/** The row's status pill, as every placement row of the admin says it. */
export function pieceTone(row: PieceRow): "in_theme" | "missing" | "unknown" | "attention" {
  if (row.cause?.kind === "embed_off" || row.state.at === "tag_copy") return "attention";
  if (row.state.at === "tag_live" || row.state.at === "in_theme") return "in_theme";
  return row.state.at;
}

// --- The page's data and its form (lib/integration/placements.server.ts) -----------------------------------------

export const PLACEMENTS_FIELD = { intent: "intent", piece: "piece" } as const;
export const PLACEMENTS_INTENT = { check: "check", brief: "brief" } as const;

export interface PieceLinks {
  /** The editor with the block added (or, for the card, the editor on a collection with the steps in the row). */
  add: string | null;
  /** The editor on the block already there (nothing is added). */
  open: string | null;
}

export interface PlacementsScreenData {
  rows: PieceRow[];
  links: Partial<Record<PieceKey, PieceLinks>>;
  /** Tags in the live theme no row stands for (a place of the merchant's own, or a typo). */
  other: ScannedTag[];
  scan: { state: ThemeScanView["state"]; theme: { id: string; name: string; complete: boolean } | null; copies: { id: string; name: string }[] };
  /** The live theme's file each place's brief is about (null = none the app recognises). */
  files: Partial<Record<WebPlace, string | null>>;
  embed: { state: "on" | "off" | "draft_only" | "unknown" | "no_scope"; activateUrl: string | null };
  shop: string;
  /** Tags changed and their resync is still running: the page says the web follows in a moment. */
  syncing: boolean;
}

export type PlacementsResult =
  | { ok: true; kind: "checked" }
  | { ok: true; kind: "brief"; piece: PieceKey; brief: string; file: string | null; read: boolean }
  | { ok: false; reason: "bad_request" | "no_theme" };
