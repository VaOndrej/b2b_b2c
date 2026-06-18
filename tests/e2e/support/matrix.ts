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
  | "QUANTITY_MAX";

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
    default:
      return archetype;
  }
}
