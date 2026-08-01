import prisma from "../db.server.ts";

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

const SHOPIFY_SOURCE = "SHOPIFY";
const PRODUCT_SYNC_STALE_MS = 6 * 60 * 60 * 1000;

type CatalogProductRecord = {
  shopifyProductId: string;
  title: string;
  handle: string | null;
  status: string | null;
  vendor: string | null;
  productType: string | null;
  imageUrl: string | null;
  variants: Array<{
    shopifyVariantId: string;
    title: string;
    sku: string | null;
    optionSummary: string | null;
  }>;
};

function db() {
  return prisma;
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeNullableString(value: unknown): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function isGiftCardLikeProduct(input: {
  title?: string | null;
  handle?: string | null;
  productType?: string | null;
}) {
  const title = normalizeString(input.title).toLowerCase();
  const handle = normalizeString(input.handle).toLowerCase();
  const productType = normalizeString(input.productType).toLowerCase();

  return (
    title === "gift card" ||
    handle === "gift-card" ||
    productType === "gift card"
  );
}

function buildVariantOptionSummary(rawVariant: any): string | null {
  const selectedOptions = Array.isArray(rawVariant?.selectedOptions)
    ? rawVariant.selectedOptions
    : [];
  const summary = selectedOptions
    .map((option: any) => {
      const name = normalizeString(option?.name);
      const value = normalizeString(option?.value);
      if (!name || !value) {
        return "";
      }
      return `${name}: ${value}`;
    })
    .filter(Boolean)
    .join(", ");

  return summary || null;
}

function normalizeProductNode(node: any): CatalogProductRecord | null {
  const shopifyProductId = normalizeString(node?.id);
  const title = normalizeString(node?.title);
  if (!shopifyProductId || !title) {
    return null;
  }
  if (
    Boolean(node?.isGiftCard) ||
    isGiftCardLikeProduct({
      title,
      handle: normalizeNullableString(node?.handle),
      productType: normalizeNullableString(node?.productType),
    })
  ) {
    return null;
  }

  const variantNodes = Array.isArray(node?.variants?.nodes) ? node.variants.nodes : [];

  return {
    shopifyProductId,
    title,
    handle: normalizeNullableString(node?.handle),
    status: normalizeNullableString(node?.status),
    vendor: normalizeNullableString(node?.vendor),
    productType: normalizeNullableString(node?.productType),
    imageUrl: normalizeNullableString(node?.featuredImage?.url),
    variants: variantNodes
      .map((rawVariant: any) => {
        const shopifyVariantId = normalizeString(rawVariant?.id);
        const variantTitle = normalizeString(rawVariant?.title) || title;
        if (!shopifyVariantId) {
          return null;
        }
        return {
          shopifyVariantId,
          title:
            variantTitle.toLowerCase() === "default title"
              ? title
              : `${title} - ${variantTitle}`,
          sku: normalizeNullableString(rawVariant?.sku),
          optionSummary: buildVariantOptionSummary(rawVariant),
        };
      })
      .filter(
        (
          variant: {
            shopifyVariantId: string;
            title: string;
            sku: string | null;
            optionSummary: string | null;
          } | null,
        ): variant is {
          shopifyVariantId: string;
          title: string;
          sku: string | null;
          optionSummary: string | null;
        } => variant != null,
      ),
  };
}

async function fetchAllShopifyProducts(
  admin: AdminGraphqlClient,
): Promise<CatalogProductRecord[]> {
  const records: CatalogProductRecord[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query MarginGuardCatalogProducts($first: Int!, $after: String) {
          products(first: $first, after: $after, sortKey: TITLE) {
            nodes {
              id
              title
              handle
              isGiftCard
              status
              vendor
              productType
              featuredImage {
                url
              }
              variants(first: 100) {
                nodes {
                  id
                  title
                  sku
                  selectedOptions {
                    name
                    value
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      {
        variables: {
          first: 100,
          after: cursor,
        },
      },
    );

    const payload = await response.json();
    const nodes = Array.isArray(payload?.data?.products?.nodes)
      ? payload.data.products.nodes
      : [];
    for (const node of nodes) {
      const normalized = normalizeProductNode(node);
      if (normalized) {
        records.push(normalized);
      }
    }

    hasNextPage = Boolean(payload?.data?.products?.pageInfo?.hasNextPage);
    cursor = normalizeNullableString(payload?.data?.products?.pageInfo?.endCursor);
  }

  return records;
}

type CatalogCollectionRecord = {
  shopifyCollectionId: string;
  title: string;
  handle: string | null;
};

function normalizeCollectionNode(node: any): CatalogCollectionRecord | null {
  const shopifyCollectionId = normalizeString(node?.id);
  const title = normalizeString(node?.title);
  if (!shopifyCollectionId || !title) {
    return null;
  }
  return {
    shopifyCollectionId,
    title,
    handle: normalizeNullableString(node?.handle),
  };
}

async function fetchAllShopifyCollections(
  admin: AdminGraphqlClient,
): Promise<CatalogCollectionRecord[]> {
  const records: CatalogCollectionRecord[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `#graphql
        query MarginGuardCatalogCollections($first: Int!, $after: String) {
          collections(first: $first, after: $after, sortKey: TITLE) {
            nodes {
              id
              title
              handle
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
      {
        variables: {
          first: 100,
          after: cursor,
        },
      },
    );

    const payload = await response.json();
    const nodes = Array.isArray(payload?.data?.collections?.nodes)
      ? payload.data.collections.nodes
      : [];
    for (const node of nodes) {
      const normalized = normalizeCollectionNode(node);
      if (normalized) {
        records.push(normalized);
      }
    }

    hasNextPage = Boolean(payload?.data?.collections?.pageInfo?.hasNextPage);
    cursor = normalizeNullableString(
      payload?.data?.collections?.pageInfo?.endCursor,
    );
  }

  return records;
}

export async function syncShopifyCollectionCatalog(admin: AdminGraphqlClient) {
  const records = await fetchAllShopifyCollections(admin);
  const syncedAt = new Date();

  await db().$transaction(async (tx) => {
    await tx.catalogCollection.updateMany({
      where: { sourceType: SHOPIFY_SOURCE },
      data: { isActive: false },
    });

    for (const record of records) {
      await tx.catalogCollection.upsert({
        where: {
          sourceType_externalKey: {
            sourceType: SHOPIFY_SOURCE,
            externalKey: record.shopifyCollectionId,
          },
        },
        update: {
          shopifyCollectionId: record.shopifyCollectionId,
          title: record.title,
          handle: record.handle,
          isActive: true,
          syncedAt,
        },
        create: {
          sourceType: SHOPIFY_SOURCE,
          externalKey: record.shopifyCollectionId,
          shopifyCollectionId: record.shopifyCollectionId,
          title: record.title,
          handle: record.handle,
          isActive: true,
          syncedAt,
        },
      });
    }
  });

  return {
    syncedAt,
    collectionCount: records.length,
  };
}

export async function syncShopifyProductCatalog(admin: AdminGraphqlClient) {
  const [records, collectionRecords] = await Promise.all([
    fetchAllShopifyProducts(admin),
    fetchAllShopifyCollections(admin),
  ]);
  const syncedAt = new Date();
  const productIds = records.map((record) => record.shopifyProductId);
  const variantIds = records.flatMap((record) =>
    record.variants.map((variant) => variant.shopifyVariantId),
  );

  await db().$transaction(async (tx) => {
    await tx.catalogProduct.updateMany({
      where: { sourceType: SHOPIFY_SOURCE },
      data: { isActive: false },
    });
    await tx.catalogVariant.updateMany({
      where: { sourceType: SHOPIFY_SOURCE },
      data: { isActive: false },
    });
    await tx.catalogCollection.updateMany({
      where: { sourceType: SHOPIFY_SOURCE },
      data: { isActive: false },
    });

    for (const record of records) {
      await tx.catalogProduct.upsert({
        where: {
          sourceType_externalKey: {
            sourceType: SHOPIFY_SOURCE,
            externalKey: record.shopifyProductId,
          },
        },
        update: {
          shopifyProductId: record.shopifyProductId,
          title: record.title,
          handle: record.handle,
          status: record.status,
          vendor: record.vendor,
          productType: record.productType,
          imageUrl: record.imageUrl,
          isActive: true,
          syncedAt,
        },
        create: {
          sourceType: SHOPIFY_SOURCE,
          externalKey: record.shopifyProductId,
          shopifyProductId: record.shopifyProductId,
          title: record.title,
          handle: record.handle,
          status: record.status,
          vendor: record.vendor,
          productType: record.productType,
          imageUrl: record.imageUrl,
          isActive: true,
          syncedAt,
        },
      });

      for (const variant of record.variants) {
        await tx.catalogVariant.upsert({
          where: {
            sourceType_externalKey: {
              sourceType: SHOPIFY_SOURCE,
              externalKey: variant.shopifyVariantId,
            },
          },
          update: {
            shopifyVariantId: variant.shopifyVariantId,
            shopifyProductId: record.shopifyProductId,
            title: variant.title,
            productTitle: record.title,
            productHandle: record.handle,
            sku: variant.sku,
            optionSummary: variant.optionSummary,
            isActive: true,
            syncedAt,
          },
          create: {
            sourceType: SHOPIFY_SOURCE,
            externalKey: variant.shopifyVariantId,
            shopifyVariantId: variant.shopifyVariantId,
            shopifyProductId: record.shopifyProductId,
            title: variant.title,
            productTitle: record.title,
            productHandle: record.handle,
            sku: variant.sku,
            optionSummary: variant.optionSummary,
            isActive: true,
            syncedAt,
          },
        });
      }
    }

    for (const colRecord of collectionRecords) {
      await tx.catalogCollection.upsert({
        where: {
          sourceType_externalKey: {
            sourceType: SHOPIFY_SOURCE,
            externalKey: colRecord.shopifyCollectionId,
          },
        },
        update: {
          shopifyCollectionId: colRecord.shopifyCollectionId,
          title: colRecord.title,
          handle: colRecord.handle,
          isActive: true,
          syncedAt,
        },
        create: {
          sourceType: SHOPIFY_SOURCE,
          externalKey: colRecord.shopifyCollectionId,
          shopifyCollectionId: colRecord.shopifyCollectionId,
          title: colRecord.title,
          handle: colRecord.handle,
          isActive: true,
          syncedAt,
        },
      });
    }

    await tx.marginGuardConfig.upsert({
      where: { id: "default" },
      update: {
        productCatalogLastSyncAt: syncedAt,
        productCatalogLastSyncError: null,
      },
      create: {
        id: "default",
        productCatalogLastSyncAt: syncedAt,
        productCatalogLastSyncError: null,
      },
    });
  });

  return {
    syncedAt,
    productCount: productIds.length,
    variantCount: variantIds.length,
    collectionCount: collectionRecords.length,
  };
}

export async function recordProductCatalogSyncError(errorMessage: string) {
  return db().marginGuardConfig.upsert({
    where: { id: "default" },
    update: {
      productCatalogLastSyncError: errorMessage,
    },
    create: {
      id: "default",
      productCatalogLastSyncError: errorMessage,
    },
  });
}

export async function searchImportedCatalogProducts(query: string, limit: number) {
  const normalized = normalizeString(query).toLowerCase();
  const products = await db().catalogProduct.findMany({
    where: {
      sourceType: SHOPIFY_SOURCE,
      isActive: true,
    },
    orderBy: [{ title: "asc" }],
  });

  return products
    .filter((product) => {
      if (
        isGiftCardLikeProduct({
          title: product.title,
          handle: product.handle,
          productType: product.productType,
        })
      ) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      const haystack = [
        product.title,
        product.handle ?? "",
        product.vendor ?? "",
        product.productType ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    })
    .slice(0, limit)
    .map((product) => ({
      id: product.shopifyProductId ?? product.externalKey,
      type: "product" as const,
      title: product.title,
      handle: product.handle,
      secondaryLabel: product.status ? `Status: ${product.status}` : null,
    }));
}

export async function searchImportedCatalogVariants(query: string, limit: number) {
  const normalized = normalizeString(query).toLowerCase();
  const variants = await db().catalogVariant.findMany({
    where: {
      sourceType: SHOPIFY_SOURCE,
      isActive: true,
    },
    orderBy: [{ productTitle: "asc" }, { title: "asc" }],
  });

  return variants
    .filter((variant) => {
      if (
        isGiftCardLikeProduct({
          title: variant.productTitle,
          handle: variant.productHandle,
        })
      ) {
        return false;
      }
      if (!normalized) {
        return true;
      }
      const haystack = [
        variant.title,
        variant.productTitle,
        variant.productHandle ?? "",
        variant.sku ?? "",
        variant.optionSummary ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    })
    .slice(0, limit)
    .map((variant) => ({
      id: variant.shopifyVariantId ?? variant.externalKey,
      type: "variant" as const,
      title: variant.title,
      handle: variant.productHandle,
      secondaryLabel: variant.sku ? `SKU: ${variant.sku}` : variant.optionSummary,
    }));
}

export async function getCatalogProductMapByIds(ids: string[]) {
  const normalized = Array.from(new Set(ids.map((id) => normalizeString(id)).filter(Boolean)));
  if (normalized.length === 0) {
    return {} as Record<string, { title: string; handle: string | null }>;
  }

  const products = await db().catalogProduct.findMany({
    where: {
      OR: [
        { shopifyProductId: { in: normalized } },
        { externalKey: { in: normalized } },
      ],
    },
  });

  return Object.fromEntries(
    products.map((product) => [
      product.shopifyProductId ?? product.externalKey,
      {
        title: product.title,
        handle: product.handle,
      },
    ]),
  );
}

export async function getCatalogVariantMapByIds(ids: string[]) {
  const normalized = Array.from(new Set(ids.map((id) => normalizeString(id)).filter(Boolean)));
  if (normalized.length === 0) {
    return {} as Record<string, { title: string; handle: string | null }>;
  }

  const variants = await db().catalogVariant.findMany({
    where: {
      OR: [
        { shopifyVariantId: { in: normalized } },
        { externalKey: { in: normalized } },
      ],
    },
  });

  return Object.fromEntries(
    variants.map((variant) => [
      variant.shopifyVariantId ?? variant.externalKey,
      {
        title: variant.title,
        handle: variant.productHandle,
      },
    ]),
  );
}

export async function getCatalogCollectionMapByIds(ids: string[]) {
  const normalized = Array.from(new Set(ids.map((id) => normalizeString(id)).filter(Boolean)));
  if (normalized.length === 0) {
    return {} as Record<string, { title: string; handle: string | null }>;
  }

  const collections = await db().catalogCollection.findMany({
    where: {
      OR: [
        { shopifyCollectionId: { in: normalized } },
        { externalKey: { in: normalized } },
      ],
    },
  });

  return Object.fromEntries(
    collections.map((collection) => [
      collection.shopifyCollectionId ?? collection.externalKey,
      {
        title: collection.title,
        handle: collection.handle,
      },
    ]),
  );
}

export async function searchImportedCatalogCollections(query: string, limit: number) {
  const normalized = normalizeString(query).toLowerCase();
  const collections = await db().catalogCollection.findMany({
    where: {
      sourceType: SHOPIFY_SOURCE,
      isActive: true,
    },
    orderBy: [{ title: "asc" }],
  });

  return collections
    .filter((collection) => {
      if (!normalized) {
        return true;
      }
      const haystack = [
        collection.title,
        collection.handle ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    })
    .slice(0, limit)
    .map((collection) => ({
      id: collection.shopifyCollectionId ?? collection.externalKey,
      type: "collection" as const,
      title: collection.title,
      handle: collection.handle,
      secondaryLabel: collection.handle ? `Handle: ${collection.handle}` : null,
    }));
}

export async function countActiveCatalogCollections() {
  return db().catalogCollection.count({
    where: {
      sourceType: SHOPIFY_SOURCE,
      isActive: true,
    },
  });
}

export async function countActiveCatalogProducts() {
  return db().catalogProduct.count({
    where: {
      sourceType: SHOPIFY_SOURCE,
      isActive: true,
    },
  });
}

export async function shouldAutoSyncProductCatalog(config: {
  productCatalogAutoImportEnabled?: boolean | null;
  productCatalogSourceType?: string | null;
  productCatalogLastSyncAt?: Date | string | null;
}) {
  if (normalizeString(config.productCatalogSourceType || SHOPIFY_SOURCE) !== SHOPIFY_SOURCE) {
    return false;
  }
  if (!config.productCatalogAutoImportEnabled) {
    return false;
  }

  const currentCount = await countActiveCatalogProducts();
  if (currentCount === 0) {
    return true;
  }

  const lastSyncAt = config.productCatalogLastSyncAt
    ? new Date(config.productCatalogLastSyncAt)
    : null;
  if (!lastSyncAt) {
    return true;
  }

  return Date.now() - lastSyncAt.getTime() > PRODUCT_SYNC_STALE_MS;
}
