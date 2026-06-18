import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import {
  getOrCreateMarginGuardConfig,
  listMarginViolationLogs,
} from "../services/margin-guard-config.server";
import { ensureCartValidationActive } from "../services/cart-validation-activation.server";
import { reconcileDiscountFunctionStatus } from "../services/discount-function-activation.server";
import {
  countActiveCatalogCollections,
  countActiveCatalogProducts,
} from "../services/product-catalog.server";
import { loadAllCatalogsForConfig } from "../services/price-catalog.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  await ensureCartValidationActive(admin);
  const [
    discountFunction,
    config,
    logs,
    catalogProductCount,
    catalogCollectionCount,
    allCatalogs,
  ] = await Promise.all([
    reconcileDiscountFunctionStatus(admin),
    getOrCreateMarginGuardConfig(),
    listMarginViolationLogs(10),
    countActiveCatalogProducts(),
    countActiveCatalogCollections(),
    loadAllCatalogsForConfig().catch(() => []),
  ]);
  const last24hCount = logs.filter((item: { createdAt: Date }) => {
    const createdAt = new Date(item.createdAt).getTime();
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return createdAt >= oneDayAgo;
  }).length;

  // MVP_5_3 #2.3c — dashboard rule counts come from catalog tables, not the
  // legacy MarginGuardConfig children.
  const sum = (pick: (catalog: (typeof allCatalogs)[number]) => number) =>
    allCatalogs.reduce((total, catalog) => total + pick(catalog), 0);
  const catalogStats = {
    catalogCount: allCatalogs.length,
    floorRuleCount: sum(
      (c) => (c.perProductFloors?.length ?? 0) + (c.perVariantFloors?.length ?? 0),
    ),
    tierRuleCount: sum((c) => c.tierPrices?.length ?? 0),
    quantityRuleCount: sum((c) => c.quantityRules?.length ?? 0),
    discountRuleCount: sum((c) => c.discountRules?.length ?? 0),
    couponRuleCount: sum((c) => c.coupons?.length ?? 0),
  };

  return {
    config,
    recentViolationCount: logs.length,
    last24hViolationCount: last24hCount,
    discountFunction,
    catalogProductCount,
    catalogCollectionCount,
    catalogStats,
  };
};

export default function AppDashboardRoute() {
  const {
    config,
    recentViolationCount,
    last24hViolationCount,
    discountFunction,
    catalogProductCount,
    catalogCollectionCount,
    catalogStats,
  } =
    useLoaderData<typeof loader>();
  const cartValidationActive = config.cartValidationStatus === "ACTIVE";
  const productCatalogImportRequired = catalogProductCount === 0;
  const collectionCatalogImportRequired = catalogCollectionCount === 0;
  const catalogImportRequired =
    productCatalogImportRequired || collectionCatalogImportRequired;
  const missingCatalogLabel =
    productCatalogImportRequired && collectionCatalogImportRequired
      ? "products and collections"
      : productCatalogImportRequired
        ? "products"
        : "collections";

  return (
    <s-page heading="Margin Guard Dashboard">
      {catalogImportRequired && (
        <s-section>
          <div
            role="status"
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
            <strong>Catalog import required.</strong> No {missingCatalogLabel} are
            imported yet, so rule search and product/collection pickers stay empty.
            Open{" "}
            <a
              href="/app/settings/global?section=global"
              style={{ color: "#005bd3", fontWeight: 600 }}
            >
              Global Settings
            </a>{" "}
            and run the catalog import first.
          </div>
        </s-section>
      )}
      <s-section heading="Governance status">
        <s-box padding="base" borderWidth="base" borderRadius="base">
          <s-stack direction="block" gap="small">
            <s-paragraph>
              B2B segment tag: <strong>{config.b2bTag}</strong>
            </s-paragraph>
            <s-paragraph>
              Global floor:{" "}
              <strong>{config.globalMinPricePercent}%</strong> of effective base
              price
            </s-paragraph>
            <s-paragraph>
              Discount stacking:{" "}
              <strong>
                {config.allowStacking ? "allowed" : "single-discount only"}
              </strong>
            </s-paragraph>
            <s-paragraph>
              Active price catalogs: <strong>{catalogStats.catalogCount}</strong>
            </s-paragraph>
            <s-paragraph>
              Catalog floor rules (product + variant):{" "}
              <strong>{catalogStats.floorRuleCount}</strong>
            </s-paragraph>
            <s-paragraph>
              Catalog tier pricing rules:{" "}
              <strong>{catalogStats.tierRuleCount}</strong>
            </s-paragraph>
            <s-paragraph>
              Catalog quantity rules (MOQ/step/max):{" "}
              <strong>{catalogStats.quantityRuleCount}</strong>
            </s-paragraph>
            <s-paragraph>
              Catalog discount rules: <strong>{catalogStats.discountRuleCount}</strong>
            </s-paragraph>
            <s-paragraph>
              Catalog coupon rules: <strong>{catalogStats.couponRuleCount}</strong>
            </s-paragraph>
            <s-paragraph>
              Cart validation function:{" "}
              <strong
                style={{ color: cartValidationActive ? "#0b6e4f" : "#b42318" }}
              >
                {config.cartValidationStatus}
              </strong>
              {config.cartValidationLastSyncAt
                ? ` (last sync ${new Date(config.cartValidationLastSyncAt).toLocaleString()})`
                : ""}
            </s-paragraph>
            <s-paragraph>
              Discount function:{" "}
              <strong
                style={{
                  color:
                    discountFunction.status === "ACTIVE"
                      ? "#0b6e4f"
                      : discountFunction.status === "INACTIVE"
                        ? "#6941c6"
                        : "#b42318",
                }}
              >
                {discountFunction.status}
              </strong>
              {discountFunction.lastSyncAt
                ? ` (last sync ${new Date(discountFunction.lastSyncAt).toLocaleString()})`
                : ` (${discountFunction.message})`}
            </s-paragraph>
            <s-paragraph>
              Violations: <strong>{recentViolationCount}</strong> recent /{" "}
              <strong>{last24hViolationCount}</strong> in last 24h
            </s-paragraph>
          </s-stack>
        </s-box>
      </s-section>
    </s-page>
  );
}
