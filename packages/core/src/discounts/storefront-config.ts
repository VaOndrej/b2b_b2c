// Storefront config (MVP 3, docs/plans/2026-09-30-won-discounts-mvp3.md, contracts K4–K6).
//
// The theme app extension reads it in Liquid from an APP-DATA metafield (owner
// AppInstallation; app-data metafields use a plain namespace, not `$app`):
//   {{ app.metafields.won_discounts.storefront_config.value }}
// It is built from the GATED config (plan-gate.ts, BILL-1), so nothing a Free
// shop may not run ever reaches a page, and it never carries purchase costs.
// Per product the block reads the product metafield's `tierRef` (targeting.ts)
// and per variant the `pdp` metafield (`PdpMetafieldValue`).
//
// buildStorefrontConfig builds it (sync, T3); pdpFloor computes the variant
// `pdp` metafield (contract K4 v2, audit MVP 3 P1-1/P2-4): the item's FLOOR in
// the shop currency — exactly the engine's `floorUnit` (margin.ts) — and the
// margin key `k` it was computed under. The storefront config's `margin`
// carries the same `k` and the shop currency `cur`; the PDP uses a `pdp` only
// when its `k` is the config's, converts the floor into a foreign currency as
// ceil(f × rate × 10^exp / 10^exp_shop) + 1 minor unit, and otherwise promises
// nothing for a variant with a purchase cost (fail closed). A floor does not
// depend on the price, so a price change (or a market's own price list) never
// makes it stale; any change of the margin settings or the shop currency
// changes `k`. pdpMaxDiscountPercent (K4 v1) stays until the sync switches.

import { variantKey } from "./cart.ts";
import {
  APPEARANCE_PRESETS,
  LOCALE_CODES,
  type AppearancePreset,
  type LocaleCode,
  type MarginModule,
  type ReadonlyDeep,
  type RewardsModule,
  type TierCountAcross,
  type WonDiscountsConfig,
} from "./config.ts";
import { buildMarginPayload, costMinorUnits, marginFloorUnit, resolveMargin } from "./margin.ts";
import { fnv1a32Hex } from "./code-hash.ts";
import { currencyExponent, moneyFor } from "./money.ts";
import { variantNumber } from "./rewards.ts";
import { campaignTierSets } from "./campaign-tiers.ts";
import { shopLocalToUtc } from "./campaigns.ts";
import { accentCss, customLookCss } from "./custom-look.ts";
import { globalTierSet, reachableTierSets } from "./tiers.ts";

/** App-data metafield (AppInstallation) the storefront reads. */
export const STOREFRONT_CONFIG_NAMESPACE = "won_discounts";
export const STOREFRONT_CONFIG_KEY = "storefront_config";

/** Variant metafield `$app:won_discounts`/`pdp` (json): see PdpMetafieldValue. */
export const PDP_METAFIELD_KEY = "pdp";

export const STOREFRONT_CONFIG_VERSION = 1;

/**
 * One quantity break as the storefront shows it: a percent, or an amount off
 * per item per ISO currency in Liquid money units (major unit × 100, whatever
 * the currency's exponent — the builder converts from minor units). A currency
 * missing from `off` = the break is not offered in that currency (MKT-1).
 */
export type StorefrontTierBreak = { min: number; pct: number } | { min: number; off: Record<string, number> };

export interface StorefrontTierSet {
  count: TierCountAcross;
  /** Ascending `min`; [] = an inert set (a Pro set on Free, K1): its products show no table. */
  breaks: StorefrontTierBreak[];
}

export interface StorefrontTiers {
  /** The global set's id (K1 step 3), null when there is none. */
  global: string | null;
  /** Every set a product can reach, by id. */
  sets: Record<string, StorefrontTierSet>;
}

export type StorefrontMargin =
  | { on: false }
  | {
      on: true;
      /** The maximum discount % for a variant without a known purchase cost (global setting). */
      max: number;
      /** Numeric collection id → that collection's maximum discount % (a product with several of its `marginRefs` takes the lowest). */
      col?: Record<string, number>;
      /**
       * K4 v2: marginKey of the gated margin + shop currency; a variant's `pdp`
       * counts only when its `k` is this one. Present when the builder was given
       * the shop currency (StorefrontConfigOptions.shopCurrency).
       */
      k?: string;
      /** K4 v2: the shop currency (the currency of `pdp.f`), with `k`. */
      cur?: string;
    };

