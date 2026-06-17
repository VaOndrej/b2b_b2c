import {
  detectDiscountFloorConflicts,
  type AutomaticDiscount,
  type ConflictDetectionProduct,
  type DiscountFloorConflict,
} from "../../core/discount/conflict.detector.ts";
import type { Segment } from "../../core/segment/segment.types.ts";
import {
  buildDiscountRuleset,
  buildFloorRuleset,
  getOrCreateMarginGuardConfig,
} from "./margin-guard-config.server.ts";
import { fetchAutomaticDiscounts } from "./automatic-discounts.server.ts";
import {
  getCatalogCollectionMapByIds,
  getCatalogProductMapByIds,
} from "./product-catalog.server.ts";
import { fetchProductCollectionIdsByProductIds } from "./storefront-visibility.server.ts";

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

// The floor and discounts are both expressed as a percentage of the same base
// price, so a conflict is price-independent. A nominal base lets us evaluate
// every product/scope without fetching real prices.
const NOMINAL_BASE_PRICE = 100;
const STOREWIDE_PROBE_ID = "__margin_guard_storewide_probe__";

export type ConflictTargetKind = "STOREWIDE" | "PRODUCT" | "COLLECTION";

export interface DiscountConflictView {
  targetKind: ConflictTargetKind;
  targetId: string | null;
  targetLabel: string;
  segment: Segment;
  floorPercent: number;
  totalPercentOff: number;
  reason: DiscountFloorConflict["reason"];
  discount: {
    id: string;
    title: string;
    percentOff: number;
  };
}

export interface DiscountConflictReport {
  conflicts: DiscountConflictView[];
  automaticDiscountCount: number;
}

type MarginGuardConfig = Awaited<ReturnType<typeof getOrCreateMarginGuardConfig>>;

export interface CartConflictNotice {
  discountTitle: string;
  percentOff: number;
  floorPercent: number;
  totalPercentOff: number;
  reason: DiscountFloorConflict["reason"];
}

function buildFloorRulesetFromConfig(config: MarginGuardConfig) {
  return buildFloorRuleset({
    globalMinPricePercent: config.globalMinPricePercent,
    b2bGlobalMinPricePercent: config.b2bGlobalMinPricePercent,
    allowZeroFinalPrice: config.allowZeroFinalPrice,
    productFloors: config.productFloors.map((rule) => ({
      productId: rule.productId,
      segment: rule.segment,
      minPercentOfBasePrice: rule.minPercentOfBasePrice,
      allowZeroFinalPrice: rule.allowZeroFinalPrice ?? null,
      b2bOverridePrice: rule.b2bOverridePrice ?? null,
    })),
  });
}

/**
 * Live, segment-specific conflict lookup for the storefront cart. Given the cart
 * line handles (already mapped to product ids + collections by the visibility
 * loader), returns the automatic-discount/floor conflicts per handle so the cart
 * can warn shoppers that a discount will be clipped or blocked at checkout.
 */
export async function resolveCartDiscountConflictsByHandle(input: {
  admin: AdminGraphqlClient | undefined;
  config: MarginGuardConfig;
  segment: Segment;
  handles: string[];
  productIdByHandle: Record<string, string>;
  productCollectionIdsByProductId: Record<string, string[]>;
}): Promise<Record<string, CartConflictNotice[]>> {
  if (!input.admin || input.handles.length === 0) {
    return {};
  }

  const automaticDiscounts = await fetchAutomaticDiscounts(input.admin);
  if (automaticDiscounts.length === 0) {
    return {};
  }

  const cartProductIds = input.handles
    .map((handle) => input.productIdByHandle[handle])
    .filter((productId): productId is string => Boolean(productId));

  // The membership map passed in by the visibility loader only covers collections
  // that have quantity rules. Resolve memberships for collections targeted by
  // automatic discounts so collection-scoped conflicts are not missed in the cart.
  const discountCollectionIds = Array.from(
    new Set(
      automaticDiscounts
        .filter((discount) => discount.scope === "COLLECTION" && discount.targetId)
        .map((discount) => discount.targetId as string),
    ),
  );
  let collectionMembership = input.productCollectionIdsByProductId;
  if (discountCollectionIds.length > 0 && cartProductIds.length > 0) {
    const extraMembership = await fetchProductCollectionIdsByProductIds({
      admin: input.admin,
      productIds: cartProductIds,
      collectionIds: discountCollectionIds,
    });
    collectionMembership = { ...input.productCollectionIdsByProductId };
    for (const [productId, collectionIds] of Object.entries(extraMembership)) {
      collectionMembership[productId] = Array.from(
        new Set([...(collectionMembership[productId] ?? []), ...collectionIds]),
      );
    }
  }

  const handleByProductId = new Map<string, string>();
  const products: ConflictDetectionProduct[] = [];
  for (const handle of input.handles) {
    const productId = input.productIdByHandle[handle];
    if (!productId) {
      continue;
    }
    handleByProductId.set(productId, handle);
    products.push({
      productId,
      handle,
      effectiveBasePrice: NOMINAL_BASE_PRICE,
      collectionIds: collectionMembership[productId] ?? [],
    });
  }
  if (products.length === 0) {
    return {};
  }

  const conflicts = detectDiscountFloorConflicts({
    products,
    automaticDiscounts,
    configuredDiscountRules: buildDiscountRuleset(input.config),
    floorRuleset: buildFloorRulesetFromConfig(input.config),
    segments: [input.segment],
  });

  const byHandle: Record<string, CartConflictNotice[]> = {};
  for (const conflict of conflicts) {
    const handle = handleByProductId.get(conflict.productId);
    if (!handle) {
      continue;
    }
    (byHandle[handle] ??= []).push({
      discountTitle: conflict.offendingDiscount.title ?? "Automatic discount",
      percentOff: conflict.offendingDiscount.percentOff,
      floorPercent: Math.round((conflict.floorPrice / NOMINAL_BASE_PRICE) * 100),
      totalPercentOff: conflict.totalPercentOff,
      reason: conflict.reason,
    });
  }
  return byHandle;
}

