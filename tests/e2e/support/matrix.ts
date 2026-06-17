import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import prisma from "../../../app/db.server.ts";

/**
 * The matrix is the single source of truth shared between the seeding setup
 * (which writes Margin Guard rules) and the read-only storefront specs (which
 * assert their effect). It is computed deterministically from the synced
 * `CatalogProduct/Collection/Variant` tables so that, once seeded, every spec
 * is purely read-only and therefore safe to run fully in parallel.
 *
 * Adding a new MVP feature = add an archetype here + a matching assertion block
 * in `buildMatrixTests`. No per-feature spec file needs to be hand-written.
 */

export const MATRIX_FILE = path.resolve(
  process.cwd(),
  "tests",
  "e2e",
  ".matrix.json",
);

export const MANIFEST_FILE = path.resolve(
  process.cwd(),
  "tests",
  "e2e",
  ".manifest.json",
);

export type ProductArchetype =
  | "VISIBILITY_B2B_ONLY"
  | "VISIBILITY_B2C_ONLY"
  | "VARIANT_B2B_ONLY"
  | "QUANTITY_MOQ_STEP"
  | "QUANTITY_MAX";

export type CollectionArchetype =
  | "COLLECTION_B2B_ONLY"
  | "COLLECTION_B2C_ONLY";

export interface ProductMatrixFixture {
  archetype: ProductArchetype;
  productId: string;
  handle: string;
  title: string;
  variantId?: string;
  minimumOrderQuantity?: number;
  stepQuantity?: number;
  maxOrderQuantity?: number;
}

export interface CollectionMatrixFixture {
  archetype: CollectionArchetype;
  collectionId: string;
  collectionHandle: string;
  collectionTitle: string | null;
}

export interface E2EMatrix {
  generatedAt: string;
  products: ProductMatrixFixture[];
  collections: CollectionMatrixFixture[];
  notes: string[];
}

const PRODUCT_ARCHETYPE_ORDER: ProductArchetype[] = [
  "VISIBILITY_B2B_ONLY",
  "VISIBILITY_B2C_ONLY",
  "QUANTITY_MOQ_STEP",
  "QUANTITY_MAX",
  "VARIANT_B2B_ONLY",
];

const COLLECTION_ARCHETYPE_ORDER: CollectionArchetype[] = [
  "COLLECTION_B2B_ONLY",
  "COLLECTION_B2C_ONLY",
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

interface CatalogCollectionRow {
  shopifyCollectionId: string | null;
  handle: string | null;
  title: string;
}

/**
 * Builds the deterministic E2E matrix from the synced catalog. Distinct
 * products are assigned distinct archetypes round-robin, so seeded rules never
 * overlap on the same product and each spec can assert only its own product.
 *
 * Returns an empty matrix (with explanatory notes) when the catalog has not
 * been synced yet — the setup project then skips with that reason instead of
 * failing.
 */
const PRODUCT_ARCHETYPES = new Set<ProductArchetype>(PRODUCT_ARCHETYPE_ORDER);
const COLLECTION_ARCHETYPES = new Set<CollectionArchetype>(
  COLLECTION_ARCHETYPE_ORDER,
);

interface ManifestShape {
  matrix?: {
    products?: unknown[];
    collections?: unknown[];
  };
}

/**
 * When the comprehensive seeder (`scripts/seed-e2e-catalog.mts`) has run it owns
 * the data additively and writes `.manifest.json` with the exact Tier-1 fixtures
 * to assert. Prefer it over catalog round-robin so the matrix matches what was
 * provisioned. Returns null when no (valid) manifest exists.
 */
export function readManifestMatrix(): E2EMatrix | null {
  if (!existsSync(MANIFEST_FILE)) {
    return null;
  }
  let manifest: ManifestShape;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as ManifestShape;
  } catch {
    return null;
  }
  const rawProducts = Array.isArray(manifest.matrix?.products)
    ? manifest.matrix!.products!
    : [];
  const rawCollections = Array.isArray(manifest.matrix?.collections)
    ? manifest.matrix!.collections!
    : [];

  const products: ProductMatrixFixture[] = [];
  for (const raw of rawProducts as Array<Record<string, unknown>>) {
    const archetype = String(raw.archetype ?? "") as ProductArchetype;
    const productId = normalizeProductGid(String(raw.productId ?? ""));
    const handle = normalizeHandle(String(raw.handle ?? ""));
    if (!PRODUCT_ARCHETYPES.has(archetype) || !productId || !handle) {
      continue;
    }
    products.push({
      archetype,
      productId,
      handle,
      title: String(raw.title ?? handle),
      variantId: raw.variantId ? String(raw.variantId) : undefined,
      minimumOrderQuantity:
        typeof raw.minimumOrderQuantity === "number" ? raw.minimumOrderQuantity : undefined,
      stepQuantity: typeof raw.stepQuantity === "number" ? raw.stepQuantity : undefined,
      maxOrderQuantity:
        typeof raw.maxOrderQuantity === "number" ? raw.maxOrderQuantity : undefined,
    });
  }

  const collections: CollectionMatrixFixture[] = [];
  for (const raw of rawCollections as Array<Record<string, unknown>>) {
    const archetype = String(raw.archetype ?? "") as CollectionArchetype;
    const collectionId = String(raw.collectionId ?? "").trim();
    const collectionHandle = normalizeHandle(String(raw.collectionHandle ?? ""));
    if (!COLLECTION_ARCHETYPES.has(archetype) || !collectionId || !collectionHandle) {
      continue;
    }
    collections.push({
      archetype,
      collectionId,
      collectionHandle,
      collectionTitle:
        raw.collectionTitle == null ? null : String(raw.collectionTitle),
    });
  }

  if (products.length === 0 && collections.length === 0) {
    return null;
  }
  return {
    generatedAt: new Date().toISOString(),
    products,
    collections,
    notes: ["Matrix sourced from .manifest.json (seed-e2e-catalog)."],
  };
}