export interface StorefrontConfigV1 {
  v: 1;
  /** The ShopConfig version it was built from (debugging, E2E). */
  cv: string;
  /**
   * The sets the product page shows. MVP 6.1 (L6): the campaign's sets while a campaign with tier overrides is
   * shown (`tc`), the base ones otherwise — the extension reads this key alone.
   */
  tiers: StorefrontTiers;
  /** MVP 6.1: the BASE sets, only while `tiers` are a campaign's (the sync puts them back before the campaign goes). */
  bt?: StorefrontTiers;
  /** MVP 6.1: the campaign whose sets `tiers` are; absent = the base sets. */
  tc?: string;
  margin: StorefrontMargin;
  /**
   * `css` (MVP 7, Pro): the custom look's stylesheet — its variables on the block roots and the merchant's CSS
   * scoped under them (custom-look.ts customLookCss); the embed prints it into a <style>. Absent = none.
   */
  appearance: { preset: AppearancePreset; css?: string };
  /** Texts the merchant changed, per locale; the extension's own locales are the fallback. */
  texts: Partial<Record<LocaleCode, Record<string, string>>>;
  /** MVP 4 (contract R7): the cart rewards; absent when nothing is offered (the embed shows no panel). */
  rewards?: StorefrontRewards;
  /**
   * MVP 5 (contract O9): 1 when outlet combines with anything (`engine.combination.outletWithAnything`); absent =
   * the default A1, a sale variant gets no other discount, so the PDP shows it no tier table (the product
   * metafield's `outlet` list names the sale variants).
   */
  ow?: 1;
  /** MVP 7 BETA (contract M8): 1 when product cards show the first quantity break (`storefront.cardPricesEnabled`). */
  cards?: 1;
  /**
   * Feedback 2 (2026-10-06, bod 7): the campaigns the storefront may announce — name, start and end as epoch
   * seconds (UTC). Pages are cached, so the "Campaign banner" block decides in the browser which one runs.
   * Not killed, at most STOREFRONT_CAMPAIGNS (the ones ending last); absent when there is none or the shop's
   * time zone is not known (StorefrontConfigOptions.shopTimezone).
   */
  camps?: StorefrontCampaign[];
}

export interface StorefrontCampaign {
  n: string;
  s: number;
  e: number;
}

/** Most campaigns the storefront config lists, and the longest name it carries. */
export const STOREFRONT_CAMPAIGNS = 10;
export const STOREFRONT_CAMPAIGN_NAME = 80;

/** A gift variant with its product's handle (Liquid renders it through `all_products[h]`). */
export interface StorefrontGiftVariant {
  v: number;
  h: string;
}

export interface StorefrontRewards {
  /** Free-shipping threshold per currency, Liquid units (major × 100); null = none. */
  ship: Record<string, number> | null;
  /** Gift tiers in config order: `t` threshold per currency (Liquid units), `c` the gifts offered, `f` the fallback (A4). */
  gifts: { id: string; t: Record<string, number>; c: StorefrontGiftVariant[]; f?: StorefrontGiftVariant }[];
  /** countOtherDiscounts: the cart compares the threshold with the total after discounts and warns. */
  other: boolean;
}

/**
 * Variant metafield `$app:won_discounts`/`pdp` (contract K4 v2): `f` = the
 * lowest price of one item in minor units of the SHOP currency — exactly the
 * engine's `floorUnit` for a cart in the shop currency — and `k` = the
 * marginKey it was computed under. Written only for variants with a known
 * purchase cost while margin protection is on (absent otherwise). The function
 * never reads it; the purchase cost itself never reaches a page.
 */
export interface PdpMetafieldValue {
  f: number;
  k: string;
}

export interface StorefrontConfigOptions {
  /** The ShopConfig version the config was read from (`cv`). */
  configVersion: string;
  /**
   * MVP 4 (R7): product handle per gift variant GID, read by the sync from the
   * Admin API. A variant without one is left out of the storefront config
   * (Liquid could not render it); the function still makes it free.
   */
  variantHandles?: Readonly<Record<string, string>>;
  /**
   * The shop currency (Admin `shop.currencyCode`): K4 v2's `margin.cur`, and
   * part of `margin.k`. Required by K4 v2 — optional only while the sync has
   * not switched to it (without it `k` and `cur` are left out, and a PDP
   * reading K4 v2 promises nothing for variants with a purchase cost).
   */
  shopCurrency?: string;
  /**
   * MVP 6.1 (L6): the campaign whose tier sets the page shows right now (campaign-tiers.ts campaignTiersShownAt
   * over the same gated config); null / absent / a campaign without an applied tier override = the base sets.
   */
  campaignId?: string | null;
  /** The shop's IANA time zone: campaign windows are shop-local, the storefront needs instants (`camps`). */
  shopTimezone?: string;
}

