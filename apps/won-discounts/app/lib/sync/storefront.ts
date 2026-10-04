// The storefront config (MVP 3, contract K5) and what the admin reads about the
// storefront side of the sync.
//
// writeStorefrontConfig (sync.server.ts, right after the shop config is in
// place): core buildStorefrontConfig over the SAME gated config the function
// payload was built from (BILL-1 — `limits.payloadConfig`: gated for the
// shop's plan, a margin collection too large to read folded in exactly as the
// payload folds it), `cv` = the F12 version token (config.server.ts
// configVersionToken) of the stored config the run synced — the admin compares
// it with its own token ("Web má aktuální nastavení"). It goes to an APP-DATA
// metafield: owner = the app's AppInstallation (currentAppInstallation.id),
// plain namespace `won_discounts`, key `storefront_config`, type json.
// Diffed against the value Shopify has (unchanged → no write), written with
// metafieldsSet, read back and compared. Every failure is a failed step
// `storefront_config.write` / `storefront_config.verify` (the admin words it,
// sync-copy.ts; the run is marked failed and resyncIfPending retries it) and
// NEVER stops the discount sync: the AFTER lane runs as usual.
// Why only behind a shop config that is in place: the table on the product
// page must never promise tiers checkout does not run yet — a held or failed
// shop config leaves the previous storefront config in place too.
// The product metafield's `tierRef` (products.ts) and the storefront config
// meet on the page: a tierRef naming a set the config lacks shows no table,
// exactly as the engine gives no tier (K1).
//
// tierProductCounts (admin, Množstevní slevy): how many products carry a Pro
// set, read from the product index (ProductTargetIndex.value, the value the
// sync wrote) — never a Shopify read.

import type { StorefrontConfigV1 } from "@won/core/discounts/storefront-config";

import type { PrismaClient } from "../../generated/prisma/client";
import { configVersionToken, loadConfig } from "../config.server";
import { STOREFRONT_CONFIG_KEY, STOREFRONT_NAMESPACE } from "./graphql";
import { TIER_SENTINEL } from "./products";
import { errorText, userErrorText, type Transport, type UserErrorLike } from "./transport";
import type { ConfigView, SyncDeps, SyncStep } from "./types";
import { canonicalJson, hashText, sameJson } from "./util";

/** Shopify's size limit for a json metafield written with API 2026-04+ (shopify.dev "Metafield limits": 128KB). */
export const STOREFRONT_CONFIG_MAX_BYTES = 128 * 1000;

export const STOREFRONT_WRITE_STEP = "storefront_config.write";
export const STOREFRONT_VERIFY_STEP = "storefront_config.verify";
/** MVP 6.1: the base tier sets put back on the page ahead of a shop config that changes or drops the campaign. */
export const STOREFRONT_CAMPAIGN_OFF_STEP = "storefront_config.campaign_off";

/**
 * `cv` of the storefront config: the F12 token of the stored config the run
 * synced — the ConfigVersion it was saved as (the same `data` string as the
 * ShopConfig row); without one (history pruned), the stored row's token when
 * that row is the config being synced; else a content hash the admin never
 * matches (it then says "not propagated yet" rather than a wrong "current").
 */
export async function storefrontConfigVersion(db: PrismaClient, shop: string, configVersionId: string | null, synced: ConfigView): Promise<string> {
  try {
    if (configVersionId) {
      const row = await db.configVersion.findFirst({ where: { id: configVersionId, shop }, select: { data: true } });
      if (row) return configVersionToken(row.data);
    }
    const loaded = await loadConfig(db, shop);
    if (loaded.exists && !loaded.unreadable && loaded.version !== null && canonicalJson(loaded.config) === canonicalJson(synced)) return loaded.version;
  } catch {
    // bookkeeping only: fall through to the content hash
  }
  return `unsaved:${hashText(canonicalJson(synced))}`;
}

