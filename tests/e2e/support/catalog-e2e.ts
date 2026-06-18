import {
  createPriceCatalog,
  deletePriceCatalog,
  listPriceCatalogs,
  upsertCatalogDiscountRule,
  upsertCatalogFloorRule,
  upsertCatalogQuantityRule,
  upsertCatalogVariantVisibilityRule,
  upsertCatalogVisibilityRule,
} from "../../../app/services/price-catalog.server.ts";
import { resyncStorefrontProjectionForE2E } from "./seed.ts";
import { E2E_CATALOG_AUDIENCE_TAG, E2E_CATALOG_NAME } from "./catalog-context.ts";
import type { E2EMatrix } from "./matrix.ts";

export { E2E_CATALOG_AUDIENCE_TAG, E2E_CATALOG_NAME };

/**
 * Catalog-native e2e provisioning (MVP_5_4). All e2e rules live on ONE dedicated,
 * disposable price catalog reachable ONLY via the gated `mg_e2e_audience` override
 * (no real customer carries `E2E_CATALOG_AUDIENCE_TAG`), so real shoppers keep
 * resolving to `default`/`b2b` and the user's live config is never touched.
 * Cleanup is a single `deletePriceCatalog` (cascade) — zero blast radius.
 *
 * Rules are seeded onto the store's EXISTING synced products, so no product is
 * created/published → no `read_publications`/`write_publications` scopes needed.
 */

async function findE2ECatalogId(): Promise<string | null> {
  const catalogs = await listPriceCatalogs();
  return catalogs.find((catalog) => catalog.name === E2E_CATALOG_NAME)?.id ?? null;
}

async function deleteE2ECatalogIfPresent(): Promise<void> {
  const id = await findE2ECatalogId();
  if (id) {
    await deletePriceCatalog(id);
  }
}

/**
 * Creates a fresh, dedicated e2e catalog. Idempotent: any leftover catalog from a
 * previous (crashed) run is dropped first so each run starts from a clean slate
 * (rule upserts always create rows). ACTIVE + INHERIT_ALL so it participates in
 * catalog resolution; high priority so it wins when its tag is present.
 */
export async function setupE2ECatalog(): Promise<{
  catalogId: string;
  audienceTag: string;
}> {
  await deleteE2ECatalogIfPresent();
  const created = await createPriceCatalog({
    name: E2E_CATALOG_NAME,
    status: "ACTIVE",
    priority: 999,
    matchCompany: false,
    membershipMode: "INHERIT_ALL",
    audienceTags: [E2E_CATALOG_AUDIENCE_TAG],
    marketFilters: [],
  });
  return { catalogId: created.id, audienceTag: E2E_CATALOG_AUDIENCE_TAG };
}

/**
 * Seeds every matrix archetype's rule onto the e2e catalog, each on its own
 * product. Uses the native catalog CRUD directly — no segment shim.
 */
export async function seedE2ECatalogRules(
  catalogId: string,
  matrix: E2EMatrix,
): Promise<void> {
  for (const fixture of matrix.products) {
    switch (fixture.archetype) {
      case "HIDDEN":
        await upsertCatalogVisibilityRule({
          catalogId,
          scope: "PRODUCT",
          targetId: fixture.productId,
          visibilityMode: "HIDDEN",
        });
        break;
      case "VARIANT_HIDDEN":
        if (fixture.variantId) {
          await upsertCatalogVariantVisibilityRule({
            catalogId,
            productId: fixture.productId,
            variantId: fixture.variantId,
            visibilityMode: "HIDDEN",
          });
        }
        break;
      case "QUANTITY_MOQ_STEP":
        await upsertCatalogQuantityRule({
          catalogId,
          productId: fixture.productId,
          moq: fixture.minimumOrderQuantity ?? null,
          step: fixture.stepQuantity ?? null,
        });
        break;
      case "QUANTITY_MAX":
        await upsertCatalogQuantityRule({
          catalogId,
          productId: fixture.productId,
          max: fixture.maxOrderQuantity ?? null,
        });
        break;
      default:
        break;
    }
  }
}

/**
 * Deletes the dedicated e2e catalog (cascade removes its rules) and re-projects
 * the storefront metafields so the live shop matches the post-teardown DB state.
 */
export async function teardownE2ECatalog(): Promise<void> {
  await deleteE2ECatalogIfPresent();
  await resyncStorefrontProjectionForE2E();
}

// ---------------------------------------------------------------------------
// Granular per-rule seeders for the serial (mutate-per-test) tier. Each test
// gets a fresh catalog (setupE2ECatalog) and seeds exactly the rule it asserts,
// scoped to the e2e catalog — never the user's default/b2b catalogs.
// ---------------------------------------------------------------------------

export async function seedCatalogProductHidden(
  catalogId: string,
  productId: string,
): Promise<void> {
  await upsertCatalogVisibilityRule({
    catalogId,
    scope: "PRODUCT",
    targetId: productId,
    visibilityMode: "HIDDEN",
  });
}

export async function seedCatalogVariantHidden(
  catalogId: string,
  productId: string,
  variantId: string,
): Promise<void> {
  await upsertCatalogVariantVisibilityRule({
    catalogId,
    productId,
    variantId,
    visibilityMode: "HIDDEN",
  });
}

export async function seedCatalogQuantity(
  catalogId: string,
  productId: string,
  quantity: { moq?: number; step?: number; max?: number },
): Promise<void> {
  await upsertCatalogQuantityRule({
    catalogId,
    productId,
    moq: quantity.moq ?? null,
    step: quantity.step ?? null,
    max: quantity.max ?? null,
  });
}

/**
 * Seeds a GLOBAL catalog discount + a product floor that the discount breaches,
 * so the cart discount-conflict detector flags it (the storefront cart banner).
 * Self-contained — no real Shopify automatic discount and no global-config edit.
 */
export async function seedCatalogDiscountFloorConflict(
  catalogId: string,
  productId: string,
  opts: { percentOff: number; floorPercent: number },
): Promise<void> {
  await upsertCatalogFloorRule({
    catalogId,
    productId,
    minPercentOfBasePrice: opts.floorPercent,
    allowZeroFinalPrice: null,
  });
  await upsertCatalogDiscountRule({
    catalogId,
    scope: "GLOBAL",
    targetId: null,
    code: null,
    percentOff: opts.percentOff,
    priority: 100,
    stackMode: "STACKABLE",
    minPricePercentOfBasePrice: null,
  });
}
