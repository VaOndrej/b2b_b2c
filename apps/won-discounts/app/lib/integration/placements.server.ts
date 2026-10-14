// Umístění na webu (balík E): the page with every piece of every module and every place (model/placements.ts), and
// its two actions. The session shop (SEC-2), the form read on the server (SEC-1).
//
//   loadPlacementsScreen   the theme look (blocks, cached 60 s, shared with the module pages), the theme scan (tags,
//                          where a block fits, the copies), the embed, and whether each module has anything to show
//                          (the gated storefront config, as the sync would build it). Tags that changed in the live
//                          theme start the resync that writes them into the storefront config (`tg`).
//   placementsAction       `check`: read the themes again now ("Zkontrolovat"); `brief`: the brief for an AI with the
//                          file of the live theme it is about, read now (model/theme-brief.ts).

import { gateConfigForPlan } from "@won/core/discounts/plan-gate";
import { buildStorefrontConfig } from "@won/core/discounts/storefront-config";

import {
  CAMPAIGN_BLOCK_HANDLE,
  REWARDS_PROGRESS_BLOCK_HANDLE,
  cartBlockAddUrl,
  collectionEditorUrl,
  editorOpenUrl,
  outletBlockAddUrl,
  placementLinks,
  tiersBlockAddUrl,
} from "../../components/model/embed";
import {
  PIECES,
  PLACEMENTS_FIELD,
  PLACEMENTS_INTENT,
  otherTags,
  pieceRows,
  type BlockFound,
  type PieceKey,
  type PieceLinks,
  type PlacementContent,
  type PlacementsResult,
  type PlacementsScreenData,
} from "../../components/model/placements";
import { composeBrief } from "../../components/model/theme-brief";
import { briefFileFor, isKnownShow, type ThemeScanView, type WebPlace } from "../../components/model/theme-scan";
import type { FormDataLike } from "../../components/model/rule-form";
import { loadConfig } from "../config.server";
import { resyncIfPending } from "../sync/save-and-sync.server";
import { isSyncRunning } from "../sync/sync.server";
import { graphqlOf, nowOf, type ShopCtx } from "./context.server";
import { withinDeadline } from "./deadline";
import { isConfigLocked, tryWithConfigLock } from "./lock.server";
import { ctxPlan } from "./sync-status.server";
import { THEME_SCAN_BODIES_DOCUMENT, readThemeScan } from "./theme-scan.server";
import { readShopContext, readThemeLook } from "./themes.server";
import { loadAdminSignals } from "../ui-actions.server";

/** How long a load or "Zkontrolovat" waits for the resync that writes new tags; the rest runs in the background. */
export const THEME_TAGS_SYNC_DEADLINE_MS = 3_000;

/** Does each module have something to show now: the storefront config the sync would write (gated for the plan). */
export function placementContentOf(config: Parameters<typeof gateConfigForPlan>[0], plan: "free" | "pro", timezone: string | null, now: Date): PlacementContent {
  const built = buildStorefrontConfig(gateConfigForPlan(config, plan).config, { configVersion: "", ...(timezone ? { shopTimezone: timezone } : {}) });
  const setWithBreaks = Object.values(built.tiers.sets).some((set) => set.breaks.length > 0);
  const rewards = built.rewards ? built.rewards.ship !== null || built.rewards.gifts.length > 0 || (built.rewards.disc?.length ?? 0) > 0 : false;
  const nowSec = now.getTime() / 1000;
  return {
    tiers: setWithBreaks,
    rewards,
    campaigns: (built.camps ?? []).some((camp) => camp.e > nowSec),
    outlet: built.ow === 1,
    cards: built.cards === 1,
  };
}

function linksOf(ctx: ShopCtx, look: Awaited<ReturnType<typeof readThemeLook>>): Partial<Record<PieceKey, PieceLinks>> {
  const rewards = placementLinks(ctx.shop, ctx.apiKey, REWARDS_PROGRESS_BLOCK_HANDLE);
  const campaign = placementLinks(ctx.shop, ctx.apiKey, CAMPAIGN_BLOCK_HANDLE);
  const spots = look.placements.spots ?? {};
  const cart = cartBlockAddUrl(ctx.shop, ctx.apiKey);
  const outlet = outletBlockAddUrl(ctx.shop, ctx.apiKey);
  const tiers = tiersBlockAddUrl(ctx.shop, ctx.apiKey);
  const collection = collectionEditorUrl(ctx.shop);
  return {
    tiersTable: { add: tiers, open: editorOpenUrl(tiers, spots.tiersBlock) },
    cardTier: { add: collection, open: collection },
    msHeader: { add: rewards.topBar, open: editorOpenUrl(rewards.topBar) },
    msProduct: { add: rewards.product, open: editorOpenUrl(rewards.product, spots.rewardsProduct) },
    msDrawer: { add: null, open: null },
    msCart: { add: cart, open: editorOpenUrl(cart) },
    outletBadge: { add: outlet, open: editorOpenUrl(outlet, spots.outletBadge) },
    cpHeader: { add: campaign.topBar, open: editorOpenUrl(campaign.topBar) },
    cpHome: { add: campaign.home, open: editorOpenUrl(campaign.home, spots.campaignHome) },
    cpProduct: { add: campaign.product, open: editorOpenUrl(campaign.product, spots.campaignProduct) },
  };
}

