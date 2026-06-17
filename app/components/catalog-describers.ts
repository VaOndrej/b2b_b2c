// MVP_5_1 (move-not-copy): catalog label helpers extracted from the
// app.settings.tsx monolith so any extracted settings view (discounts now,
// catalog-rules later) describes products/variants/collections identically.

export interface CatalogDescribeEntry {
  title: string;
  handle: string | null;
}

export type CatalogDescribeMap = Record<string, CatalogDescribeEntry>;

export interface CatalogDescribers {
  describeProduct: (productId: string | null | undefined) => string;
  describeVariant: (variantId: string | null | undefined) => string;
  describeCollection: (collectionId: string | null | undefined) => string;
}

export function makeCatalogDescribers(maps: {
  products: CatalogDescribeMap;
  variants: CatalogDescribeMap;
  collections: CatalogDescribeMap;
}): CatalogDescribers {
  function describeProduct(productId: string | null | undefined): string {
    const normalized = String(productId ?? "").trim();
    if (!normalized) {
      return "Unknown product";
    }
    const product = maps.products[normalized];
    if (!product) {
      return normalized;
    }
    return product.handle ? `${product.title} (${product.handle})` : product.title;
  }

  function describeVariant(variantId: string | null | undefined): string {
    const normalized = String(variantId ?? "").trim();
    if (!normalized) {
      return "Unknown variant";
    }
    const variant = maps.variants[normalized];
    if (!variant) {
      return normalized;
    }
    return variant.handle ? `${variant.title} (${variant.handle})` : variant.title;
  }

  function describeCollection(collectionId: string | null | undefined): string {
    const normalized = String(collectionId ?? "").trim();
    if (!normalized) {
      return "Unknown collection";
    }
    const collection = maps.collections[normalized];
    if (!collection) {
      return normalized;
    }
    return collection.handle
      ? `${collection.title} (${collection.handle})`
      : collection.title;
  }

  return { describeProduct, describeVariant, describeCollection };
}
