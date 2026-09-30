// MVP 1 transport payloads (spec §3 "Transport configu", verdict C7 = platí):
//
//   1. ONE shared config in an app-owned SHOP metafield
//      (`$app:won_discounts`/`function_config`), read by every Won node — one
//      atomic write for all nodes: `buildShopFunctionConfig(...).json`.
//   2. Small per-node variables on each discount node — `buildNodeVars`: role
//      (automatic / code + rule id) and the C4 campaign window. Shopify reads
//      input-query variables ONLY from the node's own metafield, so the window
//      must live there, and `campaignStart`/`campaignEnd` are ALWAYS present
//      (a missing key fails the whole run, C4).
//
// Campaign consistency. Writing variables to N nodes is not atomic, so both
// sides carry a `varsVersion` = hash(campaign id + window): a node applies
// campaign overrides only when its `campaignId` + `varsVersion` equal the shop
// config's `campaignId` + `campaignVarsVersion` (plan.ts); otherwise it plans as
// if no campaign were active. Only the selected campaign (current, else next)
// ships, so that is the only one any node can ever apply.
//
// Sync sequences (T3):
//   - Overrides of the selected campaign changed, same window → one write of the
//     shop config (the version is unchanged; atomic for every node).
//   - Campaign killed / deleted → one write of the shop config (its campaign is
//     then null or another one; no node matches the old version any more), then
//     the node variables at leisure.
//   - Selected campaign or its WINDOW changed (new varsVersion) — including the
//     switch to the next campaign once the current one ended — 3 phases:
//       1. shop config with `forceNoCampaign: true` → every node plans without
//          a campaign, whatever its variables say;
//       2. every node's variables (`buildNodeVars`); verify all were written;
//       3. the final shop config → all nodes flip together.
//     If phase 2 fails for any node, stay at phase 1 (no campaign, consistent)
//     and retry; never write phase 3 over a partial phase 2.
//   Back-to-back campaigns need a sync run at the boundary (one window per node).
//
// A shop config over 10 000 B reaches the function as `null` WITHOUT an error
// (C7), hence the 9 000 B budget at save time and `verifyShopFunctionConfig`
// for the sync's read-back.
//
// What the shared config carries instead of raw data:
//   - rule targets as `{kind}` only (targeting is precomputed into product
//     metafields, targeting.ts);
//   - codes as 8-hex FNV-1a hashes (code-hash.ts; `findCodeHashCollisions`
//     guards the admin save), with the longest code's length (`maxCodeLength`:
//     the function never upper-cases an entered code longer than it, nor trims
//     one longer than it + ENTERED_CODE_PADDING as entered);
//   - schedules as SHOP-LOCAL dates (`startsOn`/`endsOn`), converted with the
//     shop's IANA time zone, because the function can only compare
//     `shop.localTime.date`;
//   - Pro market targeting as `marketCountries` (the function's
//     `localization.market` is deprecated; the engine matches the cart country);
//   - a minimum's `scope` only when it is "entitled" (absent = the whole cart);
//   - margin protection (MVP 2) in its compact form (margin.ts
//     FunctionMarginPayload): `{enabled: false}` while it is off, else
//     `min`/`max`, the shop currency `cur` and per-collection `[m, p]` tuples
//     keyed by numeric collection id (50 collections ≈ 1.4 kB);
//   - quantity tiers (MVP 3) in their compact form (tiers.ts
//     FunctionTiersPayload, the exact shape and reading rules are in its
//     header): only the sets a line can reach, each as `[id, count,
//     currencies, breaks]`, never a scope id list (a product's set is its
//     metafield `tierRef`, else `global`).
// The sync must build a Free shop's payload from plan-gate.ts
// gateConfigForPlan(config, plan), never from the stored config: only then does
// none of its Pro data (targeting, combinesWith, campaigns) ship.

