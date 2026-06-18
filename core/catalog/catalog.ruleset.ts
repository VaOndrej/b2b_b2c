import type {
  CatalogMarketFilter,
  CatalogPricingLayer,
  CatalogResolutionEntry,
  EffectiveCatalogPricingLayer,
  MarketContext,
} from "./catalog.types.ts";
import { mergeCatalogLayer } from "./catalog.merge.ts";
import { resolveCatalog } from "./catalog.resolver.ts";
import type { FloorRuleset } from "../margin/floor.rules.ts";
import type {
  ConfiguredDiscountRule,
  DiscountBlacklistRule,
  DiscountReferenceType,
  DiscountRules,
  DiscountScope,
  DiscountStackMode,
} from "../discount/discount.rules.ts";

// MVP_5_3 #2.3c — per-catalog ruleset adapter.
//
// The conflict detector, webhook violation logging and pricing preview were all
// segment (B2B/B2C) shaped and read the legacy MarginGuardConfig children.
// Catalogs generalize segment→catalogId, so rather than rewrite those
// segment-shaped cores we run them once PER catalog: each catalog's effective
// layer (merge(base, delta) — the same merge the Shopify Functions perform at
// runtime) is mapped to the SAME FloorRuleset / DiscountRules shapes, sourced
// entirely from catalog tables. The `segment` field on each ruleset is the
// catalog's mapped audience (used only to filter native discounts that target a
// customer segment); within a catalog's ruleset everything is segment-agnostic
// so the segment-keyed cores can be invoked with a single dummy audience.

export interface CatalogRulesetDiscountRuleInput {
  id: string;
  scope: string;
  targetId?: string | null;
  code?: string | null;
  percentOff: number;
  priority?: number;
  stackMode?: string;
  minPricePercentOfBasePrice?: number | null;
  requiredCustomerTag?: string | null;
  catalogId?: string | null;
}

export interface CatalogRulesetBlacklistInput {
  leftType: string;
  leftValue: string;
  rightType: string;
  rightValue: string;
  catalogId?: string | null;
}

export interface CatalogRulesetConfig {
  defaultCatalogId: string;
  base: CatalogPricingLayer;
  catalogs: Record<string, CatalogPricingLayer>;
  catalogResolution: Array<{
    id: string;
    isDefault?: boolean;
    segment?: "B2B" | "B2C";
    audienceTags?: string[];
    priority?: number;
    matchCompany?: boolean;
    marketFilters?: CatalogMarketFilter[];
  }>;
  discountRules?: CatalogRulesetDiscountRuleInput[];
  discountCombinationBlacklistRules?: CatalogRulesetBlacklistInput[];
  discountCatalogCaps?: Record<string, number>;
  maxCombinedPercentOff?: number | null;
  allowStacking?: boolean;
}

// Flattened per-catalog arrays for the segment-shaped webhook / preview cores
// (they accept ProductFloor / TierPrice arrays). segment is always null = the
// rule applies to this catalog's single audience.
export interface CatalogProductFloorInput {
  productId: string;
  segment: null;
  minPercentOfBasePrice: number;
  allowZeroFinalPrice: boolean | null;
  b2bOverridePrice: number | null;
}

export interface CatalogProductTierPriceInput {
  productId: string;
  segment: null;
  minQuantity: number;
  unitPrice: number;
}

export interface CatalogRuleset {
  catalogId: string;
  isDefault: boolean;
  segment: "B2B" | "B2C";
  audienceTags: string[];
  priority: number;
  matchCompany: boolean;
  marketFilters: CatalogMarketFilter[];
  effectiveLayer: EffectiveCatalogPricingLayer;
  floorRuleset: FloorRuleset;
  discountRuleset: DiscountRules;
  productFloors: CatalogProductFloorInput[];
  productTierPrices: CatalogProductTierPriceInput[];
}

