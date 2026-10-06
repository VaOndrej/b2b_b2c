// Names (and a small image) of the products, variants and collections a
// setting points at (P4: a selection is shown as a list with names, never only
// as a count). The config stores ids only; every screen that lists a selection
// reads the names here, in one query per 100 ids.

import type { ShopCtx } from "./context.server";

export interface ResourceLabel {
  title: string;
  image?: string;
}

/** `id → label`, serialisable for a loader. Ids Shopify no longer knows are left out. */
export type ResourceLabels = Record<string, ResourceLabel>;

/** Validated against Admin 2026-04 (Shopify dev MCP); nodes(ids) of ≤ 100 products / variants / collections. */
export const RESOURCE_LABELS_DOCUMENT = `#graphql
query WonResourceLabels($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on Product {
      id
      title
      featuredMedia {
        preview {
          image {
            url(transform: { maxWidth: 80, maxHeight: 80 })
          }
        }
      }
    }
    ... on ProductVariant {
      id
      title
      product {
        title
      }
    }
    ... on Collection {
      id
      title
      image {
        url(transform: { maxWidth: 80, maxHeight: 80 })
      }
    }
  }
}`;

/** The same without images: the fallback when the shop does not let the app read media. */
export const RESOURCE_TITLES_DOCUMENT = `#graphql
query WonResourceTitles($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on Product {
      id
      title
    }
    ... on ProductVariant {
      id
      title
      product {
        title
      }
    }
    ... on Collection {
      id
      title
    }
  }
}`;

interface LabelNode {
  __typename?: string;
  id?: string;
  title?: string;
  product?: { title?: string } | null;
  featuredMedia?: { preview?: { image?: { url?: string } | null } | null } | null;
  image?: { url?: string } | null;
}

function labelOf(node: LabelNode): ResourceLabel | null {
  if (!node.id || !node.title) return null;
  // A variant is named with its product: "Mikina Won — M / černá" (a product with one variant has "Default Title").
  const title =
    node.__typename === "ProductVariant" && node.product?.title
      ? node.title === "Default Title"
        ? node.product.title
        : `${node.product.title} — ${node.title}`
      : node.title;
  const image = node.featuredMedia?.preview?.image?.url ?? node.image?.url;
  return image ? { title, image } : { title };
}

/** Labels of products / variants / collections by id. A failed read leaves the ids without a label (the screen says so). */
export async function resourceLabels(ctx: ShopCtx, ids: readonly string[]): Promise<ResourceLabels> {
  const out: ResourceLabels = {};
  const unique = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    for (const document of [RESOURCE_LABELS_DOCUMENT, RESOURCE_TITLES_DOCUMENT]) {
      try {
        const result = await ctx.client.graphql<{ nodes?: (LabelNode | null)[] }>(document, { ids: batch });
        const nodes = result.data?.nodes;
        if (!nodes) continue;
        for (const node of nodes) {
          const label = node ? labelOf(node) : null;
          if (label && node?.id) out[node.id] = label;
        }
        break;
      } catch (error) {
        if (error instanceof Response) throw error;
      }
    }
  }
  return out;
}
