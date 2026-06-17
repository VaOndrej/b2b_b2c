// MVP_5_1 (hybrid menu / MVP_4_5 tie-in, readme.txt:126): the cross-cutting
// per-product view. Given one product, this reusable panel surfaces EVERY rule
// that targets it across all modules (margin floor, B2B/tier pricing, quantity
// MOQ / step / max, customer overrides, product + variant visibility, and
// product-scoped discount orchestration) in a single read-only summary. It reads
// the same MarginGuardConfig the per-module workspaces edit, so it never drifts
// from the source of truth.

import { makeCatalogDescribers, type CatalogDescribeMap } from "./catalog-describers";

function asCatalogMap(value: unknown): CatalogDescribeMap {
  return (value ?? {}) as CatalogDescribeMap;
}

function formatSegment(segment: string | null | undefined): string {
  return String(segment ?? "").trim() || "ALL";
}

function formatVisibilityMode(mode: string | null | undefined): string {
  if (mode === "B2B_ONLY") {
    return "visible only for B2B";
  }
  if (mode === "B2C_ONLY") {
    return "visible only for B2C";
  }
  if (mode === "CUSTOMER_ONLY") {
    return "visible only for the selected customer";
  }
  return "visible for all";
}

interface RuleGroup {
  key: string;
  title: string;
  module: string;
  details: string[];
}

export interface ProductRulesPanelProps {
  config: any;
  productId: string;
  catalogProductsById: unknown;
  catalogVariantsById: unknown;
  catalogCollectionsById: unknown;
}

