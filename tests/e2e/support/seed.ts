import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import prisma from "../../../app/db.server.ts";
import {
  updateGlobalMarginGuardConfig,
  upsertProductMaximumQuantityRule,
  upsertProductQuantityRule,
  upsertProductStepQuantityRule,
  upsertProductVariantVisibilityRule,
  upsertProductVisibilityRule,
} from "../../../app/services/margin-guard-config.server.ts";
import { upsertCollectionVisibilityRule } from "../../../app/services/storefront-content.server.ts";
import { syncStorefrontProjectionMetafields } from "../../../app/services/storefront-projection.server.ts";
import type { E2EMatrix } from "./matrix.ts";

const SNAPSHOT_FILE = path.resolve(
  process.cwd(),
  "tests",
  "e2e",
  ".matrix-snapshot.json",
);

const E2E_ADMIN_API_VERSION = "2026-04";

interface OfflineAdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<unknown> }>;
}

/**
 * Builds an Admin GraphQL client from the offline Shopify session stored in
 * Prisma. Collection visibility is projected ONLY through the
 * `margin_guard.storefront_projection` shop metafield (the runtime app-proxy
 * payload does not carry hidden collections), so storefront E2E for collection
 * hiding must push that metafield to the live shop before asserting. Returns
 * null when no offline session is available, letting the caller skip.
 */
async function buildOfflineAdminClient(): Promise<OfflineAdminClient | null> {
  const session = await prisma.session.findFirst({
    where: { isOnline: false },
    orderBy: { id: "asc" },
    select: { shop: true, accessToken: true },
  });

  if (!session?.shop || !session?.accessToken) {
    return null;
  }

  const endpoint = `https://${session.shop}/admin/api/${E2E_ADMIN_API_VERSION}/graphql.json`;
  return {
    graphql: async (query, options) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
        },
        body: JSON.stringify({
          query,
          variables: options?.variables ?? {},
        }),
      });
      return { json: () => response.json() };
    },
  };
}

/**
 * Re-projects the current Prisma config into the live shop's storefront
 * projection metafield. Call after restoring the config snapshot so the dev
 * shop metafield matches the original DB state again.
 */
export async function resyncStorefrontProjectionForE2E(): Promise<boolean> {
  const admin = await buildOfflineAdminClient();
  if (!admin) {
    return false;
  }
  try {
    await syncStorefrontProjectionMetafields(admin);
    return true;
  } catch {
    return false;
  }
}

interface MarginGuardConfigSnapshot {
  globalConfig: {
    b2bTag: string;
    globalMinPricePercent: number;
    b2bGlobalMinPricePercent: number;
    allowZeroFinalPrice: boolean;
    allowRemoveAtMinimumOrderQuantity: boolean;
    allowStacking: boolean;
    maxCombinedPercentOff: number | null;
  };
  productQuantityRules: Array<{
    productId: string;
    segment: string | null;
    minimumOrderQuantity: number;
    stepQuantity: number | null;
    maxOrderQuantity: number | null;
  }>;
  collectionQuantityRules: Array<{
    collectionId: string;
    segment: string | null;
    maxOrderQuantity: number;
  }>;
  productCustomerQuantityRules: Array<{
    productId: string;
    customerId: string;
    maxOrderQuantity: number;
  }>;
  productVisibilityRules: Array<{
    productId: string;
    visibilityMode: string;
    customerId: string | null;
  }>;
  productVariantVisibilityRules: Array<{
    productId: string;
    variantId: string;
    visibilityMode: string;
    customerId: string | null;
  }>;
  couponSegmentRules: Array<{
    code: string;
    allowedSegment: string;
  }>;
  collectionVisibilityRules: Array<{
    collectionId: string;
    collectionHandle: string;
    collectionTitle: string | null;
    visibilityMode: string;
  }>;
}

let originalSnapshotPromise: Promise<MarginGuardConfigSnapshot> | null = null;

