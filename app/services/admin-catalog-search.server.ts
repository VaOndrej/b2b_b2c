export type AdminCatalogSearchType = "product" | "collection";

export interface AdminCatalogSearchItem {
  id: string;
  type: AdminCatalogSearchType;
  title: string;
  handle: string | null;
  secondaryLabel: string | null;
}

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
  if (rawType === "product" || rawType === "collection") {
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

function buildShopifySearchQuery(rawQuery: string): string {
  const normalized = String(rawQuery ?? "").trim();
  if (!normalized) {
    return "";
  }
  const escaped = escapeShopifySearchTerm(normalized);
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

export async function searchAdminCatalog(input: {
  admin: AdminGraphqlClient;
  type: AdminCatalogSearchType;
  query: string;
  limit: number;
}): Promise<AdminCatalogSearchItem[]> {
  const searchQuery = buildShopifySearchQuery(input.query);
  if (!searchQuery) {
    return [];
  }
  if (input.type === "product") {
    return searchProducts({
      admin: input.admin,
      query: searchQuery,
      limit: input.limit,
    });
  }
  return searchCollections({
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
      return badRequest("Invalid required query param: type=product|collection.");
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
