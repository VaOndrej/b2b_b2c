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
//     guards the admin save);
//   - schedules as SHOP-LOCAL dates (`startsOn`/`endsOn`), converted with the
//     shop's IANA time zone, because the function can only compare
//     `shop.localTime.date`;
//   - Pro market targeting as `marketCountries` (the function's
//     `localization.market` is deprecated; the engine matches the cart country).

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
  type MarginModule,
  type ReadonlyDeep,
  type TierSet,
  type WonDiscountsConfig,
} from "./config.ts";
import { fnv1a } from "./config/sanitize-helpers.ts";
import type { NodeRole } from "./emit.ts";
import { FUNCTION_CONFIG_BUDGET_BYTES, liveCampaigns, NO_CAMPAIGN_DATETIME, selectCampaign } from "./function-config.ts";
import type { MoneyByCurrency } from "./money.ts";
import { isFunctionConfigPayload } from "./plan.ts";

export { isFunctionConfigPayload };

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
  minimum?: { subtotal?: MoneyByCurrency; quantity?: number };
  /** Shop-local calendar days, inclusive (`YYYY-MM-DD`). */
  schedule?: { startsOn?: string; endsOn?: string };
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
  /** Market handle → upper-case countries, for enabled markets some rule targets. */
  marketCountries: Record<string, string[]>;
  modules: {
    codes: { rules: FunctionRule[] };
    tiers: { sets: TierSet[] };
    rewards: { freeShipping?: { threshold: MoneyByCurrency }; gifts: GiftTier[]; countOtherDiscounts: boolean };
    margin: MarginModule;
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

/** An instant as shop-local { date: "YYYY-MM-DD", midnight } (DST-safe: Intl does the zone math). */
function localParts(iso: string, formatter: Intl.DateTimeFormat): { date: string; midnight: boolean } | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts: Record<string, string> = {};
  for (const p of formatter.formatToParts(new Date(ms))) parts[p.type] = p.value;
  const subSecond = ms % 1000 !== 0;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    midnight: parts.hour === "00" && parts.minute === "00" && parts.second === "00" && !subSecond,
  };
}

function previousDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * A rule schedule (ISO date-times with any offset, `Z` included) as the shop's
 * calendar days: `startsOn` = the local day of `startsAt`; `endsOn` = the local
 * day of `endsAt`, or the day before when it ends exactly at local midnight.
 * [spec] Day granularity: the rule is live the whole of both days.
 */
export function shopLocalDates(
  schedule: { startsAt?: string; endsAt?: string },
  shopTimezone: string,
): { startsOn?: string; endsOn?: string } {
  const formatter = formatterFor(shopTimezone, "shopLocalDates");
  const out: { startsOn?: string; endsOn?: string } = {};
  if (schedule.startsAt) {
    const start = localParts(schedule.startsAt, formatter);
    if (start) out.startsOn = start.date;
  }
  if (schedule.endsAt) {
    const end = localParts(schedule.endsAt, formatter);
    if (end) out.endsOn = end.midnight ? previousDay(end.date) : end.date;
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
  }
  if (r.schedule && (r.schedule.startsAt || r.schedule.endsAt)) out.schedule = shopLocalDates(r.schedule, shopTimezone);
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

function shipMarketCountries(config: ConfigInput): Record<string, string[]> {
  const targeted = new Set<string>();
  for (const rule of config.modules.codes.rules) for (const m of rule.targeting?.markets ?? []) targeted.add(m);
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

function build(config: ConfigInput, selected: CampaignInput | null, shopTimezone: string): EncodedShopFunctionConfig {
  formatterFor(shopTimezone, "buildShopFunctionConfig"); // validate the zone once, up front
  const { codes, tiers, rewards, margin } = config.modules;
  return encode({
    schemaVersion: config.schemaVersion,
    campaignId: selected ? selected.id : null,
    campaignVarsVersion: campaignVarsVersion(selected),
    engine: copy<EngineSettings>(config.engine),
    marketCountries: shipMarketCountries(config),
    modules: {
      codes: { rules: codes.rules.map((r) => shipRule(r, shopTimezone)) },
      tiers: { sets: copy<TierSet[]>(tiers.sets) },
      rewards: {
        ...(rewards.freeShipping ? { freeShipping: copy<{ threshold: MoneyByCurrency }>(rewards.freeShipping) } : {}),
        gifts: copy<GiftTier[]>(rewards.gifts),
        countOtherDiscounts: rewards.countOtherDiscounts,
      },
      margin: copy<MarginModule>(margin),
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
  return build(config, selected, opts.shopTimezone);
}

export interface WorstCaseShopFunctionConfig extends EncodedShopFunctionConfig {
  /** The selected campaign that makes the payload largest (`null` = none). */
  campaignId: string | null;
}

/**
 * The largest shared config this config can produce over time: every live
 * campaign as the selected one, and none. Save must be refused unless it fits.
 * Byte size does not depend on the time zone (schedule days are fixed-length),
 * so `shopTimezone` is optional here and only shapes the returned payload.
 */
export function buildShopFunctionConfigWorstCase(
  config: ConfigInput,
  opts: { shopTimezone?: string } = {},
): WorstCaseShopFunctionConfig {
  const zone = opts.shopTimezone ?? "UTC";
  let worst: WorstCaseShopFunctionConfig = { ...build(config, null, zone), campaignId: null };
  for (const campaign of liveCampaigns(config.campaigns)) {
    const encoded = build(config, campaign, zone);
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
