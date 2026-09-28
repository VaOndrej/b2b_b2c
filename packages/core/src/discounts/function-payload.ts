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
// Writing variables to N nodes is not atomic, so both sides carry a
// `varsVersion` derived from the selected campaign (id + window): a node applies
// campaign overrides only when its `campaignId` + `varsVersion` equal the shop
// config's `campaignId` + `campaignVarsVersion` (plan.ts). A node with stale
// variables plans as if no campaign were active — deterministic and safe.
// [spec] Sync order: node variables first, the shop config last (the flip).
//
// A shop config over 10 000 B reaches the function as `null` WITHOUT an error
// (C7), hence the 9 000 B budget at save time and `verifyShopFunctionConfig`
// for the sync's read-back.
//
// Targeting is precomputed into product metafields (targeting.ts), so rule
// targets ship as `{kind}` only: product/variant/collection id lists never
// reach the function or its byte budget.

import type {
  DiscountMethod,
  DiscountRule,
  DiscountRuleValue,
  DiscountTargetKind,
  EngineSettings,
  GiftTier,
  MarginModule,
  ReadonlyDeep,
  TierSet,
  WonDiscountsConfig,
} from "./config.ts";
import { fnv1a } from "./config/sanitize-helpers.ts";
import type { CartCampaignInput } from "./cart.ts";
import type { NodeRole } from "./emit.ts";
import { FUNCTION_CONFIG_BUDGET_BYTES, liveCampaigns, NO_CAMPAIGN_DATETIME, selectCampaign } from "./function-config.ts";
import type { MoneyByCurrency } from "./money.ts";
import { isFunctionConfigPayload } from "./plan.ts";

export { isFunctionConfigPayload };

/** Shopify's hard limit for a metafield read by a function (C3/C7: 10 000 B passes, 10 001 B is `null`). */
export const FUNCTION_METAFIELD_LIMIT_BYTES = 10_000;