function collectProbeProductIds(
  config: MarginGuardConfig,
  automaticDiscounts: AutomaticDiscount[],
): Set<string> {
  const productIds = new Set<string>();
  for (const rule of config.productFloors) {
    if (rule.productId) {
      productIds.add(rule.productId);
    }
  }
  for (const rule of config.discountRules) {
    if (rule.scope === "PRODUCT" && rule.targetId) {
      productIds.add(rule.targetId);
    }
  }
  for (const discount of automaticDiscounts) {
    if (discount.scope === "PRODUCT" && discount.targetId) {
      productIds.add(discount.targetId);
    }
  }
  return productIds;
}

function collectProbeCollectionIds(automaticDiscounts: AutomaticDiscount[]): Set<string> {
  const collectionIds = new Set<string>();
  for (const discount of automaticDiscounts) {
    if (discount.scope === "COLLECTION" && discount.targetId) {
      collectionIds.add(discount.targetId);
    }
  }
  return collectionIds;
}

/**
 * Compute admin-facing discount/floor conflicts: active automatic Shopify
 * discounts that, combined with the configured margin-guard rules, would push a
 * product below the margin floor and get blocked at checkout.
 */
export async function buildDiscountConflictReport(
  admin: AdminGraphqlClient,
): Promise<DiscountConflictReport> {
  const config = await getOrCreateMarginGuardConfig();
  const automaticDiscounts = await fetchAutomaticDiscounts(admin);

  if (automaticDiscounts.length === 0) {
    return { conflicts: [], automaticDiscountCount: 0 };
  }

  const floorRuleset = buildFloorRulesetFromConfig(config);
  const discountRuleset = buildDiscountRuleset(config);

  const probeProductIds = collectProbeProductIds(config, automaticDiscounts);
  const probeCollectionIds = collectProbeCollectionIds(automaticDiscounts);

  const [productMap, collectionMap] = await Promise.all([
    probeProductIds.size > 0
      ? getCatalogProductMapByIds(Array.from(probeProductIds))
      : Promise.resolve({} as Record<string, { title?: string; handle?: string | null }>),
    probeCollectionIds.size > 0
      ? getCatalogCollectionMapByIds(Array.from(probeCollectionIds))
      : Promise.resolve({} as Record<string, { title?: string; handle?: string | null }>),
  ]);

  const probes: ConflictDetectionProduct[] = [
    { productId: STOREWIDE_PROBE_ID, effectiveBasePrice: NOMINAL_BASE_PRICE, collectionIds: [] },
  ];
  for (const productId of probeProductIds) {
    probes.push({
      productId,
      title: productMap[productId]?.title,
      handle: productMap[productId]?.handle ?? undefined,
      effectiveBasePrice: NOMINAL_BASE_PRICE,
      collectionIds: [],
    });
  }
  for (const collectionId of probeCollectionIds) {
    probes.push({
      productId: `__collection_probe__:${collectionId}`,
      title: collectionMap[collectionId]?.title,
      effectiveBasePrice: NOMINAL_BASE_PRICE,
      collectionIds: [collectionId],
    });
  }

  const rawConflicts = detectDiscountFloorConflicts({
    products: probes,
    automaticDiscounts,
    configuredDiscountRules: discountRuleset,
    floorRuleset,
  });

  const conflicts = rawConflicts.map((conflict): DiscountConflictView => {
    const floorPercent = Math.round((conflict.floorPrice / NOMINAL_BASE_PRICE) * 100);
    const base = {
      segment: conflict.segment,
      floorPercent,
      totalPercentOff: conflict.totalPercentOff,
      reason: conflict.reason,
      discount: {
        id: conflict.offendingDiscount.id,
        title: conflict.offendingDiscount.title ?? "Automatic discount",
        percentOff: conflict.offendingDiscount.percentOff,
      },
    };

    if (conflict.productId === STOREWIDE_PROBE_ID) {
      return { ...base, targetKind: "STOREWIDE", targetId: null, targetLabel: "All products" };
    }
    if (conflict.productId.startsWith("__collection_probe__:")) {
      const collectionId = conflict.productId.slice("__collection_probe__:".length);
      return {
        ...base,
        targetKind: "COLLECTION",
        targetId: collectionId,
        targetLabel: conflict.title ?? "Collection",
      };
    }
    return {
      ...base,
      targetKind: "PRODUCT",
      targetId: conflict.productId,
      targetLabel: conflict.title ?? conflict.productId,
    };
  });

  return { conflicts, automaticDiscountCount: automaticDiscounts.length };
}
