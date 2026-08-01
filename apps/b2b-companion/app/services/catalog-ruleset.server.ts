import { buildCatalogConfigFromCatalogs } from "@won/core/config/function-config";
import {
  buildCatalogRulesets,
  resolveCatalogRuleset,
  type CatalogRuleset,
  type CatalogRulesetConfig,
} from "@won/core/catalog/catalog.ruleset";
import { getOrCreateMarginGuardConfig } from "./margin-guard-config.server.ts";
import { loadAllCatalogsForConfig } from "./price-catalog.server.ts";

export interface StorefrontCatalogQuantity {
  productQuantityRules: Array<{
    productId: string;
    segment: null;
    minimumOrderQuantity: number | null;
    stepQuantity: number | null;
    maxOrderQuantity: number | null;
  }>;
  collectionQuantityRules: Array<{
    collectionId: string;
    segment: null;
    maxOrderQuantity: number | null;
  }>;
  customerQuantityRules: Array<{
    productId: string;
    customerId: string;
    maxOrderQuantity: number;
  }>;
}

export type { CatalogRuleset } from "@won/core/catalog/catalog.ruleset";
export {
  findCatalogRuleset,
  resolveCatalogRuleset,
} from "@won/core/catalog/catalog.ruleset";

// MVP_5_3 #2.3c — single entry point that assembles the per-catalog rulesets the
// conflict detector / webhook / preview consume. Shop-wide scalars come from
// MarginGuardConfig; everything else (floors, discounts, caps, tiers) is sourced
// from catalog tables via buildCatalogConfigFromCatalogs → buildCatalogRulesets.
// Resilient to missing catalog tables (falls back to default/b2b only).
export async function loadCatalogRulesets(deps?: {
  getOrCreateMarginGuardConfig?: typeof getOrCreateMarginGuardConfig;
  loadAllCatalogsForConfig?: typeof loadAllCatalogsForConfig;
}): Promise<CatalogRuleset[]> {
  const loadConfig = deps?.getOrCreateMarginGuardConfig ?? getOrCreateMarginGuardConfig;
  const loadCatalogs = deps?.loadAllCatalogsForConfig ?? loadAllCatalogsForConfig;

  const config = await loadConfig();
  const catalogs = await loadCatalogs().catch(() => []);
  const catalogConfig = buildCatalogConfigFromCatalogs(
    {
      b2bTag: config.b2bTag,
      globalMinPricePercent: config.globalMinPricePercent,
      allowZeroFinalPrice: config.allowZeroFinalPrice,
      allowStacking: config.allowStacking,
      maxCombinedPercentOff: config.maxCombinedPercentOff,
      marginGuardEnabled: config.marginGuardEnabled,
    },
    catalogs,
  );
  return buildCatalogRulesets(catalogConfig as unknown as CatalogRulesetConfig);
}

// MVP_5_4_9 — which catalog a storefront customer resolves into, from their
// audience tags (+ purchasing company). Used for the informational `catalogId`
// field on the visibility response. Resilient to missing catalog tables.
export async function resolveStorefrontCatalogId(
  input: {
    matchedTags: string[];
    hasPurchasingCompany?: boolean;
  },
  deps?: {
    getOrCreateMarginGuardConfig?: typeof getOrCreateMarginGuardConfig;
    loadAllCatalogsForConfig?: typeof loadAllCatalogsForConfig;
  },
): Promise<string | null> {
  const rulesets = await loadCatalogRulesets(deps);
  const ruleset = resolveCatalogRuleset(rulesets, {
    matchedTags: input.matchedTags,
    hasPurchasingCompany: input.hasPurchasingCompany,
  });
  return ruleset?.catalogId ?? null;
}

// MVP_5_3 #2.3c — storefront quantity hints (MOQ/step/max, collection max,
// customer-specific max) for the customer's resolved catalog, sourced from
// catalog tables. Replaces the visibility loader's legacy MarginGuardConfig
// quantity children. Resilient to missing catalog tables.
export async function loadStorefrontCatalogQuantity(
  input: {
    matchedTags: string[];
    hasPurchasingCompany?: boolean;
    customerId?: string | null;
  },
  deps?: {
    getOrCreateMarginGuardConfig?: typeof getOrCreateMarginGuardConfig;
    loadAllCatalogsForConfig?: typeof loadAllCatalogsForConfig;
  },
): Promise<StorefrontCatalogQuantity> {
  const empty: StorefrontCatalogQuantity = {
    productQuantityRules: [],
    collectionQuantityRules: [],
    customerQuantityRules: [],
  };
  const loadConfig = deps?.getOrCreateMarginGuardConfig ?? getOrCreateMarginGuardConfig;
  const loadCatalogs = deps?.loadAllCatalogsForConfig ?? loadAllCatalogsForConfig;

  const config = await loadConfig();
  const catalogs = await loadCatalogs().catch(() => []);
  const catalogConfig = buildCatalogConfigFromCatalogs(
    {
      b2bTag: config.b2bTag,
      globalMinPricePercent: config.globalMinPricePercent,
      allowZeroFinalPrice: config.allowZeroFinalPrice,
      allowStacking: config.allowStacking,
      maxCombinedPercentOff: config.maxCombinedPercentOff,
      marginGuardEnabled: config.marginGuardEnabled,
    },
    catalogs,
  );
  const rulesets = buildCatalogRulesets(catalogConfig as unknown as CatalogRulesetConfig);
  const ruleset = resolveCatalogRuleset(rulesets, {
    matchedTags: input.matchedTags,
    hasPurchasingCompany: input.hasPurchasingCompany,
  });
  if (!ruleset) {
    return empty;
  }
  const layer = ruleset.effectiveLayer;

  const productIds = Array.from(
    new Set([
      ...Object.keys(layer.perProductMinimumOrderQuantities),
      ...Object.keys(layer.perProductStepQuantities),
      ...Object.keys(layer.perProductMaximumOrderQuantities),
    ]),
  );
  const productQuantityRules = productIds.map((productId) => ({
    productId,
    segment: null as null,
    minimumOrderQuantity: layer.perProductMinimumOrderQuantities[productId] ?? null,
    stepQuantity: layer.perProductStepQuantities[productId] ?? null,
    maxOrderQuantity: layer.perProductMaximumOrderQuantities[productId] ?? null,
  }));

  const collectionQuantityRules = Object.entries(
    layer.perCollectionMaximumOrderQuantities,
  ).map(([collectionId, maxOrderQuantity]) => ({
    collectionId,
    segment: null as null,
    maxOrderQuantity,
  }));

  // Customer-specific maxima are shop-wide in the catalog config (not per-catalog).
  const customerMap = (catalogConfig.perCustomerProductMaximumOrderQuantities ??
    {}) as Record<string, Record<string, number>>;
  const customerId = String(input.customerId ?? "").trim();
  const customerQuantityRules =
    customerId && customerMap[customerId]
      ? Object.entries(customerMap[customerId]).map(([productId, maxOrderQuantity]) => ({
          productId,
          customerId,
          maxOrderQuantity,
        }))
      : [];

  return { productQuantityRules, collectionQuantityRules, customerQuantityRules };
}