/** A discount rule as the engine reads it (no admin-only fields, no target id lists). */
export interface FunctionRule {
  id: string;
  enabled: boolean;
  name: string;
  method: DiscountMethod;
  /** Code rules only, upper-case. */
  codes?: string[];
  value: DiscountRuleValue;
  target: { kind: DiscountTargetKind };
  priority?: number;
  minimum?: { subtotal?: MoneyByCurrency; quantity?: number };
  schedule?: { startsAt?: string; endsAt?: string };
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
  /** The current-or-next live campaign the node variables were written for (null = none). */
  campaignId: string | null;
  /** Must equal a node's `varsVersion` for that node to apply the campaign. */
  campaignVarsVersion: string | null;
  engine: EngineSettings;
  modules: {
    codes: { rules: FunctionRule[] };
    tiers: { sets: TierSet[] };
    rewards: { freeShipping?: { threshold: MoneyByCurrency }; gifts: GiftTier[]; countOtherDiscounts: boolean };
    margin: MarginModule;
  };
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
  /** Shop-local `YYYY-MM-DDTHH:MM:SS`: picks the current-or-next campaign and drops ended ones. */
  now?: string;
  /** Force the selected campaign (worst-case measurement): a live campaign id, or null for none. */
  campaignId?: string | null;
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

/**
 * Version of the campaign variables: a content hash of the selected campaign's id
 * and window, so the shop config and every node compute the same value from the
 * same config without a shared counter, and an edited window (same id) is a new
 * version that stale nodes cannot match. `null` when there is no campaign.
 */
export function campaignVarsVersion(campaign: { id: string; window: { start: string; end: string } } | null): string | null {
  return campaign ? `v${fnv1a(`${campaign.id}|${campaign.window.start}|${campaign.window.end}`)}` : null;
}

function select(config: ConfigInput, opts: ShopFunctionConfigOptions): CampaignInput | null {
  if (opts.campaignId !== undefined) return selectCampaign(config.campaigns, { campaignId: opts.campaignId });
  return selectCampaign(config.campaigns, opts.now === undefined ? {} : { now: opts.now });
}

function shipRule(r: ReadonlyDeep<DiscountRule>): FunctionRule {
  const out: FunctionRule = {
    id: r.id,
    enabled: r.enabled,
    name: r.name,
    method: r.method,
    value: copy<DiscountRuleValue>(r.value),
    target: { kind: r.target.kind },
  };
  if (r.method === "code" && r.codes) out.codes = [...r.codes];
  if (r.priority) out.priority = r.priority;
  const subtotal = r.minimum?.subtotal;
  const hasSubtotal = subtotal !== undefined && Object.keys(subtotal).length > 0;
  const quantity = r.minimum?.quantity ?? 0;
  if (hasSubtotal || quantity > 0) {
    out.minimum = {};
    if (hasSubtotal) out.minimum.subtotal = { ...subtotal };
    if (quantity > 0) out.minimum.quantity = quantity;
  }
  if (r.schedule && (r.schedule.startsAt || r.schedule.endsAt)) out.schedule = { ...r.schedule };
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

function encode(payload: FunctionConfigPayload): EncodedShopFunctionConfig {
  const json = JSON.stringify(payload);
  const bytes = utf8Bytes(json);
  return { payload, json, bytes, fits: bytes <= FUNCTION_CONFIG_BUDGET_BYTES };
}

/**
 * The shared function config (the shop metafield). With `now`, campaigns whose
 * window already ended are dropped (they can never apply again) and the
 * current-or-next live campaign is the one node variables are written for.
 */
export function buildShopFunctionConfig(
  config: ConfigInput,
  nowOrOptions?: string | ShopFunctionConfigOptions,
): EncodedShopFunctionConfig {
  const opts: ShopFunctionConfigOptions = typeof nowOrOptions === "string" ? { now: nowOrOptions } : (nowOrOptions ?? {});
  const selected = select(config, opts);
  const { codes, tiers, rewards, margin } = config.modules;
  return encode({
    schemaVersion: config.schemaVersion,
    campaignId: selected ? selected.id : null,
    campaignVarsVersion: campaignVarsVersion(selected),
    engine: copy<EngineSettings>(config.engine),
    modules: {
      codes: { rules: codes.rules.map(shipRule) },
      tiers: { sets: copy<TierSet[]>(tiers.sets) },
      rewards: {
        ...(rewards.freeShipping ? { freeShipping: copy<{ threshold: MoneyByCurrency }>(rewards.freeShipping) } : {}),
        gifts: copy<GiftTier[]>(rewards.gifts),
        countOtherDiscounts: rewards.countOtherDiscounts,
      },
      margin: copy<MarginModule>(margin),
    },
    campaigns: liveCampaigns(config.campaigns)
      .filter((c) => opts.now === undefined || c.window.end > opts.now)
      .map((c) => ({
        id: c.id,
        window: { start: c.window.start, end: c.window.end },
        overrides: c.overrides.map((o) => ({ ruleId: o.ruleId, patch: shipPatch(o.patch) })),
      })),
  });
}

export interface WorstCaseShopFunctionConfig extends EncodedShopFunctionConfig {
  /** The selected campaign that makes the payload largest (`null` = none). */
  campaignId: string | null;
}

/**
 * The largest shared config this config can produce over time (every live
 * campaign selected, or none; nothing pruned). Save must be refused unless it fits.
 */
export function buildShopFunctionConfigWorstCase(config: ConfigInput): WorstCaseShopFunctionConfig {
  let worst: WorstCaseShopFunctionConfig = { ...buildShopFunctionConfig(config, { campaignId: null }), campaignId: null };
  for (const campaign of liveCampaigns(config.campaigns)) {
    const encoded = buildShopFunctionConfig(config, { campaignId: campaign.id });
    if (encoded.bytes > worst.bytes) worst = { ...encoded, campaignId: campaign.id };
  }
  return worst;
}

/**
 * The per-node variables: role, rule (code nodes) and the current-or-next live
 * campaign at `now` (1970 → 1970 = never active when there is none), with the
 * same `varsVersion` the shop config built at the same `now` carries.
 */
export function buildNodeVars(role: NodeRole, config: ConfigInput, now?: string): NodeVars {
  const selected = select(config, now === undefined ? {} : { now });
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
