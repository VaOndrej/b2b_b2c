import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import prisma from "../../../app/db.server.ts";

/**
 * The matrix is the single source of truth shared between the seeding setup
 * (which writes rules onto the dedicated e2e price catalog) and the read-only
 * storefront specs (which assert their effect). It is computed deterministically
 * from the synced `CatalogProduct/Variant` tables so that, once seeded, every spec
 * is purely read-only and therefore safe to run fully in parallel.
 *
 * Catalog-native model (MVP_5_4): the matrix runs as theme × CONTEXT, where
 * `context` is either `base` (no override → default catalog → unrestricted) or
 * `catalog` (the gated `mg_e2e_audience` override injects the e2e catalog's tag →
 * the seeded restrictive rule applies). Each archetype's rule lives on a DISTINCT
 * product so storefront resolution never overlaps between scenarios.
 */

export const MATRIX_FILE = path.resolve(
  process.cwd(),
  "tests",
  "e2e",
  ".matrix.json",
);

export type ProductArchetype =
  | "HIDDEN"
  | "VARIANT_HIDDEN"
  | "QUANTITY_MOQ_STEP"
  | "QUANTITY_MAX"
  // A product restricted because its COLLECTION is targeted (max only — collection
  // visibility hides the collection page, not its products). Storefront-observable via
  // the live Product.collections membership fetch. Pinned-only (membership isn't in DB).
  | "COLLECTION_MAX";

export interface ProductMatrixFixture {
  archetype: ProductArchetype;
  productId: string;
  handle: string;
  title: string;
  variantId?: string;
  minimumOrderQuantity?: number;
  stepQuantity?: number;
  maxOrderQuantity?: number;
  /** COLLECTION_MAX only: the collection GID the quantity rule targets. */
  collectionId?: string;
}

export interface E2EMatrix {
  generatedAt: string;
  /** Audience tag of the dedicated e2e catalog (the `catalog` context forces it). */
  audienceTag: string;
  products: ProductMatrixFixture[];
  notes: string[];
}

const PRODUCT_ARCHETYPE_ORDER: ProductArchetype[] = [
  "HIDDEN",
  "QUANTITY_MOQ_STEP",
  "QUANTITY_MAX",
  "VARIANT_HIDDEN",
];

function normalizeHandle(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function normalizeProductGid(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("gid://shopify/Product/")) {
    return normalized;
  }
  if (/^\d+$/.test(normalized)) {
    return `gid://shopify/Product/${normalized}`;
  }
  return null;
}

interface CatalogProductRow {
  shopifyProductId: string | null;
  handle: string | null;
  title: string;
}

interface CatalogVariantRow {
  shopifyVariantId: string | null;
  shopifyProductId: string | null;
}

/**
 * Builds the deterministic E2E matrix from the synced catalog. Distinct products
 * are assigned distinct archetypes round-robin, so seeded rules never overlap on
 * the same product and each spec can assert only its own product.
 *
 * Returns an empty matrix (with explanatory notes) when the catalog has not been
 * synced yet — the setup project then skips with that reason instead of failing.
 */
