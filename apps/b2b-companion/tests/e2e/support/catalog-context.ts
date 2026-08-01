/**
 * Dependency-free constants for the dedicated e2e price catalog, shared by the
 * server-side seeding module (catalog-e2e.ts) and the Playwright config/fixtures
 * (which must NOT pull in prisma/server code at config-eval time).
 *
 * The `catalog` test context forces `mg_e2e_audience=E2E_CATALOG_AUDIENCE_TAG` so
 * catalog resolution picks this catalog; the `base` context sends no override and
 * resolves to the default catalog. No real customer carries this tag.
 */
export const E2E_CATALOG_NAME = "__mg_e2e_catalog__";
export const E2E_CATALOG_AUDIENCE_TAG = "mg-e2e-catalog";

export type TestContext = "base" | "catalog";