export async function buildE2EMatrix(): Promise<E2EMatrix> {
  const fromManifest = readManifestMatrix();
  if (fromManifest) {
    return fromManifest;
  }

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

  const collections = (await prisma.catalogCollection.findMany({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" },
    select: { shopifyCollectionId: true, handle: true, title: true },
  })) as CatalogCollectionRow[];

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

  const productFixtures: ProductMatrixFixture[] = [];
  let archetypeIndex = 0;
  for (const product of usableProducts) {
    if (archetypeIndex >= PRODUCT_ARCHETYPE_ORDER.length) {
      break;
    }
    const archetype = PRODUCT_ARCHETYPE_ORDER[archetypeIndex];

    if (archetype === "VARIANT_B2B_ONLY") {
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
        `No catalog product available for archetype ${archetype} (need ${PRODUCT_ARCHETYPE_ORDER.length} distinct products${archetype === "VARIANT_B2B_ONLY" ? ", one with variants" : ""}).`,
      );
    }
  }

  const usableCollections = collections
    .map((row) => ({
      collectionId: String(row.shopifyCollectionId ?? "").trim(),
      collectionHandle: normalizeHandle(row.handle),
      collectionTitle: row.title,
    }))
    .filter(
      (
        row,
      ): row is {
        collectionId: string;
        collectionHandle: string;
        collectionTitle: string;
      } => Boolean(row.collectionId && row.collectionHandle),
    );

  const collectionFixtures: CollectionMatrixFixture[] = [];
  usableCollections.slice(0, COLLECTION_ARCHETYPE_ORDER.length).forEach(
    (collection, index) => {
      collectionFixtures.push({
        archetype: COLLECTION_ARCHETYPE_ORDER[index],
        collectionId: collection.collectionId,
        collectionHandle: collection.collectionHandle,
        collectionTitle: collection.collectionTitle,
      });
    },
  );

  if (collectionFixtures.length === 0) {
    notes.push(
      "No catalog collections available — collection visibility archetypes skipped.",
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    products: productFixtures,
    collections: collectionFixtures,
    notes,
  };
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
    if (!Array.isArray(parsed.products) || !Array.isArray(parsed.collections)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function describeProductArchetype(archetype: ProductArchetype): string {
  switch (archetype) {
    case "VISIBILITY_B2B_ONLY":
      return "product visible to B2B only";
    case "VISIBILITY_B2C_ONLY":
      return "product visible to B2C only";
    case "VARIANT_B2B_ONLY":
      return "variant visible to B2B only";
    case "QUANTITY_MOQ_STEP":
      return "MOQ + step quantity";
    case "QUANTITY_MAX":
      return "max order quantity";
    default:
      return archetype;
  }
}
