import type { LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { loadMarginGuardSettingsView } from "../services/margin-guard-settings-view.server";
import { AdminCatalogPicker } from "../components/admin-catalog-picker";
import { ProductRulesPanel } from "../components/product-rules-panel";

// MVP_5_1 (hybrid menu, readme.txt:126): the cross-cutting per-product view. The
// module workspaces (Catalog Rules / Discounts / Global) each edit one slice of
// configuration; this page flips the axis and shows every rule that targets a
// single product across all modules at once. It is read-only — the "Manage in
// Catalog Rules" link sends the merchant to the editing workspace.

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const settingsView = await loadMarginGuardSettingsView();
  const url = new URL(request.url);
  const selectedProductId = String(url.searchParams.get("productId") ?? "").trim();

  return {
    config: settingsView.config,
    catalogProductsById: settingsView.catalogProductsById,
    catalogVariantsById: settingsView.catalogVariantsById,
    catalogCollectionsById: settingsView.catalogCollectionsById,
    selectedProductId,
  };
};

export default function ProductRulesRoute() {
  const {
    config,
    catalogProductsById,
    catalogVariantsById,
    catalogCollectionsById,
    selectedProductId,
  } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Product Rules">
      <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        <style>{`
          .product-rules-picker form {
            display: flex;
            flex-direction: column;
            gap: 12px;
            background: linear-gradient(180deg, #ffffff 0%, #fbfcfd 100%);
            border: 1px solid rgba(7, 33, 58, 0.10);
            border-radius: 18px;
            padding: 22px;
            box-shadow: 0 1px 2px rgba(7, 33, 58, 0.04);
          }
          .product-rules-picker form input[type="search"] {
            border: 1px solid #d0d5dd;
            border-radius: 10px;
            background: #ffffff;
            color: #101828;
            font-size: 14px;
            min-height: 40px;
            padding: 8px 12px;
            box-sizing: border-box;
            width: 100%;
          }
          .product-rules-picker form label {
            display: flex;
            flex-direction: column;
            gap: 6px;
            font-size: 13px;
            font-weight: 600;
            color: #344054;
          }
          .product-rules-picker form button {
            border: 1px solid #07213a;
            border-radius: 10px;
            background: #07213a;
            color: #ffffff;
            min-height: 38px;
            padding: 0 14px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            align-self: flex-start;
          }
        `}</style>

        <div
          style={{
            fontSize: "14px",
            color: "#51606f",
            maxWidth: "760px",
            lineHeight: 1.5,
          }}
        >
          Pick a product to see every rule that applies to it across Margin Guard,
          B2B Pricing, Quantity Rules, and Segmented Storefront — in one place. Use
          the Catalog Rules workspace to add or change these rules.
        </div>

        <div className="product-rules-picker">
          <Form method="get">
            <AdminCatalogPicker
              name="productId"
              label="Product"
              resourceType="product"
              required
              initialValue={selectedProductId || undefined}
            />
            <button type="submit">View rules</button>
          </Form>
        </div>

        {selectedProductId ? (
          <ProductRulesPanel
            config={config}
            productId={selectedProductId}
            catalogProductsById={catalogProductsById}
            catalogVariantsById={catalogVariantsById}
            catalogCollectionsById={catalogCollectionsById}
          />
        ) : (
          <div
            style={{
              padding: "16px",
              borderRadius: "14px",
              border: "1px dashed rgba(7, 33, 58, 0.16)",
              color: "#51606f",
              fontSize: "14px",
            }}
          >
            Select a product above to view its cross-module rule summary.
          </div>
        )}
      </div>
    </s-page>
  );
}