const VALID_SCOPES = new Set(["GLOBAL", "COLLECTION", "PRODUCT", "COUPON"]);
const VALID_STACK = new Set(["STACKABLE", "EXCLUSIVE", "NEVER_WITH_COUPONS"]);
const VALID_REF = new Set(["RULE_ID", "COUPON_CODE", "SCOPE"]);

function normScope(value: string): Exclude<DiscountScope, "INPUT"> {
  return (VALID_SCOPES.has(value) ? value : "GLOBAL") as Exclude<
    DiscountScope,
    "INPUT"
  >;
}
function normStack(value: string | undefined): DiscountStackMode {
  return (value && VALID_STACK.has(value) ? value : "STACKABLE") as DiscountStackMode;
}
function normRef(value: string): DiscountReferenceType {
  return (VALID_REF.has(value) ? value : "COUPON_CODE") as DiscountReferenceType;
}

function buildFloorRulesetFromLayer(eff: EffectiveCatalogPricingLayer): FloorRuleset {
  return {
    global: {
      minPercentOfBasePrice: eff.globalMinPricePercent,
      b2bMinPercentOfBasePrice: eff.globalMinPricePercent,
      allowZeroFinalPrice: eff.allowZeroFinalPrice,
    },
    perProduct: Object.entries(eff.perProductFloorPercents).map(
      ([productId, pct]) => ({
        productId,
        minPercentOfBasePrice: pct,
        allowZeroFinalPriceOverride:
          eff.perProductAllowZeroFinalPrice[productId] ?? undefined,
      }),
    ),
  };
}

function buildDiscountRulesetForCatalog(
  config: CatalogRulesetConfig,
  catalogId: string,
  isDefault: boolean,
): DiscountRules {
  // Default-catalog rules carry catalogId === null (shop-wide); a non-default
  // catalog's rules carry its own id.
  const belongs = (ruleCatalogId: string | null | undefined) =>
    isDefault ? ruleCatalogId == null : ruleCatalogId === catalogId;

  const rules: ConfiguredDiscountRule[] = [];
  for (const rule of config.discountRules ?? []) {
    if (!belongs(rule.catalogId)) continue;
    const percentOff = Number(rule.percentOff);
    if (!Number.isFinite(percentOff) || percentOff <= 0) continue;
    rules.push({
      id: rule.id,
      scope: normScope(rule.scope),
      targetId: rule.targetId ?? undefined,
      code: rule.code ?? undefined,
      percentOff: Math.min(100, Math.max(0, percentOff)),
      priority: Number.isFinite(rule.priority)
        ? Math.floor(Number(rule.priority))
        : 100,
      stackMode: normStack(rule.stackMode),
      minPricePercentOfBasePrice:
        rule.minPricePercentOfBasePrice != null &&
        Number.isFinite(rule.minPricePercentOfBasePrice)
          ? rule.minPricePercentOfBasePrice
          : undefined,
      requiredCustomerTag:
        String(rule.requiredCustomerTag ?? "").trim() || undefined,
    });
  }

  const blacklists: DiscountBlacklistRule[] = [];
  for (const rule of config.discountCombinationBlacklistRules ?? []) {
    if (!belongs(rule.catalogId)) continue;
    blacklists.push({
      leftType: normRef(rule.leftType),
      leftValue: rule.leftValue,
      rightType: normRef(rule.rightType),
      rightValue: rule.rightValue,
    });
  }

  const rawCap = isDefault
    ? config.maxCombinedPercentOff ?? null
    : config.discountCatalogCaps?.[catalogId] ??
      config.maxCombinedPercentOff ??
      null;

  return {
    allowStacking: config.allowStacking === true,
    maxCombinedPercentOff:
      rawCap != null && Number.isFinite(rawCap) ? rawCap : undefined,
    rules,
    blacklists,
    segmentCaps: [],
  };
}

