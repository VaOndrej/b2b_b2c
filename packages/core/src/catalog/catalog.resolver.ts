import type {
  CatalogMarketFilter,
  CatalogResolutionEntry,
  CatalogResolutionInput,
  MarketContext,
} from "./catalog.types";

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

// A market filter only constrains the fields it actually sets. An unset field
// (null/empty) is "any". A set field must equal the customer's market context;
// if the context is missing that field the catalog does not match (we never
// guess a market).
function marketFilterMatches(
  filter: CatalogMarketFilter | null | undefined,
  context: MarketContext | null | undefined,
): boolean {
  if (!filter) {
    return true;
  }
  const fields: Array<keyof CatalogMarketFilter & keyof MarketContext> = [
    "countryCode",
    "currencyCode",
    "languageCode",
  ];
  for (const field of fields) {
    const expected = filter[field];
    if (expected == null || expected === "") {
      continue;
    }
    if (normalizeCode(context?.[field]) !== normalizeCode(expected)) {
      return false;
    }
  }
  return true;
}

// A catalog with several market filters matches if ANY matches; with none it is
// unconstrained. Supports both the array (`marketFilters`) and the singular
// `marketFilter` (Phase 1) shapes.
function marketConstraintMatches(
  entry: CatalogResolutionEntry,
  context: MarketContext | null | undefined,
): boolean {
  const filters =
    entry.marketFilters && entry.marketFilters.length > 0
      ? entry.marketFilters
      : entry.marketFilter
        ? [entry.marketFilter]
        : [];
  if (filters.length === 0) {
    return true;
  }
  return filters.some((filter) => marketFilterMatches(filter, context));
}

function audienceMatches(
  entry: CatalogResolutionEntry,
  tagSet: Set<string>,
  hasPurchasingCompany: boolean,
): boolean {
  if (entry.matchCompany && hasPurchasingCompany) {
    return true;
  }
  return entry.audienceTags.some((tag) => tagSet.has(normalizeTag(tag)));
}

// Resolve the single catalog a customer falls into. Non-default catalogs
// compete by audience (+ optional market filter); the highest-priority match
// wins (ties broken deterministically by id). With no match we fall back to the
// default catalog. Returns null only if no default exists (should never happen
// in a seeded shop).
export function resolveCatalog(input: CatalogResolutionInput): string | null {
  const tagSet = new Set(
    (input.matchedTags ?? []).map(normalizeTag).filter(Boolean),
  );
  const hasPurchasingCompany = input.hasPurchasingCompany === true;
  const marketContext = input.marketContext ?? null;
  const defaultEntry = input.catalogs.find((catalog) => catalog.isDefault) ?? null;

  const matching = input.catalogs
    .filter((catalog) => !catalog.isDefault)
    .filter((catalog) => marketConstraintMatches(catalog, marketContext))
    .filter((catalog) => audienceMatches(catalog, tagSet, hasPurchasingCompany));

  if (matching.length > 0) {
    matching.sort(
      (left, right) =>
        right.priority - left.priority || left.id.localeCompare(right.id),
    );
    return matching[0].id;
  }

  return defaultEntry ? defaultEntry.id : null;
}

// Alias mirroring the §7.2 naming (`resolveCatalogId`). resolveSegment in
// core/segment stays as the thin segment-specific adapter for existing callers.
export const resolveCatalogId = resolveCatalog;