async function captureMarginGuardConfigSnapshot(): Promise<MarginGuardConfigSnapshot> {
  const config = await prisma.marginGuardConfig.findUnique({
    where: {
      id: "default",
    },
    include: {
      productQuantityRules: true,
      collectionQuantityRules: true,
      productCustomerQuantityRules: true,
      productVisibilityRules: true,
      productVariantVisibilityRules: true,
      couponSegmentRules: true,
      collectionVisibilityRules: true,
    },
  });

  if (!config) {
    const defaults = await updateGlobalMarginGuardConfig({
      b2bTag: "b2b",
      globalMinPricePercent: 70,
      b2bGlobalMinPricePercent: 70,
      allowZeroFinalPrice: false,
      allowRemoveAtMinimumOrderQuantity: true,
      allowStacking: false,
      maxCombinedPercentOff: null,
    });

    return {
      globalConfig: {
        b2bTag: defaults.b2bTag,
        globalMinPricePercent: defaults.globalMinPricePercent,
        b2bGlobalMinPricePercent: defaults.b2bGlobalMinPricePercent,
        allowZeroFinalPrice: defaults.allowZeroFinalPrice,
        allowRemoveAtMinimumOrderQuantity: defaults.allowRemoveAtMinimumOrderQuantity,
        allowStacking: defaults.allowStacking,
        maxCombinedPercentOff: defaults.maxCombinedPercentOff ?? null,
      },
      productQuantityRules: [],
      collectionQuantityRules: [],
      productCustomerQuantityRules: [],
      productVisibilityRules: [],
      productVariantVisibilityRules: [],
      couponSegmentRules: [],
      collectionVisibilityRules: [],
    };
  }

  return {
    globalConfig: {
      b2bTag: config.b2bTag,
      globalMinPricePercent: config.globalMinPricePercent,
      b2bGlobalMinPricePercent: config.b2bGlobalMinPricePercent,
      allowZeroFinalPrice: config.allowZeroFinalPrice,
      allowRemoveAtMinimumOrderQuantity: config.allowRemoveAtMinimumOrderQuantity,
      allowStacking: config.allowStacking,
      maxCombinedPercentOff: config.maxCombinedPercentOff ?? null,
    },
    productQuantityRules: config.productQuantityRules.map((rule) => ({
      productId: rule.productId,
      segment: rule.segment,
      minimumOrderQuantity: rule.minimumOrderQuantity,
      stepQuantity: rule.stepQuantity,
      maxOrderQuantity: rule.maxOrderQuantity,
    })),
    collectionQuantityRules: config.collectionQuantityRules.map((rule) => ({
      collectionId: rule.collectionId,
      segment: rule.segment,
      maxOrderQuantity: rule.maxOrderQuantity,
    })),
    productCustomerQuantityRules: config.productCustomerQuantityRules.map((rule) => ({
      productId: rule.productId,
      customerId: rule.customerId,
      maxOrderQuantity: rule.maxOrderQuantity,
    })),
    productVisibilityRules: config.productVisibilityRules.map((rule) => ({
      productId: rule.productId,
      visibilityMode: rule.visibilityMode,
      customerId: rule.customerId,
    })),
    productVariantVisibilityRules: config.productVariantVisibilityRules.map((rule) => ({
      productId: rule.productId,
      variantId: rule.variantId,
      visibilityMode: rule.visibilityMode,
      customerId: rule.customerId,
    })),
    couponSegmentRules: config.couponSegmentRules.map((rule) => ({
      code: rule.code,
      allowedSegment: rule.allowedSegment,
    })),
    collectionVisibilityRules: config.collectionVisibilityRules.map((rule) => ({
      collectionId: rule.collectionId,
      collectionHandle: rule.collectionHandle,
      collectionTitle: rule.collectionTitle,
      visibilityMode: rule.visibilityMode,
    })),
  };
}

export async function ensureOriginalMarginGuardSnapshot() {
  if (!originalSnapshotPromise) {
    originalSnapshotPromise = captureMarginGuardConfigSnapshot();
  }
  return originalSnapshotPromise;
}

