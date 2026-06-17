import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useState } from "react";
import {
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
  useSearchParams,
} from "react-router";
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
import { GlobalSettingsView } from "../components/global-settings-view";
import {
  CatalogRulesView,
  PRODUCT_RULE_VIEWS,
  type ProductRuleView,
} from "../components/catalog-rules-view";
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

// PRODUCT_RULE_VIEWS + ProductRuleView are owned by the shared CatalogRulesView
// module (move-not-copy); the monolith imports them so the sidebar sub-navigation
// and the extracted catalog-rules workspace stay in lockstep.

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
  // Per-product / collection rule arrays + item builders + the "Products affected"
  // summary now live in the shared CatalogRulesView module (move-not-copy).
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

  const { describeProduct, describeCollection } =
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
      {isGlobalSection && (
        <GlobalSettingsView
          config={config}
          catalogProductCount={catalogProductCount}
          catalogCollectionCount={catalogCollectionCount}
          isSubmitting={isSubmitting}
        />
      )}

      {/* MVP_5_1 (move-not-copy): the per-product / collection catalog rule panels
          and the "Products affected" summary render from the shared CatalogRulesView,
          identical to the standalone app.settings.catalog-rules route. The sidebar
          owns sub-navigation in this all-in-one workspace, so showProductViewNav stays
          false here. These sections are mutually exclusive with the global section
          above, so rendering after it does not change behavior. */}
      <CatalogRulesView
        config={config}
        catalogProductsById={catalogProductsById}
        catalogVariantsById={catalogVariantsById}
        catalogCollectionsById={catalogCollectionsById}
        isSubmitting={isSubmitting}
        productCatalogImportRequired={productCatalogImportRequired}
        collectionCatalogImportRequired={collectionCatalogImportRequired}
        isProductsSection={isProductsSection}
        isCollectionsSection={isCollectionsSection}
        isDiscountOrchestrationSection={isDiscountOrchestrationSection}
        advancedDiscountRules={advancedDiscountRules}
        activeProductRuleView={activeProductRuleView}
      />

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