import { codeHash } from "./code-hash.ts";
import { normalizeCode, type CartCampaignInput } from "./cart.ts";
import {
  isShopLocalDateTime,
  type DiscountMethod,
  type DiscountRule,
  type DiscountRuleValue,
  type DiscountTargetKind,
  type EngineSettings,
  type GiftTier,
  type ReadonlyDeep,
  type WonDiscountsConfig,
} from "./config.ts";
import { fnv1a } from "./config/sanitize-helpers.ts";
import type { NodeRole } from "./emit.ts";
import { FUNCTION_CONFIG_BUDGET_BYTES, liveCampaigns, NO_CAMPAIGN_DATETIME, selectCampaign } from "./function-config.ts";
import { buildMarginPayload, type FunctionMarginPayload, type MarginCollectionTuple } from "./margin.ts";
import type { MoneyByCurrency } from "./money.ts";
import { isFunctionConfigPayload } from "./plan.ts";
import { buildTiersPayload, type FunctionTierBreak, type FunctionTierSet, type FunctionTiersPayload } from "./tiers.ts";

export { isFunctionConfigPayload };
export type { FunctionMarginPayload, FunctionTierBreak, FunctionTierSet, FunctionTiersPayload, MarginCollectionTuple };

/** Shopify's hard limit for a metafield read by a function (C3/C7: 10 000 B passes, 10 001 B is `null`). */
export const FUNCTION_METAFIELD_LIMIT_BYTES = 10_000;

/** A discount rule as the engine reads it (no admin-only fields, no id lists, no raw codes). */
export interface FunctionRule {
  id: string;
  enabled: boolean;
  name: string;
  method: DiscountMethod;
  /** Code rules only: codeHash() of each code. */
  codeHashes?: string[];
  value: DiscountRuleValue;
  target: { kind: DiscountTargetKind };
  priority?: number;
  /** `scope: "entitled"` only when the minimum counts the rule's own lines; absent = the whole cart. */
  minimum?: { subtotal?: MoneyByCurrency; quantity?: number; scope?: "entitled" };
  /**
   * Shop-local calendar days, inclusive (`YYYY-MM-DD`). `{ invalid: true }` when a
   * date could not be converted: the engine then never applies the rule (fail
   * closed), it is never read as "no schedule".
   */
  schedule?: { startsOn?: string; endsOn?: string; invalid?: true };
  targeting?: { segments?: string[]; markets?: string[] };
  combinesWith?: { ruleIds: string[] };
}

export interface FunctionCampaign {
  id: string;
  window: { start: string; end: string };
  overrides: { ruleId: string; patch: Record<string, unknown> }[];
  /** Never true in a built payload (killed campaigns do not ship); read defensively. */
  killed?: boolean;
}

/** The shared config every node reads (and what `planCart` accepts). */
export interface FunctionConfigPayload {
  schemaVersion: number;
  /** The selected campaign the node variables were written for (null = none). */
  campaignId: string | null;
  /** Must equal a node's `varsVersion` for that node to apply the campaign. */
  campaignVarsVersion: string | null;
  engine: EngineSettings;
  /** Market handle → upper-case countries, for enabled markets some rule or the selected campaign targets. */
  marketCountries: Record<string, string[]>;
  modules: {
    /**
     * `maxCodeLength`: the longest Won code (UTF-16 units, trimmed and
     * upper-cased), shipped whenever a code rule ships code hashes (audit round
     * 6). The function matches only an entered code at most this + 16 long as
     * entered whose upper-case form is at most this long (plan.ts
     * `matchCodes`, audit round 7): any other cannot be a Won code. Absent (a
     * payload written before) it reads as CONFIG_LIMITS.codeLength (plan.ts
     * `readMaxCodeLength`). It costs the payload `,"maxCodeLength":N` — 18 B,
     * 19 B once the longest code has 10 characters or more.
     */
    codes: { rules: FunctionRule[]; maxCodeLength?: number };
    /** Compact (tiers.ts FunctionTiersPayload): the reachable sets, no scope lists. */
    tiers: FunctionTiersPayload;
    rewards: { freeShipping?: { threshold: MoneyByCurrency }; gifts: GiftTier[]; countOtherDiscounts: boolean };
    margin: FunctionMarginPayload;
  };
  /** At most one: the selected campaign. */
  campaigns: FunctionCampaign[];
}

