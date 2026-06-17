// MVP_5_1 (move-not-copy): Catalog Rules is the third module pulled out of the
// app.settings.tsx monolith into a shared, props-driven view. It owns the
// per-product governance panels (floor / tier / MOQ / step / max / customer
// overrides / product + variant visibility), collection-level rules
// (collection visibility under product governance, collection maximum quantity),
// the "Products affected in this section" summary, and an optional compact
// product-rule-view sub-navigation. The standalone app.settings.catalog-rules
// route and the legacy all-in-one settings workspace both render this single
// implementation, so there is zero duplication.

import type { ReactNode } from "react";
import { AdminCatalogPicker } from "./admin-catalog-picker";
import type { CatalogRuleItem } from "./compact-rule-panel";
import { CompactRulePanel } from "./compact-rule-panel";
import {
  makeCatalogDescribers,
  type CatalogDescribeMap,
} from "./catalog-describers";

export const PRODUCT_RULE_VIEWS = [
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

export type ProductRuleView = (typeof PRODUCT_RULE_VIEWS)[number]["id"];

function asCatalogMap(value: unknown): CatalogDescribeMap {
  return (value ?? {}) as CatalogDescribeMap;
}

export interface CatalogRulesViewProps {
  config: any;
  catalogProductsById: unknown;
  catalogVariantsById: unknown;
  catalogCollectionsById: unknown;
  isSubmitting: boolean;
  productCatalogImportRequired: boolean;
  collectionCatalogImportRequired: boolean;
  isProductsSection: boolean;
  isCollectionsSection: boolean;
  /**
   * The discount-orchestration "Products affected" summary shares the same panel
   * as the products section in the legacy all-in-one workspace. Standalone
   * Catalog Rules leaves this false.
   */
  isDiscountOrchestrationSection?: boolean;
  advancedDiscountRules?: any[];
  activeProductRuleView: ProductRuleView;
  /** Render the compact product-rule sub-navigation (standalone route uses this). */
  showProductViewNav?: boolean;
  onSelectProductView?: (view: ProductRuleView) => void;
}

export function CatalogRulesView({
  config,
  catalogProductsById,
  catalogVariantsById,
  catalogCollectionsById,
  isSubmitting,
  productCatalogImportRequired,
  collectionCatalogImportRequired,
  isProductsSection,
  isCollectionsSection,
  isDiscountOrchestrationSection = false,
  advancedDiscountRules = [],
  activeProductRuleView,
  showProductViewNav = false,
  onSelectProductView,
}: CatalogRulesViewProps) {
  const { describeProduct, describeVariant, describeCollection } =
    makeCatalogDescribers({
      products: asCatalogMap(catalogProductsById),
      variants: asCatalogMap(catalogVariantsById),
      collections: asCatalogMap(catalogCollectionsById),
    });

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

  return (
    <>
      {showProductViewNav && isProductsSection && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            padding: "4px 0 2px 0",
          }}
        >
          {PRODUCT_RULE_VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              onClick={() => onSelectProductView?.(view.id)}
              style={{
                background:
                  activeProductRuleView === view.id
                    ? "rgba(7, 33, 58, 0.06)"
                    : "transparent",
                border: "1px solid rgba(7, 33, 58, 0.10)",
                borderRadius: "999px",
                color:
                  activeProductRuleView === view.id ? "#07213a" : "#667085",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: activeProductRuleView === view.id ? 700 : 500,
                padding: "6px 12px",
              }}
            >
              {view.label}
            </button>
          ))}
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
    </>
  );
}