function blocksOf(look: Awaited<ReturnType<typeof readThemeLook>>, scan: ThemeScanView): BlockFound {
  const p = look.placements;
  const tiers = look.block.state === "on" ? true : look.block.state === "off" ? false : undefined;
  const card = scan.state === "ok" ? (scan.live.blocks.card_tiers?.length ?? 0) > 0 : undefined;
  const out: BlockFound = { tiersTable: tiers, cardTier: card, msHeader: p.topBarRewards, msProduct: p.rewardsProduct, msCart: p.cartBlock, outletBadge: p.outletBadge, cpHeader: p.topBarCampaign, cpHome: p.campaignHome, cpProduct: p.campaignProduct };
  for (const key of Object.keys(out) as PieceKey[]) if (out[key] === undefined) delete out[key];
  return out;
}

/**
 * New tags in the live theme → the resync that puts them into the storefront config, behind the config lock like
 * every sync (never next to a save or a running sync: those pick the tags up themselves), waiting at most
 * `deadlineMs`. true = it is still running.
 */
async function syncThemeTags(ctx: ShopCtx, deadlineMs: number): Promise<boolean> {
  if (isConfigLocked(ctx.shop) || isSyncRunning(ctx.shop)) return true;
  const attempt = tryWithConfigLock(ctx.shop, () =>
    resyncIfPending({ client: ctx.client, db: ctx.db, shop: ctx.shop, createSync: ctx.createSync, now: ctx.now, logger: ctx.logger, grantedScopes: ctx.scopes, productWrites: "background" }),
  );
  if (attempt.skipped) return true;
  void attempt.result.catch(() => undefined);
  const outcome = await withinDeadline(attempt.result, deadlineMs);
  if (outcome.done && "error" in outcome && outcome.error instanceof Response) throw outcome.error;
  return !outcome.done;
}

export async function loadPlacementsScreen(ctx: ShopCtx, opts: { fresh?: boolean; deadlineMs?: number } = {}): Promise<PlacementsScreenData> {
  const scopes = ctx.scopes ?? "";
  const graphql = graphqlOf(ctx);
  const [loaded, plan, shopContext, signals, look, scanned] = await Promise.all([
    loadConfig(ctx.db, ctx.shop),
    ctxPlan(ctx),
    readShopContext(graphql),
    loadAdminSignals({ shop: ctx.shop, scopes, apiKey: ctx.apiKey, graphql, fresh: opts.fresh }),
    readThemeLook(ctx, { scopes, fresh: opts.fresh }),
    readThemeScan(ctx, { scopes, fresh: opts.fresh, now: ctx.now }),
  ]);
  const syncing = scanned.tagsChanged && loaded.exists ? await syncThemeTags(ctx, opts.deadlineMs ?? THEME_TAGS_SYNC_DEADLINE_MS) : false;
  const scan = scanned.scan;
  const content = placementContentOf(loaded.config, plan, shopContext.timezone, nowOf(ctx));
  const files: Partial<Record<WebPlace, string | null>> = {};
  if (scan.state === "ok") for (const def of PIECES) files[def.place] = briefFileFor(def.place, scan.live.files);
  return {
    rows: pieceRows({ scan, blocks: blocksOf(look, scan), embed: signals.embed.state, content }),
    links: linksOf(ctx, look),
    other: otherTags(scan),
    scan: {
      state: scan.state,
      theme: scan.state === "ok" ? { id: scan.live.id, name: scan.live.name, complete: scan.live.complete } : null,
      copies: scan.state === "ok" ? scan.copies.map((copy) => ({ id: copy.id, name: copy.name })) : [],
    },
    files,
    embed: { state: signals.embed.state, activateUrl: signals.embed.activateUrl },
    shop: ctx.shop,
    syncing,
  };
}

/** One file of the live theme, read now (null = not there or not readable). */
async function readLiveFile(ctx: ShopCtx, themeId: string, file: string): Promise<string | null> {
  try {
    const result = await ctx.client.graphql<{ theme?: { files?: { nodes?: { filename?: unknown; body?: { content?: unknown } | null }[] } | null } | null }>(THEME_SCAN_BODIES_DOCUMENT, {
      id: `gid://shopify/OnlineStoreTheme/${themeId}`,
      filenames: [file],
      after: null,
    });
    const node = result.data?.theme?.files?.nodes?.find((n) => n?.filename === file);
    return typeof node?.body?.content === "string" ? node.body.content : null;
  } catch (error) {
    if (error instanceof Response) throw error;
    return null;
  }
}

export async function placementsAction(ctx: ShopCtx, form: FormDataLike): Promise<PlacementsResult> {
  const intent = form.get(PLACEMENTS_FIELD.intent);
  const scopes = ctx.scopes ?? "";
  if (intent === PLACEMENTS_INTENT.check) {
    const [scanned] = await Promise.all([readThemeScan(ctx, { scopes, fresh: true, now: ctx.now }), readThemeLook(ctx, { scopes, fresh: true })]);
    if (scanned.tagsChanged) await syncThemeTags(ctx, THEME_TAGS_SYNC_DEADLINE_MS);
    return { ok: true, kind: "checked" };
  }
  if (intent !== PLACEMENTS_INTENT.brief) return { ok: false, reason: "bad_request" };
  const def = PIECES.find((p) => p.key === form.get(PLACEMENTS_FIELD.piece));
  if (!def || !def.show || !isKnownShow(def.show)) return { ok: false, reason: "bad_request" };
  const { scan } = await readThemeScan(ctx, { scopes, now: ctx.now });
  if (scan.state !== "ok") return { ok: false, reason: "no_theme" };
  const file = briefFileFor(def.place, scan.live.files);
  const content = file ? await readLiveFile(ctx, scan.live.id, file) : null;
  return { ok: true, kind: "brief", piece: def.key, brief: composeBrief({ show: def.show, place: def.place, themeName: scan.live.name, file, content }), file, read: content !== null };
}
