import {
  detectDiscountFloorConflicts,
  type AutomaticDiscount,
  type AutomaticDiscountValueType,
  type ConflictDetectionProduct,
  type DiscountFloorConflict,
} from "#core/discount/conflict.detector";
import {
  loadCatalogRulesets,
  resolveCatalogRuleset,
  type CatalogRuleset,
} from "./catalog-ruleset.server.ts";
import { fetchAutomaticDiscounts } from "./automatic-discounts.server.ts";
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

export interface CartConflictNotice {
  discountTitle: string;
  valueType: AutomaticDiscountValueType;
  percentOff: number;
  amount?: number;
  unsupportedKind?: string;
  floorPercent: number;
  totalPercentOff: number;
  reason: DiscountFloorConflict["reason"];
}

const PRODUCT_UNIT_PRICES_QUERY = `#graphql
  query MarginGuardProductUnitPrices($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on Product {
        id
        priceRangeV2 { minVariantPrice { amount } }
      }
    }
  }`;

/**
 * Fetch a reference unit price (minimum variant price) for the given products.
 * Fixed-amount conflict detection needs a real base price; percentage discounts
 * do not. Returns an empty map on failure so callers degrade gracefully.
 */
async function fetchProductUnitPrices(
  admin: AdminGraphqlClient,
  productIds: string[],
): Promise<Record<string, number>> {
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (ids.length === 0) {
    return {};
  }
  const prices: Record<string, number> = {};
  try {
    const response = await admin.graphql(PRODUCT_UNIT_PRICES_QUERY, {
      variables: { ids },
    });
    const payload = await response.json();
    const nodes = Array.isArray(payload?.data?.nodes) ? payload.data.nodes : [];
    for (const node of nodes) {
      if (node?.__typename !== "Product" || !node?.id) {
        continue;
      }
      const amount = Number(node.priceRangeV2?.minVariantPrice?.amount ?? 0);
      if (Number.isFinite(amount) && amount > 0) {
        prices[String(node.id)] = Math.round(amount * 100) / 100;
      }
    }
  } catch (error) {
    console.error("[fetchProductUnitPrices] failed:", error);
    return {};
  }
  return prices;
}

/**
 * Live, catalog-specific conflict lookup for the storefront cart. Given the cart
 * line handles (already mapped to product ids + collections by the visibility
 * loader) and the customer's tags, resolves the customer's price catalog and
 * returns the automatic-discount/floor conflicts per handle so the cart can warn
 * shoppers that a discount will be clipped or blocked at checkout.
 *
 * MVP_5_3 #2.3c — sources the floor + configured discount rules from catalog
 * tables (per-catalog ruleset), not the legacy MarginGuardConfig children.
 */
export async function resolveCartDiscountConflictsByHandle(input: {
  admin: AdminGraphqlClient | undefined;
  matchedTags?: string[];
  hasPurchasingCompany?: boolean;
  handles: string[];
  productIdByHandle: Record<string, string>;
  productCollectionIdsByProductId: Record<string, string[]>;
  // Injectable for tests; defaults to loading from catalog tables.
  catalogRulesets?: CatalogRuleset[];
}): Promise<Record<string, CartConflictNotice[]>> {
  if (!input.admin || input.handles.length === 0) {
    return {};
  }

  const automaticDiscounts = await fetchAutomaticDiscounts(input.admin);
  if (automaticDiscounts.length === 0) {
    return {};
  }

  const rulesets =
    input.catalogRulesets ?? (await loadCatalogRulesets().catch(() => []));
  const ruleset = resolveCatalogRuleset(rulesets, {
    matchedTags: input.matchedTags,
    hasPurchasingCompany: input.hasPurchasingCompany,
  });
  if (!ruleset) {
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

  // In the cart we know the real price of every line, so fixed-amount discounts
  // can be verified directly (no downgrade needed) when any are present.
  const hasFixedAmount = automaticDiscounts.some(
    (discount) => discount.valueType === "FIXED_AMOUNT",
  );
  const priceByProductId = hasFixedAmount
    ? await fetchProductUnitPrices(input.admin, cartProductIds)
    : {};

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
      effectiveBasePrice: priceByProductId[productId] ?? NOMINAL_BASE_PRICE,
      collectionIds: collectionMembership[productId] ?? [],
    });
  }
  if (products.length === 0) {
    return {};
  }

  const conflicts = detectDiscountFloorConflicts({
    products,
    automaticDiscounts,
    configuredDiscountRules: ruleset.discountRuleset,
    floorRuleset: ruleset.floorRuleset,
    segments: [ruleset.segment],
  });

  const byHandle: Record<string, CartConflictNotice[]> = {};
  for (const conflict of conflicts) {
    const handle = handleByProductId.get(conflict.productId);
    if (!handle) {
      continue;
    }
    (byHandle[handle] ??= []).push({
      discountTitle: conflict.offendingDiscount.title ?? "Automatic discount",
      valueType: conflict.offendingDiscount.valueType,
      percentOff: conflict.offendingDiscount.percentOff,
      ...(conflict.offendingDiscount.amount != null
        ? { amount: conflict.offendingDiscount.amount }
        : {}),
      ...(conflict.offendingDiscount.unsupportedKind != null
        ? { unsupportedKind: conflict.offendingDiscount.unsupportedKind }
        : {}),
      floorPercent:
        conflict.effectiveBasePrice > 0
          ? Math.round((conflict.floorPrice / conflict.effectiveBasePrice) * 100)
          : 0,
      totalPercentOff: conflict.totalPercentOff,
      reason: conflict.reason,
    });
  }
  return byHandle;
}