export async function buildE2EMatrix(audienceTag: string): Promise<E2EMatrix> {
  const notes: string[] = [];

  const products = (await prisma.catalogProduct.findMany({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { shopifyProductId: true, handle: true, title: true },
  })) as CatalogProductRow[];

  const variants = (await prisma.catalogVariant.findMany({
    where: { isActive: true },
    select: { shopifyVariantId: true, shopifyProductId: true },
  })) as CatalogVariantRow[];

  const firstVariantByProductId = new Map<string, string>();
  for (const variant of variants) {
    const productGid = normalizeProductGid(variant.shopifyProductId);
    const variantGid = String(variant.shopifyVariantId ?? "").trim();
    if (!productGid || !variantGid || firstVariantByProductId.has(productGid)) {
      continue;
    }
    firstVariantByProductId.set(productGid, variantGid);
  }

  const usableProducts = products
    .map((row) => ({
      productId: normalizeProductGid(row.shopifyProductId),
      handle: normalizeHandle(row.handle),
      title: row.title,
    }))
    .filter(
      (row): row is { productId: string; handle: string; title: string } =>
        Boolean(row.productId && row.handle),
    );

  // Pinned path: when every archetype's handle is set (SHOPIFY_E2E_PRODUCT_HANDLE_*),
  // the matrix uses EXACTLY those products with a FIXED archetype each, instead of the
  // updatedAt-ordered round-robin below. This is what makes the tested data stable —
  // a re-sync or product edit can no longer shuffle which product plays which role.
  const pinned = buildPinnedFixtures(usableProducts, firstVariantByProductId, notes);
  if (pinned) {
    return { generatedAt: new Date().toISOString(), audienceTag, products: pinned, notes };
  }

  const productFixtures: ProductMatrixFixture[] = [];
  let archetypeIndex = 0;
  for (const product of usableProducts) {
    if (archetypeIndex >= PRODUCT_ARCHETYPE_ORDER.length) {
      break;
    }
    const archetype = PRODUCT_ARCHETYPE_ORDER[archetypeIndex];

    if (archetype === "VARIANT_HIDDEN") {
      const variantId = firstVariantByProductId.get(product.productId);
      if (!variantId) {
        // Skip this product for the variant archetype; try it on the next one.
        continue;
      }
      productFixtures.push({
        archetype,
        productId: product.productId,
        handle: product.handle,
        title: product.title,
        variantId,
      });
      archetypeIndex += 1;
      continue;
    }

    const fixture: ProductMatrixFixture = {
      archetype,
      productId: product.productId,
      handle: product.handle,
      title: product.title,
    };
    if (archetype === "QUANTITY_MOQ_STEP") {
      fixture.minimumOrderQuantity = 6;
      fixture.stepQuantity = 3;
    }
    if (archetype === "QUANTITY_MAX") {
      fixture.maxOrderQuantity = 3;
    }
    productFixtures.push(fixture);
    archetypeIndex += 1;
  }

  for (const archetype of PRODUCT_ARCHETYPE_ORDER) {
    if (!productFixtures.some((fixture) => fixture.archetype === archetype)) {
      notes.push(
        `No catalog product available for archetype ${archetype} (need ${PRODUCT_ARCHETYPE_ORDER.length} distinct products${archetype === "VARIANT_HIDDEN" ? ", one with variants" : ""}).`,
      );
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    audienceTag,
    products: productFixtures,
    notes,
  };
}

/** Maps each archetype to its pin env var. Keep in sync with runtime.ts / the wrapper. */
const ARCHETYPE_PIN_ENV: Record<ProductArchetype, string> = {
  HIDDEN: "SHOPIFY_E2E_PRODUCT_HANDLE_VISIBILITY",
  QUANTITY_MOQ_STEP: "SHOPIFY_E2E_PRODUCT_HANDLE_STEP",
  QUANTITY_MAX: "SHOPIFY_E2E_PRODUCT_HANDLE_MAX",
  VARIANT_HIDDEN: "SHOPIFY_E2E_PRODUCT_HANDLE_VARIANT",
  COLLECTION_MAX: "SHOPIFY_E2E_PRODUCT_HANDLE_COLLECTION",
};

// COLLECTION_MAX also needs the collection GID whose quantity rule the member product
// inherits (membership is resolved live, never from the DB, so it must be pinned).
const COLLECTION_ID_ENV = "SHOPIFY_E2E_COLLECTION_ID";
const COLLECTION_MAX_QUANTITY = 3;

/**
 * Builds the matrix from pinned handles when ALL four are set. Returns null when any
 * pin is missing (→ caller falls back to the dynamic round-robin). Fixed quantities
 * (MOQ 6 / step 3 / max 3) match the serial tier and the spec assertions.
 */
function buildPinnedFixtures(
  usableProducts: { productId: string; handle: string; title: string }[],
  firstVariantByProductId: Map<string, string>,
  notes: string[],
): ProductMatrixFixture[] | null {
  const pins = PRODUCT_ARCHETYPE_ORDER.map((archetype) => ({
    archetype,
    handle: normalizeHandle(process.env[ARCHETYPE_PIN_ENV[archetype]]),
  }));
  if (pins.some((pin) => !pin.handle)) {
    return null;
  }

  const byHandle = new Map(usableProducts.map((product) => [product.handle, product]));
  const fixtures: ProductMatrixFixture[] = [];
  for (const pin of pins) {
    const product = byHandle.get(pin.handle as string);
    if (!product) {
      notes.push(
        `Pinned handle "${pin.handle}" for ${pin.archetype} not found in the synced catalog ` +
          `(${ARCHETYPE_PIN_ENV[pin.archetype]}). Sync the catalog or fix the pin.`,
      );
      continue;
    }
    const fixture: ProductMatrixFixture = {
      archetype: pin.archetype,
      productId: product.productId,
      handle: product.handle,
      title: product.title,
    };
    if (pin.archetype === "QUANTITY_MOQ_STEP") {
      fixture.minimumOrderQuantity = 6;
      fixture.stepQuantity = 3;
    }
    if (pin.archetype === "QUANTITY_MAX") {
      fixture.maxOrderQuantity = 3;
    }
    if (pin.archetype === "VARIANT_HIDDEN") {
      const variantId = firstVariantByProductId.get(product.productId);
      if (!variantId) {
        notes.push(
          `Pinned VARIANT_HIDDEN product "${pin.handle}" has no variant in the synced catalog.`,
        );
        continue;
      }
      fixture.variantId = variantId;
    }
    fixtures.push(fixture);
  }

  // Optional 5th archetype: COLLECTION_MAX. Appended only when both its member-product
  // handle and its collection GID are pinned — otherwise the base 4 stand alone. Never
  // part of the round-robin: collection membership isn't in the synced DB.
  const collectionHandle = normalizeHandle(process.env[ARCHETYPE_PIN_ENV.COLLECTION_MAX]);
  const collectionId = String(process.env[COLLECTION_ID_ENV] ?? "").trim();
  if (collectionHandle && collectionId) {
    const product = byHandle.get(collectionHandle);
    if (!product) {
      notes.push(
        `Pinned COLLECTION_MAX member "${collectionHandle}" not found in the synced catalog ` +
          `(${ARCHETYPE_PIN_ENV.COLLECTION_MAX}). Sync the catalog or fix the pin.`,
      );
    } else {
      fixtures.push({
        archetype: "COLLECTION_MAX",
        productId: product.productId,
        handle: product.handle,
        title: product.title,
        maxOrderQuantity: COLLECTION_MAX_QUANTITY,
        collectionId,
      });
    }
  }

  return fixtures;
}

export function writeMatrixFile(matrix: E2EMatrix): void {
  writeFileSync(MATRIX_FILE, JSON.stringify(matrix, null, 2), "utf8");
}

export function readMatrixFile(): E2EMatrix | null {
  if (!existsSync(MATRIX_FILE)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(MATRIX_FILE, "utf8")) as E2EMatrix;
    if (!Array.isArray(parsed.products)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function describeProductArchetype(archetype: ProductArchetype): string {
  switch (archetype) {
    case "HIDDEN":
      return "product hidden in the e2e catalog";
    case "VARIANT_HIDDEN":
      return "variant hidden in the e2e catalog";
    case "QUANTITY_MOQ_STEP":
      return "MOQ + step quantity";
    case "QUANTITY_MAX":
      return "max order quantity";
    case "COLLECTION_MAX":
      return "max order quantity via collection membership";
    default:
      return archetype;
  }
}
