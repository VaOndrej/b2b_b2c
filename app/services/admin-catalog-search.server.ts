import {
  searchImportedCatalogProducts,
  searchImportedCatalogVariants,
  searchImportedCatalogCollections,
} from "./product-catalog.server.ts";

export type AdminCatalogSearchType =
  | "product"
  | "collection"
  | "customer"
  | "variant";

export interface AdminCatalogSearchItem {
  id: string;
  type: AdminCatalogSearchType;
  title: string;
  handle: string | null;
  secondaryLabel: string | null;
}

type SearchAdminCatalogDeps = {
  searchImportedProducts?: typeof searchImportedCatalogProducts;
  searchImportedVariants?: typeof searchImportedCatalogVariants;
  searchImportedCollections?: typeof searchImportedCatalogCollections;
};

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

const CONTRACT_NAME = "INTERNAL_ADMIN_ENDPOINT";
const MAX_QUERY_LENGTH = 120;
const MAX_LIMIT = 25;
const DEFAULT_LIMIT = 10;

function methodNotAllowed() {
  return Response.json(
    {
      ok: false,
      error: "Method not allowed. Use GET.",
      contract: CONTRACT_NAME,
    },
    { status: 405 },
  );
}

function badRequest(message: string, details?: Record<string, unknown>) {
  return Response.json(
    {
      ok: false,
      error: message,
      contract: CONTRACT_NAME,
      ...(details ? { details } : {}),
    },
    { status: 400 },
  );
}

function parseType(rawType: string | null): AdminCatalogSearchType | null {
  if (
    rawType === "product" ||
    rawType === "collection" ||
    rawType === "customer" ||
    rawType === "variant"
  ) {
    return rawType;
  }
  return null;
}

function parseLimit(rawLimit: string | null): number | null {
  if (rawLimit == null || String(rawLimit).trim() === "") {
    return DEFAULT_LIMIT;
  }
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const normalized = Math.floor(parsed);
  if (normalized < 1 || normalized > MAX_LIMIT) {
    return null;
  }
  return normalized;
}

