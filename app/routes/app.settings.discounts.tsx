import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { loadMarginGuardSettingsView } from "../services/margin-guard-settings-view.server";
import {
  handleDiscountSettingsAction,
} from "../services/discount-settings.server";
import { ensureCartValidationActive } from "../services/cart-validation-activation.server";
import {
  buildDiscountConflictReport,
  type DiscountConflictView,
} from "../services/discount-conflict.server";
import { makeCatalogDescribers } from "../components/catalog-describers";
import { useManualRuleForm } from "../components/use-manual-rule-form";
import { DiscountSettingsView } from "../components/discount-settings-view";
import { storefrontProjection } from "../../config/feature-flags.ts";

// MVP_5_1 (move-not-copy): Discounts is the second module pulled out of the
// app.settings.tsx monolith into a standalone route. It shares the action
// handlers (discount-settings.server) and the UI (DiscountSettingsView) with the
// legacy all-in-one workspace, so there is a single implementation. The module
// page shows both discount sections (coupon eligibility + orchestration) plus the
// automatic-discount/floor conflict banner.

function asCatalogMap(
  value: unknown,
): Record<string, { title: string; handle: string | null }> {
  return (value ?? {}) as Record<string, { title: string; handle: string | null }>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const settingsView = await loadMarginGuardSettingsView();

  let discountConflicts: DiscountConflictView[] = [];
  let automaticDiscountCount = 0;
  try {
    const report = await buildDiscountConflictReport(admin);
    discountConflicts = report.conflicts;
    automaticDiscountCount = report.automaticDiscountCount;
  } catch (error) {
    if (storefrontProjection.debug) {
      console.error("[discounts route] discount conflict report failed:", error);
    }
  }

  return {
    config: settingsView.config,
    catalogProductsById: settingsView.catalogProductsById,
    catalogVariantsById: settingsView.catalogVariantsById,
    catalogCollectionsById: settingsView.catalogCollectionsById,
    discountConflicts,
    automaticDiscountCount,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const handled = await handleDiscountSettingsAction(formData);
  if (handled) {
    await ensureCartValidationActive(admin);
  }
  return null;
};

export default function DiscountSettingsRoute() {
  const {
    config,
    catalogProductsById,
    catalogVariantsById,
    catalogCollectionsById,
    discountConflicts,
  } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const {
    openManualRuleForm,
    setOpenManualRuleForm,
    openManualAddForm,
    openManualModifyForm,
  } = useManualRuleForm();
  const { describeProduct, describeCollection } = makeCatalogDescribers({
    products: asCatalogMap(catalogProductsById),
    variants: asCatalogMap(catalogVariantsById),
    collections: asCatalogMap(catalogCollectionsById),
  });

  const couponSegmentRules = Array.isArray((config as any).couponSegmentRules)
    ? (config as any).couponSegmentRules
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

  return (
    <s-page heading="Discounts">
      <DiscountSettingsView
        isDiscountCouponsSection
        isDiscountOrchestrationSection
        couponSegmentRules={couponSegmentRules}
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
    </s-page>
  );
}