export interface StorefrontWriteArgs {
  deps: Pick<SyncDeps, "db" | "buildStorefrontConfig">;
  transport: Transport;
  shop: string;
  /** The gated config the function payload was built from (sync.server.ts `limits.payloadConfig`). */
  config: ConfigView;
  /** The stored config as the run received it and the ConfigVersion it was saved as (`cv`). */
  stored: ConfigView;
  configVersionId: string | null;
  /** The shop currency (util.ts isoCurrency of `shop.currencyCode`): the margin's K4 v2 key `k` and `cur`; absent = left out. */
  shopCurrency?: string | null;
  /** MVP 6.1 (L7): the campaign whose tier sets the page shows now (core campaignTiersShownAt); null = the base sets. */
  campaignId?: string | null;
  record: (step: SyncStep) => void;
}

type InstallationRead = { currentAppInstallation: { id: string; metafield: { value: string } | null } | null };

/** Step of a gift variant Shopify no longer has (MVP 4, R7): `rewards.variant_missing:<variant GID>`. */
export const GIFT_VARIANT_MISSING_STEP = "rewards.variant_missing";

/** The gift variants of the gated config: every tier's choices and fallback, config order, once each. */
export function giftVariantIds(config: ConfigView): string[] {
  const out: string[] = [];
  for (const tier of config.modules.rewards.gifts) {
    for (const id of [...tier.choices, ...(tier.fallbackVariantId ? [tier.fallbackVariantId] : [])]) if (!out.includes(id)) out.push(id);
  }
  return out;
}

type GiftVariantsRead = { nodes: ({ id?: string; product?: { handle?: string | null } | null } | null)[] };

/**
 * The product handle of every gift variant (R7), read as the app. A variant
 * Shopify does not return (deleted, or not a variant) is a failed step: the
 * storefront cannot show that gift (the function still makes it free), and the
 * admin says which. A failed read leaves every gift out of the storefront
 * config for this run (a failed step; the next sync retries) — never fatal.
 */
async function giftVariantHandles(transport: Transport, ids: readonly string[], record: (step: SyncStep) => void): Promise<Record<string, string>> {
  const handles: Record<string, string> = {};
  if (ids.length === 0) return handles;
  let data: GiftVariantsRead;
  try {
    data = await transport.call("giftVariants", { ids });
  } catch (error) {
    if (error instanceof Response) throw error;
    record({ step: GIFT_VARIANT_MISSING_STEP, ok: false, detail: `could not read the gift variants: ${errorText(error)} — the cart shows no gift until the next sync` });
    return handles;
  }
  ids.forEach((id, i) => {
    const handle = data.nodes?.[i]?.id === id ? data.nodes[i]?.product?.handle : null;
    if (typeof handle === "string" && handle !== "") handles[id] = handle;
    else record({ step: `${GIFT_VARIANT_MISSING_STEP}:${id}`, ok: false, detail: `gift variant ${id} was not found — the cart cannot show it` });
  });
  return handles;
}

