import prisma from "../db.server.ts";
import type {
  CustomCatalogInput,
  CatalogTableInput,
} from "#core/config/function-config";

// MVP_5_3 Phase 2 — repository for simulated price catalogs (PriceCatalog +
// children). Follows the repo's dependency-injection idiom: every function takes
// an optional `client` (defaulting to the real Prisma client) so it can be
// unit-tested with a fake (see tests/services/price-catalog.server.test.ts).
//
// System catalogs (default / b2b) are seeded by migration and are NOT deletable
// here; the merchant manages N *custom* catalogs through the Catalogs admin.

export const CATALOG_STATUSES = ["ACTIVE", "DRAFT", "ARCHIVED"] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const MEMBERSHIP_MODES = ["INHERIT_ALL", "OPT_IN"] as const;
export type MembershipMode = (typeof MEMBERSHIP_MODES)[number];

export interface CatalogMarketFilterInput {
  countryCode?: string | null;
  currencyCode?: string | null;
  languageCode?: string | null;
}

export interface PriceCatalogWriteInput {
  name: string;
  priority: number;
  status: CatalogStatus;
  matchCompany: boolean;
  membershipMode: MembershipMode;
  audienceTags: string[];
  marketFilters: CatalogMarketFilterInput[];
}

// Structural subset of the Prisma client this module touches — keeps the
// injectable seam small and the fake in tests trivial.
export interface PriceCatalogClient {
  priceCatalog: {
    findMany: (args?: any) => Promise<any[]>;
    findUnique: (args: any) => Promise<any | null>;
    create: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
    delete: (args: any) => Promise<any>;
  };
  catalogAudienceTag: {
    deleteMany: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
  catalogMarketFilter: {
    deleteMany: (args: any) => Promise<any>;
    create: (args: any) => Promise<any>;
  };
  catalogPriceRule: CatalogRuleDelegate;
  catalogFloorRule: CatalogRuleDelegate;
  catalogTierPriceRule: CatalogRuleDelegate;
  catalogDiscountRule: CatalogRuleDelegate;
  catalogQuantityRule: CatalogRuleDelegate;
  catalogMembership: CatalogRuleDelegate;
  catalogVariantVisibilityRule: CatalogRuleDelegate;
  catalogVisibilityRule: CatalogRuleDelegate;
  catalogCouponRule: CatalogRuleDelegate;
  catalogDiscountCap: CatalogRuleDelegate & {
    deleteMany: (args: any) => Promise<any>;
  };
  catalogDiscountBlacklistRule: CatalogRuleDelegate;
  catalogCustomerQuantityRule: CatalogRuleDelegate;
}

interface CatalogRuleDelegate {
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
  delete: (args: any) => Promise<any>;
}

function defaultClient(): PriceCatalogClient {
  const client = prisma as unknown as PriceCatalogClient;
  if (
    !client.priceCatalog ||
    !client.catalogAudienceTag ||
    !client.catalogMarketFilter ||
    !client.catalogPriceRule ||
    !client.catalogFloorRule ||
    !client.catalogTierPriceRule ||
    !client.catalogDiscountRule ||
    !client.catalogQuantityRule ||
    !client.catalogMembership ||
    !client.catalogVariantVisibilityRule ||
    !client.catalogVisibilityRule ||
    !client.catalogCouponRule ||
    !client.catalogDiscountCap ||
    !client.catalogDiscountBlacklistRule ||
    !client.catalogCustomerQuantityRule
  ) {
    throw new Error(
      "Prisma client is out of date for Price Catalog models. Run `npm run prisma:generate` and restart `shopify app dev`.",
    );
  }
  return client;
}

const CATALOG_INCLUDE = {
  audienceTags: true,
  marketFilters: true,
  _count: {
    select: {
      memberships: true,
      priceRules: true,
      tierPrices: true,
      floorRules: true,
      quantityRules: true,
      discountRules: true,
    },
  },
} as const;

export function normalizeAudienceTag(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

export function normalizeMarketCode(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized || null;
}

function normalizeStatus(value: string): CatalogStatus {
  return (CATALOG_STATUSES as readonly string[]).includes(value)
    ? (value as CatalogStatus)
    : "DRAFT";
}

function normalizeMembershipMode(value: string): MembershipMode {
  return (MEMBERSHIP_MODES as readonly string[]).includes(value)
    ? (value as MembershipMode)
    : "OPT_IN";
}

function normalizePriority(value: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : 0;
}

function dedupeTags(tags: string[]): string[] {
  return Array.from(
    new Set((tags ?? []).map(normalizeAudienceTag).filter(Boolean)),
  );
}

function normalizeMarketFilters(
  filters: CatalogMarketFilterInput[],
): CatalogMarketFilterInput[] {
  const normalized: CatalogMarketFilterInput[] = [];
  const seen = new Set<string>();
  for (const filter of filters ?? []) {
    const countryCode = normalizeMarketCode(filter.countryCode);
    const currencyCode = normalizeMarketCode(filter.currencyCode);
    const languageCode = normalizeMarketCode(filter.languageCode);
    if (!countryCode && !currencyCode && !languageCode) {
      continue; // an all-null filter constrains nothing — drop it.
    }
    const key = `${countryCode ?? ""}|${currencyCode ?? ""}|${languageCode ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({ countryCode, currencyCode, languageCode });
  }
  return normalized;
}

export async function listPriceCatalogs(client: PriceCatalogClient = defaultClient()) {
  return client.priceCatalog.findMany({
    include: CATALOG_INCLUDE,
    orderBy: [{ priority: "desc" }, { name: "asc" }, { id: "asc" }],
  });
}

export async function getPriceCatalog(
  id: string,
  client: PriceCatalogClient = defaultClient(),
) {
  return client.priceCatalog.findUnique({
    where: { id },
    include: CATALOG_INCLUDE,
  });
}

export async function createPriceCatalog(
  input: PriceCatalogWriteInput,
  client: PriceCatalogClient = defaultClient(),
) {
  const name = String(input.name ?? "").trim();
  if (!name) {
    throw new Error("Catalog name is required.");
  }
  return client.priceCatalog.create({
    data: {
      name,
      priority: normalizePriority(input.priority),
      status: normalizeStatus(input.status),
      isDefault: false,
      isSystem: false,
      matchCompany: input.matchCompany === true,
      membershipMode: normalizeMembershipMode(input.membershipMode),
      audienceTags: {
        create: dedupeTags(input.audienceTags).map((tag) => ({ tag })),
      },
      marketFilters: {
        create: normalizeMarketFilters(input.marketFilters),
      },
    },
    include: CATALOG_INCLUDE,
  });
}

export async function updatePriceCatalog(
  id: string,
  input: PriceCatalogWriteInput,
  client: PriceCatalogClient = defaultClient(),
) {
  const name = String(input.name ?? "").trim();
  if (!name) {
    throw new Error("Catalog name is required.");
  }
  const existing = await client.priceCatalog.findUnique({ where: { id } });
  if (!existing) {
    throw new Error(`Catalog ${id} not found.`);
  }

  // Replace-all semantics for audience tags + market filters (small sets).
  await client.catalogAudienceTag.deleteMany({ where: { catalogId: id } });
  await client.catalogMarketFilter.deleteMany({ where: { catalogId: id } });
  for (const tag of dedupeTags(input.audienceTags)) {
    await client.catalogAudienceTag.create({ data: { catalogId: id, tag } });
  }
  for (const filter of normalizeMarketFilters(input.marketFilters)) {
    await client.catalogMarketFilter.create({ data: { catalogId: id, ...filter } });
  }

  // System catalogs keep their isDefault/isSystem/priority identity; only their
  // editable surface (name, status, audience, market, membership) changes.
  const data = existing.isSystem
    ? {
        name,
        status: normalizeStatus(input.status),
        membershipMode: normalizeMembershipMode(input.membershipMode),
      }
    : {
        name,
        priority: normalizePriority(input.priority),
        status: normalizeStatus(input.status),
        matchCompany: input.matchCompany === true,
        membershipMode: normalizeMembershipMode(input.membershipMode),
      };

  return client.priceCatalog.update({
    where: { id },
    data,
    include: CATALOG_INCLUDE,
  });
}

export async function deletePriceCatalog(
  id: string,
  client: PriceCatalogClient = defaultClient(),
) {
  const existing = await client.priceCatalog.findUnique({ where: { id } });
  if (!existing) {
    return;
  }
  if (existing.isSystem) {
    throw new Error("System catalogs (default / b2b) cannot be deleted.");
  }
  await client.priceCatalog.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Per-facet rule CRUD (Price list / Floor / Discounts / Quantity / Membership).
// Each upsert creates when no id is supplied and updates by id otherwise; the
// admin lists existing rows (with ids) for edit/delete and offers an add form.
// ---------------------------------------------------------------------------

const PRICE_RULE_SCOPES = ["CATALOG", "COLLECTION", "PRODUCT", "VARIANT"] as const;
const PRICE_RULE_MODES = ["FIXED", "PERCENT"] as const;
const DISCOUNT_RULE_SCOPES = ["GLOBAL", "COLLECTION", "PRODUCT", "COUPON"] as const;
const DISCOUNT_STACK_MODES = ["STACKABLE", "EXCLUSIVE", "NEVER_WITH_COUPONS"] as const;

const DETAIL_INCLUDE = {
  audienceTags: true,
  marketFilters: true,
  memberships: { orderBy: { productId: "asc" as const } },
  priceRules: { orderBy: [{ scope: "asc" as const }, { targetId: "asc" as const }] },
  tierPrices: { orderBy: [{ productId: "asc" as const }, { minQuantity: "asc" as const }] },
  floorRules: { orderBy: { productId: "asc" as const } },
  quantityRules: { orderBy: { productId: "asc" as const } },
  discountRules: { orderBy: [{ priority: "desc" as const }, { id: "asc" as const }] },
  variantVisibilityRules: { orderBy: { productId: "asc" as const } },
  visibilityRules: { orderBy: [{ scope: "asc" as const }, { targetId: "asc" as const }] },
  couponRules: { orderBy: { code: "asc" as const } },
  discountCaps: true,
  blacklistRules: { orderBy: { id: "asc" as const } },
  customerQuantityRules: { orderBy: [{ customerId: "asc" as const }, { productId: "asc" as const }] },
} as const;

function oneOf<T extends string>(values: readonly T[], value: unknown, fallback: T): T {
  return (values as readonly string[]).includes(String(value)) ? (value as T) : fallback;
}

function toFinite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPositiveIntOrNull(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return Math.floor(parsed);
}

function emptyToNull(value: string | null | undefined): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export async function getPriceCatalogDetail(
  id: string,
  client: PriceCatalogClient = defaultClient(),
) {
  return client.priceCatalog.findUnique({ where: { id }, include: DETAIL_INCLUDE });
}

export interface CatalogPriceRuleInput {
  id?: string | null;
  catalogId: string;
  scope: string;
  targetId?: string | null;
  mode: string;
  value: number;
}

export async function upsertCatalogPriceRule(
  input: CatalogPriceRuleInput,
  client: PriceCatalogClient = defaultClient(),
) {
  const scope = oneOf(PRICE_RULE_SCOPES, input.scope, "CATALOG");
  const mode = oneOf(PRICE_RULE_MODES, input.mode, "PERCENT");
  const value = toFinite(input.value);
  if (value == null || value < 0) {
    throw new Error("Price rule value must be a non-negative number.");
  }
  const targetId = scope === "CATALOG" ? null : emptyToNull(input.targetId);
  if (scope !== "CATALOG" && !targetId) {
    throw new Error(`A ${scope} price rule needs a target id.`);
  }
  const data = { scope, targetId, mode, value };
  if (input.id) {
    return client.catalogPriceRule.update({ where: { id: input.id }, data });
  }
  return client.catalogPriceRule.create({ data: { catalogId: input.catalogId, ...data } });
}

export async function deleteCatalogPriceRule(id: string, client: PriceCatalogClient = defaultClient()) {
  await client.catalogPriceRule.delete({ where: { id } });
}

export interface CatalogFloorRuleInput {
  id?: string | null;
  catalogId: string;
  productId?: string | null;
  variantId?: string | null;
  minPercentOfBasePrice: number;
  allowZeroFinalPrice?: boolean | null;
}

export async function upsertCatalogFloorRule(
  input: CatalogFloorRuleInput,
  client: PriceCatalogClient = defaultClient(),
) {
  const minPercent = toFinite(input.minPercentOfBasePrice);
  if (minPercent == null || minPercent < 0 || minPercent > 100) {
    throw new Error("Floor percent must be between 0 and 100.");
  }
  const data = {
    productId: emptyToNull(input.productId),
    variantId: emptyToNull(input.variantId),
    minPercentOfBasePrice: minPercent,
    allowZeroFinalPrice: input.allowZeroFinalPrice ?? null,
  };
  if (input.id) {
    return client.catalogFloorRule.update({ where: { id: input.id }, data });
  }
  return client.catalogFloorRule.create({ data: { catalogId: input.catalogId, ...data } });
}

export async function deleteCatalogFloorRule(id: string, client: PriceCatalogClient = defaultClient()) {
  await client.catalogFloorRule.delete({ where: { id } });
}

export interface CatalogTierPriceRuleInput {
  id?: string | null;
  catalogId: string;
  productId: string;
  variantId?: string | null;
  minQuantity: number;
  unitPrice: number;
}

export async function upsertCatalogTierPriceRule(
  input: CatalogTierPriceRuleInput,
  client: PriceCatalogClient = defaultClient(),
) {
  const minQuantity = toPositiveIntOrNull(input.minQuantity);
  const unitPrice = toFinite(input.unitPrice);
  if (minQuantity == null || minQuantity < 1) {
    throw new Error("Tier price needs a minQuantity >= 1.");
  }
  if (unitPrice == null || unitPrice < 0) {
    throw new Error("Tier price needs a unitPrice >= 0.");
  }
  const productId = emptyToNull(input.productId);
  if (!productId) {
    throw new Error("Tier price needs a product id.");
  }
  const data = {
    productId,
    variantId: emptyToNull(input.variantId),
    minQuantity,
    unitPrice,
  };
  if (input.id) {
    return client.catalogTierPriceRule.update({ where: { id: input.id }, data });
  }
  return client.catalogTierPriceRule.create({
    data: { catalogId: input.catalogId, ...data },
  });
}

export async function deleteCatalogTierPriceRule(
  id: string,
  client: PriceCatalogClient = defaultClient(),
) {
  await client.catalogTierPriceRule.delete({ where: { id } });
}

export interface CatalogDiscountRuleInput {
  id?: string | null;
  catalogId: string;
  scope: string;
  targetId?: string | null;
  code?: string | null;
  percentOff: number;
  priority: number;
  stackMode: string;
  minPricePercentOfBasePrice?: number | null;
}

export async function upsertCatalogDiscountRule(
  input: CatalogDiscountRuleInput,
  client: PriceCatalogClient = defaultClient(),
) {
  const scope = oneOf(DISCOUNT_RULE_SCOPES, input.scope, "GLOBAL");
  const percentOff = toFinite(input.percentOff);
  if (percentOff == null || percentOff <= 0 || percentOff > 100) {
    throw new Error("Discount percent must be between 0 and 100.");
  }
  const minFloor = input.minPricePercentOfBasePrice == null ? null : toFinite(input.minPricePercentOfBasePrice);
  const data = {
    scope,
    targetId: scope === "COLLECTION" || scope === "PRODUCT" ? emptyToNull(input.targetId) : null,
    code: scope === "COUPON" ? emptyToNull(input.code) : null,
    percentOff,
    priority: toFinite(input.priority) ?? 100,
    stackMode: oneOf(DISCOUNT_STACK_MODES, input.stackMode, "STACKABLE"),
    minPricePercentOfBasePrice: minFloor,
  };
  if (scope === "COUPON" && !data.code) {
    throw new Error("A COUPON discount rule needs a code.");
  }
  if ((scope === "COLLECTION" || scope === "PRODUCT") && !data.targetId) {
    throw new Error(`A ${scope} discount rule needs a target id.`);
  }
  if (input.id) {
    return client.catalogDiscountRule.update({ where: { id: input.id }, data });
  }
  return client.catalogDiscountRule.create({ data: { catalogId: input.catalogId, ...data } });
}

export async function deleteCatalogDiscountRule(id: string, client: PriceCatalogClient = defaultClient()) {
  await client.catalogDiscountRule.delete({ where: { id } });
}

export interface CatalogQuantityRuleInput {
  id?: string | null;
  catalogId: string;
  productId?: string | null;
  variantId?: string | null;
  collectionId?: string | null;
  moq?: number | null;
  step?: number | null;
  max?: number | null;
}

export async function upsertCatalogQuantityRule(
  input: CatalogQuantityRuleInput,
  client: PriceCatalogClient = defaultClient(),
) {
  const moq = input.moq == null ? null : toPositiveIntOrNull(input.moq);
  const step = input.step == null ? null : toPositiveIntOrNull(input.step);
  const max = input.max == null ? null : toPositiveIntOrNull(input.max);
  if (moq == null && step == null && max == null) {
    throw new Error("A quantity rule needs at least one of moq / step / max.");
  }
  const data = {
    productId: emptyToNull(input.productId),
    variantId: emptyToNull(input.variantId),
    collectionId: emptyToNull(input.collectionId),
    moq,
    step,
    max,
  };
  if (input.id) {
    return client.catalogQuantityRule.update({ where: { id: input.id }, data });
  }
  return client.catalogQuantityRule.create({ data: { catalogId: input.catalogId, ...data } });
}

export async function deleteCatalogQuantityRule(id: string, client: PriceCatalogClient = defaultClient()) {
  await client.catalogQuantityRule.delete({ where: { id } });
}

export async function addCatalogMembership(
  input: { catalogId: string; productId: string },
  client: PriceCatalogClient = defaultClient(),
) {
  const productId = emptyToNull(input.productId);
  if (!productId) {
    throw new Error("Membership needs a product id.");
  }
  return client.catalogMembership.create({ data: { catalogId: input.catalogId, productId } });
}

export async function removeCatalogMembership(id: string, client: PriceCatalogClient = defaultClient()) {
  await client.catalogMembership.delete({ where: { id } });
}

export interface CatalogVariantVisibilityInput {
  id?: string | null;
  catalogId: string;
  productId: string;
  variantId: string;
  visibilityMode?: string;
}

export async function upsertCatalogVariantVisibilityRule(
  input: CatalogVariantVisibilityInput,
  client: PriceCatalogClient = defaultClient(),
) {
  const productId = emptyToNull(input.productId);
  const variantId = emptyToNull(input.variantId);
  if (!productId || !variantId) {
    throw new Error("Variant visibility needs both a product id and a variant id.");
  }
  const visibilityMode = input.visibilityMode === "VISIBLE" ? "VISIBLE" : "HIDDEN";
  const data = { productId, variantId, visibilityMode };
  if (input.id) {
    return client.catalogVariantVisibilityRule.update({ where: { id: input.id }, data });
  }
  return client.catalogVariantVisibilityRule.create({
    data: { catalogId: input.catalogId, ...data },
  });
}

export async function deleteCatalogVariantVisibilityRule(
  id: string,
  client: PriceCatalogClient = defaultClient(),
) {
  await client.catalogVariantVisibilityRule.delete({ where: { id } });
}

// For the storefront projection: per ACTIVE catalog, the variants hidden in it,
// grouped by product id. Storefront resolves the catalog (catalogResolution) and
// hides these variants. System catalogs are excluded (legacy/overlay).
export async function loadCatalogVariantVisibility(
  client: PriceCatalogClient = defaultClient(),
): Promise<Array<{ catalogId: string; hiddenVariantsByProductId: Record<string, string[]> }>> {
  const catalogs = await client.priceCatalog.findMany({
    where: { status: "ACTIVE", isSystem: false },
    include: { variantVisibilityRules: true },
    orderBy: [{ priority: "desc" }, { id: "asc" }],
  });
  return catalogs
    .map((catalog) => {
      const hiddenVariantsByProductId: Record<string, string[]> = {};
      for (const rule of catalog.variantVisibilityRules ?? []) {
        if (rule.visibilityMode !== "HIDDEN") continue;
        const productId = String(rule.productId);
        (hiddenVariantsByProductId[productId] ??= []).push(String(rule.variantId));
      }
      return { catalogId: catalog.id, hiddenVariantsByProductId };
    })
    .filter((entry) => Object.keys(entry.hiddenVariantsByProductId).length > 0);
}

export interface CatalogVisibilityInput {
  id?: string | null;
  catalogId: string;
  scope: string; // PRODUCT | COLLECTION
  targetId: string;
  handle?: string | null;
  visibilityMode?: string;
}

export async function upsertCatalogVisibilityRule(
  input: CatalogVisibilityInput,
  client: PriceCatalogClient = defaultClient(),
) {
  const scope = input.scope === "COLLECTION" ? "COLLECTION" : "PRODUCT";
  const targetId = emptyToNull(input.targetId);
  if (!targetId) {
    throw new Error("Visibility rule needs a target id.");
  }
  const visibilityMode = input.visibilityMode === "VISIBLE" ? "VISIBLE" : "HIDDEN";
  const data = {
    scope,
    targetId,
    handle: emptyToNull(input.handle),
    visibilityMode,
  };
  if (input.id) {
    return client.catalogVisibilityRule.update({ where: { id: input.id }, data });
  }
  return client.catalogVisibilityRule.create({
    data: { catalogId: input.catalogId, ...data },
  });
}

export async function deleteCatalogVisibilityRule(
  id: string,
  client: PriceCatalogClient = defaultClient(),
) {
  await client.catalogVisibilityRule.delete({ where: { id } });
}

// Storefront resolution: highest-priority ACTIVE custom catalog whose audience
// matches → its hidden PRODUCT ids (live loader maps them to handles). No match → [].
export async function resolveStorefrontCatalogProductVisibility(
  customerTags: string[],
  client: PriceCatalogClient = defaultClient(),
): Promise<string[]> {
  const tagSet = new Set(
    (customerTags ?? []).map(normalizeAudienceTag).filter(Boolean),
  );
  if (tagSet.size === 0) {
    return [];
  }
  const catalogs = await client.priceCatalog.findMany({
    where: { status: "ACTIVE", isSystem: false },
    include: { audienceTags: true, visibilityRules: true },
    orderBy: [{ priority: "desc" }, { id: "asc" }],
  });
  const matched = catalogs.find((catalog) =>
    (catalog.audienceTags ?? []).some((tag: any) =>
      tagSet.has(normalizeAudienceTag(tag.tag)),
    ),
  );
  if (!matched) {
    return [];
  }
  return (matched.visibilityRules ?? [])
    .filter((rule: any) => rule.scope === "PRODUCT" && rule.visibilityMode === "HIDDEN")
    .map((rule: any) => String(rule.targetId));
}

// For the storefront projection: per ACTIVE custom catalog, the collection
// handles hidden in it (collections are hidden by handle storefront-side).
export async function loadCatalogCollectionVisibility(
  client: PriceCatalogClient = defaultClient(),
): Promise<Array<{ catalogId: string; hiddenCollectionHandles: string[] }>> {
  const catalogs = await client.priceCatalog.findMany({
    where: { status: "ACTIVE", isSystem: false },
    include: { visibilityRules: true },
    orderBy: [{ priority: "desc" }, { id: "asc" }],
  });
  return catalogs
    .map((catalog) => ({
      catalogId: catalog.id,
      hiddenCollectionHandles: (catalog.visibilityRules ?? [])
        .filter(
          (rule: any) =>
            rule.scope === "COLLECTION" &&
            rule.visibilityMode === "HIDDEN" &&
            rule.handle,
        )
        .map((rule: any) => String(rule.handle).trim().toLowerCase())
        .filter(Boolean),
    }))
    .filter((entry) => entry.hiddenCollectionHandles.length > 0);
}

// MVP_5_3 #2.3c — per-catalog hidden whole-product ids (PRODUCT-scoped visibility
// rules), so the storefront projection can regenerate its b2b/b2c snapshots from
// catalog tables instead of the legacy MarginGuardConfig children.
export async function loadCatalogProductVisibility(
  client: PriceCatalogClient = defaultClient(),
): Promise<Array<{ catalogId: string; hiddenProductIds: string[] }>> {
  const catalogs = await client.priceCatalog.findMany({
    where: { status: "ACTIVE", isSystem: false },
    include: { visibilityRules: true },
    orderBy: [{ priority: "desc" }, { id: "asc" }],
  });
  return catalogs
    .map((catalog) => ({
      catalogId: catalog.id,
      hiddenProductIds: Array.from(
        new Set<string>(
          (catalog.visibilityRules ?? [])
            .filter(
              (rule: any) =>
                rule.scope === "PRODUCT" &&
                rule.visibilityMode === "HIDDEN" &&
                rule.targetId,
            )
            .map((rule: any): string => String(rule.targetId).trim())
            .filter((id: string): id is string => Boolean(id)),
        ),
      ),
    }))
    .filter((entry) => entry.hiddenProductIds.length > 0);
}

function normalizeCouponCode(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

export async function upsertCatalogCouponRule(
  input: { id?: string | null; catalogId: string; code: string },
  client: PriceCatalogClient = defaultClient(),
) {
  const code = normalizeCouponCode(input.code);
  if (!code) {
    throw new Error("A coupon rule needs a code.");
  }
  if (input.id) {
    return client.catalogCouponRule.update({ where: { id: input.id }, data: { code } });
  }
  return client.catalogCouponRule.create({ data: { catalogId: input.catalogId, code } });
}

export async function deleteCatalogCouponRule(id: string, client: PriceCatalogClient = defaultClient()) {
  await client.catalogCouponRule.delete({ where: { id } });
}

export async function setCatalogDiscountCap(
  input: { catalogId: string; maxCombinedPercentOff: number },
  client: PriceCatalogClient = defaultClient(),
) {
  const max = toFinite(input.maxCombinedPercentOff);
  if (max == null || max < 0 || max > 100) {
    throw new Error("Discount cap must be between 0 and 100.");
  }
  await client.catalogDiscountCap.deleteMany({ where: { catalogId: input.catalogId } });
  return client.catalogDiscountCap.create({
    data: { catalogId: input.catalogId, maxCombinedPercentOff: max },
  });
}

export async function clearCatalogDiscountCap(
  catalogId: string,
  client: PriceCatalogClient = defaultClient(),
) {
  await client.catalogDiscountCap.deleteMany({ where: { catalogId } });
}

const BLACKLIST_REF_TYPES = ["RULE_ID", "COUPON_CODE", "SCOPE"] as const;

export async function upsertCatalogBlacklistRule(
  input: {
    id?: string | null;
    catalogId: string;
    leftType: string;
    leftValue: string;
    rightType: string;
    rightValue: string;
  },
  client: PriceCatalogClient = defaultClient(),
) {
  const leftValue = emptyToNull(input.leftValue);
  const rightValue = emptyToNull(input.rightValue);
  if (!leftValue || !rightValue) {
    throw new Error("A blacklist rule needs both left and right values.");
  }
  const data = {
    leftType: oneOf(BLACKLIST_REF_TYPES, input.leftType, "COUPON_CODE"),
    leftValue: input.leftType === "COUPON_CODE" || !input.leftType ? normalizeCouponCode(leftValue) : leftValue,
    rightType: oneOf(BLACKLIST_REF_TYPES, input.rightType, "COUPON_CODE"),
    rightValue: input.rightType === "COUPON_CODE" || !input.rightType ? normalizeCouponCode(rightValue) : rightValue,
  };
  if (input.id) {
    return client.catalogDiscountBlacklistRule.update({ where: { id: input.id }, data });
  }
  return client.catalogDiscountBlacklistRule.create({ data: { catalogId: input.catalogId, ...data } });
}

export async function deleteCatalogBlacklistRule(id: string, client: PriceCatalogClient = defaultClient()) {
  await client.catalogDiscountBlacklistRule.delete({ where: { id } });
}

export async function upsertCatalogCustomerQuantityRule(
  input: {
    id?: string | null;
    catalogId: string;
    customerId: string;
    productId: string;
    maxOrderQuantity: number;
  },
  client: PriceCatalogClient = defaultClient(),
) {
  const customerId = emptyToNull(input.customerId);
  const productId = emptyToNull(input.productId);
  const max = toPositiveIntOrNull(input.maxOrderQuantity);
  if (!customerId || !productId || max == null) {
    throw new Error("Customer quantity rule needs customer id, product id and a positive max.");
  }
  const data = { customerId, productId, maxOrderQuantity: max };
  if (input.id) {
    return client.catalogCustomerQuantityRule.update({ where: { id: input.id }, data });
  }
  return client.catalogCustomerQuantityRule.create({ data: { catalogId: input.catalogId, ...data } });
}

export async function deleteCatalogCustomerQuantityRule(id: string, client: PriceCatalogClient = defaultClient()) {
  await client.catalogCustomerQuantityRule.delete({ where: { id } });
}

// Storefront resolution: given the customer's tags, pick the highest-priority
// ACTIVE custom catalog whose audience matches and return its hidden variants
// grouped by product id. Used by the visibility loader to hide per-catalog
// variants (e.g. carton visible only in wholesale). No match → {}.
export async function resolveStorefrontCatalogVariantVisibility(
  customerTags: string[],
  client: PriceCatalogClient = defaultClient(),
): Promise<Record<string, string[]>> {
  const tagSet = new Set(
    (customerTags ?? []).map(normalizeAudienceTag).filter(Boolean),
  );
  if (tagSet.size === 0) {
    return {};
  }
  const catalogs = await client.priceCatalog.findMany({
    where: { status: "ACTIVE", isSystem: false },
    include: { audienceTags: true, variantVisibilityRules: true },
    orderBy: [{ priority: "desc" }, { id: "asc" }],
  });
  const matched = catalogs.find((catalog) =>
    (catalog.audienceTags ?? []).some((tag: any) =>
      tagSet.has(normalizeAudienceTag(tag.tag)),
    ),
  );
  if (!matched) {
    return {};
  }
  const hiddenVariantsByProductId: Record<string, string[]> = {};
  for (const rule of matched.variantVisibilityRules ?? []) {
    if (rule.visibilityMode !== "HIDDEN") continue;
    (hiddenVariantsByProductId[String(rule.productId)] ??= []).push(
      String(rule.variantId),
    );
  }
  return hiddenVariantsByProductId;
}

// Map a catalog row (with its rule sets) into the plain CatalogTableInput the
// function-config builder consumes.
function mapCatalogRowToInput(catalog: any): CatalogTableInput {
  {
    const floorRules = (catalog.floorRules ?? []) as Array<any>;
    const defaultFloor = floorRules.find((r) => !r.productId && !r.variantId);
    const perProductFloors = floorRules
      .filter((r) => r.productId && !r.variantId)
      .map((r) => ({
        productId: String(r.productId),
        minPercentOfBasePrice: r.minPercentOfBasePrice,
        allowZeroFinalPrice: r.allowZeroFinalPrice,
      }));
    const perVariantFloors = floorRules
      .filter((r) => r.variantId)
      .map((r) => ({
        variantId: String(r.variantId),
        minPercentOfBasePrice: r.minPercentOfBasePrice,
        allowZeroFinalPrice: r.allowZeroFinalPrice,
      }));

    return {
      id: catalog.id,
      priority: catalog.priority,
      matchCompany: catalog.matchCompany === true,
      segment: "B2C" as const,
      audienceTags: (catalog.audienceTags ?? []).map((t: any) => t.tag),
      marketFilters: (catalog.marketFilters ?? []).map((f: any) => ({
        countryCode: f.countryCode,
        currencyCode: f.currencyCode,
        languageCode: f.languageCode,
      })),
      floorDefaultPercent: defaultFloor ? defaultFloor.minPercentOfBasePrice : null,
      floorDefaultAllowZero: defaultFloor ? defaultFloor.allowZeroFinalPrice : null,
      perProductFloors,
      perVariantFloors,
      priceRules: (catalog.priceRules ?? []).map((r: any) => ({
        scope: r.scope,
        targetId: r.targetId,
        mode: r.mode,
        value: r.value,
      })),
      tierPrices: (catalog.tierPrices ?? [])
        .filter((r: any) => !r.variantId)
        .map((r: any) => ({
          productId: String(r.productId),
          minQuantity: r.minQuantity,
          unitPrice: r.unitPrice,
        })),
      variantTierPrices: (catalog.tierPrices ?? [])
        .filter((r: any) => r.variantId)
        .map((r: any) => ({
          variantId: String(r.variantId),
          minQuantity: r.minQuantity,
          unitPrice: r.unitPrice,
        })),
      quantityRules: (catalog.quantityRules ?? []).map((r: any) => ({
        productId: r.productId,
        collectionId: r.collectionId,
        moq: r.moq,
        step: r.step,
        max: r.max,
      })),
      discountRules: (catalog.discountRules ?? []).map((r: any) => ({
        scope: r.scope,
        targetId: r.targetId,
        code: r.code,
        percentOff: r.percentOff,
        priority: r.priority,
        stackMode: r.stackMode,
        minPricePercentOfBasePrice: r.minPricePercentOfBasePrice,
      })),
      coupons: (catalog.couponRules ?? []).map((r: any) => String(r.code)),
      discountCapPercent: (catalog.discountCaps ?? [])[0]
        ? (catalog.discountCaps ?? [])[0].maxCombinedPercentOff
        : null,
      blacklist: (catalog.blacklistRules ?? []).map((r: any) => ({
        leftType: r.leftType,
        leftValue: r.leftValue,
        rightType: r.rightType,
        rightValue: r.rightValue,
      })),
      customerQuantity: (catalog.customerQuantityRules ?? []).map((r: any) => ({
        customerId: String(r.customerId),
        productId: String(r.productId),
        maxOrderQuantity: r.maxOrderQuantity,
      })),
      isDefault: catalog.isDefault === true,
    };
  }
}

// ACTIVE non-system catalogs (overlay path — used while legacy still powers
// default/b2b). Drops the isDefault flag for the legacy custom-catalog builder.
export async function loadActiveCustomCatalogs(
  client: PriceCatalogClient = defaultClient(),
): Promise<CustomCatalogInput[]> {
  const catalogs = await client.priceCatalog.findMany({
    where: { status: "ACTIVE", isSystem: false },
    include: DETAIL_INCLUDE,
    orderBy: [{ priority: "desc" }, { id: "asc" }],
  });
  return catalogs.map(mapCatalogRowToInput);
}

// ALL ACTIVE catalogs (default + b2b + custom) as catalog-native input for
// buildCatalogConfigFromCatalogs (#2.2 — catalog tables are the source of truth).
export async function loadAllCatalogsForConfig(
  client: PriceCatalogClient = defaultClient(),
): Promise<CatalogTableInput[]> {
  const catalogs = await client.priceCatalog.findMany({
    where: { status: "ACTIVE" },
    include: DETAIL_INCLUDE,
    orderBy: [{ priority: "desc" }, { id: "asc" }],
  });
  return catalogs.map(mapCatalogRowToInput);
}
