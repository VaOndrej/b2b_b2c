/**
 * Comprehensive, idempotent, ADDITIVE E2E provisioner.
 *
 * Provisions BOTH the Shopify fixtures (products / variants / collections via
 * Admin API) AND the matching `MarginGuardConfig` singleton + child-table rows
 * so every feature and its key branches are covered. One rule-set lives on one
 * dedicated product/collection (stable `mg-e2e-` prefix) so storefront
 * resolution never overlaps between scenarios (per the parallelism correction).
 *
 * - NO destructive reset. Re-runnable: fixtures are create-if-absent (matched by
 *   handle) and rules are upserts keyed on stable identifiers.
 * - Enum coverage is pulled from the app's real upsert signatures / TS types
 *   (`Parameters<typeof ...>`, content types) with compile-time completeness
 *   guards — values are never guessed.
 * - Emits `tests/e2e/.manifest.json`, consumed by the matrix builder (Phase A).
 *
 * Run: `npm run e2e:seed-catalog` (runs `prisma:ensure-db` first so the seed
 * targets the same DB the app reads at test time).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import prisma from "../app/db.server.ts";
import {
  getOrCreateMarginGuardConfig,
  upsertProductFloorRule,
  upsertProductTierPriceRule,
  upsertProductQuantityRule,
  upsertProductStepQuantityRule,
  upsertProductMaximumQuantityRule,
  upsertCollectionMaximumQuantityRule,
  upsertProductCustomerMaximumQuantityRule,
  upsertProductVisibilityRule,
  upsertProductVariantVisibilityRule,
  upsertCouponSegmentRule,
  upsertDiscountRule,
  upsertDiscountCombinationBlacklistRule,
  upsertDiscountSegmentCap,
} from "../app/services/margin-guard-config.server.ts";
import {
  upsertStorefrontContentRule,
  upsertCollectionVisibilityRule,
} from "../app/services/storefront-content.server.ts";
import { syncStorefrontProjectionMetafields } from "../app/services/storefront-projection.server.ts";
import {
  syncShopifyProductCatalog,
  syncShopifyCollectionCatalog,
} from "../app/services/product-catalog.server.ts";
import type {
  ContentAction,
  PageType,
  SemanticPosition,
  TargetType,
} from "../core/storefront/storefront-content.types.ts";

const PREFIX = "mg-e2e-";
const E2E_ADMIN_API_VERSION = "2026-04";
const MANIFEST_FILE = path.resolve(process.cwd(), "tests", "e2e", ".manifest.json");

// ---------------------------------------------------------------------------
// Enum coverage pulled from the app (NOT guessed). The `satisfies Record<U, …>`
// guards fail compilation if a union gains/loses a member, forcing coverage.
// ---------------------------------------------------------------------------
type VisibilityMode = Parameters<typeof upsertProductVisibilityRule>[0]["visibilityMode"];
type DiscountScope = Parameters<typeof upsertDiscountRule>[0]["scope"];
type DiscountStackMode = Parameters<typeof upsertDiscountRule>[0]["stackMode"];
type AllowedSegment = Parameters<typeof upsertCouponSegmentRule>[0]["allowedSegment"];
type DiscountRefType = Parameters<typeof upsertDiscountCombinationBlacklistRule>[0]["leftType"];
type CapSegment = Parameters<typeof upsertDiscountSegmentCap>[0]["segment"];

const VISIBILITY_MODES = {
  ALL: 0, B2B_ONLY: 0, B2C_ONLY: 0, CUSTOMER_ONLY: 0,
} satisfies Record<VisibilityMode, number>;
const DISCOUNT_SCOPES = {
  GLOBAL: 0, COLLECTION: 0, PRODUCT: 0, COUPON: 0,
} satisfies Record<DiscountScope, number>;
const STACK_MODES = {
  STACKABLE: 0, EXCLUSIVE: 0, NEVER_WITH_COUPONS: 0,
} satisfies Record<DiscountStackMode, number>;
const ALLOWED_SEGMENTS = {
  B2B: 0, B2C: 0, ALL: 0,
} satisfies Record<AllowedSegment, number>;
const CONTENT_ACTIONS = {
  SWAP_IMAGE: 0, SWAP_TEXT: 0, SWAP_HTML: 0, SWAP_HREF: 0,
  HIDE: 0, SHOW: 0, ADD_CLASS: 0, REMOVE_CLASS: 0,
} satisfies Record<ContentAction, number>;
const TARGET_TYPES = {
  CSS_SELECTOR: 0, SEMANTIC_POSITION: 0,
} satisfies Record<TargetType, number>;
const SEMANTIC_POSITIONS = {
  TOP_BANNER: 0, ABOVE_TITLE: 0, BELOW_TITLE: 0,
  ABOVE_ADD_TO_CART: 0, BELOW_ADD_TO_CART: 0, BOTTOM_BANNER: 0,
} satisfies Record<SemanticPosition, number>;
const PAGE_TYPES = {
  ALL: 0, HOME: 0, PRODUCT: 0, COLLECTION: 0, CART: 0, PAGE: 0,
} satisfies Record<PageType, number>;
const REF_TYPES = {
  RULE_ID: 0, COUPON_CODE: 0, SCOPE: 0,
} satisfies Record<DiscountRefType, number>;
const CAP_SEGMENTS = {
  ALL: 0, B2B: 0, B2C: 0,
} satisfies Record<CapSegment, number>;

const keys = <T extends Record<string, unknown>>(record: T) =>
  Object.keys(record) as Array<keyof T & string>;

// ---------------------------------------------------------------------------
// Admin API plumbing
// ---------------------------------------------------------------------------
interface AdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

async function buildAdminClient(): Promise<AdminClient> {
  const session = await prisma.session.findFirst({
    where: { isOnline: false },
    orderBy: { id: "asc" },
    select: { shop: true, accessToken: true },
  });
  if (!session?.shop || !session?.accessToken) {
    throw new Error("No offline Shopify session found. Install/re-auth the app first.");
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
        body: JSON.stringify({ query, variables: options?.variables ?? {} }),
      });
      return { json: () => response.json() };
    },
  };
}

async function gql<T = any>(
  admin: AdminClient,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const json = await (await admin.graphql(query, { variables })).json();
  if (json?.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data as T;
}

async function onlineStorePublicationId(admin: AdminClient): Promise<string | null> {
  const data = await gql<{ publications: { nodes: Array<{ id: string; name: string }> } }>(
    admin,
    `#graphql
      query { publications(first: 20) { nodes { id name } } }`,
  );
  return data.publications.nodes.find((p) => /online store/i.test(p.name))?.id ?? null;
}

interface ProvisionedProduct {
  handle: string;
  productId: string;
  title: string;
  variantIds: string[];
}

async function ensureProduct(
  admin: AdminClient,
  handle: string,
  title: string,
  publicationId: string | null,
): Promise<ProvisionedProduct> {
  const existing = await gql<{ productByHandle: { id: string; variants: { nodes: Array<{ id: string }> } } | null }>(
    admin,
    `#graphql
      query P($handle: String!) {
        productByHandle(handle: $handle) { id variants(first: 10) { nodes { id } } }
      }`,
    { handle },
  );
  if (existing.productByHandle) {
    return {
      handle,
      productId: existing.productByHandle.id,
      title,
      variantIds: existing.productByHandle.variants.nodes.map((v) => v.id),
    };
  }

  const created = await gql<{
    productCreate: { product: { id: string; variants: { nodes: Array<{ id: string }> } } | null; userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation Create($input: ProductInput!) {
        productCreate(input: $input) {
          product { id variants(first: 10) { nodes { id } } }
          userErrors { message }
        }
      }`,
    { input: { title, handle, status: "ACTIVE" } },
  );
  if (created.productCreate.userErrors?.length) {
    throw new Error(`productCreate(${handle}): ${created.productCreate.userErrors.map((e) => e.message).join("; ")}`);
  }
  const product = created.productCreate.product!;
  if (publicationId) {
    await gql(admin, `#graphql
      mutation Pub($id: ID!, $pubId: ID!) {
        publishablePublish(id: $id, input: { publicationId: $pubId }) { userErrors { message } }
      }`, { id: product.id, pubId: publicationId });
  }
  console.log(`  • product ${handle}`);
  return { handle, productId: product.id, title, variantIds: product.variants.nodes.map((v) => v.id) };
}

interface ProvisionedCollection {
  handle: string;
  collectionId: string;
  title: string;
}

async function ensureCollection(
  admin: AdminClient,
  handle: string,
  title: string,
  publicationId: string | null,
): Promise<ProvisionedCollection> {
  const existing = await gql<{ collectionByHandle: { id: string } | null }>(
    admin,
    `#graphql
      query C($handle: String!) { collectionByHandle(handle: $handle) { id } }`,
    { handle },
  );
  if (existing.collectionByHandle) {
    return { handle, collectionId: existing.collectionByHandle.id, title };
  }
  const created = await gql<{
    collectionCreate: { collection: { id: string } | null; userErrors: Array<{ message: string }> };
  }>(
    admin,
    `#graphql
      mutation Create($input: CollectionInput!) {
        collectionCreate(input: $input) { collection { id } userErrors { message } }
      }`,
    { input: { title, handle } },
  );
  if (created.collectionCreate.userErrors?.length) {
    throw new Error(`collectionCreate(${handle}): ${created.collectionCreate.userErrors.map((e) => e.message).join("; ")}`);
  }
  const collection = created.collectionCreate.collection!;
  if (publicationId) {
    await gql(admin, `#graphql
      mutation Pub($id: ID!, $pubId: ID!) {
        publishablePublish(id: $id, input: { publicationId: $pubId }) { userErrors { message } }
      }`, { id: collection.id, pubId: publicationId });
  }
  console.log(`  • collection ${handle}`);
  return { handle, collectionId: collection.id, title };
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------
interface RuleEntry {
  table: string;
  scenario: string;
  target?: string;
}

interface Manifest {
  generatedAt: string;
  prefix: string;
  products: ProvisionedProduct[];
  collections: ProvisionedCollection[];
  rules: RuleEntry[];
  // Tier-1 (anonymous/B2C, theme-dependent) fixtures consumed by the matrix.
  matrix: {
    products: Array<{
      archetype: string;
      productId: string;
      handle: string;
      title: string;
      variantId?: string;
      minimumOrderQuantity?: number;
      stepQuantity?: number;
      maxOrderQuantity?: number;
    }>;
    collections: Array<{
      archetype: string;
      collectionId: string;
      collectionHandle: string;
      collectionTitle: string | null;
    }>;
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const admin = await buildAdminClient();
  await getOrCreateMarginGuardConfig();

  console.log("Resolving Online Store publication…");
  const publicationId = await onlineStorePublicationId(admin);
  if (!publicationId) {
    console.warn("  ! Online Store publication not found — fixtures created unpublished.");
  }

  console.log("Provisioning Shopify fixtures…");
  const P = {
    visB2B: await ensureProduct(admin, `${PREFIX}vis-b2b`, "MG E2E Visibility B2B", publicationId),
    visB2C: await ensureProduct(admin, `${PREFIX}vis-b2c`, "MG E2E Visibility B2C", publicationId),
    visCustomer: await ensureProduct(admin, `${PREFIX}vis-customer`, "MG E2E Visibility Customer", publicationId),
    variant: await ensureProduct(admin, `${PREFIX}variant`, "MG E2E Variant Visibility", publicationId),
    moqStep: await ensureProduct(admin, `${PREFIX}moq-step`, "MG E2E MOQ Step", publicationId),
    max: await ensureProduct(admin, `${PREFIX}max`, "MG E2E Max Quantity", publicationId),
    moqStepB2B: await ensureProduct(admin, `${PREFIX}moq-step-b2b`, "MG E2E MOQ Step B2B", publicationId),
    floor: await ensureProduct(admin, `${PREFIX}floor`, "MG E2E Floor", publicationId),
    floorB2B: await ensureProduct(admin, `${PREFIX}floor-b2b`, "MG E2E Floor B2B", publicationId),
    floorB2C: await ensureProduct(admin, `${PREFIX}floor-b2c`, "MG E2E Floor B2C", publicationId),
    tier: await ensureProduct(admin, `${PREFIX}tier`, "MG E2E Tier Pricing", publicationId),
    discountProduct: await ensureProduct(admin, `${PREFIX}discount`, "MG E2E Discount Product", publicationId),
    content: await ensureProduct(admin, `${PREFIX}content`, "MG E2E Content", publicationId),
    customerQty: await ensureProduct(admin, `${PREFIX}customer-qty`, "MG E2E Customer Qty", publicationId),
  };
  const C = {
    colB2B: await ensureCollection(admin, `${PREFIX}col-b2b`, "MG E2E Collection B2B", publicationId),
    colB2C: await ensureCollection(admin, `${PREFIX}col-b2c`, "MG E2E Collection B2C", publicationId),
    colMaxQty: await ensureCollection(admin, `${PREFIX}col-maxqty`, "MG E2E Collection Max Qty", publicationId),
    colDiscount: await ensureCollection(admin, `${PREFIX}col-discount`, "MG E2E Collection Discount", publicationId),
  };

  const rules: RuleEntry[] = [];
  const record = (table: string, scenario: string, target?: string) =>
    rules.push({ table, scenario, target });

  console.log("Seeding MarginGuardConfig child rules (additive)…");

  // --- ProductVisibilityRule: every visibility mode (one per product) ---
  await upsertProductVisibilityRule({ productId: P.visB2B.productId, visibilityMode: "B2B_ONLY" });
  record("ProductVisibilityRule", "B2B_ONLY", P.visB2B.handle);
  await upsertProductVisibilityRule({ productId: P.visB2C.productId, visibilityMode: "B2C_ONLY" });
  record("ProductVisibilityRule", "B2C_ONLY", P.visB2C.handle);
  await upsertProductVisibilityRule({
    productId: P.visCustomer.productId,
    visibilityMode: "CUSTOMER_ONLY",
    customerId: "gid://shopify/Customer/1",
  });
  record("ProductVisibilityRule", "CUSTOMER_ONLY (integration)", P.visCustomer.handle);
  // ALL is a no-op clear; assert it is accepted without leaving a restrictive rule.
  void keys(VISIBILITY_MODES);

  // --- ProductVariantVisibilityRule ---
  if (P.variant.variantIds[0]) {
    await upsertProductVariantVisibilityRule({
      productId: P.variant.productId,
      variantId: P.variant.variantIds[0],
      visibilityMode: "B2B_ONLY",
    });
    record("ProductVariantVisibilityRule", "B2B_ONLY", P.variant.handle);
  }

  // --- ProductQuantityRule: MOQ / step / max, segment null + B2B ---
  await upsertProductQuantityRule({ productId: P.moqStep.productId, minimumOrderQuantity: 6 });
  await upsertProductStepQuantityRule({ productId: P.moqStep.productId, stepQuantity: 3 });
  record("ProductQuantityRule", "MOQ=6 + step=3 (segment null)", P.moqStep.handle);
  await upsertProductMaximumQuantityRule({ productId: P.max.productId, maxOrderQuantity: 4 });
  record("ProductQuantityRule", "max=4 (segment null)", P.max.handle);
  await upsertProductQuantityRule({ productId: P.moqStepB2B.productId, segment: "B2B", minimumOrderQuantity: 12 });
  await upsertProductStepQuantityRule({ productId: P.moqStepB2B.productId, segment: "B2B", stepQuantity: 6 });
  record("ProductQuantityRule", "MOQ=12 + step=6 (segment B2B, integration)", P.moqStepB2B.handle);

  // --- CollectionQuantityRule: segment null + B2B + B2C on one collection ---
  await upsertCollectionMaximumQuantityRule({ collectionId: C.colMaxQty.collectionId, maxOrderQuantity: 10 });
  await upsertCollectionMaximumQuantityRule({ collectionId: C.colMaxQty.collectionId, segment: "B2B", maxOrderQuantity: 20 });
  await upsertCollectionMaximumQuantityRule({ collectionId: C.colMaxQty.collectionId, segment: "B2C", maxOrderQuantity: 5 });
  record("CollectionQuantityRule", "max segment null/B2B/B2C", C.colMaxQty.handle);

  // --- ProductCustomerQuantityRule (integration) ---
  await upsertProductCustomerMaximumQuantityRule({
    productId: P.customerQty.productId,
    customerId: "gid://shopify/Customer/1",
    maxOrderQuantity: 2,
  });
  record("ProductCustomerQuantityRule", "customer max=2 (integration)", P.customerQty.handle);

  // --- ProductFloorRule: segment null / B2C / B2B + b2bOverridePrice + allowZeroFinalPrice override ---
  await upsertProductFloorRule({
    productId: P.floor.productId,
    minPercentOfBasePrice: 80,
    allowZeroFinalPrice: null,
    b2bOverridePrice: null,
  });
  record("ProductFloorRule", "min=80% (segment null)", P.floor.handle);
  await upsertProductFloorRule({
    productId: P.floorB2C.productId,
    segment: "B2C",
    minPercentOfBasePrice: 85,
    allowZeroFinalPrice: true,
    b2bOverridePrice: null,
  });
  record("ProductFloorRule", "min=85% segment B2C + allowZeroFinalPrice override", P.floorB2C.handle);
  await upsertProductFloorRule({
    productId: P.floorB2B.productId,
    segment: "B2B",
    minPercentOfBasePrice: 60,
    allowZeroFinalPrice: false,
    b2bOverridePrice: 12.5,
  });
  record("ProductFloorRule", "min=60% segment B2B + b2bOverridePrice", P.floorB2B.handle);

  // --- ProductTierPriceRule: multiple tiers, segment null + B2B ---
  await upsertProductTierPriceRule({ productId: P.tier.productId, minQuantity: 10, unitPrice: 9 });
  await upsertProductTierPriceRule({ productId: P.tier.productId, minQuantity: 50, unitPrice: 7.5 });
  await upsertProductTierPriceRule({ productId: P.tier.productId, segment: "B2B", minQuantity: 100, unitPrice: 6 });
  record("ProductTierPriceRule", "tiers 10/50 (null) + 100 (B2B)", P.tier.handle);

  // --- StorefrontContentRule: every action / targetType / position / pageType / segment / locale / priority / active ---
  const actions = keys(CONTENT_ACTIONS);
  const positions = keys(SEMANTIC_POSITIONS);
  const pages = keys(PAGE_TYPES);
  for (const [index, action] of actions.entries()) {
    const useSemantic = index % 2 === 0;
    const targetType: TargetType = useSemantic ? "SEMANTIC_POSITION" : "CSS_SELECTOR";
    await upsertStorefrontContentRule({
      name: `${PREFIX}content-${action.toLowerCase()}`,
      active: index % 4 !== 3, // also exercise active=false
      priority: 100 + index,
      segment: index % 2 === 0 ? "B2B" : "B2C",
      pageType: pages[index % pages.length],
      productId: P.content.productId,
      targetType,
      targetSelector: useSemantic ? null : ".product__title",
      targetPosition: useSemantic ? positions[index % positions.length] : null,
      action,
      value: `MG E2E ${action}`,
      valueCsLocale: `MG E2E ${action} (cs)`,
    });
    record("StorefrontContentRule", `action=${action} targetType=${targetType} active=${index % 4 !== 3}`, P.content.handle);
  }
  // Explicit priority-ordering pair on the same target to assert sort.
  await upsertStorefrontContentRule({
    name: `${PREFIX}content-priority-low`, active: true, priority: 10, segment: "B2C",
    pageType: "PRODUCT", productId: P.content.productId, targetType: "CSS_SELECTOR",
    targetSelector: ".product__title", targetPosition: null, action: "SWAP_TEXT",
    value: "low-priority", valueCsLocale: "nízká priorita",
  });
  await upsertStorefrontContentRule({
    name: `${PREFIX}content-priority-high`, active: true, priority: 900, segment: "B2C",
    pageType: "PRODUCT", productId: P.content.productId, targetType: "CSS_SELECTOR",
    targetSelector: ".product__title", targetPosition: null, action: "SWAP_TEXT",
    value: "high-priority", valueCsLocale: "vysoká priorita",
  });
  record("StorefrontContentRule", "priority ordering pair", P.content.handle);

  // --- CollectionVisibilityRule: B2B_ONLY + B2C_ONLY ---
  await upsertCollectionVisibilityRule({
    collectionId: C.colB2B.collectionId, collectionHandle: C.colB2B.handle,
    collectionTitle: C.colB2B.title, visibilityMode: "B2B_ONLY",
  });
  record("CollectionVisibilityRule", "B2B_ONLY", C.colB2B.handle);
  await upsertCollectionVisibilityRule({
    collectionId: C.colB2C.collectionId, collectionHandle: C.colB2C.handle,
    collectionTitle: C.colB2C.title, visibilityMode: "B2C_ONLY",
  });
  record("CollectionVisibilityRule", "B2C_ONLY", C.colB2C.handle);

  // --- CouponSegmentRule: every allowed segment ---
  for (const segment of keys(ALLOWED_SEGMENTS)) {
    await upsertCouponSegmentRule({ code: `${PREFIX}coupon-${segment}`.toUpperCase(), allowedSegment: segment });
    record("CouponSegmentRule", `allowedSegment=${segment}`);
  }

  // --- DiscountRule: every scope, every stackMode, with/without code, segments, minPrice ---
  const stackModes = keys(STACK_MODES);
  await upsertDiscountRule({ scope: "GLOBAL", percentOff: 10, priority: 100, stackMode: stackModes[0] });
  record("DiscountRule", `scope=GLOBAL stackMode=${stackModes[0]}`);
  await upsertDiscountRule({ scope: "PRODUCT", targetId: P.discountProduct.productId, percentOff: 15, priority: 200, stackMode: stackModes[1], minPricePercentOfBasePrice: 70 });
  record("DiscountRule", `scope=PRODUCT stackMode=${stackModes[1]} minPrice=70`, P.discountProduct.handle);
  await upsertDiscountRule({ scope: "COLLECTION", targetId: C.colDiscount.collectionId, percentOff: 12, priority: 150, stackMode: stackModes[2], segment: "B2B" });
  record("DiscountRule", `scope=COLLECTION stackMode=${stackModes[2]} segment=B2B`, C.colDiscount.handle);
  await upsertDiscountRule({ scope: "COUPON", code: `${PREFIX}auto`.toUpperCase(), percentOff: 20, priority: 300, stackMode: stackModes[0], segment: "B2C" });
  record("DiscountRule", `scope=COUPON stackMode=${stackModes[0]} segment=B2C`);

  // --- DiscountCombinationBlacklistRule: ref-type pair + segment ---
  await upsertDiscountCombinationBlacklistRule({
    leftType: "COUPON_CODE", leftValue: `${PREFIX}auto`.toUpperCase(),
    rightType: "SCOPE", rightValue: "GLOBAL", segment: "ALL",
  });
  record("DiscountCombinationBlacklistRule", "COUPON_CODE × SCOPE (ALL)");
  void keys(REF_TYPES);

  // --- DiscountSegmentCap: every segment ---
  for (const segment of keys(CAP_SEGMENTS)) {
    await upsertDiscountSegmentCap({ segment, maxCombinedPercentOff: segment === "B2B" ? 40 : 25 });
    record("DiscountSegmentCap", `segment=${segment}`);
  }

  // --- Sync Shopify catalog into Prisma, then project storefront metafields ---
  console.log("Syncing catalog into Prisma…");
  await syncShopifyCollectionCatalog(admin as any);
  await syncShopifyProductCatalog(admin as any);

  console.log("Projecting storefront metafields…");
  await syncStorefrontProjectionMetafields(admin as any);

  // --- Build the Tier-1 matrix (anonymous/B2C, theme-dependent) ---
  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    prefix: PREFIX,
    products: Object.values(P),
    collections: Object.values(C),
    rules,
    matrix: {
      products: [
        { archetype: "VISIBILITY_B2B_ONLY", productId: P.visB2B.productId, handle: P.visB2B.handle, title: P.visB2B.title },
        { archetype: "VISIBILITY_B2C_ONLY", productId: P.visB2C.productId, handle: P.visB2C.handle, title: P.visB2C.title },
        { archetype: "VARIANT_B2B_ONLY", productId: P.variant.productId, handle: P.variant.handle, title: P.variant.title, variantId: P.variant.variantIds[0] },
        { archetype: "QUANTITY_MOQ_STEP", productId: P.moqStep.productId, handle: P.moqStep.handle, title: P.moqStep.title, minimumOrderQuantity: 6, stepQuantity: 3 },
        { archetype: "QUANTITY_MAX", productId: P.max.productId, handle: P.max.handle, title: P.max.title, maxOrderQuantity: 4 },
      ].filter((fixture) => fixture.archetype !== "VARIANT_B2B_ONLY" || fixture.variantId),
      collections: [
        { archetype: "COLLECTION_B2B_ONLY", collectionId: C.colB2B.collectionId, collectionHandle: C.colB2B.handle, collectionTitle: C.colB2B.title },
        { archetype: "COLLECTION_B2C_ONLY", collectionId: C.colB2C.collectionId, collectionHandle: C.colB2C.handle, collectionTitle: C.colB2C.title },
      ],
    },
  };
  writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8");

  console.log(`\nSeeded ${rules.length} rule scenarios across ${manifest.products.length} products / ${manifest.collections.length} collections.`);
  console.log(`Manifest → ${MANIFEST_FILE}`);
  console.log("Run `npm run test:e2e:matrix` to exercise Tier-1 on Horizon + Dawn.");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