/** A value under a key that may be an Object.prototype name ("__proto__"): always an own, enumerable entry. */
function setOwn<T>(target: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Minor units → Liquid money units (major × 100, K5), with money.ts
 * currencyExponent — the table checkout reads amounts with — rounded DOWN for
 * a currency with more than 2 digits (the page never shows more than checkout
 * gives). Integer math: exact for every amount the config allows.
 */
function liquidUnits(minor: number, currency: string): number {
  const exponent = currencyExponent(currency);
  return exponent <= 2 ? minor * 10 ** (2 - exponent) : Math.floor(minor / 10 ** (exponent - 2));
}

type SetLike = ReadonlyDeep<WonDiscountsConfig>["modules"]["tiers"]["sets"][number];

function storefrontSet(set: SetLike): StorefrontTierSet {
  const breaks: StorefrontTierBreak[] = [];
  for (const b of [...set.breaks].sort((x, y) => x.minQty - y.minQty)) {
    if (typeof b.percent === "number") {
      breaks.push({ min: b.minQty, pct: b.percent });
      continue;
    }
    const off: Record<string, number> = {};
    let any = false;
    for (const currency of Object.keys(b.amountOff ?? {}).sort()) {
      const minor = moneyFor(b.amountOff, currency);
      if (minor === null) continue;
      setOwn(off, currency, liquidUnits(minor, currency));
      any = true;
    }
    if (any) breaks.push({ min: b.minQty, off });
  }
  return { count: set.countAcross, breaks };
}

function storefrontMargin(margin: ReadonlyDeep<MarginModule>, shopCurrency: string | undefined): StorefrontMargin {
  const payload = buildMarginPayload(margin);
  if (!payload.enabled) return { on: false };
  const out: Extract<StorefrontMargin, { on: true }> = { on: true, max: payload.max };
  if (payload.col) {
    const col: Record<string, number> = {};
    // Every margin collection with its EFFECTIVE maximum (empty = the global
    // value): the lowest over a product's refs is then exactly resolveMargin's.
    for (const key of Object.keys(payload.col)) setOwn(col, key, payload.col[key][1] ?? payload.max);
    out.col = col;
  }
  if (shopCurrency !== undefined) {
    out.k = marginKey(margin, shopCurrency);
    out.cur = shopCurrency;
  }
  return out;
}

function storefrontTexts(locales: ReadonlyDeep<WonDiscountsConfig>["locales"]): StorefrontConfigV1["texts"] {
  const texts: StorefrontConfigV1["texts"] = {};
  for (const locale of LOCALE_CODES) {
    const changed: Record<string, string> = {};
    let any = false;
    for (const [key, text] of Object.entries(locales[locale] ?? {})) {
      if (typeof text !== "string" || text === "") continue;
      setOwn(changed, key, text);
      any = true;
    }
    if (any) texts[locale] = changed;
  }
  return texts;
}

function storefrontTiers(setsOf: ReadonlyDeep<WonDiscountsConfig>["modules"]["tiers"]["sets"]): StorefrontTiers {
  const reachable = reachableTierSets(setsOf);
  const sets: Record<string, StorefrontTierSet> = {};
  for (const set of reachable) setOwn(sets, set.id, storefrontSet(set));
  return { global: globalTierSet(reachable)?.id ?? null, sets };
}

/**
 * The storefront config (K5) from the GATED config (plan-gate.ts, BILL-1): the
 * sets a product can reach (tiers.ts reachableTierSets) keyed by id, amounts in
 * Liquid money units per currency, the margin caps (never a cost), the
 * appearance preset (K7) and the texts the merchant changed (non-empty ones).
 * MVP 6.1: `opts.campaignId` swaps in that campaign's sets (`bt`, `tc`).
 * Pure; never throws.
 */
export function buildStorefrontConfig(gated: ReadonlyDeep<WonDiscountsConfig>, opts: StorefrontConfigOptions): StorefrontConfigV1 {
  const base = storefrontTiers(gated.modules.tiers.sets);
  const campaign = opts.campaignId ? gated.campaigns.find((c) => c.id === opts.campaignId && !c.killed) : undefined;
  const run = campaign ? campaignTierSets(gated.modules.tiers, campaign) : null;
  const shown = campaign && run && run.applied.length > 0 ? { tiers: storefrontTiers(run.sets), bt: base, tc: campaign.id } : { tiers: base };
  const preset = gated.storefront.appearancePreset;
  // The ready-made colour first: the Pro custom look's own accent (a later rule of the same weight) goes over it.
  const customCss = accentCss(gated.storefront.accent) + customLookCss(gated.storefront.custom);
  return {
    v: STOREFRONT_CONFIG_VERSION,
    cv: opts.configVersion,
    ...shown,
    margin: storefrontMargin(gated.modules.margin, opts.shopCurrency),
    appearance: { preset: (APPEARANCE_PRESETS as readonly string[]).includes(preset) ? preset : "default", ...(customCss ? { css: customCss } : {}) },
    texts: storefrontTexts(gated.locales),
    ...rewardsPart(gated.modules.rewards, opts.variantHandles ?? {}),
    ...(gated.engine.combination.outletWithAnything ? { ow: 1 as const } : {}),
    ...(gated.storefront.cardPricesEnabled ? { cards: 1 as const } : {}),
    ...campaignsPart(gated.campaigns, opts.shopTimezone),
  };
}

/** `camps`: every campaign that is not killed, as instants; a window that cannot be read is left out. */
function campaignsPart(campaigns: ReadonlyDeep<WonDiscountsConfig["campaigns"]>, zone: string | undefined): { camps?: StorefrontCampaign[] } {
  if (!zone) return {};
  const out: StorefrontCampaign[] = [];
  for (const campaign of campaigns) {
    if (campaign.killed) continue;
    try {
      const s = Math.floor(shopLocalToUtc(campaign.window.start, zone).getTime() / 1000);
      const e = Math.floor(shopLocalToUtc(campaign.window.end, zone).getTime() / 1000);
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) out.push({ n: campaign.name.trim().slice(0, STOREFRONT_CAMPAIGN_NAME), s, e });
    } catch {
      // An unknown zone or an unreadable window: the storefront announces nothing for it.
    }
  }
  if (out.length === 0) return {};
  out.sort((a, b) => b.e - a.e || a.s - b.s);
  return { camps: out.slice(0, STOREFRONT_CAMPAIGNS).sort((a, b) => a.s - b.s || a.e - b.e) };
}