export function ProductRulesPanel({
  config,
  productId,
  catalogProductsById,
  catalogVariantsById,
  catalogCollectionsById,
}: ProductRulesPanelProps) {
  const { describeProduct, describeVariant } = makeCatalogDescribers({
    products: asCatalogMap(catalogProductsById),
    variants: asCatalogMap(catalogVariantsById),
    collections: asCatalogMap(catalogCollectionsById),
  });

  const normalized = String(productId ?? "").trim();
  const matches = (value: unknown) => String(value ?? "").trim() === normalized;

  const productQuantityRules = Array.isArray(config.productQuantityRules)
    ? config.productQuantityRules
    : [];
  const productCustomerQuantityRules = Array.isArray(config.productCustomerQuantityRules)
    ? config.productCustomerQuantityRules
    : [];
  const productVariantVisibilityRules = Array.isArray(
    (config as any).productVariantVisibilityRules,
  )
    ? (config as any).productVariantVisibilityRules
    : [];
  const discountRules = Array.isArray((config as any).discountRules)
    ? (config as any).discountRules
    : [];

  const groups: RuleGroup[] = [
    {
      key: "floor",
      title: "Margin floor",
      module: "Margin Guard",
      details: config.productFloors
        .filter((rule: any) => matches(rule.productId))
        .map(
          (rule: any) =>
            `${formatSegment(rule.segment)} floor at ${rule.minPercentOfBasePrice}%${
              rule.b2bOverridePrice == null
                ? ""
                : `, B2B base override ${rule.b2bOverridePrice}`
            }`,
        ),
    },
    {
      key: "tier",
      title: "Tier pricing",
      module: "B2B Pricing",
      details: config.productTierPrices
        .filter((rule: any) => matches(rule.productId))
        .map(
          (rule: any) =>
            `${formatSegment(rule.segment)} from qty ${rule.minQuantity} at unit price ${rule.unitPrice}`,
        ),
    },
    {
      key: "moq",
      title: "Minimum order quantity",
      module: "Quantity Rules",
      details: productQuantityRules
        .filter((rule: any) => matches(rule.productId) && Number(rule.minimumOrderQuantity) > 1)
        .map(
          (rule: any) =>
            `MOQ ${rule.minimumOrderQuantity} for ${formatSegment(rule.segment)}`,
        ),
    },
    {
      key: "step",
      title: "Step quantity",
      module: "Quantity Rules",
      details: productQuantityRules
        .filter((rule: any) => matches(rule.productId) && Number(rule.stepQuantity ?? 0) > 1)
        .map(
          (rule: any) =>
            `step ${rule.stepQuantity} for ${formatSegment(rule.segment)}`,
        ),
    },
    {
      key: "max",
      title: "Maximum order quantity",
      module: "Quantity Rules",
      details: productQuantityRules
        .filter((rule: any) => matches(rule.productId) && Number(rule.maxOrderQuantity ?? 0) > 0)
        .map(
          (rule: any) =>
            `max ${rule.maxOrderQuantity} for ${formatSegment(rule.segment)}`,
        ),
    },
    {
      key: "customer-max",
      title: "Customer max overrides",
      module: "Quantity Rules",
      details: productCustomerQuantityRules
        .filter((rule: any) => matches(rule.productId) && Number(rule.maxOrderQuantity ?? 0) > 0)
        .map(
          (rule: any) =>
            `max ${rule.maxOrderQuantity} for customer ${rule.customerId}`,
        ),
    },
    {
      key: "product-visibility",
      title: "Product visibility",
      module: "Segmented Storefront",
      details: config.productVisibilityRules
        .filter((rule: any) => matches(rule.productId))
        .map(
          (rule: any) =>
            `${formatVisibilityMode(rule.visibilityMode)}${rule.customerId ? ` (customer ${rule.customerId})` : ""}`,
        ),
    },
    {
      key: "variant-visibility",
      title: "Variant visibility",
      module: "Segmented Storefront",
      details: productVariantVisibilityRules
        .filter((rule: any) => matches(rule.productId))
        .map(
          (rule: any) =>
            `${describeVariant(rule.variantId)}: ${formatVisibilityMode(rule.visibilityMode)}${rule.customerId ? ` (customer ${rule.customerId})` : ""}`,
        ),
    },
    {
      key: "discount",
      title: "Discount orchestration",
      module: "Margin Guard",
      details: discountRules
        .filter(
          (rule: any) =>
            String(rule.scope ?? "") === "PRODUCT" && matches(rule.targetId),
        )
        .map(
          (rule: any) =>
            `${rule.percentOff}% off for ${formatSegment(rule.segment)}, priority ${rule.priority}, ${String(rule.stackMode ?? "").toLowerCase()}`,
        ),
    },
  ];

  const populatedGroups = groups.filter((group) => group.details.length > 0);
  const totalRules = populatedGroups.reduce(
    (sum, group) => sum + group.details.length,
    0,
  );

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid rgba(7, 33, 58, 0.10)",
        borderRadius: "18px",
        padding: "20px",
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
          marginBottom: "6px",
        }}
      >
        Rules across all modules
      </div>
      <div
        style={{
          fontSize: "20px",
          fontWeight: 700,
          color: "#07213a",
          marginBottom: "16px",
        }}
      >
        {describeProduct(normalized)}
      </div>

      {totalRules === 0 ? (
        <div style={{ color: "#51606f", fontSize: "14px", lineHeight: 1.5 }}>
          No rules are configured for this product yet. Add floor, pricing,
          quantity, or visibility rules from the Catalog Rules workspace.
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "14px",
          }}
        >
          {populatedGroups.map((group) => (
            <div
              key={group.key}
              style={{
                border: "1px solid rgba(7, 33, 58, 0.08)",
                borderRadius: "14px",
                padding: "16px",
                background: "#fbfcfd",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: "8px",
                  marginBottom: "10px",
                }}
              >
                <div style={{ fontSize: "15px", fontWeight: 700, color: "#07213a" }}>
                  {group.title}
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    color: "#667085",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  {group.module}
                </div>
              </div>
              <ul style={{ margin: 0, paddingLeft: "18px", color: "#475467", lineHeight: 1.6 }}>
                {group.details.map((detail, index) => (
                  <li key={`${group.key}-${index}`}>{detail}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
