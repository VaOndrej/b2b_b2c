import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import {
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "react-router";
import { AdminCatalogPicker } from "../components/admin-catalog-picker";
import type { CatalogRuleItem } from "../components/catalog-rule-section";
import { CompactRulePanel } from "../components/compact-rule-panel";
import { authenticate } from "../shopify.server";
import { ensureCartValidationActive } from "../services/cart-validation-activation.server";
import {
  deactivateDiscountFunction,
  reconcileDiscountFunctionStatus,
} from "../services/discount-function-activation.server";
import {
  updateGlobalMarginGuardConfig,
  syncVisibilityHandlesMetafield,
} from "../services/margin-guard-config.server";
import { loadMarginGuardSettingsView } from "../services/margin-guard-settings-view.server";
import { handleDiscountSettingsAction } from "../services/discount-settings.server";
import { handleCatalogRulesSettingsAction } from "../services/catalog-rules-settings.server";
import { makeCatalogDescribers } from "../components/catalog-describers";
import { useManualRuleForm } from "../components/use-manual-rule-form";
import { DiscountSettingsView } from "../components/discount-settings-view";
import {
  countActiveCatalogCollections,
  countActiveCatalogProducts,
  recordProductCatalogSyncError,
  shouldAutoSyncProductCatalog,
  syncShopifyCollectionCatalog,
  syncShopifyProductCatalog,
} from "../services/product-catalog.server";
import { syncStorefrontProjectionMetafields } from "../services/storefront-projection.server";
import { storefrontProjection } from "../../config/feature-flags.ts";
import {
  buildDiscountConflictReport,
  type DiscountConflictView,
} from "../services/discount-conflict.server";

function parseNumber(input: FormDataEntryValue | null, fallback = 0): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

function formatTimestamp(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatCatalogSourceLabel(sourceType: string | null | undefined): string {
  if (String(sourceType ?? "").trim() === "ERP") {
    return "ERP";
  }
  if (String(sourceType ?? "").trim() === "CSV") {
    return "CSV";
  }
  return "Shopify";
}

const SETTINGS_SECTIONS = [
  "global",
  "products",
  "collections",
  "quantity",
  "visibility",
  "discount-coupons",
  "discount-orchestration",
  "functions",
] as const;

type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

function normalizeSettingsSection(value: string | null): SettingsSection {
  return SETTINGS_SECTIONS.includes(value as SettingsSection)
    ? (value as SettingsSection)
    : "global";
}

const SETTINGS_AREAS = [
  "all",
  "global",
  "catalog-rules",
  "discounts",
] as const;

type SettingsArea = (typeof SETTINGS_AREAS)[number];

function normalizeSettingsArea(value: string | null): SettingsArea {
  return SETTINGS_AREAS.includes(value as SettingsArea)
    ? (value as SettingsArea)
    : "all";
}

function inferSettingsAreaFromPathname(pathname: string): SettingsArea {
  if (pathname.endsWith("/settings/global")) {
    return "global";
  }
  if (pathname.endsWith("/settings/catalog-rules")) {
    return "catalog-rules";
  }
  if (pathname.endsWith("/settings/discounts")) {
    return "discounts";
  }
  return "all";
}

const SETTINGS_SECTION_OPTIONS: Array<{
  id: SettingsSection;
  label: string;
  description: string;
}> = [
  {
    id: "global",
    label: "Global Settings",
    description: "Core governance, floors, stacking, and B2B tag configuration.",
  },
  {
    id: "products",
    label: "Products",
    description: "Per-product pricing, quantity governance, customer overrides, and visibility controls.",
  },
  {
    id: "collections",
    label: "Collections",
    description: "Collection-specific catalog governance and collection maximum quantity rules.",
  },
  {
    id: "discount-coupons",
    label: "Discount Coupons",
    description: "Coupon segment validation and coupon-specific controls.",
  },
  {
    id: "discount-orchestration",
    label: "Discount Orchestration",
    description: "Advanced discount rules, blacklists, and segment caps.",
  },
  {
    id: "functions",
    label: "Functions",
    description: "Live Shopify Function activation and runtime status.",
  },
];

const SETTINGS_AREA_OPTIONS: Record<
  SettingsArea,
  { heading: string; description: string }
> = {
  all: {
    heading: "Margin Guard Settings",
    description: "Legacy all-in-one workspace across governance, catalog rules, discounts, and function runtime.",
  },
  global: {
    heading: "Global Settings",
    description: "Core governance, B2B segment defaults, and product or collection import foundations.",
  },
  "catalog-rules": {
    heading: "Catalog Rules",
    description: "Pricing, quantity, visibility, and collection-level catalog governance in one isolated workspace.",
  },
  discounts: {
    heading: "Discounts",
    description: "Coupon eligibility, discount orchestration, stacking, blacklist combinations, and caps.",
  },
};

const SETTINGS_AREA_SECTION_IDS: Record<SettingsArea, SettingsSection[]> = {
  all: [...SETTINGS_SECTIONS],
  global: ["global"],
  "catalog-rules": ["products", "collections", "quantity", "visibility"],
  discounts: ["discount-coupons", "discount-orchestration"],
};

const SIDEBAR_SECTION_IDS: Record<SettingsArea, SettingsSection[]> = {
  all: [
    "global",
    "products",
    "collections",
    "discount-coupons",
    "discount-orchestration",
    "functions",
  ],
  global: ["global"],
  "catalog-rules": ["products", "collections"],
  discounts: ["discount-coupons", "discount-orchestration"],
};

const PRODUCT_RULE_VIEWS = [
  {
    id: "floor-rules",
    label: "Floor rules",
    description: "Per-product minimum margin floors and B2B override pricing.",
  },
  {
    id: "tier-pricing",
    label: "Tier pricing",
    description: "Quantity break pricing per product and segment.",
  },
  {
    id: "moq",
    label: "MOQ",
    description: "Minimum order quantity rules per product.",
  },
  {
    id: "step-quantity",
    label: "Step quantity",
    description: "Carton multiple and increment controls.",
  },
  {
    id: "max-quantity",
    label: "Max quantity",
    description: "Per-product maximum order quantity limits.",
  },
  {
    id: "customer-overrides",
    label: "Customer overrides",
    description: "Customer-specific maximum quantity exceptions.",
  },
  {
    id: "product-visibility",
    label: "Product visibility",
    description: "Segment and customer visibility rules for products.",
  },
  {
    id: "variant-visibility",
    label: "Variant visibility",
    description: "Hide or expose specific variants by segment or customer.",
  },
  {
    id: "collection-visibility",
    label: "Collection visibility",
    description: "Collection-level storefront access rules managed with product governance.",
  },
] as const;

type ProductRuleView = (typeof PRODUCT_RULE_VIEWS)[number]["id"];

function normalizeProductRuleView(
  section: SettingsSection,
  value: string | null,
): ProductRuleView {
  if (value && PRODUCT_RULE_VIEWS.some((view) => view.id === value)) {
    return value as ProductRuleView;
  }
  if (section === "quantity") {
    return "moq";
  }
  if (section === "visibility") {
    return "product-visibility";
  }
  return "floor-rules";
}

function getCanonicalSection(section: SettingsSection): SettingsSection {
  if (section === "quantity" || section === "visibility") {
    return "products";
  }
  return section;
}

function normalizeSettingsSectionForArea(
  area: SettingsArea,
  value: string | null,
): SettingsSection {
  const normalizedSection = normalizeSettingsSection(value);
  const allowedSections = SETTINGS_AREA_SECTION_IDS[area];
  return allowedSections.includes(normalizedSection)
    ? normalizedSection
    : allowedSections[0];
}

function findSettingsAreaForSection(section: SettingsSection): SettingsArea {
  if (section === "global") {
    return "global";
  }
  if (section === "discount-coupons" || section === "discount-orchestration") {
    return "discounts";
  }
  if (section === "products" || section === "collections" || section === "quantity" || section === "visibility") {
    return "catalog-rules";
  }
  return "all";
}

function buildSettingsWorkspaceUrl(input: {
  area: SettingsArea;
  section: SettingsSection;
  view?: ProductRuleView | null;
}) {
  const pathname =
    input.area === "all" ? "/app/settings" : `/app/settings/${input.area}`;
  const params = new URLSearchParams();
  params.set("section", input.section);
  if (input.view) {
    params.set("view", input.view);
  }
  return `${pathname}?${params.toString()}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  let settingsView = await loadMarginGuardSettingsView();
  let autoActivationMessage: string | null = null;
  let productCatalogSyncMessage: string | null = null;
  let discountFunctionStatus: "ACTIVE" | "INACTIVE" | "ERROR" = "ERROR";
  let discountFunctionMessage = "Discount status is unknown.";
  let discountFunctionLastSyncAt: string | Date | null = null;
  const syncActivation = await ensureCartValidationActive(admin);
  autoActivationMessage = syncActivation.message;
  if (await shouldAutoSyncProductCatalog(settingsView.config)) {
    try {
      const syncResult = await syncShopifyProductCatalog(admin);
      settingsView = await loadMarginGuardSettingsView();
      productCatalogSyncMessage = `Imported ${syncResult.productCount} products and ${syncResult.variantCount} variants from Shopify.`;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Product catalog import failed.";
      await recordProductCatalogSyncError(message);
      settingsView = await loadMarginGuardSettingsView();
      productCatalogSyncMessage = `Product catalog import failed: ${message}`;
    }
  } else {
    settingsView = await loadMarginGuardSettingsView();
  }
  const discountStatus = await reconcileDiscountFunctionStatus(admin);
  discountFunctionStatus = discountStatus.status;
  discountFunctionMessage = discountStatus.message;
  discountFunctionLastSyncAt = discountStatus.lastSyncAt ?? null;
  // The storefront projection + visibility handles metafields are kept fresh by
  // the rule-change and catalog-sync action handlers below. Refreshing them on
  // every settings load is redundant GraphQL traffic, so it is gated behind a
  // flag (default off) and only used as an opt-in fallback.
  if (storefrontProjection.syncOnSettingsLoad) {
    Promise.all([
      syncVisibilityHandlesMetafield(admin),
      syncStorefrontProjectionMetafields(admin),
    ]).catch((err) => {
      if (storefrontProjection.debug) {
        console.error("[settings loader] storefront projection sync failed:", err);
      }
    });
  }
  const url = new URL(request.url);
  const activation = url.searchParams.get("activation");
  const message = url.searchParams.get("message");
  const discountActionMessage = url.searchParams.get("discountActionMessage");
  const catalogMessage = url.searchParams.get("catalogMessage");
  const collectionCatalogMessage = url.searchParams.get("collectionCatalogMessage");
  const catalogProductCount = await countActiveCatalogProducts();
  const catalogCollectionCount = await countActiveCatalogCollections();

  // MVP_5_0_3: only compute automatic-discount/floor conflicts when a discount
  // section is open — it queries Shopify discounts and should not slow other tabs.
  const requestedSectionParam = url.searchParams.get("section");
  let discountConflicts: DiscountConflictView[] = [];
  let automaticDiscountCount = 0;
  if (
    requestedSectionParam === "discount-orchestration" ||
    requestedSectionParam === "discount-coupons"
  ) {
    try {
      const conflictReport = await buildDiscountConflictReport(admin);
      discountConflicts = conflictReport.conflicts;
      automaticDiscountCount = conflictReport.automaticDiscountCount;
    } catch (error) {
      if (storefrontProjection.debug) {
        console.error("[settings loader] discount conflict report failed:", error);
      }
    }
  }

  return {
    config: settingsView.config,
    catalogProductsById: settingsView.catalogProductsById,
    catalogVariantsById: settingsView.catalogVariantsById,
    catalogCollectionsById: settingsView.catalogCollectionsById,
    catalogProductCount,
    catalogCollectionCount,
    activation,
    message,
    catalogMessage,
    productCatalogSyncMessage,
    collectionCatalogMessage,
    discountActionMessage,
    autoActivationMessage,
    discountFunctionStatus,
    discountFunctionMessage,
    discountFunctionLastSyncAt,
    discountConflicts,
    automaticDiscountCount,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "save-global") {
    const b2bTag = String(formData.get("b2bTag") ?? "b2b").trim() || "b2b";
    const globalMinPricePercent = parseNumber(
      formData.get("globalMinPricePercent"),
      70,
    );
    const b2bGlobalMinPricePercent = parseNumber(
      formData.get("b2bGlobalMinPricePercent"),
      globalMinPricePercent,
    );
    const allowZeroFinalPrice = formData.get("allowZeroFinalPrice") === "on";
    const allowRemoveAtMinimumOrderQuantity =
      formData.get("allowRemoveAtMinimumOrderQuantity") === "on";
    const productCatalogSourceType =
      String(formData.get("productCatalogSourceType") ?? "SHOPIFY").trim() || "SHOPIFY";
    const productCatalogAutoImportEnabled =
      formData.get("productCatalogAutoImportEnabled") === "on";
    const allowStacking = formData.get("allowStacking") === "on";
    const maxCombinedRaw = String(formData.get("maxCombinedPercentOff") ?? "").trim();
    const maxCombinedPercentOff = maxCombinedRaw ? Number(maxCombinedRaw) : null;
    const marginGuardEnabled = formData.get("marginGuardEnabled") === "on";

    await updateGlobalMarginGuardConfig({
      b2bTag,
      globalMinPricePercent,
      b2bGlobalMinPricePercent,
      productCatalogSourceType,
      productCatalogAutoImportEnabled,
      allowZeroFinalPrice,
      allowRemoveAtMinimumOrderQuantity,
      allowStacking,
      marginGuardEnabled,
      maxCombinedPercentOff:
        maxCombinedPercentOff != null && Number.isFinite(maxCombinedPercentOff)
          ? maxCombinedPercentOff
          : null,
    });
    await syncVisibilityHandlesMetafield(admin).catch((err) => {
      console.error("[syncVisibilityHandlesMetafield] global sync failed:", err);
    });
  }

  if (intent === "sync-product-catalog") {
    const url = new URL(request.url);
    url.searchParams.set("section", "global");
    try {
      const result = await syncShopifyProductCatalog(admin);
      await Promise.all([
        syncVisibilityHandlesMetafield(admin),
        syncStorefrontProjectionMetafields(admin),
      ]).catch((err) => {
        console.error("[storefrontProjectionSync] catalog sync follow-up failed:", err);
      });
      url.searchParams.set(
        "catalogMessage",
        `Imported ${result.productCount} products and ${result.variantCount} variants from Shopify.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Product catalog import failed.";
      await recordProductCatalogSyncError(message);
      url.searchParams.set("catalogMessage", `Product catalog import failed: ${message}`);
    }
    return Response.redirect(url.toString(), 302);
  }

  if (intent === "sync-collection-catalog") {
    const url = new URL(request.url);
    url.searchParams.set("section", "global");
    try {
      const result = await syncShopifyCollectionCatalog(admin);
      await syncStorefrontProjectionMetafields(admin).catch((err) => {
        console.error("[storefrontProjectionSync] collection catalog follow-up failed:", err);
      });
      url.searchParams.set(
        "collectionCatalogMessage",
        `Imported ${result.collectionCount} collections from Shopify.`,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Collection catalog import failed.";
      url.searchParams.set(
        "collectionCatalogMessage",
        `Collection catalog import failed: ${message}`,
      );
    }
    return Response.redirect(url.toString(), 302);
  }

  // MVP_5_1 (move-not-copy): catalog-rules writes (per-product floor/tier/MOQ/
  // step/max/customer-max, collection max, product/variant/collection visibility)
  // are owned by the shared catalog-rules-settings module; the standalone
  // app.settings.catalog-rules route uses the same handler. The shared
  // projection + cart-validation tail below still runs for these intents.
  await handleCatalogRulesSettingsAction({ admin, formData });

  // MVP_5_1 (move-not-copy): discount-area writes are owned by the shared
  // discount-settings module; the standalone app.settings.discounts route uses
  // the same handler. The cart-validation activation tail below still runs for
  // these intents.
  await handleDiscountSettingsAction(formData);

  if (intent === "deactivate-discount-function") {
    const result = await deactivateDiscountFunction(admin);
    const url = new URL(request.url);
    url.searchParams.set("discountActionMessage", result.message);
    return Response.redirect(url.toString(), 302);
  }

  if (
    intent === "save-global" ||
    intent === "save-product-quantity-rule" ||
    intent === "delete-product-quantity-rule" ||
    intent === "save-product-step-quantity-rule" ||
    intent === "delete-product-step-quantity-rule" ||
    intent === "save-product-max-quantity-rule" ||
    intent === "delete-product-max-quantity-rule" ||
    intent === "save-product-visibility-rule" ||
    intent === "delete-product-visibility-rule" ||
    intent === "save-product-variant-visibility-rule" ||
    intent === "delete-product-variant-visibility-rule" ||
    intent === "save-collection-visibility-rule" ||
    intent === "delete-collection-visibility-rule"
  ) {
    await syncStorefrontProjectionMetafields(admin).catch((err) => {
      console.error("[syncStorefrontProjectionMetafields] action sync failed:", err);
    });
  }

  if (
    intent === "save-global" ||
    intent === "save-product-floor" ||
    intent === "delete-product-floor" ||
    intent === "save-product-tier-price" ||
    intent === "delete-product-tier-price" ||
    intent === "save-product-quantity-rule" ||
    intent === "delete-product-quantity-rule" ||
    intent === "save-product-step-quantity-rule" ||
    intent === "delete-product-step-quantity-rule" ||
    intent === "save-product-max-quantity-rule" ||
    intent === "delete-product-max-quantity-rule" ||
    intent === "save-collection-max-quantity-rule" ||
    intent === "delete-collection-max-quantity-rule" ||
    intent === "save-product-customer-max-quantity-rule" ||
    intent === "delete-product-customer-max-quantity-rule" ||
    intent === "save-product-visibility-rule" ||
    intent === "delete-product-visibility-rule" ||
    intent === "save-product-variant-visibility-rule" ||
    intent === "delete-product-variant-visibility-rule" ||
    intent === "save-coupon-segment-rule" ||
    intent === "delete-coupon-segment-rule" ||
    intent === "save-discount-rule" ||
    intent === "delete-discount-rule" ||
    intent === "save-discount-blacklist-rule" ||
    intent === "delete-discount-blacklist-rule" ||
    intent === "save-discount-segment-cap" ||
    intent === "delete-discount-segment-cap"
  ) {
    await ensureCartValidationActive(admin);
  }

  return null;
};

export default function AppSettingsRoute() {
  const {
    config,
    catalogProductsById,
    catalogVariantsById,
    catalogCollectionsById,
    catalogProductCount,
    catalogCollectionCount,
    activation,
    message,
    catalogMessage,
    productCatalogSyncMessage,
    collectionCatalogMessage,
    discountActionMessage,
    autoActivationMessage,
    discountFunctionStatus,
    discountFunctionMessage,
    discountFunctionLastSyncAt,
    discountConflicts,
    automaticDiscountCount,
  } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const area = normalizeSettingsArea(
    searchParams.get("area") ?? inferSettingsAreaFromPathname(location.pathname),
  );
  const requestedSection = normalizeSettingsSectionForArea(
    area,
    searchParams.get("section"),
  );
  const activeSection = getCanonicalSection(requestedSection);
  const visibleSections = SIDEBAR_SECTION_IDS[area];
  const activeProductRuleView = normalizeProductRuleView(
    requestedSection,
    searchParams.get("view"),
  );
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const showSectionSidebar = area === "all" || visibleSections.length > 1;
  const productMoqRules = config.productQuantityRules.filter(
    (rule: any) => Number(rule.minimumOrderQuantity) > 1,
  );
  const productStepRules = config.productQuantityRules.filter(
    (rule: any) => Number(rule.stepQuantity ?? 0) > 1,
  );
  const productMaxRules = config.productQuantityRules.filter(
    (rule: any) => Number(rule.maxOrderQuantity ?? 0) > 0,
  );
  const collectionMaxRules = Array.isArray((config as any).collectionQuantityRules)
    ? (config as any).collectionQuantityRules.filter(
        (rule: any) => Number(rule.maxOrderQuantity ?? 0) > 0,
      )
    : [];
  const productCustomerMaxRules = Array.isArray(config.productCustomerQuantityRules)
    ? config.productCustomerQuantityRules.filter(
        (rule: any) => Number(rule.maxOrderQuantity ?? 0) > 0,
      )
    : [];
  const productVariantVisibilityRules = Array.isArray(
    (config as any).productVariantVisibilityRules,
  )
    ? (config as any).productVariantVisibilityRules
    : [];
  const collectionVisibilityRules = Array.isArray(
    (config as any).collectionVisibilityRules,
  )
    ? (config as any).collectionVisibilityRules
    : [];
  const advancedDiscountRules = Array.isArray((config as any).discountRules)
    ? (config as any).discountRules
    : [];
  const discountBlacklistRules = Array.isArray(
    (config as any).discountCombinationBlacklistRules,
  )
    ? (config as any).discountCombinationBlacklistRules
    : [];
  const discountSegmentCaps = Array.isArray((config as any).discountSegmentCaps)
    ? (config as any).discountSegmentCaps
    : [];
  const isGlobalSection = activeSection === "global";
  const isProductsSection = activeSection === "products";
  const isCollectionsSection = activeSection === "collections";
  const isDiscountCouponsSection = activeSection === "discount-coupons";
  const isDiscountOrchestrationSection = activeSection === "discount-orchestration";
  const isFunctionsSection = activeSection === "functions";
  const productCatalogImportRequired = catalogProductCount === 0;
  const collectionCatalogImportRequired = catalogCollectionCount === 0;
  const activeSectionOption =
    SETTINGS_SECTION_OPTIONS.find((section) => section.id === activeSection) ??
    SETTINGS_SECTION_OPTIONS[0];
  const activeAreaOption = SETTINGS_AREA_OPTIONS[area];
  const activeProductRuleViewOption =
    PRODUCT_RULE_VIEWS.find((view) => view.id === activeProductRuleView) ??
    PRODUCT_RULE_VIEWS[0];
  const productCatalogLastSyncLabel = formatTimestamp(
    (config as any).productCatalogLastSyncAt,
  );
  const productCatalogSourceLabel = formatCatalogSourceLabel(
    (config as any).productCatalogSourceType,
  );

  const { describeProduct, describeVariant, describeCollection } =
    makeCatalogDescribers({
      products: catalogProductsById as Record<
        string,
        { title: string; handle: string | null }
      >,
      variants: catalogVariantsById as Record<
        string,
        { title: string; handle: string | null }
      >,
      collections: catalogCollectionsById as Record<
        string,
        { title: string; handle: string | null }
      >,
    });

  function formatSegment(segment: string | null | undefined): string {
    return String(segment ?? "").trim() || "ALL";
  }

  function formatVisibilityMode(mode: string | null | undefined): string {
    if (mode === "B2B_ONLY") {
      return "visibility only for B2B";
    }
    if (mode === "B2C_ONLY") {
      return "visibility only for B2C";
    }
    if (mode === "CUSTOMER_ONLY") {
      return "visibility only for selected customer";
    }
    return "visible for all";
  }

  function formatCollectionVisibilityMode(mode: string | null | undefined): string {
    if (mode === "B2B_ONLY") {
      return "visible only for B2B";
    }
    if (mode === "B2C_ONLY") {
      return "visible only for B2C";
    }
    return "visibility restricted";
  }

  function getSectionLockReason(section: SettingsSection): string | null {
    const canonicalSection = getCanonicalSection(section);
    if (canonicalSection === "products" || canonicalSection === "collections") {
      return null;
    }
    return null;
  }

  const activeSectionLockReason =
    isProductsSection && activeProductRuleView === "collection-visibility"
      ? collectionCatalogImportRequired
        ? "Collection catalog is not imported yet. Open Global Settings and run Import collections now."
        : null
      : isProductsSection
        ? productCatalogImportRequired
          ? "Product catalog is not imported yet. Open Global Settings and run Import products now."
          : null
        : isCollectionsSection
          ? collectionCatalogImportRequired
            ? "Collection catalog is not imported yet. Open Global Settings and run Import collections now."
            : null
          : getSectionLockReason(activeSection);
  const collectionVisibilityItems: CatalogRuleItem[] = collectionVisibilityRules.map(
    (rule: any) => ({
      id: rule.id,
      label: describeCollection(rule.collectionId),
      badges: [
        {
          text: rule.visibilityMode === "B2B_ONLY" ? "B2B only" : "B2C only",
          variant: (rule.visibilityMode === "B2B_ONLY" ? "info" : "warning") as
            | "info"
            | "warning",
        },
      ],
      detail: rule.collectionHandle
        ? `Handle: ${rule.collectionHandle} | ${formatCollectionVisibilityMode(rule.visibilityMode)}`
        : formatCollectionVisibilityMode(rule.visibilityMode),
      formValues: {
        collectionId: rule.collectionId,
        visibilityMode: rule.visibilityMode,
      },
      formDescriptions: {
        collectionId: describeCollection(rule.collectionId),
      },
    }),
  );
  const productFloorItems: CatalogRuleItem[] = config.productFloors.map((rule: any) => ({
    id: rule.id,
    label: describeProduct(rule.productId),
    badges: [
      { text: formatSegment(rule.segment), variant: "neutral" },
      { text: `${rule.minPercentOfBasePrice}% floor`, variant: "info" },
    ],
    detail: `Zero final: ${
      rule.allowZeroFinalPrice == null
        ? "inherit"
        : rule.allowZeroFinalPrice
          ? "allow"
          : "deny"
    }${rule.b2bOverridePrice == null ? "" : ` | B2B base override ${rule.b2bOverridePrice}`}`,
    formValues: {
      productId: rule.productId,
      segment: rule.segment ?? "",
      allowZeroFinalPriceOverride:
        rule.allowZeroFinalPrice == null
          ? "inherit"
          : rule.allowZeroFinalPrice
            ? "allow"
            : "deny",
      minPercentOfBasePrice: rule.minPercentOfBasePrice,
      b2bOverridePrice: rule.b2bOverridePrice ?? "",
    },
    formDescriptions: {
      productId: describeProduct(rule.productId),
    },
  }));
  const productTierPriceItems: CatalogRuleItem[] = config.productTierPrices.map((rule: any) => ({
    id: rule.id,
    label: describeProduct(rule.productId),
    badges: [
      { text: formatSegment(rule.segment), variant: "neutral" },
      { text: `Qty ${rule.minQuantity}+`, variant: "info" },
    ],
    detail: `Tier unit price ${rule.unitPrice}`,
    formValues: {
      productId: rule.productId,
      segment: rule.segment ?? "",
      minQuantity: rule.minQuantity,
      unitPrice: rule.unitPrice,
    },
    formDescriptions: {
      productId: describeProduct(rule.productId),
    },
  }));
  const productMoqItems: CatalogRuleItem[] = productMoqRules.map((rule: any) => ({
    id: rule.id,
    label: describeProduct(rule.productId),
    badges: [
      { text: formatSegment(rule.segment), variant: "neutral" },
      { text: `MOQ ${rule.minimumOrderQuantity}`, variant: "warning" },
    ],
    formValues: {
      productId: rule.productId,
      segment: rule.segment ?? "",
      minimumOrderQuantity: rule.minimumOrderQuantity,
    },
    formDescriptions: {
      productId: describeProduct(rule.productId),
    },
  }));
  const productStepItems: CatalogRuleItem[] = productStepRules.map((rule: any) => ({
    id: rule.id,
    label: describeProduct(rule.productId),
    badges: [
      { text: formatSegment(rule.segment), variant: "neutral" },
      { text: `Step ${rule.stepQuantity}`, variant: "warning" },
    ],
    detail: "Cart quantity must follow this increment.",
    formValues: {
      productId: rule.productId,
      segment: rule.segment ?? "",
      stepQuantity: rule.stepQuantity,
    },
    formDescriptions: {
      productId: describeProduct(rule.productId),
    },
  }));
  const productMaxItems: CatalogRuleItem[] = productMaxRules.map((rule: any) => ({
    id: rule.id,
    label: describeProduct(rule.productId),
    badges: [
      { text: formatSegment(rule.segment), variant: "neutral" },
      { text: `Max ${rule.maxOrderQuantity}`, variant: "warning" },
    ],
    formValues: {
      productId: rule.productId,
      segment: rule.segment ?? "",
      maxOrderQuantity: rule.maxOrderQuantity,
    },
    formDescriptions: {
      productId: describeProduct(rule.productId),
    },
  }));
  const productCustomerMaxItems: CatalogRuleItem[] = productCustomerMaxRules.map(
    (rule: any) => ({
      id: rule.id,
      label: describeProduct(rule.productId),
      badges: [{ text: `Customer ${rule.customerId}`, variant: "success" }],
      detail: `Max quantity ${rule.maxOrderQuantity}`,
      formValues: {
        productId: rule.productId,
        customerId: rule.customerId,
        maxOrderQuantity: rule.maxOrderQuantity,
      },
      formDescriptions: {
        productId: describeProduct(rule.productId),
        customerId: `Customer ${rule.customerId}`,
      },
    }),
  );
  const productVisibilityItems: CatalogRuleItem[] = config.productVisibilityRules.map(
    (rule: any) => ({
      id: rule.id,
      label: describeProduct(rule.productId),
      badges: [
        {
          text:
            rule.visibilityMode === "CUSTOMER_ONLY"
              ? "Customer only"
              : rule.visibilityMode === "B2B_ONLY"
                ? "B2B only"
                : rule.visibilityMode === "B2C_ONLY"
                  ? "B2C only"
                  : "Visible for all",
          variant:
            rule.visibilityMode === "B2B_ONLY"
              ? "info"
              : rule.visibilityMode === "B2C_ONLY"
                ? "warning"
                : rule.visibilityMode === "CUSTOMER_ONLY"
                  ? "success"
                  : "neutral",
        },
      ],
      detail: rule.customerId ? `Customer ${rule.customerId}` : formatVisibilityMode(rule.visibilityMode),
      formValues: {
        productId: rule.productId,
        visibilityMode: rule.visibilityMode,
        customerId: rule.customerId ?? "",
      },
      formDescriptions: {
        productId: describeProduct(rule.productId),
        customerId: rule.customerId ? `Customer ${rule.customerId}` : "",
      },
    }),
  );
  const productVariantVisibilityItems: CatalogRuleItem[] = productVariantVisibilityRules.map(
    (rule: any) => ({
      id: rule.id,
      label: `${describeProduct(rule.productId)} / ${describeVariant(rule.variantId)}`,
      badges: [
        {
          text:
            rule.visibilityMode === "CUSTOMER_ONLY"
              ? "Customer only"
              : rule.visibilityMode === "B2B_ONLY"
                ? "B2B only"
                : rule.visibilityMode === "B2C_ONLY"
                  ? "B2C only"
                  : "Visible for all",
          variant:
            rule.visibilityMode === "B2B_ONLY"
              ? "info"
              : rule.visibilityMode === "B2C_ONLY"
                ? "warning"
                : rule.visibilityMode === "CUSTOMER_ONLY"
                  ? "success"
                  : "neutral",
        },
      ],
      detail: rule.customerId ? `Customer ${rule.customerId}` : formatVisibilityMode(rule.visibilityMode),
      formValues: {
        productId: rule.productId,
        variantId: rule.variantId,
        visibilityMode: rule.visibilityMode,
        customerId: rule.customerId ?? "",
      },
      formDescriptions: {
        productId: describeProduct(rule.productId),
        variantId: describeVariant(rule.variantId),
        customerId: rule.customerId ? `Customer ${rule.customerId}` : "",
      },
    }),
  );
  const collectionMaxItems: CatalogRuleItem[] = collectionMaxRules.map((rule: any) => ({
    id: rule.id,
    label: describeCollection(rule.collectionId),
    badges: [
      { text: formatSegment(rule.segment), variant: "neutral" },
      { text: `Max ${rule.maxOrderQuantity}`, variant: "warning" },
    ],
    formValues: {
      collectionId: rule.collectionId,
      segment: rule.segment ?? "",
      maxOrderQuantity: rule.maxOrderQuantity,
    },
    formDescriptions: {
      collectionId: describeCollection(rule.collectionId),
    },
  }));

  function buildProductRuleSummary() {
    const groups = new Map<string, { productId: string; title: string; details: string[] }>();
    const pushDetail = (productId: string | null | undefined, detail: string) => {
      const normalized = String(productId ?? "").trim();
      if (!normalized) {
        return;
      }
      const existing = groups.get(normalized);
      if (existing) {
        existing.details.push(detail);
        return;
      }
      groups.set(normalized, {
        productId: normalized,
        title: describeProduct(normalized),
        details: [detail],
      });
    };

    if (isProductsSection) {
      for (const rule of config.productFloors) {
        pushDetail(
          rule.productId,
          `floor ${formatSegment(rule.segment)} at ${rule.minPercentOfBasePrice}%${rule.b2bOverridePrice == null ? "" : `, B2B base ${rule.b2bOverridePrice}`}`,
        );
      }
      for (const rule of config.productTierPrices) {
        pushDetail(
          rule.productId,
          `tier ${formatSegment(rule.segment)} from qty ${rule.minQuantity} at ${rule.unitPrice}`,
        );
      }
      for (const rule of productCustomerMaxRules) {
        pushDetail(
          rule.productId,
          `customer-specific max ${rule.maxOrderQuantity} for ${rule.customerId}`,
        );
      }
      for (const rule of productMoqRules) {
        pushDetail(
          rule.productId,
          `MOQ ${rule.minimumOrderQuantity} for ${formatSegment(rule.segment)}`,
        );
      }
      for (const rule of productStepRules) {
        pushDetail(
          rule.productId,
          `step quantity ${rule.stepQuantity} for ${formatSegment(rule.segment)}`,
        );
      }
      for (const rule of productMaxRules) {
        pushDetail(
          rule.productId,
          `maximum ${rule.maxOrderQuantity} for ${formatSegment(rule.segment)}`,
        );
      }
      for (const rule of config.productVisibilityRules) {
        pushDetail(
          rule.productId,
          `${formatVisibilityMode(rule.visibilityMode)}${rule.customerId ? ` (${rule.customerId})` : ""}`,
        );
      }
      for (const rule of productVariantVisibilityRules) {
        pushDetail(
          rule.productId,
          `${describeVariant(rule.variantId)}: ${formatVisibilityMode(rule.visibilityMode)}${rule.customerId ? ` (${rule.customerId})` : ""}`,
        );
      }
    }

    if (isDiscountOrchestrationSection) {
      for (const rule of advancedDiscountRules) {
        if (String(rule.scope ?? "") !== "PRODUCT") {
          continue;
        }
        pushDetail(
          rule.targetId,
          `${rule.percentOff}% off for ${formatSegment(rule.segment)}, priority ${rule.priority}, ${String(rule.stackMode ?? "").toLowerCase()}`,
        );
      }
    }

    return Array.from(groups.values()).sort((left, right) =>
      left.title.localeCompare(right.title),
    );
  }

  const sectionProductRuleSummary = buildProductRuleSummary();
  function handleSectionSelect(section: SettingsSection) {
    const nextArea = visibleSections.includes(section)
      ? area
      : findSettingsAreaForSection(section);
    navigate(
      buildSettingsWorkspaceUrl({
        area: nextArea,
        section,
        view:
          section === "products"
            ? "floor-rules"
            : null,
      }),
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleProductViewSelect(view: ProductRuleView) {
    navigate(
      buildSettingsWorkspaceUrl({
        area,
        section: "products",
        view,
      }),
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const {
    openManualRuleForm,
    setOpenManualRuleForm,
    openManualAddForm,
    openManualModifyForm,
  } = useManualRuleForm();

  const workspaceTitle =
    isProductsSection && area !== "all"
      ? activeProductRuleViewOption.label
      : area === "all"
        ? activeSectionOption.label
        : activeAreaOption.heading;
  const workspaceDescription =
    isProductsSection && area !== "all"
      ? activeProductRuleViewOption.description
      : area === "all"
        ? activeSectionOption.description
        : activeAreaOption.description;

  return (
    <s-page heading={activeAreaOption.heading}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          width: "100%",
        }}
      >
        {showSectionSidebar && (
          <div
            style={{
              width: "184px",
              minWidth: "184px",
              flexShrink: 0,
              position: "sticky",
              top: "12px",
              zIndex: 1,
              marginLeft: "-12px",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                paddingTop: "6px",
              }}
            >
              {visibleSections.map((sectionId) => {
                const section = SETTINGS_SECTION_OPTIONS.find(
                  (option) => option.id === getCanonicalSection(sectionId),
                );
                if (!section) {
                  return null;
                }
                const lockReason = getSectionLockReason(section.id);
                const isLocked = lockReason != null;
                const isActiveSection = section.id === activeSection;
                return (
                  <div
                    key={section.id}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "4px",
                    }}
                  >
                    <button
                      type="button"
                      disabled={isLocked}
                      onClick={() => {
                        if (!isLocked) handleSectionSelect(section.id);
                      }}
                      title={lockReason ?? undefined}
                      style={{
                        background: "transparent",
                        border: "none",
                        borderLeft: isActiveSection
                          ? "3px solid #07213a"
                          : "3px solid transparent",
                        color: isLocked
                          ? "#b5bec9"
                          : isActiveSection
                            ? "#07213a"
                            : "#51606f",
                        cursor: isLocked ? "not-allowed" : "pointer",
                        fontSize: "14px",
                        fontWeight: isActiveSection ? 700 : 500,
                        padding: "10px 8px 10px 12px",
                        textAlign: "left",
                        opacity: isLocked ? 0.6 : 1,
                      }}
                    >
                      {section.label}
                      {isLocked && " 🔒"}
                    </button>
                    {isActiveSection && section.id === "products" && (
                      <div
                        style={{
                          marginLeft: "16px",
                          paddingLeft: "10px",
                          borderLeft: "1px solid rgba(7, 33, 58, 0.10)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "2px",
                        }}
                      >
                        {PRODUCT_RULE_VIEWS.map((view) => (
                          <button
                            key={view.id}
                            type="button"
                            onClick={() => handleProductViewSelect(view.id)}
                            style={{
                              background: "transparent",
                              border: "none",
                              color:
                                activeProductRuleView === view.id
                                  ? "#07213a"
                                  : "#667085",
                              cursor: "pointer",
                              fontSize: "12px",
                              fontWeight:
                                activeProductRuleView === view.id ? 700 : 500,
                              padding: "6px 8px 6px 10px",
                              textAlign: "left",
                              borderRadius: "10px",
                              backgroundColor:
                                activeProductRuleView === view.id
                                  ? "rgba(7, 33, 58, 0.06)"
                                  : "transparent",
                            }}
                          >
                            {view.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div
          className="settings-workspace"
          style={{
            minWidth: 0,
            flex: 1,
            width: showSectionSidebar ? "calc(100% - 196px)" : "100%",
          }}
        >
      <style>{`
        .settings-workspace {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .settings-workspace > s-section {
          display: block;
          margin: 0;
        }

        .settings-workspace > s-section > form {
          display: block;
          background: linear-gradient(180deg, #ffffff 0%, #fbfcfd 100%);
          border: 1px solid rgba(7, 33, 58, 0.10);
          border-radius: 18px;
          padding: 22px;
          box-shadow: 0 1px 2px rgba(7, 33, 58, 0.04);
          margin-bottom: 14px;
        }

        .settings-workspace > s-section > s-box {
          display: block;
          background: #ffffff;
          border: 1px solid rgba(7, 33, 58, 0.10);
          border-radius: 18px;
          padding: 18px;
          box-shadow: 0 1px 2px rgba(7, 33, 58, 0.04);
        }

        .settings-workspace > s-section > s-paragraph {
          display: block;
          margin: 0 0 14px 0;
          padding: 12px 14px;
          background: rgba(7, 33, 58, 0.03);
          border: 1px solid rgba(7, 33, 58, 0.08);
          border-radius: 14px;
          color: #475467;
        }

        .settings-workspace form label {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          color: #344054;
        }

        .settings-workspace form input,
        .settings-workspace form select,
        .settings-workspace form textarea {
          border: 1px solid #d0d5dd;
          border-radius: 10px;
          background: #ffffff;
          color: #101828;
          font-size: 14px;
          line-height: 1.4;
          min-height: 40px;
          padding: 8px 12px;
          box-sizing: border-box;
          width: 100%;
        }

        .settings-workspace form textarea {
          min-height: 88px;
          resize: vertical;
        }

        .settings-workspace form button,
        .settings-workspace s-box form button {
          border: 1px solid #07213a;
          border-radius: 10px;
          background: #07213a;
          color: #ffffff;
          min-height: 38px;
          padding: 0 14px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        .settings-workspace s-box form button {
          border-color: #d0d5dd;
          background: #ffffff;
          color: #344054;
        }

        .settings-workspace s-box > s-heading {
          display: block;
          margin-bottom: 12px;
        }

        .settings-workspace s-box > s-stack {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .settings-workspace s-box s-stack[direction="inline"] {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
          padding: 12px 14px;
          border: 1px solid rgba(7, 33, 58, 0.08);
          border-radius: 12px;
          background: #fbfcfd;
        }

        .settings-workspace s-box s-stack[direction="inline"] form {
          margin: 0;
          padding: 0;
          border: none;
          background: transparent;
          box-shadow: none;
        }

        .settings-workspace s-text {
          color: #344054;
          line-height: 1.5;
        }

        .catalog-source-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
        }

        .catalog-source-card {
          border: 1px solid rgba(7, 33, 58, 0.10);
          border-radius: 16px;
          padding: 16px;
          background: #ffffff;
        }

        .catalog-source-card.is-active {
          border-color: rgba(7, 33, 58, 0.22);
          box-shadow: 0 1px 2px rgba(7, 33, 58, 0.06);
          background: linear-gradient(180deg, #ffffff 0%, #f8fbfd 100%);
        }

        .catalog-source-card.is-disabled {
          background: #f8fafc;
          color: #98a2b3;
        }

        .catalog-source-kicker {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 8px;
          color: #667085;
        }

        .catalog-source-title {
          font-size: 16px;
          font-weight: 700;
          color: #07213a;
          margin-bottom: 8px;
        }

        .catalog-source-card.is-disabled .catalog-source-title {
          color: #98a2b3;
        }

        .catalog-source-meta {
          font-size: 13px;
          line-height: 1.5;
          color: #51606f;
        }

        .catalog-source-card.is-disabled .catalog-source-meta {
          color: #98a2b3;
        }
      `}</style>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          paddingTop: "6px",
        }}
      >
      <div
        style={{
          padding: "4px 0 8px 0",
          borderBottom: "1px solid rgba(7,33,58,0.08)",
          marginBottom: "4px",
        }}
      >
        <div
          style={{
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#6b7280",
            marginBottom: "6px",
          }}
        >
          {area === "all" ? "Settings workspace" : `${activeAreaOption.heading} workspace`}
        </div>
        <div
          style={{
            fontSize: "28px",
            fontWeight: 700,
            color: "#07213a",
            lineHeight: 1.15,
            marginBottom: "6px",
          }}
        >
          {workspaceTitle}
        </div>
        <div
          style={{
            fontSize: "14px",
            color: "#51606f",
            maxWidth: "760px",
            lineHeight: 1.5,
          }}
        >
          {workspaceDescription}
        </div>
      </div>
      {activeSectionLockReason && (
        <div
          style={{
            padding: "14px 16px",
            borderRadius: "14px",
            border: "1px solid rgba(183, 121, 0, 0.25)",
            background: "rgba(255, 236, 213, 0.5)",
            color: "#7a4f01",
            fontSize: "14px",
            lineHeight: 1.5,
          }}
        >
          <strong>Catalog import required.</strong> {activeSectionLockReason} Go to{" "}
          <button
            type="button"
            onClick={() => handleSectionSelect("global")}
            style={{
              background: "none",
              border: "none",
              color: "#005bd3",
              cursor: "pointer",
              textDecoration: "underline",
              padding: 0,
              fontSize: "inherit",
              fontWeight: 600,
            }}
          >
            Global Settings
          </button>{" "}
          and continue there.
        </div>
      )}
      {(catalogMessage || productCatalogSyncMessage || collectionCatalogMessage) && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: "14px",
            border: "1px solid rgba(10, 132, 255, 0.18)",
            background: "rgba(10, 132, 255, 0.06)",
            color: "#0b4f8a",
            fontSize: "14px",
            lineHeight: 1.5,
          }}
        >
          {catalogMessage ?? productCatalogSyncMessage ?? collectionCatalogMessage}
        </div>
      )}
      {(isProductsSection || isDiscountOrchestrationSection) && (
        <div
          style={{
            background: "#ffffff",
            border: "1px solid rgba(7, 33, 58, 0.10)",
            borderRadius: "18px",
            padding: "18px",
            boxShadow: "0 1px 2px rgba(7, 33, 58, 0.04)",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#667085",
              marginBottom: "8px",
            }}
          >
            Applied products
          </div>
          <div
            style={{
              fontSize: "18px",
              fontWeight: 700,
              color: "#07213a",
              marginBottom: "12px",
            }}
          >
            Products affected in this section
          </div>
          {sectionProductRuleSummary.length === 0 ? (
            <div style={{ color: "#51606f", fontSize: "14px" }}>
              No product rules are configured in this section yet.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "12px",
              }}
            >
              {sectionProductRuleSummary.map((group) => (
                <div
                  key={group.productId}
                  style={{
                    border: "1px solid rgba(7, 33, 58, 0.08)",
                    borderRadius: "14px",
                    padding: "14px",
                    background: "#fbfcfd",
                  }}
                >
                  <div
                    style={{
                      fontSize: "15px",
                      fontWeight: 700,
                      color: "#07213a",
                      marginBottom: "10px",
                    }}
                  >
                    {group.title}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: "18px", color: "#475467" }}>
                    {group.details.map((detail, index) => (
                      <li key={`${group.productId}-${index}`}>{detail}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {isGlobalSection && (
      <s-section heading="Global configuration">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Product catalog foundation</s-heading>
          <div
            style={{
              marginBottom: "14px",
              fontSize: "14px",
              color: "#51606f",
              lineHeight: 1.5,
            }}
          >
            Importing products is the first admin setup step. Product, variant, and
            rule pickers use this catalog as the source of truth across the entire
            settings workspace.
          </div>
          <div className="catalog-source-grid">
            <div className="catalog-source-card is-active">
              <div className="catalog-source-kicker">Available now</div>
              <div className="catalog-source-title">Shopify Catalog</div>
              <div className="catalog-source-meta">
                Active products: {catalogProductCount}
                <br />
                Last sync: {productCatalogLastSyncLabel ?? "never"}
                <br />
                Auto import:{" "}
                {(config as any).productCatalogAutoImportEnabled !== false
                  ? "enabled"
                  : "disabled"}
              </div>
            </div>
            <div className="catalog-source-card is-disabled" aria-disabled="true">
              <div className="catalog-source-kicker">Planned</div>
              <div className="catalog-source-title">CSV / JSON Import</div>
              <div className="catalog-source-meta">
                Reserved for MVP_6 data import flows. This source will later support
                price, MOQ, and catalog feeds from flat files.
              </div>
            </div>
            <div className="catalog-source-card is-disabled" aria-disabled="true">
              <div className="catalog-source-kicker">Planned</div>
              <div className="catalog-source-title">ERP Integration</div>
              <div className="catalog-source-meta">
                Reserved for future ERP sync. The admin UI is prepared for this path,
                but activation will come in a later delivery.
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: "14px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <s-text>
              Current source: {productCatalogSourceLabel}
              {(config as any).productCatalogLastSyncError
                ? ` | last error: ${(config as any).productCatalogLastSyncError}`
                : ""}
            </s-text>
            <form method="post">
              <input type="hidden" name="intent" value="sync-product-catalog" />
              <button
                type="submit"
                disabled={
                  isSubmitting ||
                  String((config as any).productCatalogSourceType ?? "SHOPIFY") !== "SHOPIFY"
                }
              >
                Import products now
              </button>
            </form>
          </div>
        </s-box>
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Collection catalog foundation</s-heading>
          <div
            style={{
              marginBottom: "14px",
              fontSize: "14px",
              color: "#51606f",
              lineHeight: 1.5,
            }}
          >
            Collection imports will become the source layer for collection rules,
            collection-driven discount orchestration, and future non-Shopify feeds.
            The UI is prepared now so this foundation matches the product catalog
            model.
          </div>
          <div className="catalog-source-grid">
            <div className="catalog-source-card is-active">
              <div className="catalog-source-kicker">Available now</div>
              <div className="catalog-source-title">Shopify Collections</div>
              <div className="catalog-source-meta">
                Active collections: {catalogCollectionCount}
                <br />
                Stored locally for collection rules and collection-based governance.
              </div>
            </div>
            <div className="catalog-source-card is-disabled" aria-disabled="true">
              <div className="catalog-source-kicker">Planned</div>
              <div className="catalog-source-title">CSV / JSON Import</div>
              <div className="catalog-source-meta">
                Reserved for MVP_6 collection imports from flat-file feeds and
                external data export pipelines.
              </div>
            </div>
            <div className="catalog-source-card is-disabled" aria-disabled="true">
              <div className="catalog-source-kicker">Planned</div>
              <div className="catalog-source-title">ERP Integration</div>
              <div className="catalog-source-meta">
                Reserved for future ERP-backed collection synchronization and mapping
                into admin governance rules.
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: "14px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <s-text>
              Collection source: Shopify
            </s-text>
            <form method="post">
              <input type="hidden" name="intent" value="sync-collection-catalog" />
              <button type="submit" disabled={isSubmitting}>
                Import collections now
              </button>
            </form>
          </div>
        </s-box>
        <form method="post">
          <input type="hidden" name="intent" value="save-global" />
          <s-stack direction="block" gap="base">
            <label>
              <input
                name="marginGuardEnabled"
                type="checkbox"
                defaultChecked={(config as any).marginGuardEnabled !== false}
              />
              Margin Guard enforcement active
            </label>
            <s-paragraph>
              When enabled, Margin Guard enforces the margin floor on all discounts.
              When disabled, all discounts pass through without floor enforcement.
              Note: only product-level discount codes (Amount off products) are intercepted. Order-level codes (Amount off order) bypass per-line floor checks.
            </s-paragraph>
            <label>
              Customer segment tag treated as B2B pricing
              <input name="b2bTag" defaultValue={config.b2bTag} placeholder="wholesale" />
            </label>
            <s-paragraph>
              Any customer with this exact tag is evaluated as the protected segment in
              discount controls.
            </s-paragraph>
            <label>
              Global minimum price percent
              <input
                name="globalMinPricePercent"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={config.globalMinPricePercent}
              />
            </label>
            <label>
              B2B global minimum price percent
              <input
                name="b2bGlobalMinPricePercent"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={
                  (config as any).b2bGlobalMinPricePercent ?? config.globalMinPricePercent
                }
              />
            </label>
            <input
              type="hidden"
              name="productCatalogSourceType"
              value={(config as any).productCatalogSourceType ?? "SHOPIFY"}
            />
            <label>
              <input
                name="productCatalogAutoImportEnabled"
                type="checkbox"
                defaultChecked={(config as any).productCatalogAutoImportEnabled !== false}
              />
              Automatically sync product catalog from the selected source
            </label>
            <label>
              <input
                name="allowZeroFinalPrice"
                type="checkbox"
                defaultChecked={config.allowZeroFinalPrice}
              />
              Allow zero final price globally
            </label>
            <label>
              <input
                name="allowRemoveAtMinimumOrderQuantity"
                type="checkbox"
                defaultChecked={
                  (config as any).allowRemoveAtMinimumOrderQuantity !== false
                }
              />
              Allow removing a cart line when customer decreases from MOQ
            </label>
            <label>
              <input name="allowStacking" type="checkbox" defaultChecked={config.allowStacking} />
              Allow discount stacking
            </label>
            <label>
              Max combined discount percent (optional)
              <input
                name="maxCombinedPercentOff"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={config.maxCombinedPercentOff ?? ""}
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save global settings
            </button>
          </s-stack>
        </form>
      </s-section>
      )}

      {isProductsSection && activeProductRuleView === "floor-rules" && (
        <CompactRulePanel
          heading="Floor rules"
          description="Protect margin per product with compact pricing controls and optional B2B base-price override."
          saveIntent="save-product-floor"
          submitLabel="Save floor rule"
          deleteIntent="delete-product-floor"
          rulesHeading="Configured floor rules"
          emptyMessage="No per-product floor rules yet."
          isSubmitting={isSubmitting || productCatalogImportRequired}
          items={productFloorItems}
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
            />
          </div>
          <label>
            Segment
            <select name="segment" defaultValue="">
              <option value="">All segments</option>
              <option value="B2B">B2B</option>
              <option value="B2C">B2C</option>
            </select>
          </label>
          <label>
            Zero final price
            <select name="allowZeroFinalPriceOverride" defaultValue="inherit">
              <option value="inherit">Inherit global</option>
              <option value="allow">Allow free final price</option>
              <option value="deny">Disallow free final price</option>
            </select>
          </label>
          <label>
            Minimum price percent
            <input
              name="minPercentOfBasePrice"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={70}
            />
          </label>
          <label>
            B2B override base price
            <input
              name="b2bOverridePrice"
              type="number"
              min={0}
              step="0.01"
              placeholder="e.g. 499.00"
            />
          </label>
        </CompactRulePanel>
      )}

      {isProductsSection && activeProductRuleView === "tier-pricing" && (
        <CompactRulePanel
          heading="Tier pricing"
          description="Define volume-based unit prices for a product and keep the configuration compact."
          saveIntent="save-product-tier-price"
          submitLabel="Save tier pricing rule"
          deleteIntent="delete-product-tier-price"
          rulesHeading="Configured tier pricing"
          emptyMessage="No per-product tier pricing rules yet."
          isSubmitting={isSubmitting || productCatalogImportRequired}
          items={productTierPriceItems}
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
            />
          </div>
          <label>
            Segment
            <select name="segment" defaultValue="">
              <option value="">All segments</option>
              <option value="B2B">B2B</option>
              <option value="B2C">B2C</option>
            </select>
          </label>
          <label>
            Minimum quantity
            <input name="minQuantity" type="number" min={1} step={1} defaultValue={1} />
          </label>
          <label>
            Tier unit price
            <input
              name="unitPrice"
              type="number"
              min={0}
              step="0.01"
              placeholder="e.g. 450.00"
              required
            />
          </label>
        </CompactRulePanel>
      )}

      {isProductsSection && activeProductRuleView === "moq" && (
        <CompactRulePanel
          heading="MOQ"
          description="Configure minimum order quantity per product and segment from the compact product governance panel."
          saveIntent="save-product-quantity-rule"
          submitLabel="Save MOQ rule"
          deleteIntent="delete-product-quantity-rule"
          rulesHeading="Configured MOQ rules"
          emptyMessage="No per-product MOQ rules yet."
          isSubmitting={isSubmitting || productCatalogImportRequired}
          items={productMoqItems}
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
            />
          </div>
          <label>
            Segment
            <select name="segment" defaultValue="">
              <option value="">All segments</option>
              <option value="B2B">B2B</option>
              <option value="B2C">B2C</option>
            </select>
          </label>
          <label>
            Minimum order quantity
            <input
              name="minimumOrderQuantity"
              type="number"
              min={1}
              step={1}
              defaultValue={1}
            />
          </label>
        </CompactRulePanel>
      )}

      {isProductsSection && activeProductRuleView === "step-quantity" && (
        <CompactRulePanel
          heading="Step quantity"
          description="Use carton multiple controls when orders must move in fixed increments."
          saveIntent="save-product-step-quantity-rule"
          submitLabel="Save step rule"
          deleteIntent="delete-product-step-quantity-rule"
          rulesHeading="Configured step rules"
          emptyMessage="No per-product step quantity rules yet."
          isSubmitting={isSubmitting || productCatalogImportRequired}
          items={productStepItems}
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
            />
          </div>
          <label>
            Segment
            <select name="segment" defaultValue="">
              <option value="">All segments</option>
              <option value="B2B">B2B</option>
              <option value="B2C">B2C</option>
            </select>
          </label>
          <label>
            Step quantity
            <input name="stepQuantity" type="number" min={1} step={1} defaultValue={1} />
          </label>
        </CompactRulePanel>
      )}

      {isProductsSection && activeProductRuleView === "max-quantity" && (
        <CompactRulePanel
          heading="Max quantity"
          description="Set per-product order ceilings without leaving the product governance workspace."
          saveIntent="save-product-max-quantity-rule"
          submitLabel="Save maximum quantity rule"
          deleteIntent="delete-product-max-quantity-rule"
          rulesHeading="Configured max quantity rules"
          emptyMessage="No per-product max quantity rules yet."
          isSubmitting={isSubmitting || productCatalogImportRequired}
          items={productMaxItems}
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
            />
          </div>
          <label>
            Segment
            <select name="segment" defaultValue="">
              <option value="">All segments</option>
              <option value="B2B">B2B</option>
              <option value="B2C">B2C</option>
            </select>
          </label>
          <label>
            Maximum order quantity
            <input
              name="maxOrderQuantity"
              type="number"
              min={1}
              step={1}
              defaultValue={1}
            />
          </label>
        </CompactRulePanel>
      )}

      {isProductsSection && activeProductRuleView === "customer-overrides" && (
        <CompactRulePanel
          heading="Customer overrides"
          description="Keep customer-specific exceptions close to the product rule they override."
          saveIntent="save-product-customer-max-quantity-rule"
          submitLabel="Save customer override"
          deleteIntent="delete-product-customer-max-quantity-rule"
          rulesHeading="Configured customer overrides"
          emptyMessage="No customer max overrides yet."
          isSubmitting={isSubmitting || productCatalogImportRequired}
          items={productCustomerMaxItems}
        >
          <AdminCatalogPicker
            name="productId"
            label="Product"
            resourceType="product"
            required
          />
          <AdminCatalogPicker
            name="customerId"
            label="Customer"
            resourceType="customer"
            required
          />
          <label>
            Maximum order quantity
            <input
              name="maxOrderQuantity"
              type="number"
              min={1}
              step={1}
              defaultValue={1}
            />
          </label>
        </CompactRulePanel>
      )}

      {isProductsSection && activeProductRuleView === "product-visibility" && (
        <CompactRulePanel
          heading="Product visibility"
          description={
            <>
              Storefront enforcement uses <code>/apps/margin-guard/visibility-script</code> to
              hide restricted products before checkout.
            </>
          }
          saveIntent="save-product-visibility-rule"
          submitLabel="Save visibility rule"
          deleteIntent="delete-product-visibility-rule"
          rulesHeading="Configured product visibility"
          emptyMessage="No visibility rules yet."
          isSubmitting={isSubmitting || productCatalogImportRequired}
          items={productVisibilityItems}
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
            />
          </div>
          <label>
            Visibility mode
            <select name="visibilityMode" defaultValue="B2B_ONLY">
              <option value="B2B_ONLY">B2B only</option>
              <option value="B2C_ONLY">B2C only</option>
              <option value="CUSTOMER_ONLY">Specific customer only</option>
              <option value="ALL">Visible for all</option>
            </select>
          </label>
          <AdminCatalogPicker
            name="customerId"
            label="Customer"
            resourceType="customer"
          />
        </CompactRulePanel>
      )}

      {isProductsSection && activeProductRuleView === "variant-visibility" && (
        <CompactRulePanel
          heading="Variant visibility"
          description="Hide a specific variant for B2B, B2C, or a selected customer on the same product page."
          saveIntent="save-product-variant-visibility-rule"
          submitLabel="Save variant visibility"
          deleteIntent="delete-product-variant-visibility-rule"
          rulesHeading="Configured variant visibility"
          emptyMessage="No variant visibility rules yet."
          isSubmitting={isSubmitting || productCatalogImportRequired}
          items={productVariantVisibilityItems}
        >
          <AdminCatalogPicker
            name="productId"
            label="Product"
            resourceType="product"
            required
          />
          <AdminCatalogPicker
            name="variantId"
            label="Variant"
            resourceType="variant"
            required
          />
          <label>
            Visibility mode
            <select name="visibilityMode" defaultValue="B2B_ONLY">
              <option value="B2B_ONLY">B2B only</option>
              <option value="B2C_ONLY">B2C only</option>
              <option value="CUSTOMER_ONLY">Specific customer only</option>
              <option value="ALL">Visible for all</option>
            </select>
          </label>
          <AdminCatalogPicker
            name="customerId"
            label="Customer"
            resourceType="customer"
          />
        </CompactRulePanel>
      )}

      {isProductsSection && activeProductRuleView === "collection-visibility" && (
        <CompactRulePanel
          heading="Collection visibility"
          description="Keep collection access rules close to product governance so storefront catalog restrictions stay in one admin workspace."
          saveIntent="save-collection-visibility-rule"
          submitLabel="Save collection visibility"
          deleteIntent="delete-collection-visibility-rule"
          deleteFieldName="ruleId"
          rulesHeading="Configured collection visibility"
          emptyMessage="No collection visibility rules yet."
          isSubmitting={isSubmitting || collectionCatalogImportRequired}
          items={collectionVisibilityItems}
        >
          {collectionCatalogImportRequired ? (
            <div
              style={{
                gridColumn: "1 / -1",
                padding: "12px 14px",
                borderRadius: "12px",
                background: "rgba(255, 236, 213, 0.55)",
                border: "1px solid rgba(185, 92, 0, 0.14)",
                color: "#9a4600",
                fontSize: "13px",
                lineHeight: 1.5,
              }}
            >
              Collection visibility needs imported collections. Open Global Settings
              and run Import collections now first.
            </div>
          ) : null}
          <div style={{ gridColumn: "1 / -1" }}>
            <AdminCatalogPicker
              name="collectionId"
              label="Collection"
              resourceType="collection"
              required
            />
          </div>
          <label>
            Visibility mode
            <select name="visibilityMode" defaultValue="B2B_ONLY">
              <option value="B2B_ONLY">B2B only</option>
              <option value="B2C_ONLY">B2C only</option>
            </select>
          </label>
        </CompactRulePanel>
      )}

      {isCollectionsSection && (
        <CompactRulePanel
          heading="Collection maximum quantity"
          description="Collection-level ceilings stay isolated here, while product-specific overrides remain under Products."
          saveIntent="save-collection-max-quantity-rule"
          submitLabel="Save collection maximum quantity"
          deleteIntent="delete-collection-max-quantity-rule"
          rulesHeading="Configured collection max quantity"
          emptyMessage="No per-collection max quantity rules yet."
          isSubmitting={isSubmitting || collectionCatalogImportRequired}
          items={collectionMaxItems}
        >
          <div style={{ gridColumn: "1 / -1" }}>
            <AdminCatalogPicker
              name="collectionId"
              label="Collection"
              resourceType="collection"
              required
            />
          </div>
          <label>
            Segment
            <select name="segment" defaultValue="">
              <option value="">All segments</option>
              <option value="B2B">B2B</option>
              <option value="B2C">B2C</option>
            </select>
          </label>
          <label>
            Maximum order quantity
            <input
              name="maxOrderQuantity"
              type="number"
              min={1}
              step={1}
              defaultValue={1}
            />
          </label>
        </CompactRulePanel>
      )}

      <DiscountSettingsView
        isDiscountCouponsSection={isDiscountCouponsSection}
        isDiscountOrchestrationSection={isDiscountOrchestrationSection}
        couponSegmentRules={config.couponSegmentRules}
        advancedDiscountRules={advancedDiscountRules}
        discountBlacklistRules={discountBlacklistRules}
        discountSegmentCaps={discountSegmentCaps}
        discountConflicts={discountConflicts}
        isSubmitting={isSubmitting}
        openManualRuleForm={openManualRuleForm}
        setOpenManualRuleForm={setOpenManualRuleForm}
        openManualAddForm={openManualAddForm}
        openManualModifyForm={openManualModifyForm}
        describeProduct={describeProduct}
        describeCollection={describeCollection}
      />

      {isFunctionsSection && (
      <s-section heading="Live Shopify Function activation">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              Cart validation function is automatically synced on save and when
              this page opens.
            </s-paragraph>
            {autoActivationMessage && (
              <s-paragraph>Auto-sync info: {autoActivationMessage}</s-paragraph>
            )}
            {activation === "success" && (
              <s-paragraph>Activation status: SUCCESS. {message}</s-paragraph>
            )}
            {activation === "error" && (
              <s-paragraph>Activation status: ERROR. {message}</s-paragraph>
            )}
            <s-paragraph>
              Cart validation:{" "}
              <strong
                style={{
                  color:
                    config.cartValidationStatus === "ACTIVE"
                      ? "#0b6e4f"
                      : "#b42318",
                }}
              >
                {config.cartValidationStatus}
              </strong>
              {config.cartValidationLastSyncAt
                ? ` | last sync: ${new Date(config.cartValidationLastSyncAt).toLocaleString()}`
                : ""}
              {config.cartValidationLastError
                ? ` | last error: ${config.cartValidationLastError}`
                : ""}
            </s-paragraph>
            <s-paragraph>
              Discount function:{" "}
              <strong
                style={{
                  color:
                    discountFunctionStatus === "ACTIVE"
                      ? "#0b6e4f"
                      : discountFunctionStatus === "INACTIVE"
                        ? "#6941c6"
                        : "#b42318",
                }}
              >
                {discountFunctionStatus}
              </strong>
              {discountFunctionLastSyncAt
                ? ` | last sync: ${new Date(discountFunctionLastSyncAt).toLocaleString()}`
                : ` | ${discountFunctionMessage}`}
            </s-paragraph>
            {discountActionMessage && (
              <s-paragraph>{discountActionMessage}</s-paragraph>
            )}
          </s-stack>
        </s-box>
      </s-section>
      )}
      </div>
        </div>
      </div>
    </s-page>
  );
}
