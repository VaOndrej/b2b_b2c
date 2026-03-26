export type CatalogResourceType = "product" | "collection" | "customer";

export interface CatalogSearchItem {
  id: string;
  title: string;
  handle: string | null;
  secondaryLabel?: string | null;
}

function normalizeString(value: unknown): string {
  return String(value ?? "").trim();
}

export function buildCatalogSearchUrl(input: {
  endpoint: string;
  resourceType: CatalogResourceType;
  query: string;
  limit: number;
}): string {
  const params = new URLSearchParams();
  params.set("type", input.resourceType);
  params.set("q", input.query);
  params.set("limit", String(input.limit));
  return `${input.endpoint}?${params.toString()}`;
}

export function normalizeCatalogSearchItems(payload: unknown): CatalogSearchItem[] {
  const rawItems =
    (payload as any)?.items ??
    (payload as any)?.results ??
    (payload as any)?.data?.items ??
    [];
  const items: CatalogSearchItem[] = [];

  if (!Array.isArray(rawItems)) {
    return items;
  }

  for (const rawItem of rawItems) {
    const id = normalizeString((rawItem as any)?.id);
    const title = normalizeString((rawItem as any)?.title);
    const handle = normalizeString((rawItem as any)?.handle);
    const secondaryLabel = normalizeString((rawItem as any)?.secondaryLabel);
    if (!id || !title) {
      continue;
    }
    items.push({
      id,
      title,
      handle: handle || null,
      secondaryLabel: secondaryLabel || null,
    });
  }

  return items;
}

export function describeCatalogItem(item: CatalogSearchItem): string {
  if (item.handle) {
    return `${item.title} (${item.handle})`;
  }
  if (item.secondaryLabel) {
    return `${item.title} (${item.secondaryLabel})`;
  }
  return item.title;
}

export function defaultSearchPlaceholder(resourceType: CatalogResourceType): string {
  if (resourceType === "product") {
    return "Search product by title or handle";
  }
  if (resourceType === "collection") {
    return "Search collection by title or handle";
  }
  return "Search customer by name or email";
}

export function defaultManualPlaceholder(resourceType: CatalogResourceType): string {
  if (resourceType === "product") {
    return "gid://shopify/Product/123456789";
  }
  if (resourceType === "collection") {
    return "gid://shopify/Collection/123456789";
  }
  return "gid://shopify/Customer/123456789";
}

export function normalizeCatalogPickerValue(value: unknown): string {
  return normalizeString(value);
}