export async function resetMarginGuardConfigForStorefrontE2E() {
  await ensureOriginalMarginGuardSnapshot();
  await updateGlobalMarginGuardConfig({
    b2bTag: "b2b",
    globalMinPricePercent: 70,
    b2bGlobalMinPricePercent: 70,
    allowZeroFinalPrice: false,
    allowRemoveAtMinimumOrderQuantity: true,
    allowStacking: false,
    maxCombinedPercentOff: null,
  });

  await prisma.productVariantVisibilityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.productVisibilityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.productCustomerQuantityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.collectionQuantityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.productQuantityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.couponSegmentRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.collectionVisibilityRule.deleteMany({
    where: { configId: "default" },
  });
}

export async function restoreOriginalMarginGuardSnapshot() {
  const snapshot = await ensureOriginalMarginGuardSnapshot();
  await applyMarginGuardConfigSnapshot(snapshot);
}

/**
 * Applies a captured snapshot back onto the live config: resets global fields
 * and rebuilds every child rule table from the snapshot. Shared by the
 * in-memory restore and the cross-process file restore.
 */
async function applyMarginGuardConfigSnapshot(
  snapshot: MarginGuardConfigSnapshot,
) {
  await updateGlobalMarginGuardConfig(snapshot.globalConfig);

  await prisma.productVariantVisibilityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.productVisibilityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.productCustomerQuantityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.collectionQuantityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.productQuantityRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.couponSegmentRule.deleteMany({
    where: { configId: "default" },
  });
  await prisma.collectionVisibilityRule.deleteMany({
    where: { configId: "default" },
  });

  for (const rule of snapshot.productQuantityRules) {
    await prisma.productQuantityRule.create({
      data: {
        configId: "default",
        productId: rule.productId,
        segment: rule.segment,
        minimumOrderQuantity: rule.minimumOrderQuantity,
        stepQuantity: rule.stepQuantity,
        maxOrderQuantity: rule.maxOrderQuantity,
      },
    });
  }

  for (const rule of snapshot.collectionQuantityRules) {
    await prisma.collectionQuantityRule.create({
      data: {
        configId: "default",
        collectionId: rule.collectionId,
        segment: rule.segment,
        maxOrderQuantity: rule.maxOrderQuantity,
      },
    });
  }

  for (const rule of snapshot.productCustomerQuantityRules) {
    await prisma.productCustomerQuantityRule.create({
      data: {
        configId: "default",
        productId: rule.productId,
        customerId: rule.customerId,
        maxOrderQuantity: rule.maxOrderQuantity,
      },
    });
  }

  for (const rule of snapshot.productVisibilityRules) {
    await prisma.productVisibilityRule.create({
      data: {
        configId: "default",
        productId: rule.productId,
        visibilityMode: rule.visibilityMode,
        customerId: rule.customerId,
      },
    });
  }

  for (const rule of snapshot.productVariantVisibilityRules) {
    await prisma.productVariantVisibilityRule.create({
      data: {
        configId: "default",
        productId: rule.productId,
        variantId: rule.variantId,
        visibilityMode: rule.visibilityMode,
        customerId: rule.customerId,
      },
    });
  }

  for (const rule of snapshot.couponSegmentRules) {
    await prisma.couponSegmentRule.create({
      data: {
        configId: "default",
        code: rule.code,
        allowedSegment: rule.allowedSegment,
      },
    });
  }

  for (const rule of snapshot.collectionVisibilityRules) {
    await prisma.collectionVisibilityRule.create({
      data: {
        configId: "default",
        collectionId: rule.collectionId,
        collectionHandle: rule.collectionHandle,
        collectionTitle: rule.collectionTitle,
        visibilityMode: rule.visibilityMode,
      },
    });
  }
}

/**
 * Captures the current config to a file so a separate-process teardown can
 * restore it. Used by the parallel matrix globalSetup/globalTeardown, which run
 * in different processes and therefore cannot share the in-memory snapshot.
 * Captures only once (won't overwrite an existing snapshot of the pre-seed state).
 */