/** Write the storefront config (see the header). Never throws, except a re-auth Response. */
export async function writeStorefrontConfig(args: StorefrontWriteArgs): Promise<void> {
  const { transport, record } = args;
  const fail = (step: string, detail: string) => record({ step, ok: false, detail: `${detail} — the product page keeps the previous storefront config; the next sync retries` });
  const variantHandles = await giftVariantHandles(transport, giftVariantIds(args.config), record);
  let json: string;
  try {
    const configVersion = await storefrontConfigVersion(args.deps.db, args.shop, args.configVersionId, args.stored);
    const value: StorefrontConfigV1 = args.deps.buildStorefrontConfig(args.config, {
      configVersion,
      ...(args.shopCurrency ? { shopCurrency: args.shopCurrency } : {}),
      variantHandles,
      ...(args.campaignId ? { campaignId: args.campaignId } : {}),
    });
    json = JSON.stringify(value);
  } catch (error) {
    fail(STOREFRONT_WRITE_STEP, `could not build the storefront config: ${errorText(error)}`);
    return;
  }
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > STOREFRONT_CONFIG_MAX_BYTES) {
    fail(STOREFRONT_WRITE_STEP, `the storefront config is ${bytes} B, over Shopify's ${STOREFRONT_CONFIG_MAX_BYTES} B json metafield limit — not written`);
    return;
  }
  const read = async (): Promise<InstallationRead["currentAppInstallation"]> => {
    const data: InstallationRead = await transport.call("storefrontConfig");
    return data.currentAppInstallation;
  };

  let installation: InstallationRead["currentAppInstallation"];
  try {
    installation = await read();
  } catch (error) {
    if (error instanceof Response) throw error;
    fail(STOREFRONT_WRITE_STEP, `could not read the app installation's storefront config: ${errorText(error)}`);
    return;
  }
  if (!installation?.id) {
    fail(STOREFRONT_WRITE_STEP, "Shopify did not return the app installation, so the storefront config could not be written");
    return;
  }
  if (sameJson(installation.metafield?.value, json)) {
    record({ step: STOREFRONT_WRITE_STEP, ok: true, detail: `unchanged (${bytes} B)` });
    return;
  }

  let refused: string | null;
  try {
    const data: { metafieldsSet: { userErrors: UserErrorLike[] } } = await transport.call("storefrontConfigSet", {
      metafields: [{ ownerId: installation.id, namespace: STOREFRONT_NAMESPACE, key: STOREFRONT_CONFIG_KEY, type: "json", value: json }],
    });
    refused = userErrorText(data.metafieldsSet.userErrors);
  } catch (error) {
    if (error instanceof Response) throw error;
    refused = errorText(error);
  }
  if (refused !== null) {
    fail(STOREFRONT_WRITE_STEP, `could not write the storefront config: ${refused}`);
    return;
  }
  record({ step: STOREFRONT_WRITE_STEP, ok: true, detail: `${bytes} B written` });

  try {
    const back = await read();
    if (!back?.metafield) fail(STOREFRONT_VERIFY_STEP, "the storefront config is missing after the write");
    else if (!sameJson(back.metafield.value, json)) fail(STOREFRONT_VERIFY_STEP, "the storefront config read back differs from the value written");
    else record({ step: STOREFRONT_VERIFY_STEP, ok: true, detail: `read back and verified (${bytes} B)` });
  } catch (error) {
    if (error instanceof Response) throw error;
    fail(STOREFRONT_VERIFY_STEP, `could not read the storefront config back: ${errorText(error)}`);
  }
}

export interface CampaignOffArgs {
  transport: Transport;
  /** What this run will show once its shop config is in place: the tier part of its storefront config. */
  next: Pick<StorefrontConfigV1, "tiers" | "tc">;
  record: (step: SyncStep) => void;
}

/**
 * MVP 6.1 (L7, E4): before the run writes a shop config, take a campaign's tier sets off the product page when the
 * run will not show exactly them again — the campaign was killed, changed, ended, or its window moved (phase 1). The
 * live storefront config carries its own base sets (`bt`): they go back as `tiers`, everything else stays as it is,
 * so the page never shows more than the checkout that is about to change. Nothing on show (no `bt`), or the same
 * campaign with the same sets → no read-modify-write at all. A failure is a failed step and never stops the run
 * (a kill switch must not wait for the storefront); the storefront config behind the shop config writes the base
 * sets again. Never throws, except a re-auth Response.
 */
