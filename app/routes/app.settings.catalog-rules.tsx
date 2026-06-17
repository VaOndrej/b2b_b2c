import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useNavigation, useSearchParams } from "react-router";
import { authenticate } from "../shopify.server";
import { loadMarginGuardSettingsView } from "../services/margin-guard-settings-view.server";
import {
  countActiveCatalogCollections,
  countActiveCatalogProducts,
} from "../services/product-catalog.server";
import { handleCatalogRulesSettingsAction } from "../services/catalog-rules-settings.server";
import { ensureCartValidationActive } from "../services/cart-validation-activation.server";
import { syncStorefrontProjectionMetafields } from "../services/storefront-projection.server";
import {
  CatalogRulesView,
  PRODUCT_RULE_VIEWS,
  type ProductRuleView,
} from "../components/catalog-rules-view";

// MVP_5_1 (move-not-copy): Catalog Rules is the third module pulled out of the
// app.settings.tsx monolith into a standalone route. It shares the action
// handlers (catalog-rules-settings.server) and the UI (CatalogRulesView) with the
// legacy all-in-one workspace, so there is a single implementation. The module
// page exposes the per-product governance sub-navigation (floor / tier / MOQ /
// step / max / customer overrides / product + variant + collection visibility)
// plus the collection maximum-quantity rules.

type CatalogRulesSection = "products" | "collections";

function normalizeCatalogRulesSection(value: string | null): CatalogRulesSection {
  return value === "collections" ? "collections" : "products";
}

function normalizeProductRuleView(value: string | null): ProductRuleView {
  if (value && PRODUCT_RULE_VIEWS.some((view) => view.id === value)) {
    return value as ProductRuleView;
  }
  return "floor-rules";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const settingsView = await loadMarginGuardSettingsView();
  const catalogProductCount = await countActiveCatalogProducts();
  const catalogCollectionCount = await countActiveCatalogCollections();

  return {
    config: settingsView.config,
    catalogProductsById: settingsView.catalogProductsById,
    catalogVariantsById: settingsView.catalogVariantsById,
    catalogCollectionsById: settingsView.catalogCollectionsById,
    catalogProductCount,
    catalogCollectionCount,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  await handleCatalogRulesSettingsAction({ admin, formData });

  // Shared storefront-projection tail — kept byte-for-byte in step with the
  // monolith's projected-intent list (floor/tier/customer-max are not projected).
  if (
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

  // Shared cart-validation activation tail — mirrors the monolith's catalog
  // intent list (collection-visibility writes do not toggle cart validation).
  if (
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
    intent === "delete-product-variant-visibility-rule"
  ) {
    await ensureCartValidationActive(admin);
  }

  return null;
};

export default function CatalogRulesRoute() {
  const {
    config,
    catalogProductsById,
    catalogVariantsById,
    catalogCollectionsById,
    catalogProductCount,
    catalogCollectionCount,
  } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const isSubmitting = navigation.state === "submitting";

  const activeSection = normalizeCatalogRulesSection(searchParams.get("section"));
  const activeProductRuleView = normalizeProductRuleView(searchParams.get("view"));
  const isProductsSection = activeSection === "products";
  const isCollectionsSection = activeSection === "collections";

  const productCatalogImportRequired = catalogProductCount === 0;
  const collectionCatalogImportRequired = catalogCollectionCount === 0;
  const isCollectionContext =
    isCollectionsSection ||
    (isProductsSection && activeProductRuleView === "collection-visibility");
  const importBannerReason = isCollectionContext
    ? collectionCatalogImportRequired
      ? "Collection catalog is not imported yet. Open Global Settings and run Import collections now."
      : null
    : productCatalogImportRequired
      ? "Product catalog is not imported yet. Open Global Settings and run Import products now."
      : null;

  function selectSection(section: CatalogRulesSection) {
    const params = new URLSearchParams();
    params.set("section", section);
    if (section === "products") {
      params.set("view", "floor-rules");
    }
    navigate(`/app/settings/catalog-rules?${params.toString()}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function selectProductView(view: ProductRuleView) {
    const params = new URLSearchParams();
    params.set("section", "products");
    params.set("view", view);
    navigate(`/app/settings/catalog-rules?${params.toString()}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const SECTION_TABS: Array<{ id: CatalogRulesSection; label: string }> = [
    { id: "products", label: "Products" },
    { id: "collections", label: "Collections" },
  ];

  return (
    <s-page heading="Catalog Rules">
      <div
        className="catalog-rules-workspace"
        style={{ display: "flex", flexDirection: "column", gap: "18px" }}
      >
        <style>{`
          .catalog-rules-workspace > s-section {
            display: block;
            margin: 0;
          }

          .catalog-rules-workspace > s-section > form {
            display: block;
            background: linear-gradient(180deg, #ffffff 0%, #fbfcfd 100%);
            border: 1px solid rgba(7, 33, 58, 0.10);
            border-radius: 18px;
            padding: 22px;
            box-shadow: 0 1px 2px rgba(7, 33, 58, 0.04);
            margin-bottom: 14px;
          }

          .catalog-rules-workspace form label {
            display: flex;
            flex-direction: column;
            gap: 6px;
            font-size: 13px;
            font-weight: 600;
            color: #344054;
          }

          .catalog-rules-workspace form input,
          .catalog-rules-workspace form select,
          .catalog-rules-workspace form textarea {
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

          .catalog-rules-workspace form button {
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
        `}</style>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {SECTION_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => selectSection(tab.id)}
              style={{
                background:
                  activeSection === tab.id ? "#07213a" : "transparent",
                border: "1px solid rgba(7, 33, 58, 0.16)",
                borderRadius: "999px",
                color: activeSection === tab.id ? "#ffffff" : "#51606f",
                cursor: "pointer",
                fontSize: "13px",
                fontWeight: activeSection === tab.id ? 700 : 500,
                padding: "8px 16px",
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {importBannerReason && (
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
            <strong>Catalog import required.</strong> {importBannerReason} Go to{" "}
            <a
              href="/app/settings/global"
              style={{ color: "#005bd3", fontWeight: 600 }}
            >
              Global Settings
            </a>{" "}
            and continue there.
          </div>
        )}

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
          activeProductRuleView={activeProductRuleView}
          showProductViewNav
          onSelectProductView={selectProductView}
        />
      </div>
    </s-page>
  );
}