export interface EncodedShopFunctionConfig {
  payload: FunctionConfigPayload;
  json: string;
  bytes: number;
  /** bytes <= FUNCTION_CONFIG_BUDGET_BYTES (9 000 B, ~10 % under the platform limit). */
  fits: boolean;
}

export interface NodeVars {
  role: NodeRole["kind"];
  ruleId?: string;
  campaignId: string | null;
  campaignStart: string;
  campaignEnd: string;
  varsVersion: string | null;
}

export interface ShopFunctionConfigOptions {
  /** REQUIRED. Shop-local `YYYY-MM-DDTHH:MM:SS`: picks the selected campaign (current, else next). */
  now: string;
  /** REQUIRED. The shop's IANA time zone (Admin `shop.ianaTimezone`, e.g. "Europe/Prague"). */
  shopTimezone: string;
  /** Phase 1 of the 3-phase campaign sync: ship no campaign and no version. */
  forceNoCampaign?: boolean;
  /**
   * The shop currency (Admin `shop.currencyCode`, e.g. "CZK"): the currency of
   * the variants' cost prices, shipped as the margin's `cur`. Without it an
   * enabled margin ships no `cur` and every cost is unknown (the maximum
   * discount % applies) — safe, never a wrong conversion.
   */
  shopCurrency?: string;
}

type ConfigInput = ReadonlyDeep<WonDiscountsConfig>;
type CampaignInput = ConfigInput["campaigns"][number];

const utf8Bytes = (text: string) => new TextEncoder().encode(text).length;

/** Plain-data deep copy (config values are JSON by construction). */
function copy<T>(value: ReadonlyDeep<T> | T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nonEmpty(list: readonly string[] | undefined): list is readonly string[] {
  return Array.isArray(list) && list.length > 0;
}

function requireNow(now: unknown, where: string): string {
  if (!isShopLocalDateTime(now)) {
    throw new TypeError(`${where}: \`now\` is required, as shop-local YYYY-MM-DDTHH:MM:SS (got ${JSON.stringify(now)})`);
  }
  return now;
}

/** Cached formatters: one per zone (Intl.DateTimeFormat construction is the slow part). */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: unknown, where: string): Intl.DateTimeFormat {
  if (typeof timeZone !== "string" || timeZone === "") {
    throw new TypeError(`${where}: \`shopTimezone\` is required (an IANA zone such as "Europe/Prague")`);
  }
  let formatter = FORMATTERS.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      throw new TypeError(`${where}: \`shopTimezone\` ${JSON.stringify(timeZone)} is not a known IANA time zone`);
    }
    FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

interface LocalTime {
  /** Shop-local "YYYY-MM-DD". */
  date: string;
  /** Shop-local "HH:MM:SS". */
  time: string;
  /** Offset from UTC at that instant, minutes (Prague summer: +120). */
  offset: number;
}