function escapeShopifySearchTerm(term: string): string {
  return term.replace(/["\\]/g, "\\$&");
}

function buildShopifySearchQuery(
  rawQuery: string,
  type: AdminCatalogSearchType,
): string {
  const normalized = String(rawQuery ?? "").trim();
  if (!normalized) {
    return "";
  }
  const escaped = escapeShopifySearchTerm(normalized);
  if (type === "customer") {
    return `email:*${escaped}* OR first_name:*${escaped}* OR last_name:*${escaped}*`;
  }
  if (type === "variant") {
    return `sku:*${escaped}* OR title:*${escaped}* OR product_title:*${escaped}*`;
  }
  return `title:*${escaped}* OR handle:*${escaped}*`;
}

function normalizeBaseNode(
  node: unknown,
): { id: string; title: string; handle: string | null } | null {
  const id = String((node as any)?.id ?? "").trim();
  const title = String((node as any)?.title ?? "").trim();
  const handleRaw = String((node as any)?.handle ?? "").trim();
  if (!id || !title) {
    return null;
  }
  return {
    id,
    title,
    handle: handleRaw || null,
  };
}

function mapProductNodes(nodes: unknown[]): AdminCatalogSearchItem[] {
  const mapped: AdminCatalogSearchItem[] = [];
  for (const rawNode of nodes) {
    const baseNode = normalizeBaseNode(rawNode);
    if (!baseNode) {
      continue;
    }
    const status = String((rawNode as any)?.status ?? "").trim();
    mapped.push({
      ...baseNode,
      type: "product",
      secondaryLabel: baseNode.handle ? `Handle: ${baseNode.handle}` : status || null,
    });
  }
  return mapped;
}

function mapCollectionNodes(nodes: unknown[]): AdminCatalogSearchItem[] {
  const mapped: AdminCatalogSearchItem[] = [];
  for (const rawNode of nodes) {
    const baseNode = normalizeBaseNode(rawNode);
    if (!baseNode) {
      continue;
    }
    mapped.push({
      ...baseNode,
      type: "collection",
      secondaryLabel: baseNode.handle ? `Handle: ${baseNode.handle}` : null,
    });
  }
  return mapped;
}

function buildVariantTitle(node: unknown): string {
  const productTitle = String((node as any)?.product?.title ?? "").trim();
  const variantTitle = String((node as any)?.title ?? "").trim();
  if (
    productTitle &&
    variantTitle &&
    variantTitle.toLowerCase() !== "default title"
  ) {
    return `${productTitle} - ${variantTitle}`;
  }
  return productTitle || variantTitle;
}

function buildVariantSecondaryLabel(node: unknown): string | null {
  const sku = String((node as any)?.sku ?? "").trim();
  if (sku) {
    return `SKU: ${sku}`;
  }
  const selectedOptions = Array.isArray((node as any)?.selectedOptions)
    ? (node as any).selectedOptions
    : [];
  const optionSummary = selectedOptions
    .map((option: any) => {
      const name = String(option?.name ?? "").trim();
      const value = String(option?.value ?? "").trim();
      if (!name || !value) {
        return "";
      }
      return `${name}: ${value}`;
    })
    .filter(Boolean)
    .join(", ");
  return optionSummary || null;
}

function mapVariantNodes(nodes: unknown[]): AdminCatalogSearchItem[] {
  const mapped: AdminCatalogSearchItem[] = [];
  for (const rawNode of nodes) {
    const id = String((rawNode as any)?.id ?? "").trim();
    const title = buildVariantTitle(rawNode);
    const handle = String((rawNode as any)?.product?.handle ?? "").trim();
    if (!id || !title) {
      continue;
    }
    mapped.push({
      id,
      type: "variant",
      title,
      handle: handle || null,
      secondaryLabel: buildVariantSecondaryLabel(rawNode),
    });
  }
  return mapped;
}

async function searchProducts(input: {
  admin: AdminGraphqlClient;
  query: string;
  limit: number;
}): Promise<AdminCatalogSearchItem[]> {
  const response = await input.admin.graphql(
    `#graphql
      query AdminCatalogSearchProducts($query: String!, $first: Int!) {
        products(first: $first, query: $query) {
          nodes {
            id
            title
            handle
            status
          }
        }
      }`,
    {
      variables: {
        query: input.query,
        first: input.limit,
      },
    },
  );
  const payload = await response.json();
  const nodes = Array.isArray(payload?.data?.products?.nodes)
    ? payload.data.products.nodes
    : [];
  return mapProductNodes(nodes);
}

async function searchCollections(input: {
  admin: AdminGraphqlClient;
  query: string;
  limit: number;
}): Promise<AdminCatalogSearchItem[]> {
  const response = await input.admin.graphql(
    `#graphql
      query AdminCatalogSearchCollections($query: String!, $first: Int!) {
        collections(first: $first, query: $query) {
          nodes {
            id
            title
            handle
          }
        }
      }`,
    {
      variables: {
        query: input.query,
        first: input.limit,
      },
    },
  );
  const payload = await response.json();
  const nodes = Array.isArray(payload?.data?.collections?.nodes)
    ? payload.data.collections.nodes
    : [];
  return mapCollectionNodes(nodes);
}

function buildCustomerTitle(node: unknown): string {
  const displayName = String((node as any)?.displayName ?? "").trim();
  if (displayName) {
    return displayName;
  }
  const firstName = String((node as any)?.firstName ?? "").trim();
  const lastName = String((node as any)?.lastName ?? "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName) {
    return fullName;
  }
  return String((node as any)?.email ?? "").trim();
}

function mapCustomerNodes(nodes: unknown[]): AdminCatalogSearchItem[] {
  const mapped: AdminCatalogSearchItem[] = [];
  for (const rawNode of nodes) {
    const id = String((rawNode as any)?.id ?? "").trim();
    const title = buildCustomerTitle(rawNode);
    const email = String((rawNode as any)?.email ?? "").trim();
    if (!id || !title) {
      continue;
    }
    mapped.push({
      id,
      type: "customer",
      title,
      handle: null,
      secondaryLabel: email && email !== title ? email : null,
    });
  }
  return mapped;
}

async function searchCustomers(input: {
  admin: AdminGraphqlClient;
  query: string;
  limit: number;
}): Promise<AdminCatalogSearchItem[]> {
  const response = await input.admin.graphql(
    `#graphql
      query AdminCatalogSearchCustomers($query: String!, $first: Int!) {
        customers(first: $first, query: $query) {
          nodes {
            id
            displayName
            firstName
            lastName
            email
          }
        }
      }`,
    {
      variables: {
        query: input.query,
        first: input.limit,
      },
    },
  );
  const payload = await response.json();
  const nodes = Array.isArray(payload?.data?.customers?.nodes)
    ? payload.data.customers.nodes
    : [];
  return mapCustomerNodes(nodes);
}

async function searchVariants(input: {
  admin: AdminGraphqlClient;
  query: string;
  limit: number;
}): Promise<AdminCatalogSearchItem[]> {
  const response = await input.admin.graphql(
    `#graphql
      query AdminCatalogSearchVariants($query: String!, $first: Int!) {
        productVariants(first: $first, query: $query) {
          nodes {
            id
            title
            sku
            product {
              title
              handle
            }
            selectedOptions {
              name
              value
            }
          }
        }
      }`,
    {
      variables: {
        query: input.query,
        first: input.limit,
      },
    },
  );
  const payload = await response.json();
  const nodes = Array.isArray(payload?.data?.productVariants?.nodes)
    ? payload.data.productVariants.nodes
    : [];
  return mapVariantNodes(nodes);
}

export async function searchAdminCatalog(input: {
  admin: AdminGraphqlClient;
  type: AdminCatalogSearchType;
  query: string;
  limit: number;
}, deps: SearchAdminCatalogDeps = {}): Promise<AdminCatalogSearchItem[]> {
  const searchImportedProducts =
    deps.searchImportedProducts ?? searchImportedCatalogProducts;
  const searchImportedVariants =
    deps.searchImportedVariants ?? searchImportedCatalogVariants;
  const searchImportedCollections =
    deps.searchImportedCollections ?? searchImportedCatalogCollections;
  if (input.type === "product") {
    return searchImportedProducts(input.query, input.limit);
  }
  if (input.type === "variant") {
    return searchImportedVariants(input.query, input.limit);
  }
  if (input.type === "collection") {
    return searchImportedCollections(input.query, input.limit);
  }

  const searchQuery = buildShopifySearchQuery(input.query, input.type);
  if (!searchQuery) {
    return [];
  }

  return searchCustomers({
    admin: input.admin,
    query: searchQuery,
    limit: input.limit,
  });
}

type CatalogSearchDeps = {
  authenticateAdmin: (
    request: Request,
  ) => Promise<{ admin: AdminGraphqlClient }>;
  searchCatalog: typeof searchAdminCatalog;
};

export function createCatalogSearchLoader(deps: CatalogSearchDeps) {
  return async ({ request }: { request: Request }) => {
    if (request.method.toUpperCase() !== "GET") {
      return methodNotAllowed();
    }

    const { admin } = await deps.authenticateAdmin(request);
    const url = new URL(request.url);
    const rawType = String(url.searchParams.get("type") ?? "").trim();
    const type = parseType(rawType || null);
    if (!type) {
      return badRequest(
        "Invalid required query param: type=product|collection|customer|variant.",
      );
    }

    const query = String(url.searchParams.get("q") ?? "").trim();
    if (query.length > MAX_QUERY_LENGTH) {
      return badRequest(`Query param q is too long (max ${MAX_QUERY_LENGTH} chars).`);
    }

    const limit = parseLimit(url.searchParams.get("limit"));
    if (limit == null) {
      return badRequest(`Invalid query param: limit must be integer 1..${MAX_LIMIT}.`);
    }

    const items = await deps.searchCatalog({
      admin,
      type,
      query,
      limit,
    });

    return Response.json({
      ok: true,
      contract: CONTRACT_NAME,
      type,
      query,
      limit,
      items,
    });
  };
}
