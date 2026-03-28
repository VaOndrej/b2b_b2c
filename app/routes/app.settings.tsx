import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useNavigation, useSearchParams } from "react-router";
import { AdminCatalogPicker } from "../components/admin-catalog-picker";
import { authenticate } from "../shopify.server";
import { ensureCartValidationActive } from "../services/cart-validation-activation.server";
import {
  deactivateDiscountFunction,
  reconcileDiscountFunctionStatus,
} from "../services/discount-function-activation.server";
import {
  deleteCollectionMaximumQuantityRule,
  deleteCouponSegmentRule,
  deleteDiscountCombinationBlacklistRule,
  deleteDiscountRule,
  deleteDiscountSegmentCap,
  deleteProductCustomerMaximumQuantityRule,
  deleteProductFloorRule,
  deleteProductMaximumQuantityRule,
  deleteProductQuantityRule,
  deleteProductStepQuantityRule,
  deleteProductVisibilityRule,
  deleteProductVariantVisibilityRule,
  deleteProductTierPriceRule,
  getOrCreateMarginGuardConfig,
  upsertCollectionMaximumQuantityRule,
  upsertCouponSegmentRule,
  upsertDiscountCombinationBlacklistRule,
  upsertDiscountRule,
  upsertDiscountSegmentCap,
  upsertProductCustomerMaximumQuantityRule,
  upsertProductFloorRule,
  upsertProductMaximumQuantityRule,
  upsertProductQuantityRule,
  upsertProductStepQuantityRule,
  upsertProductVisibilityRule,
  upsertProductVariantVisibilityRule,
  upsertProductTierPriceRule,
  updateGlobalMarginGuardConfig,
} from "../services/margin-guard-config.server";

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
    description: "Per-product floors, tier pricing, and product-level overrides.",
  },
  {
    id: "collections",
    label: "Collections",
    description: "Collection quantity governance and collection-specific rules.",
  },
  {
    id: "quantity",
    label: "Quantity",
    description: "MOQ, step quantity, and maximum quantity controls.",
  },
  {
    id: "visibility",
    label: "Visibility",
    description: "Product and variant storefront visibility by segment or customer.",
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  let config = await getOrCreateMarginGuardConfig();
  let autoActivationMessage: string | null = null;
  let discountFunctionStatus: "ACTIVE" | "INACTIVE" | "ERROR" = "ERROR";
  let discountFunctionMessage = "Discount status is unknown.";
  let discountFunctionLastSyncAt: string | Date | null = null;
  const syncActivation = await ensureCartValidationActive(admin);
  autoActivationMessage = syncActivation.message;
  config = await getOrCreateMarginGuardConfig();
  const discountStatus = await reconcileDiscountFunctionStatus(admin);
  discountFunctionStatus = discountStatus.status;
  discountFunctionMessage = discountStatus.message;
  discountFunctionLastSyncAt = discountStatus.lastSyncAt ?? null;
  const url = new URL(request.url);
  const activation = url.searchParams.get("activation");
  const message = url.searchParams.get("message");
  const discountActionMessage = url.searchParams.get("discountActionMessage");
  return {
    config,
    activation,
    message,
    discountActionMessage,
    autoActivationMessage,
    discountFunctionStatus,
    discountFunctionMessage,
    discountFunctionLastSyncAt,
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
    const allowStacking = formData.get("allowStacking") === "on";
    const maxCombinedRaw = String(formData.get("maxCombinedPercentOff") ?? "").trim();
    const maxCombinedPercentOff = maxCombinedRaw ? Number(maxCombinedRaw) : null;

    await updateGlobalMarginGuardConfig({
      b2bTag,
      globalMinPricePercent,
      b2bGlobalMinPricePercent,
      allowZeroFinalPrice,
      allowRemoveAtMinimumOrderQuantity,
      allowStacking,
      maxCombinedPercentOff:
        maxCombinedPercentOff != null && Number.isFinite(maxCombinedPercentOff)
          ? maxCombinedPercentOff
          : null,
    });
  }

  if (intent === "save-product-floor") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const allowZeroOverrideRaw = String(
      formData.get("allowZeroFinalPriceOverride") ?? "inherit",
    ).trim();
    const b2bOverrideRaw = String(formData.get("b2bOverridePrice") ?? "").trim();
    const minPercentOfBasePrice = parseNumber(
      formData.get("minPercentOfBasePrice"),
      70,
    );
    const b2bOverridePrice = b2bOverrideRaw ? Number(b2bOverrideRaw) : null;

    if (productId) {
      await upsertProductFloorRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        minPercentOfBasePrice,
        allowZeroFinalPrice:
          allowZeroOverrideRaw === "allow"
            ? true
            : allowZeroOverrideRaw === "deny"
              ? false
              : null,
        b2bOverridePrice:
          b2bOverridePrice != null &&
          Number.isFinite(b2bOverridePrice) &&
          b2bOverridePrice >= 0
            ? b2bOverridePrice
            : null,
      });
    }
  }

  if (intent === "delete-product-floor") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductFloorRule(id);
    }
  }

  if (intent === "save-product-tier-price") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const minQuantity = Math.max(1, Math.floor(parseNumber(formData.get("minQuantity"), 1)));
    const unitPrice = parseNumber(formData.get("unitPrice"), NaN);

    if (productId && Number.isFinite(unitPrice) && unitPrice >= 0) {
      await upsertProductTierPriceRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        minQuantity,
        unitPrice,
      });
    }
  }

  if (intent === "delete-product-tier-price") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductTierPriceRule(id);
    }
  }

  if (intent === "save-product-quantity-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const minimumOrderQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("minimumOrderQuantity"), 1)),
    );

    if (productId) {
      await upsertProductQuantityRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        minimumOrderQuantity,
      });
    }
  }

  if (intent === "delete-product-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductQuantityRule(id);
    }
  }

  if (intent === "save-product-step-quantity-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const stepQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("stepQuantity"), 1)),
    );

    if (productId) {
      await upsertProductStepQuantityRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        stepQuantity,
      });
    }
  }

  if (intent === "delete-product-step-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductStepQuantityRule(id);
    }
  }

  if (intent === "save-product-max-quantity-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const maxOrderQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("maxOrderQuantity"), 1)),
    );

    if (productId) {
      await upsertProductMaximumQuantityRule({
        productId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        maxOrderQuantity,
      });
    }
  }

  if (intent === "delete-product-max-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductMaximumQuantityRule(id);
    }
  }

  if (intent === "save-collection-max-quantity-rule") {
    const collectionId = String(formData.get("collectionId") ?? "").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const maxOrderQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("maxOrderQuantity"), 1)),
    );

    if (collectionId) {
      await upsertCollectionMaximumQuantityRule({
        collectionId,
        segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
        maxOrderQuantity,
      });
    }
  }

  if (intent === "delete-collection-max-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteCollectionMaximumQuantityRule(id);
    }
  }

  if (intent === "save-product-customer-max-quantity-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const customerId = String(formData.get("customerId") ?? "").trim();
    const maxOrderQuantity = Math.max(
      1,
      Math.floor(parseNumber(formData.get("maxOrderQuantity"), 1)),
    );
    if (productId && customerId) {
      await upsertProductCustomerMaximumQuantityRule({
        productId,
        customerId,
        maxOrderQuantity,
      });
    }
  }

  if (intent === "delete-product-customer-max-quantity-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductCustomerMaximumQuantityRule(id);
    }
  }

  if (intent === "save-product-visibility-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const visibilityModeRaw = String(formData.get("visibilityMode") ?? "ALL").trim();
    const customerId = String(formData.get("customerId") ?? "").trim();

    if (productId) {
      await upsertProductVisibilityRule({
        productId,
        visibilityMode:
          visibilityModeRaw === "B2B_ONLY" ||
          visibilityModeRaw === "B2C_ONLY" ||
          visibilityModeRaw === "CUSTOMER_ONLY"
            ? visibilityModeRaw
            : "ALL",
        customerId,
      });
    }
  }

  if (intent === "delete-product-visibility-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductVisibilityRule(id);
    }
  }

  if (intent === "save-product-variant-visibility-rule") {
    const productId = String(formData.get("productId") ?? "").trim();
    const variantId = String(formData.get("variantId") ?? "").trim();
    const visibilityModeRaw = String(formData.get("visibilityMode") ?? "ALL").trim();
    const customerId = String(formData.get("customerId") ?? "").trim();

    if (productId && variantId) {
      await upsertProductVariantVisibilityRule({
        productId,
        variantId,
        visibilityMode:
          visibilityModeRaw === "B2B_ONLY" ||
          visibilityModeRaw === "B2C_ONLY" ||
          visibilityModeRaw === "CUSTOMER_ONLY"
            ? visibilityModeRaw
            : "ALL",
        customerId,
      });
    }
  }

  if (intent === "delete-product-variant-visibility-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteProductVariantVisibilityRule(id);
    }
  }

  if (intent === "save-coupon-segment-rule") {
    const code = String(formData.get("code") ?? "").trim();
    const allowedSegmentRaw = String(formData.get("allowedSegment") ?? "ALL").trim();
    if (code) {
      await upsertCouponSegmentRule({
        code,
        allowedSegment:
          allowedSegmentRaw === "B2B" || allowedSegmentRaw === "B2C"
            ? allowedSegmentRaw
            : "ALL",
      });
    }
  }

  if (intent === "delete-coupon-segment-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteCouponSegmentRule(id);
    }
  }

  if (intent === "save-discount-rule") {
    const scopeRaw = String(formData.get("scope") ?? "GLOBAL").trim();
    const segmentRaw = String(formData.get("segment") ?? "").trim();
    const targetId =
      scopeRaw === "PRODUCT"
        ? String(formData.get("productId") ?? "").trim()
        : scopeRaw === "COLLECTION"
          ? String(formData.get("collectionId") ?? "").trim()
          : undefined;
    const code = String(formData.get("code") ?? "").trim();
    const percentOff = parseNumber(formData.get("percentOff"), NaN);
    const priority = Math.floor(parseNumber(formData.get("priority"), 100));
    const minPricePercentOfBasePriceRaw = String(
      formData.get("minPricePercentOfBasePrice") ?? "",
    ).trim();
    const minPricePercentOfBasePrice = minPricePercentOfBasePriceRaw
      ? Number(minPricePercentOfBasePriceRaw)
      : null;
    await upsertDiscountRule({
      scope:
        scopeRaw === "COLLECTION" ||
        scopeRaw === "PRODUCT" ||
        scopeRaw === "COUPON"
          ? scopeRaw
          : "GLOBAL",
      targetId,
      code,
      segment: segmentRaw === "B2B" || segmentRaw === "B2C" ? segmentRaw : undefined,
      percentOff,
      priority,
      stackMode:
        String(formData.get("stackMode") ?? "STACKABLE").trim() === "EXCLUSIVE"
          ? "EXCLUSIVE"
          : String(formData.get("stackMode") ?? "STACKABLE").trim() ===
              "NEVER_WITH_COUPONS"
            ? "NEVER_WITH_COUPONS"
            : "STACKABLE",
      minPricePercentOfBasePrice:
        minPricePercentOfBasePrice != null &&
        Number.isFinite(minPricePercentOfBasePrice)
          ? minPricePercentOfBasePrice
          : null,
    });
  }

  if (intent === "delete-discount-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteDiscountRule(id);
    }
  }

  if (intent === "save-discount-blacklist-rule") {
    await upsertDiscountCombinationBlacklistRule({
      leftType:
        String(formData.get("leftType") ?? "COUPON_CODE").trim() === "RULE_ID"
          ? "RULE_ID"
          : String(formData.get("leftType") ?? "COUPON_CODE").trim() === "SCOPE"
            ? "SCOPE"
            : "COUPON_CODE",
      leftValue: String(formData.get("leftValue") ?? "").trim(),
      rightType:
        String(formData.get("rightType") ?? "COUPON_CODE").trim() === "RULE_ID"
          ? "RULE_ID"
          : String(formData.get("rightType") ?? "COUPON_CODE").trim() === "SCOPE"
            ? "SCOPE"
            : "COUPON_CODE",
      rightValue: String(formData.get("rightValue") ?? "").trim(),
      segment:
        String(formData.get("segment") ?? "").trim() === "B2B"
          ? "B2B"
          : String(formData.get("segment") ?? "").trim() === "B2C"
            ? "B2C"
            : "ALL",
    });
  }

  if (intent === "delete-discount-blacklist-rule") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteDiscountCombinationBlacklistRule(id);
    }
  }

  if (intent === "save-discount-segment-cap") {
    await upsertDiscountSegmentCap({
      segment:
        String(formData.get("segment") ?? "").trim() === "B2B"
          ? "B2B"
          : String(formData.get("segment") ?? "").trim() === "B2C"
            ? "B2C"
            : "ALL",
      maxCombinedPercentOff: parseNumber(
        formData.get("maxCombinedPercentOff"),
        NaN,
      ),
    });
  }

  if (intent === "delete-discount-segment-cap") {
    const id = String(formData.get("id") ?? "");
    if (id) {
      await deleteDiscountSegmentCap(id);
    }
  }

  if (intent === "deactivate-discount-function") {
    const result = await deactivateDiscountFunction(admin);
    const url = new URL(request.url);
    url.searchParams.set("discountActionMessage", result.message);
    return Response.redirect(url.toString(), 302);
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
    activation,
    message,
    discountActionMessage,
    autoActivationMessage,
    discountFunctionStatus,
    discountFunctionMessage,
    discountFunctionLastSyncAt,
  } =
    useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeSection = normalizeSettingsSection(searchParams.get("section"));
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
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
  const isQuantitySection = activeSection === "quantity";
  const isVisibilitySection = activeSection === "visibility";
  const isDiscountCouponsSection = activeSection === "discount-coupons";
  const isDiscountOrchestrationSection = activeSection === "discount-orchestration";
  const isFunctionsSection = activeSection === "functions";
  const activeSectionOption =
    SETTINGS_SECTION_OPTIONS.find((section) => section.id === activeSection) ??
    SETTINGS_SECTION_OPTIONS[0];
  function handleSectionSelect(section: SettingsSection) {
    navigate(`/app/settings?section=${section}`, {
      preventScrollReset: true,
    });
  }

  return (
    <s-page heading="Margin Guard Settings">
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "12px",
          width: "100%",
        }}
      >
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
            {SETTINGS_SECTION_OPTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => handleSectionSelect(section.id)}
                style={{
                  background: "transparent",
                  border: "none",
                  borderLeft:
                    section.id === activeSection
                      ? "3px solid #07213a"
                      : "3px solid transparent",
                  color: section.id === activeSection ? "#07213a" : "#51606f",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: section.id === activeSection ? 700 : 500,
                  padding: "10px 8px 10px 12px",
                  textAlign: "left",
                }}
              >
                {section.label}
              </button>
            ))}
          </div>
        </div>
        <div
          style={{
            minWidth: 0,
            flex: 1,
            width: "calc(100% - 196px)",
          }}
        >
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
          Settings workspace
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
          {activeSectionOption.label}
        </div>
        <div
          style={{
            fontSize: "14px",
            color: "#51606f",
            maxWidth: "760px",
            lineHeight: 1.5,
          }}
        >
          {activeSectionOption.description}
        </div>
      </div>
      {isGlobalSection && (
      <s-section heading="Global configuration">
        <form method="post">
          <input type="hidden" name="intent" value="save-global" />
          <s-stack direction="block" gap="base">
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

      {isProductsSection && (
      <>
      <s-section heading="Per-product floor rules">
        <form method="post">
          <input type="hidden" name="intent" value="save-product-floor" />
          <s-stack direction="block" gap="base">
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
            />
            <label>
              Segment (optional)
              <select name="segment" defaultValue="">
                <option value="">All segments</option>
                <option value="B2B">B2B</option>
                <option value="B2C">B2C</option>
              </select>
            </label>
            <label>
              Allow zero final price override
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
              B2B override base price (optional)
              <input
                name="b2bOverridePrice"
                type="number"
                min={0}
                step="0.01"
                placeholder="e.g. 499.00"
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save product floor
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured product floors</s-heading>
          {config.productFloors.length === 0 ? (
            <s-paragraph>No per-product floor rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {config.productFloors.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | {rule.segment ?? "ALL"} | {rule.minPercentOfBasePrice}% |
                    zero-final:{" "}
                    {rule.allowZeroFinalPrice == null
                      ? "inherit"
                      : rule.allowZeroFinalPrice
                        ? "allow"
                        : "deny"}{" "}
                    | b2b-base-override:{" "}
                    {rule.b2bOverridePrice == null ? "none" : rule.b2bOverridePrice}
                  </s-text>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-product-floor" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Per-product tier pricing rules">
        <form method="post">
          <input type="hidden" name="intent" value="save-product-tier-price" />
          <s-stack direction="block" gap="base">
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
            />
            <label>
              Segment (optional)
              <select name="segment" defaultValue="">
                <option value="">All segments</option>
                <option value="B2B">B2B</option>
                <option value="B2C">B2C</option>
              </select>
            </label>
            <label>
              Minimum quantity (tier starts at)
              <input
                name="minQuantity"
                type="number"
                min={1}
                step={1}
                defaultValue={1}
              />
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
            <button type="submit" disabled={isSubmitting}>
              Save tier pricing rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured tier pricing rules</s-heading>
          {config.productTierPrices.length === 0 ? (
            <s-paragraph>No per-product tier pricing rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {config.productTierPrices.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | {rule.segment ?? "ALL"} | qty {rule.minQuantity}
                    + | unit price: {rule.unitPrice}
                  </s-text>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-product-tier-price" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>
      </>
      )}

      {isQuantitySection && (
      <>
      <s-section heading="Per-product MOQ rules">
        <form method="post">
          <input type="hidden" name="intent" value="save-product-quantity-rule" />
          <s-stack direction="block" gap="base">
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
            />
            <label>
              Segment (optional)
              <select name="segment" defaultValue="">
                <option value="">All segments</option>
                <option value="B2B">B2B</option>
                <option value="B2C">B2C</option>
              </select>
            </label>
            <label>
              Minimum order quantity (MOQ)
              <input
                name="minimumOrderQuantity"
                type="number"
                min={1}
                step={1}
                defaultValue={1}
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save MOQ rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured MOQ rules</s-heading>
          {productMoqRules.length === 0 ? (
            <s-paragraph>No per-product MOQ rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {productMoqRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | {rule.segment ?? "ALL"} | MOQ {rule.minimumOrderQuantity}
                  </s-text>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-product-quantity-rule" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Per-product step quantity rules">
        <form method="post">
          <input type="hidden" name="intent" value="save-product-step-quantity-rule" />
          <s-stack direction="block" gap="base">
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
            />
            <label>
              Segment (optional)
              <select name="segment" defaultValue="">
                <option value="">All segments</option>
                <option value="B2B">B2B</option>
                <option value="B2C">B2C</option>
              </select>
            </label>
            <label>
              Step quantity (carton multiple)
              <input
                name="stepQuantity"
                type="number"
                min={1}
                step={1}
                defaultValue={1}
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save step rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured step rules</s-heading>
          {productStepRules.length === 0 ? (
            <s-paragraph>No per-product step quantity rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {productStepRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | {rule.segment ?? "ALL"} | step {rule.stepQuantity}
                  </s-text>
                  <form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="delete-product-step-quantity-rule"
                    />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Per-product maximum quantity rules">
        <form method="post">
          <input type="hidden" name="intent" value="save-product-max-quantity-rule" />
          <s-stack direction="block" gap="base">
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
            />
            <label>
              Segment (optional)
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
            <button type="submit" disabled={isSubmitting}>
              Save maximum quantity rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured max quantity rules</s-heading>
          {productMaxRules.length === 0 ? (
            <s-paragraph>No per-product max quantity rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {productMaxRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | {rule.segment ?? "ALL"} | max {rule.maxOrderQuantity}
                  </s-text>
                  <form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="delete-product-max-quantity-rule"
                    />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>
      </>
      )}

      {isCollectionsSection && (
      <s-section heading="Per-collection maximum quantity rules">
        <form method="post">
          <input
            type="hidden"
            name="intent"
            value="save-collection-max-quantity-rule"
          />
          <s-stack direction="block" gap="base">
            <AdminCatalogPicker
              name="collectionId"
              label="Collection"
              resourceType="collection"
              required
            />
            <label>
              Segment (optional)
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
            <button type="submit" disabled={isSubmitting}>
              Save collection maximum quantity rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured collection max quantity rules</s-heading>
          {collectionMaxRules.length === 0 ? (
            <s-paragraph>No per-collection max quantity rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {collectionMaxRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.collectionId} | {rule.segment ?? "ALL"} | max {rule.maxOrderQuantity}
                  </s-text>
                  <form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="delete-collection-max-quantity-rule"
                    />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>
      )}

      {isProductsSection && (
      <s-section heading="Per-customer max quantity overrides">
        <form method="post">
          <input
            type="hidden"
            name="intent"
            value="save-product-customer-max-quantity-rule"
          />
          <s-stack direction="block" gap="base">
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
              Maximum order quantity for this customer
              <input
                name="maxOrderQuantity"
                type="number"
                min={1}
                step={1}
                defaultValue={1}
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save customer max override
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured customer max overrides</s-heading>
          {productCustomerMaxRules.length === 0 ? (
            <s-paragraph>No customer max overrides yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {productCustomerMaxRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | customer {rule.customerId} | max {rule.maxOrderQuantity}
                  </s-text>
                  <form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="delete-product-customer-max-quantity-rule"
                    />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>
      )}

      {isVisibilitySection && (
      <>
      <s-section heading="Basic product visibility rules">
        <s-paragraph>
          Storefront enforcement: include
          {" "}
          <code>/apps/margin-guard/visibility-script</code>
          {" "}
          in your theme to hide restricted products before checkout.
        </s-paragraph>
        <form method="post">
          <input type="hidden" name="intent" value="save-product-visibility-rule" />
          <s-stack direction="block" gap="base">
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
            />
            <label>
              Visibility mode
              <select name="visibilityMode" defaultValue="B2B_ONLY">
                <option value="B2B_ONLY">B2B only</option>
                <option value="B2C_ONLY">B2C only</option>
                <option value="CUSTOMER_ONLY">Specific customer only</option>
                <option value="ALL">Visible for all (removes rule)</option>
              </select>
            </label>
            <AdminCatalogPicker
              name="customerId"
              label="Customer (only for specific customer mode)"
              resourceType="customer"
            />
            <button type="submit" disabled={isSubmitting}>
              Save visibility rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured visibility rules</s-heading>
          {config.productVisibilityRules.length === 0 ? (
            <s-paragraph>No visibility rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {config.productVisibilityRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | {rule.visibilityMode}
                    {rule.customerId ? ` | customer: ${rule.customerId}` : ""}
                  </s-text>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-product-visibility-rule" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Per-variant visibility rules">
        <s-paragraph>
          Hide a specific variant for B2B, B2C, or a selected customer. This is useful
          for unit-vs-carton variants on the same product page.
        </s-paragraph>
        <form method="post">
          <input
            type="hidden"
            name="intent"
            value="save-product-variant-visibility-rule"
          />
          <s-stack direction="block" gap="base">
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
                <option value="ALL">Visible for all (removes rule)</option>
              </select>
            </label>
            <AdminCatalogPicker
              name="customerId"
              label="Customer (only for specific customer mode)"
              resourceType="customer"
            />
            <button type="submit" disabled={isSubmitting}>
              Save variant visibility rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured variant visibility rules</s-heading>
          {productVariantVisibilityRules.length === 0 ? (
            <s-paragraph>No variant visibility rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {productVariantVisibilityRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.productId} | variant {rule.variantId} | {rule.visibilityMode}
                    {rule.customerId ? ` | customer: ${rule.customerId}` : ""}
                  </s-text>
                  <form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="delete-product-variant-visibility-rule"
                    />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>
      </>
      )}

      {isDiscountCouponsSection && (
      <s-section heading="Coupon segment validation rules">
        <form method="post">
          <input type="hidden" name="intent" value="save-coupon-segment-rule" />
          <s-stack direction="block" gap="base">
            <label>
              Coupon code
              <input name="code" required placeholder="VIP20" />
            </label>
            <label>
              Allowed segment
              <select name="allowedSegment" defaultValue="ALL">
                <option value="ALL">All segments</option>
                <option value="B2B">B2B only</option>
                <option value="B2C">B2C only</option>
              </select>
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save coupon rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured coupon rules</s-heading>
          {config.couponSegmentRules.length === 0 ? (
            <s-paragraph>No coupon segment rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {config.couponSegmentRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.code} | allowed: {rule.allowedSegment}
                  </s-text>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-coupon-segment-rule" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>
      )}

      {isDiscountOrchestrationSection && (
      <>
      <s-section heading="Advanced discount orchestration rules">
        <form method="post">
          <input type="hidden" name="intent" value="save-discount-rule" />
          <s-stack direction="block" gap="base">
            <label>
              Scope
              <select name="scope" defaultValue="GLOBAL">
                <option value="GLOBAL">Global</option>
                <option value="COLLECTION">Collection</option>
                <option value="PRODUCT">Product</option>
                <option value="COUPON">Coupon</option>
              </select>
            </label>
            <AdminCatalogPicker
              name="productId"
              label="Product (for product scope)"
              resourceType="product"
            />
            <AdminCatalogPicker
              name="collectionId"
              label="Collection (for collection scope)"
              resourceType="collection"
            />
            <label>
              Coupon code (for coupon scope)
              <input name="code" placeholder="VIP20" />
            </label>
            <label>
              Segment (optional)
              <select name="segment" defaultValue="">
                <option value="">All segments</option>
                <option value="B2B">B2B</option>
                <option value="B2C">B2C</option>
              </select>
            </label>
            <label>
              Percent off
              <input
                name="percentOff"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={10}
                required
              />
            </label>
            <label>
              Priority
              <input name="priority" type="number" step={1} defaultValue={100} />
            </label>
            <label>
              Stack mode
              <select name="stackMode" defaultValue="STACKABLE">
                <option value="STACKABLE">Stackable</option>
                <option value="EXCLUSIVE">Exclusive</option>
                <option value="NEVER_WITH_COUPONS">Never with coupons</option>
              </select>
            </label>
            <label>
              Minimum price percent of base price (optional)
              <input
                name="minPricePercentOfBasePrice"
                type="number"
                min={0}
                max={100}
                step="0.01"
                placeholder="e.g. 75"
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save advanced discount rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured advanced discount rules</s-heading>
          {advancedDiscountRules.length === 0 ? (
            <s-paragraph>No advanced discount rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {advancedDiscountRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.scope}
                    {rule.targetId ? ` | ${rule.targetId}` : ""}
                    {rule.code ? ` | ${rule.code}` : ""}
                    {" | "}
                    {rule.segment ?? "ALL"} | {rule.percentOff}% | priority {rule.priority}
                    {" | "}
                    {rule.stackMode}
                    {" | "}
                    min-price:{" "}
                    {rule.minPricePercentOfBasePrice == null
                      ? "inherit"
                      : `${rule.minPricePercentOfBasePrice}%`}
                  </s-text>
                  <form method="post">
                    <input type="hidden" name="intent" value="delete-discount-rule" />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Discount blacklist combinations">
        <form method="post">
          <input type="hidden" name="intent" value="save-discount-blacklist-rule" />
          <s-stack direction="block" gap="base">
            <label>
              Left type
              <select name="leftType" defaultValue="COUPON_CODE">
                <option value="COUPON_CODE">Coupon code</option>
                <option value="SCOPE">Rule scope</option>
                <option value="RULE_ID">Rule ID</option>
              </select>
            </label>
            <label>
              Left value
              <input name="leftValue" placeholder="VIP20 or GLOBAL" required />
            </label>
            <label>
              Right type
              <select name="rightType" defaultValue="COUPON_CODE">
                <option value="COUPON_CODE">Coupon code</option>
                <option value="SCOPE">Rule scope</option>
                <option value="RULE_ID">Rule ID</option>
              </select>
            </label>
            <label>
              Right value
              <input name="rightValue" placeholder="SPRING10 or COLLECTION" required />
            </label>
            <label>
              Segment
              <select name="segment" defaultValue="ALL">
                <option value="ALL">All segments</option>
                <option value="B2B">B2B only</option>
                <option value="B2C">B2C only</option>
              </select>
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save blacklist rule
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured blacklist rules</s-heading>
          {discountBlacklistRules.length === 0 ? (
            <s-paragraph>No blacklist rules yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {discountBlacklistRules.map((rule: any) => (
                <s-stack key={rule.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {rule.leftType}:{rule.leftValue} x {rule.rightType}:{rule.rightValue} |{" "}
                    {rule.segment ?? "ALL"}
                  </s-text>
                  <form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="delete-discount-blacklist-rule"
                    />
                    <input type="hidden" name="id" value={rule.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>

      <s-section heading="Per-segment discount caps">
        <form method="post">
          <input type="hidden" name="intent" value="save-discount-segment-cap" />
          <s-stack direction="block" gap="base">
            <label>
              Segment
              <select name="segment" defaultValue="ALL">
                <option value="ALL">All segments</option>
                <option value="B2B">B2B only</option>
                <option value="B2C">B2C only</option>
              </select>
            </label>
            <label>
              Max combined discount percent
              <input
                name="maxCombinedPercentOff"
                type="number"
                min={0}
                max={100}
                step="0.01"
                defaultValue={40}
                required
              />
            </label>
            <button type="submit" disabled={isSubmitting}>
              Save segment cap
            </button>
          </s-stack>
        </form>

        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-heading>Configured segment caps</s-heading>
          {discountSegmentCaps.length === 0 ? (
            <s-paragraph>No segment caps yet.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {discountSegmentCaps.map((cap: any) => (
                <s-stack key={cap.id} direction="inline" gap="base" alignItems="center">
                  <s-text>
                    {cap.segment} | max combined {cap.maxCombinedPercentOff}%
                  </s-text>
                  <form method="post">
                    <input
                      type="hidden"
                      name="intent"
                      value="delete-discount-segment-cap"
                    />
                    <input type="hidden" name="id" value={cap.id} />
                    <button type="submit" disabled={isSubmitting}>
                      Delete
                    </button>
                  </form>
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-box>
      </s-section>
      </>
      )}

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