/** Threshold per currency in Liquid units, own entries only; empty map → null. */
function liquidThreshold(money: ReadonlyDeep<Record<string, number>> | undefined): Record<string, number> | null {
  const out: Record<string, number> = {};
  let any = false;
  for (const currency of Object.keys(money ?? {}).sort()) {
    const minor = moneyFor(money, currency);
    if (minor === null || minor <= 0) continue;
    setOwn(out, currency, liquidUnits(minor, currency));
    any = true;
  }
  return any ? out : null;
}

function rewardsPart(rewards: ReadonlyDeep<RewardsModule>, handles: Readonly<Record<string, string>>): { rewards?: StorefrontRewards } {
  const variant = (id: string): StorefrontGiftVariant | null => {
    const v = variantNumber(id);
    const h = Object.prototype.hasOwnProperty.call(handles, id) ? handles[id] : undefined;
    return v !== null && typeof h === "string" && h !== "" ? { v, h } : null;
  };
  const gifts: StorefrontRewards["gifts"] = [];
  for (const tier of rewards.gifts) {
    const t = liquidThreshold(tier.threshold);
    if (!t) continue;
    const c = tier.choices.map(variant).filter((x): x is StorefrontGiftVariant => x !== null);
    const f = tier.fallbackVariantId ? variant(tier.fallbackVariantId) : null;
    if (c.length === 0 && !f) continue;
    gifts.push(f ? { id: tier.id, t, c, f } : { id: tier.id, t, c });
  }
  const ship = liquidThreshold(rewards.freeShipping?.threshold);
  if (!ship && gifts.length === 0) return {};
  return { rewards: { ship, gifts, other: rewards.countOtherDiscounts } };
}

// --- K4 v2: the variant `pdp` metafield ------------------------------------------------------------

/**
 * A short, stable key of everything an item's floor depends on besides its
 * cost and collections: whether protection is on, the global minimum margin
 * and maximum discount, every collection's [minimum, maximum] (in collection
 * id order, so reordering changes nothing), and the shop currency (the
 * currency of `pdp.f`). Any change that could move a floor changes the key.
 * FNV-1a 32 bit as 8 hex digits (code-hash.ts) of a canonical text.
 */
export function marginKey(margin: ReadonlyDeep<MarginModule>, shopCurrency: string): string {
  const payload = buildMarginPayload(margin);
  const text = !payload.enabled
    ? `off|${shopCurrency}`
    : [
        "on",
        String(payload.min ?? 0),
        String(payload.max),
        shopCurrency,
        ...Object.keys(payload.col ?? {})
          .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
          .map((key) => `${key}:${payload.col![key][0] ?? "-"},${payload.col![key][1] ?? "-"}`),
      ].join("|");
  return fnv1a32Hex(text);
}