/** An instant (epoch ms) in the shop's zone (DST-safe: Intl does the zone math). */
function localAt(ms: number, formatter: Intl.DateTimeFormat): LocalTime {
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(new Date(ms))) parts[p.type] = p.value;
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    offset: Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000),
  };
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The first instant (epoch ms, whole seconds) whose shop-local date is `date`.
 * Found by search, not by "local midnight": in zones whose clocks jump at
 * midnight (America/Santiago, America/Havana on their spring-forward day) the
 * day starts at 01:00, and there is no local 00:00 to convert (audit MVP 1
 * drift #8). Every offset lies within −12 h … +14 h, so the answer lies within
 * 15 h of that day's UTC midnight.
 */
function dayStartMs(date: string, formatter: Intl.DateTimeFormat): number {
  const key = `${formatter.resolvedOptions().timeZone}|${date}`;
  const cached = DAY_STARTS.get(key);
  if (cached !== undefined) return cached;
  const ms = searchDayStart(date, formatter);
  if (DAY_STARTS.size >= 10_000) DAY_STARTS.clear();
  DAY_STARTS.set(key, ms);
  return ms;
}

/** zone|date → dayStartMs (a sync builds the payload once per live campaign; the search is ~17 Intl calls). */
const DAY_STARTS = new Map<string, number>();

function searchDayStart(date: string, formatter: Intl.DateTimeFormat): number {
  const m = DAY_RE.exec(date);
  const utcMidnight = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN;
  if (!m || !Number.isFinite(utcMidnight) || new Date(utcMidnight).toISOString().slice(0, 10) !== date) {
    throw new TypeError(`shopDayStart: ${JSON.stringify(date)} is not a calendar date YYYY-MM-DD`);
  }
  let lo = utcMidnight / 1000 - 15 * 3600; // local date before `date`
  let hi = utcMidnight / 1000 + 15 * 3600; // local date at or after `date`
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localAt(mid * 1000, formatter).date < date) lo = mid;
    else hi = mid;
  }
  return hi * 1000;
}