export async function captureSnapshotToFile(): Promise<void> {
  if (existsSync(SNAPSHOT_FILE)) {
    return;
  }
  const snapshot = await captureMarginGuardConfigSnapshot();
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), "utf8");
}

/**
 * Restores the config from the file captured by `captureSnapshotToFile` and
 * removes the file. No-op when no snapshot file exists.
 */
export async function restoreSnapshotFromFile(): Promise<boolean> {
  if (!existsSync(SNAPSHOT_FILE)) {
    return false;
  }
  let snapshot: MarginGuardConfigSnapshot;
  try {
    snapshot = JSON.parse(
      readFileSync(SNAPSHOT_FILE, "utf8"),
    ) as MarginGuardConfigSnapshot;
  } catch {
    return false;
  }
  await applyMarginGuardConfigSnapshot(snapshot);
  try {
    unlinkSync(SNAPSHOT_FILE);
  } catch {
    /* best effort */
  }
  return true;
}

export async function seedB2BOnlyVisibilityScenario(input: {
  productId: string;
}) {
  await resetMarginGuardConfigForStorefrontE2E();
  await upsertProductVisibilityRule({
    productId: input.productId,
    visibilityMode: "B2B_ONLY",
  });
}

export async function seedQuantityConstraintScenario(input: {
  productId: string;
  minimumOrderQuantity: number;
  stepQuantity: number;
}) {
  await resetMarginGuardConfigForStorefrontE2E();
  await upsertProductQuantityRule({
    productId: input.productId,
    minimumOrderQuantity: input.minimumOrderQuantity,
  });
  await upsertProductStepQuantityRule({
    productId: input.productId,
    stepQuantity: input.stepQuantity,
  });
}

export async function seedVariantVisibilityScenario(input: {
  productId: string;
  variantId: string;
}) {
  await resetMarginGuardConfigForStorefrontE2E();
  await upsertProductVariantVisibilityRule({
    productId: input.productId,
    variantId: input.variantId,
    visibilityMode: "B2B_ONLY",
  });
}

export async function seedMaxOrderQuantityScenario(input: {
  productId: string;
  maxOrderQuantity: number;
}) {
  await resetMarginGuardConfigForStorefrontE2E();
  await upsertProductMaximumQuantityRule({
    productId: input.productId,
    maxOrderQuantity: input.maxOrderQuantity,
  });
}

export async function seedCollectionVisibilityScenario(input: {
  collectionHandle: string;
}): Promise<{ seeded: boolean; collectionId: string | null }> {
  const normalizedHandle = input.collectionHandle.trim().toLowerCase();
  const snapshot = await ensureOriginalMarginGuardSnapshot();

  const snapshotMatch = snapshot.collectionVisibilityRules.find(
    (rule) => rule.collectionHandle.trim().toLowerCase() === normalizedHandle,
  );

  let collectionId = snapshotMatch?.collectionId ?? null;
  let collectionTitle = snapshotMatch?.collectionTitle ?? null;

  if (!collectionId) {
    const catalogCollections = await prisma.catalogCollection.findMany({
      select: { shopifyCollectionId: true, handle: true, title: true },
    });
    const catalogMatch = catalogCollections.find(
      (collection) =>
        String(collection.handle ?? "").trim().toLowerCase() === normalizedHandle,
    );
    collectionId = catalogMatch?.shopifyCollectionId ?? null;
    collectionTitle = catalogMatch?.title ?? collectionTitle;
  }

  if (!collectionId) {
    return { seeded: false, collectionId: null };
  }

  const admin = await buildOfflineAdminClient();
  if (!admin) {
    return { seeded: false, collectionId };
  }

  await resetMarginGuardConfigForStorefrontE2E();
  await upsertCollectionVisibilityRule({
    collectionId,
    collectionHandle: normalizedHandle,
    collectionTitle,
    visibilityMode: "B2B_ONLY",
  });

  // Collection hiding is driven exclusively by the storefront_projection
  // metafield (inline CSS), so push the projection to the live shop.
  try {
    await syncStorefrontProjectionMetafields(admin);
  } catch {
    return { seeded: false, collectionId };
  }

  return { seeded: true, collectionId };
}