function flattenProductFloors(
  eff: EffectiveCatalogPricingLayer,
): CatalogProductFloorInput[] {
  return Object.entries(eff.perProductFloorPercents).map(([productId, pct]) => ({
    productId,
    segment: null,
    minPercentOfBasePrice: pct,
    allowZeroFinalPrice: eff.perProductAllowZeroFinalPrice[productId] ?? null,
    b2bOverridePrice: eff.perProductOverrideBasePrices[productId] ?? null,
  }));
}

function flattenProductTierPrices(
  eff: EffectiveCatalogPricingLayer,
): CatalogProductTierPriceInput[] {
  const out: CatalogProductTierPriceInput[] = [];
  for (const [productId, tiers] of Object.entries(eff.perProductTierPrices)) {
    for (const tier of tiers) {
      out.push({
        productId,
        segment: null,
        minQuantity: tier.minQuantity,
        unitPrice: tier.unitPrice,
      });
    }
  }
  return out;
}

/**
 * Map a catalog config (as produced by buildCatalogConfigFromCatalogs) to one
 * ruleset per catalog. Each ruleset is what a segment-shaped core (conflict
 * detector / webhook / preview) consumes; running the core once per catalog and
 * relabelling the result by catalogId yields per-catalog behavior with no core
 * rewrite.
 */
export function buildCatalogRulesets(
  config: CatalogRulesetConfig,
): CatalogRuleset[] {
  const out: CatalogRuleset[] = [];
  for (const entry of config.catalogResolution) {
    const isDefault =
      entry.isDefault === true || entry.id === config.defaultCatalogId;
    const delta = isDefault ? {} : config.catalogs[entry.id] ?? {};
    const eff = mergeCatalogLayer(config.base, delta);
    out.push({
      catalogId: entry.id,
      isDefault,
      segment: entry.segment === "B2B" ? "B2B" : "B2C",
      audienceTags: entry.audienceTags ?? [],
      priority: Number.isFinite(entry.priority) ? Number(entry.priority) : 0,
      matchCompany: entry.matchCompany === true,
      marketFilters: entry.marketFilters ?? [],
      effectiveLayer: eff,
      floorRuleset: buildFloorRulesetFromLayer(eff),
      discountRuleset: buildDiscountRulesetForCatalog(config, entry.id, isDefault),
      productFloors: flattenProductFloors(eff),
      productTierPrices: flattenProductTierPrices(eff),
    });
  }
  return out;
}

export function findCatalogRuleset(
  rulesets: CatalogRuleset[],
  catalogId: string,
): CatalogRuleset | undefined {
  return rulesets.find((ruleset) => ruleset.catalogId === catalogId);
}

/**
 * Resolve the single catalog ruleset a customer falls into (same audience/
 * priority/market logic the Shopify Functions use), so the segment-shaped cores
 * run against exactly the catalog that will price the customer's cart.
 */
export function resolveCatalogRuleset(
  rulesets: CatalogRuleset[],
  input: {
    matchedTags?: string[];
    hasPurchasingCompany?: boolean;
    marketContext?: MarketContext | null;
  },
): CatalogRuleset | undefined {
  if (rulesets.length === 0) {
    return undefined;
  }
  const entries: CatalogResolutionEntry[] = rulesets.map((ruleset) => ({
    id: ruleset.catalogId,
    priority: ruleset.priority,
    isDefault: ruleset.isDefault,
    audienceTags: ruleset.audienceTags,
    matchCompany: ruleset.matchCompany,
    marketFilters: ruleset.marketFilters,
    segment: ruleset.segment,
  }));
  const resolvedId = resolveCatalog({
    matchedTags: input.matchedTags ?? [],
    hasPurchasingCompany: input.hasPurchasingCompany === true,
    marketContext: input.marketContext ?? null,
    catalogs: entries,
  });
  if (!resolvedId) {
    return rulesets.find((ruleset) => ruleset.isDefault) ?? rulesets[0];
  }
  return (
    findCatalogRuleset(rulesets, resolvedId) ??
    rulesets.find((ruleset) => ruleset.isDefault) ??
    rulesets[0]
  );
}