function offsetText(minutes: number): string {
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * The start of a shop-local day as an ISO date-time with the zone's offset at
 * that instant: "2026-07-01T00:00:00+02:00" in Prague, and
 * "2026-09-06T01:00:00-03:00" in Santiago, where that day has no midnight. What
 * a whole-day rule schedule stores (the admin's day picker: start = start of the
 * first day, end = start of the day after the last one), and what
 * shopLocalDates reads back as exactly those days. Throws TypeError on an
 * invalid date or zone (a programming error).
 */
export function shopDayStart(date: string, shopTimezone: string): string {
  const formatter = formatterFor(shopTimezone, "shopDayStart");
  const ms = dayStartMs(date, formatter);
  const local = localAt(ms, formatter);
  return `${local.date}T${local.time}${offsetText(local.offset)}`;
}

function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * A rule schedule (ISO date-times with any offset, `Z` included) as the shop's
 * calendar days: `startsOn` = the local day of `startsAt`; `endsOn` = the local
 * day of `endsAt`, or the day before when it ends exactly at the START of its
 * local day (an exclusive end; the start of a day is local midnight, or 01:00
 * where the clocks skip midnight — shopDayStart).
 * [spec] Day granularity: the rule is live the whole of both days.
 */
export function shopLocalDates(
  schedule: { startsAt?: string; endsAt?: string },
  shopTimezone: string,
): { startsOn?: string; endsOn?: string } {
  const formatter = formatterFor(shopTimezone, "shopLocalDates");
  const out: { startsOn?: string; endsOn?: string } = {};
  if (schedule.startsAt) {
    const ms = Date.parse(schedule.startsAt);
    if (Number.isFinite(ms)) out.startsOn = localAt(ms, formatter).date;
  }
  if (schedule.endsAt) {
    const ms = Date.parse(schedule.endsAt);
    if (Number.isFinite(ms)) {
      const date = localAt(ms, formatter).date;
      out.endsOn = ms === dayStartMs(date, formatter) ? previousDay(date) : date;
    }
  }
  return out;
}

/**
 * Version of the campaign variables: a content hash of the selected campaign's id
 * and window, so the shop config and every node compute the same value from the
 * same config without a shared counter, and an edited window (same id) is a new
 * version that stale nodes cannot match. `null` when there is no campaign.
 */
export function campaignVarsVersion(campaign: { id: string; window: { start: string; end: string } } | null): string | null {
  return campaign ? `v${fnv1a(`${campaign.id}|${campaign.window.start}|${campaign.window.end}`)}` : null;
}

function shipRule(r: ReadonlyDeep<DiscountRule>, shopTimezone: string): FunctionRule {
  const out: FunctionRule = {
    id: r.id,
    enabled: r.enabled,
    name: r.name,
    method: r.method,
    value: copy<DiscountRuleValue>(r.value),
    target: { kind: r.target.kind },
  };
  if (r.method === "code" && r.codes) out.codeHashes = r.codes.map(codeHash);
  if (r.priority) out.priority = r.priority;
  const subtotal = r.minimum?.subtotal;
  const hasSubtotal = subtotal !== undefined && Object.keys(subtotal).length > 0;
  const quantity = r.minimum?.quantity ?? 0;
  if (hasSubtotal || quantity > 0) {
    out.minimum = {};
    if (hasSubtotal) out.minimum.subtotal = { ...subtotal };
    if (quantity > 0) out.minimum.quantity = quantity;
    // Absent = the whole cart (the default), so only "entitled" costs bytes.
    if (r.minimum?.scope === "entitled") out.minimum.scope = "entitled";
  }
  if (r.schedule && (r.schedule.startsAt || r.schedule.endsAt)) {
    // Fail closed: a side that was set but did not convert must not become "unbounded".
    const local = shopLocalDates(r.schedule, shopTimezone);
    const converted = (!r.schedule.startsAt || local.startsOn) && (!r.schedule.endsAt || local.endsOn);
    out.schedule = converted ? local : { invalid: true };
  }
  const segments = r.targeting?.segments;
  const markets = r.targeting?.markets;
  if (nonEmpty(segments) || nonEmpty(markets)) {
    out.targeting = {};
    if (nonEmpty(segments)) out.targeting.segments = [...segments];
    if (nonEmpty(markets)) out.targeting.markets = [...markets];
  }
  if (r.combinesWith && r.combinesWith.ruleIds.length > 0) out.combinesWith = { ruleIds: [...r.combinesWith.ruleIds] };
  return out;
}

/** The codes module: the rules, and the longest Won code when any code ships. */
function shipCodes(rules: ConfigInput["modules"]["codes"]["rules"], shopTimezone: string): FunctionConfigPayload["modules"]["codes"] {
  const shipped = rules.map((r) => shipRule(r, shopTimezone));
  let longest = -1;
  for (const r of rules) {
    if (r.method !== "code") continue;
    for (const code of r.codes ?? []) longest = Math.max(longest, normalizeCode(code).length);
  }
  return longest < 0 ? { rules: shipped } : { rules: shipped, maxCodeLength: longest };
}

/** A campaign patch as the engine reads it: a re-targeting patch keeps only `{kind}`
 * (the lines carry campaign-scoped refs instead, see targeting.ts). */
function shipPatch(patch: ReadonlyDeep<Record<string, unknown>>): Record<string, unknown> {
  const out = copy<Record<string, unknown>>(patch);
  const target = out.target;
  if (typeof target === "object" && target !== null && "kind" in target) {
    out.target = { kind: (target as { kind: unknown }).kind };
  }
  return out;
}

/**
 * Countries of every enabled market that a base rule OR an override of the
 * selected campaign targets (a campaign may re-target a rule to another market;
 * without its countries that rule could never apply). Only the selected campaign
 * ships, so the worst-case builder measures each campaign's markets too.
 */
function shipMarketCountries(config: ConfigInput, selected: CampaignInput | null): Record<string, string[]> {
  const targeted = new Set<string>();
  const addFrom = (targeting: unknown) => {
    if (typeof targeting !== "object" || targeting === null) return;
    const markets = (targeting as { markets?: unknown }).markets;
    if (Array.isArray(markets)) for (const m of markets) if (typeof m === "string") targeted.add(m);
  };
  for (const rule of config.modules.codes.rules) addFrom(rule.targeting);
  for (const override of selected?.overrides ?? []) addFrom(override.patch.targeting);
  const out: Record<string, string[]> = {};
  for (const market of config.markets) {
    if (!market.enabled || !targeted.has(market.handle) || !market.countries?.length) continue;
    out[market.handle] = [...market.countries];
  }
  return out;
}

function encode(payload: FunctionConfigPayload): EncodedShopFunctionConfig {
  const json = JSON.stringify(payload);
  const bytes = utf8Bytes(json);
  return { payload, json, bytes, fits: bytes <= FUNCTION_CONFIG_BUDGET_BYTES };
}

function build(config: ConfigInput, selected: CampaignInput | null, shopTimezone: string, shopCurrency?: string): EncodedShopFunctionConfig {
  formatterFor(shopTimezone, "buildShopFunctionConfig"); // validate the zone once, up front
  const { codes, tiers, rewards, margin } = config.modules;
  return encode({
    schemaVersion: config.schemaVersion,
    campaignId: selected ? selected.id : null,
    campaignVarsVersion: campaignVarsVersion(selected),
    engine: copy<EngineSettings>(config.engine),
    marketCountries: shipMarketCountries(config, selected),
    modules: {
      codes: shipCodes(codes.rules, shopTimezone),
      tiers: buildTiersPayload(tiers),
      rewards: {
        ...(rewards.freeShipping ? { freeShipping: copy<{ threshold: MoneyByCurrency }>(rewards.freeShipping) } : {}),
        gifts: copy<GiftTier[]>(rewards.gifts),
        countOtherDiscounts: rewards.countOtherDiscounts,
      },
      margin: buildMarginPayload(margin, shopCurrency),
    },
    campaigns: selected
      ? [
          {
            id: selected.id,
            window: { start: selected.window.start, end: selected.window.end },
            overrides: selected.overrides.map((o) => ({ ruleId: o.ruleId, patch: shipPatch(o.patch) })),
          },
        ]
      : [],
  });
}

/**
 * The shared function config (the shop metafield). `now` and `shopTimezone` are
 * required — there is no silent default: `now` picks the selected campaign (the
 * current one, else the next), the time zone turns rule schedules into shop days.
 * Throws TypeError on a missing/invalid `now` or zone (a programming error).
 */
export function buildShopFunctionConfig(config: ConfigInput, opts: ShopFunctionConfigOptions): EncodedShopFunctionConfig {
  if (typeof opts !== "object" || opts === null) {
    throw new TypeError("buildShopFunctionConfig: options { now, shopTimezone } are required");
  }
  const now = requireNow(opts.now, "buildShopFunctionConfig");
  formatterFor(opts.shopTimezone, "buildShopFunctionConfig");
  const selected = opts.forceNoCampaign ? null : selectCampaign(config.campaigns, { now });
  return build(config, selected, opts.shopTimezone, opts.shopCurrency);
}

export interface WorstCaseShopFunctionConfig extends EncodedShopFunctionConfig {
  /** The selected campaign that makes the payload largest (`null` = none). */
  campaignId: string | null;
}

/**
 * The largest shared config this config can produce over time: every live
 * campaign as the selected one, and none. Save must be refused unless it fits.
 * Byte size does not depend on the time zone (schedule days are fixed-length)
 * nor on which shop currency (always 3 letters: "XXX" stands in when none is
 * given, so an enabled margin's `cur` is always measured), so both are optional
 * here and only shape the returned payload.
 */
export function buildShopFunctionConfigWorstCase(
  config: ConfigInput,
  opts: { shopTimezone?: string; shopCurrency?: string } = {},
): WorstCaseShopFunctionConfig {
  const zone = opts.shopTimezone ?? "UTC";
  const currency = opts.shopCurrency ?? "XXX";
  let worst: WorstCaseShopFunctionConfig = { ...build(config, null, zone, currency), campaignId: null };
  for (const campaign of liveCampaigns(config.campaigns)) {
    const encoded = build(config, campaign, zone, currency);
    if (encoded.bytes > worst.bytes) worst = { ...encoded, campaignId: campaign.id };
  }
  return worst;
}

/**
 * The per-node variables: role, rule (code nodes) and the selected campaign at
 * `now` (required; 1970 → 1970 = never active when there is none), with the same
 * `varsVersion` the shop config built at the same `now` carries.
 */
export function buildNodeVars(role: NodeRole, config: ConfigInput, now: string): NodeVars {
  const selected = selectCampaign(config.campaigns, { now: requireNow(now, "buildNodeVars") });
  return {
    role: role.kind,
    ...(role.kind === "code" ? { ruleId: role.ruleId } : {}),
    campaignId: selected ? selected.id : null,
    campaignStart: selected ? selected.window.start : NO_CAMPAIGN_DATETIME,
    campaignEnd: selected ? selected.window.end : NO_CAMPAIGN_DATETIME,
    varsVersion: campaignVarsVersion(selected),
  };
}

export function encodeNodeVars(vars: NodeVars): { json: string; bytes: number } {
  const json = JSON.stringify(vars);
  return { json, bytes: utf8Bytes(json) };
}

/**
 * The `campaign` field of CartPlanInput for the admin simulation, computed the
 * way the function gets it: `active` = `shop.localTime.dateTimeBetween(start,
 * end)` at `now` (start inclusive, end exclusive [spec, unverified boundary]).
 */
export function campaignInputFromVars(vars: NodeVars, now: string): CartCampaignInput {
  const active = vars.campaignId !== null && now >= vars.campaignStart && now < vars.campaignEnd;
  return { id: vars.campaignId, active, varsVersion: vars.varsVersion };
}

export interface CodeHashCollision {
  hash: string;
  /** Every distinct code with that hash; `ruleId: null` = one of `otherCodes`. */
  codes: { code: string; ruleId: string | null }[];
}

/**
 * Codes that would be indistinguishable in the function (same codeHash). The
 * admin must refuse to save a config with any, and say which codes clash.
 * `otherCodes` = the shop's non-Won codes the admin knows about (native
 * discounts), which could otherwise trigger a Won rule by accident.
 */
export function findCodeHashCollisions(config: ConfigInput, otherCodes: readonly string[] = []): CodeHashCollision[] {
  const byHash = new Map<string, { code: string; ruleId: string | null }[]>();
  const add = (raw: string, ruleId: string | null) => {
    const code = normalizeCode(raw);
    if (!code) return;
    const hash = codeHash(code);
    const list = byHash.get(hash);
    if (!list) byHash.set(hash, [{ code, ruleId }]);
    else if (!list.some((x) => x.code === code)) list.push({ code, ruleId });
  };
  for (const rule of config.modules.codes.rules) {
    if (rule.method !== "code") continue;
    for (const code of rule.codes ?? []) add(code, rule.id);
  }
  for (const code of otherCodes) add(code, null);
  const out: CodeHashCollision[] = [];
  for (const [hash, codes] of byHash) {
    if (codes.length > 1 && codes.some((c) => c.ruleId !== null)) out.push({ hash, codes });
  }
  return out;
}

export type ShopFunctionConfigCheck =
  | { ok: true; bytes: number }
  | { ok: false; bytes: number; reason: "not_json" | "invalid_shape" | "too_large" | "over_budget" };

/**
 * The sync's read-back check of a shop config (the exact JSON written, or the
 * `jsonValue` read back). Over 10 000 B the function would silently get `null`
 * (C7); over 9 000 B is outside the safety margin saveConfig guarantees.
 */
export function verifyShopFunctionConfig(json: string | unknown): ShopFunctionConfigCheck {
  const text = typeof json === "string" ? json : JSON.stringify(json ?? null);
  const bytes = utf8Bytes(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, bytes, reason: "not_json" };
  }
  if (bytes > FUNCTION_METAFIELD_LIMIT_BYTES) return { ok: false, bytes, reason: "too_large" };
  if (!isFunctionConfigPayload(parsed)) return { ok: false, bytes, reason: "invalid_shape" };
  const p = parsed as unknown as Record<string, unknown>;
  const nullableString = (x: unknown) => x === null || typeof x === "string";
  if (!nullableString(p.campaignId) || !nullableString(p.campaignVarsVersion)) {
    return { ok: false, bytes, reason: "invalid_shape" };
  }
  if (bytes > FUNCTION_CONFIG_BUDGET_BYTES) return { ok: false, bytes, reason: "over_budget" };
  return { ok: true, bytes };
}