/**
 * Seeds the entire deterministic E2E matrix in one shot, then pushes the
 * storefront projection once. After this runs the live shop holds every
 * archetype's rule simultaneously (each on a distinct product/collection), so
 * the matrix specs can assert purely read-only and run fully in parallel.
 *
 * Returns `seeded: false` with a reason when no offline session is available to
 * project collection visibility, letting the setup project skip gracefully.
 */
export async function seedE2EMatrix(
  matrix: E2EMatrix,
): Promise<{ seeded: boolean; reason: string | null }> {
  await ensureOriginalMarginGuardSnapshot();
  await resetMarginGuardConfigForStorefrontE2E();

  for (const fixture of matrix.products) {
    switch (fixture.archetype) {
      case "VISIBILITY_B2B_ONLY":
        await upsertProductVisibilityRule({
          productId: fixture.productId,
          visibilityMode: "B2B_ONLY",
        });
        break;
      case "VISIBILITY_B2C_ONLY":
        await upsertProductVisibilityRule({
          productId: fixture.productId,
          visibilityMode: "B2C_ONLY",
        });
        break;
      case "VARIANT_B2B_ONLY":
        if (fixture.variantId) {
          await upsertProductVariantVisibilityRule({
            productId: fixture.productId,
            variantId: fixture.variantId,
            visibilityMode: "B2B_ONLY",
          });
        }
        break;
      case "QUANTITY_MOQ_STEP":
        if (fixture.minimumOrderQuantity != null) {
          await upsertProductQuantityRule({
            productId: fixture.productId,
            minimumOrderQuantity: fixture.minimumOrderQuantity,
          });
        }
        if (fixture.stepQuantity != null) {
          await upsertProductStepQuantityRule({
            productId: fixture.productId,
            stepQuantity: fixture.stepQuantity,
          });
        }
        break;
      case "QUANTITY_MAX":
        if (fixture.maxOrderQuantity != null) {
          await upsertProductMaximumQuantityRule({
            productId: fixture.productId,
            maxOrderQuantity: fixture.maxOrderQuantity,
          });
        }
        break;
      default:
        break;
    }
  }

  const admin = await buildOfflineAdminClient();
  if (!admin) {
    return {
      seeded: matrix.collections.length === 0,
      reason:
        matrix.collections.length === 0
          ? null
          : "No offline Shopify session available to project collection visibility metafield.",
    };
  }

  for (const fixture of matrix.collections) {
    if (fixture.archetype === "COLLECTION_B2B_ONLY") {
      await upsertCollectionVisibilityRule({
        collectionId: fixture.collectionId,
        collectionHandle: fixture.collectionHandle,
        collectionTitle: fixture.collectionTitle,
        visibilityMode: "B2B_ONLY",
      });
    } else if (fixture.archetype === "COLLECTION_B2C_ONLY") {
      await upsertCollectionVisibilityRule({
        collectionId: fixture.collectionId,
        collectionHandle: fixture.collectionHandle,
        collectionTitle: fixture.collectionTitle,
        visibilityMode: "B2C_ONLY",
      });
    }
  }

  try {
    await syncStorefrontProjectionMetafields(admin);
  } catch (error) {
    return {
      seeded: false,
      reason:
        error instanceof Error
          ? `Storefront projection sync failed: ${error.message}`
          : "Storefront projection sync failed.",
    };
  }

  return { seeded: true, reason: null };
}

/**
 * Exposes the offline-session Admin GraphQL client for E2E specs that need to
 * activate Shopify Functions (discount / cart validation) before asserting
 * checkout-level enforcement. Returns null when no offline session exists.
 */
export async function getOfflineAdminClientForE2E() {
  return buildOfflineAdminClient();
}

export async function disconnectE2EPrisma() {
  await prisma.$disconnect();
}