export async function takeBackCampaignTiers(args: CampaignOffArgs): Promise<void> {
  const { transport, record } = args;
  const fail = (detail: string) => record({ step: STOREFRONT_CAMPAIGN_OFF_STEP, ok: false, detail: `${detail} — the product page may show the campaign's quantity breaks until the storefront config is written again` });
  let installation: InstallationRead["currentAppInstallation"];
  try {
    installation = ((await transport.call("storefrontConfig")) as InstallationRead).currentAppInstallation;
  } catch (error) {
    if (error instanceof Response) throw error;
    fail(`could not read the storefront config: ${errorText(error)}`);
    return;
  }
  let live: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(installation?.metafield?.value ?? "null");
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) live = parsed as Record<string, unknown>;
  } catch {
    // unreadable: nothing of ours is on show
  }
  if (!installation?.id || !live || typeof live.bt !== "object" || live.bt === null) return;
  if (live.tc === args.next.tc && canonicalJson(live.tiers) === canonicalJson(args.next.tiers)) return;
  const base: Record<string, unknown> = { ...live, tiers: live.bt };
  delete base.bt;
  delete base.tc;
  const json = JSON.stringify(base);
  let refused: string | null;
  try {
    const data: { metafieldsSet: { userErrors: UserErrorLike[] } } = await transport.call("storefrontConfigSet", {
      metafields: [{ ownerId: installation.id, namespace: STOREFRONT_NAMESPACE, key: STOREFRONT_CONFIG_KEY, type: "json", value: json }],
    });
    refused = userErrorText(data.metafieldsSet.userErrors);
  } catch (error) {
    if (error instanceof Response) throw error;
    refused = errorText(error);
  }
  if (refused !== null) {
    fail(`could not put the base quantity breaks back: ${refused}`);
    return;
  }
  try {
    const back = ((await transport.call("storefrontConfig")) as InstallationRead).currentAppInstallation;
    if (sameJson(back?.metafield?.value, json)) record({ step: STOREFRONT_CAMPAIGN_OFF_STEP, ok: true, detail: `the base quantity breaks are back on the product page (campaign ${String(live.tc ?? "")})` });
    else fail("the storefront config read back differs from the value written");
  } catch (error) {
    if (error instanceof Response) throw error;
    fail(`could not read the storefront config back: ${errorText(error)}`);
  }
}

/**
 * What a run that applied the shop config did with the storefront config:
 * "written" (written and verified, or already equal), "failed" (a write or
 * verify step failed), "none" (no storefront step at all: a run from before
 * MVP 3).
 */
export function storefrontOutcome(steps: readonly SyncStep[]): "written" | "failed" | "none" {
  const own = steps.filter((step) => step.step === STOREFRONT_WRITE_STEP || step.step === STOREFRONT_VERIFY_STEP);
  if (own.length === 0) return "none";
  return own.every((step) => step.ok) ? "written" : "failed";
}

/** Index rows read per query (paged by id). */
const COUNT_PAGE = 1000;

/**
 * How many products carry a Pro tier set (`tierRef`), in all and per set id —
 * from the product index (the values the sync wrote; a write in flight counts
 * with its previous value). The admin shows it on Množstevní slevy.
 */
export async function tierProductCounts(db: PrismaClient, shop: string): Promise<{ total: number; bySet: Record<string, number> }> {
  // A Map, then own properties: a set id is [A-Za-z0-9_-], "__proto__" included.
  const bySet = new Map<string, number>();
  let total = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.productTargetIndex.findMany({
      where: { shop, value: { contains: '"tierRef"' } },
      select: { id: true, value: true },
      orderBy: { id: "asc" },
      take: COUNT_PAGE,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    for (const row of rows) {
      let tierRef: unknown;
      try {
        tierRef = (JSON.parse(row.value ?? "null") as { tierRef?: unknown } | null)?.tierRef;
      } catch {
        continue;
      }
      // The sentinel (a tier set change in flight, products.ts TIER_SENTINEL) is no set.
      if (typeof tierRef !== "string" || tierRef === "" || tierRef === TIER_SENTINEL) continue;
      total += 1;
      bySet.set(tierRef, (bySet.get(tierRef) ?? 0) + 1);
    }
    if (rows.length < COUNT_PAGE) break;
    cursor = rows[rows.length - 1]!.id;
  }
  return { total, bySet: Object.fromEntries(bySet) };
}