export interface PdpFloorInput {
  /** The variant's cost as the cost mirror has it (variant metafield `cost`: MAJOR units); absent = unknown. */
  unitCost?: number | null;
  /** The cost's currency (metafield `cur`); must equal `shopCurrency` exactly. */
  costCurrency?: string | null;
  /** The shop currency (Admin `shop.currencyCode`). */
  shopCurrency: string;
  /** The GATED config's margin module. */
  margin: ReadonlyDeep<MarginModule>;
  /** The product's collections (GIDs or numeric ids); those with a margin setting decide, as at checkout. */
  collectionIds: readonly string[];
}

/**
 * K4 v2: the variant `pdp` value — `f` = exactly the engine's floorUnit of one
 * item for a cart in the shop currency (margin.ts costMinorUnits at rate 1,
 * resolveMargin over the product's collections, marginFloorUnit; with a known
 * cost the floor does not depend on the price), `k` = marginKey. null when
 * protection is off or the cost is unusable (none, ≤ 0, another currency): the
 * metafield is then not written.
 */
export function pdpFloor(input: PdpFloorInput): PdpMetafieldValue | null {
  const shopCurrency = input.shopCurrency;
  const payload = buildMarginPayload(input.margin, shopCurrency);
  if (!payload.enabled) return null;
  const costMinor = costMinorUnits(input.unitCost ?? undefined, input.costCurrency ?? undefined, 1, shopCurrency, shopCurrency);
  if (costMinor === null) return null;
  const settings = resolveMargin(payload, input.collectionIds.map(variantKey));
  if (!settings) return null;
  const { floorUnit } = marginFloorUnit({ unitPrice: 0, costMinor, ...settings });
  return { f: floorUnit, k: marginKey(input.margin, shopCurrency) };
}

// --- K4 v1 (deprecated): the largest discount % ------------------------------------------------------

export interface PdpMaxDiscountInput {
  /** Price of one item, minor units of the SHOP currency. */
  unitPrice: number;
  /** The variant's cost as the cost mirror has it (variant metafield `cost`: MAJOR units); absent = unknown. */
  unitCost?: number | null;
  /** The cost's currency (metafield `cur`); must equal `shopCurrency` exactly. */
  costCurrency?: string | null;
  /** The shop currency (Admin `shop.currencyCode`). */
  shopCurrency: string;
  /** The GATED config's margin module. */
  margin: ReadonlyDeep<MarginModule>;
  /** The product's collections (GIDs or numeric ids); those with a margin setting decide, as at checkout. */
  collectionIds: readonly string[];
}

/**
 * @deprecated K4 v1 — replaced by pdpFloor (K4 v2, audit MVP 3 P1-1: a percent
 * of the shop-currency price over-promises in a market with its own price
 * list). Kept only until the sync writes `pdp` = pdpFloor; then removed.
 *
 * The largest discount % margin protection allows on the variant at its price
 * in the shop currency (K4): (price − floor) / price, in tenths of a percent
 * ROUNDED DOWN, where the floor is margin.ts marginFloorUnit with the cost
 * (costMinorUnits) and the product's settings (resolveMargin over its
 * collections) — the same math checkout runs. null when protection is off or
 * the cost is unknown (the storefront then uses the config's `margin` caps).
 * A price at or below its floor → 0.
 */
export function pdpMaxDiscountPercent(input: PdpMaxDiscountInput): number | null {
  const payload = buildMarginPayload(input.margin, input.shopCurrency);
  if (!payload.enabled) return null;
  const shopCurrency = input.shopCurrency;
  const costMinor = costMinorUnits(input.unitCost ?? undefined, input.costCurrency ?? undefined, 1, shopCurrency, shopCurrency);
  if (costMinor === null) return null;
  const settings = resolveMargin(payload, input.collectionIds.map(variantKey));
  if (!settings) return null;
  const unitPrice = Number.isFinite(input.unitPrice) ? Math.max(0, Math.floor(input.unitPrice)) : 0;
  if (unitPrice === 0) return 0;
  const { floorUnit } = marginFloorUnit({ unitPrice, costMinor, ...settings });
  const allowed = unitPrice - floorUnit;
  if (allowed <= 0) return 0;
  // Integer division (exact below 2^53): tenths of a percent, rounded down.
  const scaled = allowed * 1000;
  const tenths = (scaled - (scaled % unitPrice)) / unitPrice;
  return Math.min(1000, tenths) / 10;
}
