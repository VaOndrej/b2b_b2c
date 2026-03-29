import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation, useSearchParams, useNavigate } from "react-router";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import {
  getStorefrontContentRules,
  upsertStorefrontContentRule,
  deleteStorefrontContentRule,
} from "../services/storefront-content.server";
import {
  countActiveCatalogProducts,
  countActiveCatalogCollections,
} from "../services/product-catalog.server";

type Section = "content-rules";

const SECTION_OPTIONS: { id: Section; label: string }[] = [
  { id: "content-rules", label: "Content Rules" },
];

const PAGE_TYPE_OPTIONS = [
  { value: "ALL", label: "All pages" },
  { value: "HOME", label: "Homepage" },
  { value: "PRODUCT", label: "Product page" },
  { value: "COLLECTION", label: "Collection page" },
  { value: "CART", label: "Cart" },
  { value: "PAGE", label: "Other pages" },
];

const TARGET_TYPE_OPTIONS = [
  { value: "CSS_SELECTOR", label: "CSS Selector" },
  { value: "SEMANTIC_POSITION", label: "Semantic Position" },
];

const SEMANTIC_POSITION_OPTIONS = [
  { value: "TOP_BANNER", label: "Top of page (after header)" },
  { value: "ABOVE_TITLE", label: "Above product title" },
  { value: "BELOW_TITLE", label: "Below product title" },
  { value: "ABOVE_ADD_TO_CART", label: "Above Add to Cart" },
  { value: "BELOW_ADD_TO_CART", label: "Below Add to Cart" },
  { value: "BOTTOM_BANNER", label: "Bottom of page (before footer)" },
];

const ACTION_OPTIONS = [
  { value: "SWAP_IMAGE", label: "Swap image" },
  { value: "SWAP_TEXT", label: "Swap text" },
  { value: "SWAP_HTML", label: "Swap HTML" },
  { value: "SWAP_HREF", label: "Swap link URL" },
  { value: "HIDE", label: "Hide element" },
  { value: "SHOW", label: "Show element" },
  { value: "ADD_CLASS", label: "Add CSS class" },
  { value: "REMOVE_CLASS", label: "Remove CSS class" },
];

const SEGMENT_OPTIONS = [
  { value: "B2B", label: "B2B" },
  { value: "B2C", label: "B2C" },
];

function parseString(input: FormDataEntryValue | null): string {
  return String(input ?? "").trim();
}

function parseNumber(input: FormDataEntryValue | null, fallback = 0): number {
  const value = Number(input);
  return Number.isFinite(value) ? value : fallback;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const [contentRules, catalogProductCount, catalogCollectionCount] = await Promise.all([
    getStorefrontContentRules(),
    countActiveCatalogProducts(),
    countActiveCatalogCollections(),
  ]);

  return { contentRules, catalogProductCount, catalogCollectionCount };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = parseString(formData.get("intent"));

  try {
    if (intent === "upsert-content-rule") {
      await upsertStorefrontContentRule({
        id: parseString(formData.get("ruleId")) || undefined,
        name: parseString(formData.get("name")),
        active: parseString(formData.get("active")) !== "false",
        priority: parseNumber(formData.get("priority"), 100),
        segment: parseString(formData.get("segment")),
        pageType: parseString(formData.get("pageType")) || "ALL",
        productId: parseString(formData.get("productId")) || null,
        collectionId: parseString(formData.get("collectionId")) || null,
        targetType: parseString(formData.get("targetType")),
        targetSelector: parseString(formData.get("targetSelector")) || null,
        targetPosition: parseString(formData.get("targetPosition")) || null,
        action: parseString(formData.get("action")),
        value: parseString(formData.get("value")) || null,
        valueCsLocale: parseString(formData.get("valueCsLocale")) || null,
      });
      return { ok: true, message: "Content rule saved." };
    }

    if (intent === "delete-content-rule") {
      const id = parseString(formData.get("ruleId"));
      if (id) {
        await deleteStorefrontContentRule(id);
      }
      return { ok: true, message: "Content rule deleted." };
    }

    return { ok: false, message: `Unknown intent: ${intent}` };
  } catch (error: any) {
    return { ok: false, message: error?.message ?? "An error occurred." };
  }
};

function ContentRuleForm({
  rule,
  isSubmitting,
  onCancel,
}: {
  rule?: any;
  isSubmitting: boolean;
  onCancel: () => void;
}) {
  const [targetType, setTargetType] = useState(
    rule?.targetType ?? "CSS_SELECTOR",
  );
  const [action, setAction] = useState(rule?.action ?? "SWAP_IMAGE");
  const needsValue = !["HIDE", "SHOW"].includes(action);

  return (
    <form method="post" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <input type="hidden" name="intent" value="upsert-content-rule" />
      {rule?.id && <input type="hidden" name="ruleId" value={rule.id} />}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <label style={labelStyle}>
          Name *
          <input
            name="name"
            defaultValue={rule?.name ?? ""}
            required
            style={inputStyle}
            placeholder="e.g. Homepage banner for B2B"
          />
        </label>
        <label style={labelStyle}>
          Segment *
          <select name="segment" defaultValue={rule?.segment ?? "B2B"} style={inputStyle}>
            {SEGMENT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
        <label style={labelStyle}>
          Page type
          <select name="pageType" defaultValue={rule?.pageType ?? "ALL"} style={inputStyle}>
            {PAGE_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Priority
          <input
            name="priority"
            type="number"
            defaultValue={rule?.priority ?? 100}
            style={inputStyle}
          />
        </label>
        <label style={labelStyle}>
          Active
          <select name="active" defaultValue={rule?.active !== false ? "true" : "false"} style={inputStyle}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <label style={labelStyle}>
          Target type *
          <select
            name="targetType"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            style={inputStyle}
          >
            {TARGET_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        {targetType === "CSS_SELECTOR" ? (
          <label style={labelStyle}>
            CSS Selector *
            <input
              name="targetSelector"
              defaultValue={rule?.targetSelector ?? ""}
              style={inputStyle}
              placeholder=".hero-banner img"
            />
          </label>
        ) : (
          <label style={labelStyle}>
            Semantic position *
            <select
              name="targetPosition"
              defaultValue={rule?.targetPosition ?? "TOP_BANNER"}
              style={inputStyle}
            >
              {SEMANTIC_POSITION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
        <label style={labelStyle}>
          Action *
          <select
            name="action"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            style={inputStyle}
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </label>
        <label style={labelStyle}>
          Product ID (optional)
          <input
            name="productId"
            defaultValue={rule?.productId ?? ""}
            style={inputStyle}
            placeholder="gid://shopify/Product/..."
          />
        </label>
      </div>

      {needsValue && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
          <label style={labelStyle}>
            Value (EN)
            <textarea
              name="value"
              defaultValue={rule?.value ?? ""}
              style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
              placeholder={action === "SWAP_IMAGE" ? "https://cdn.shopify.com/..." : "Content..."}
            />
          </label>
          <label style={labelStyle}>
            Value (CS) - optional
            <textarea
              name="valueCsLocale"
              defaultValue={rule?.valueCsLocale ?? ""}
              style={{ ...inputStyle, minHeight: "60px", resize: "vertical" }}
              placeholder="Czech translation..."
            />
          </label>
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={secondaryButtonStyle}>
          Cancel
        </button>
        <button type="submit" disabled={isSubmitting} style={primaryButtonStyle}>
          {isSubmitting ? "Saving..." : "Save rule"}
        </button>
      </div>
    </form>
  );
}


const labelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  fontSize: "13px",
  fontWeight: 500,
  color: "#1a1a1a",
};

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 400,
  width: "100%",
  boxSizing: "border-box",
};

const primaryButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#07213a",
  color: "#fff",
  border: "none",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  background: "#f1f2f4",
  color: "#1a1a1a",
  border: "1px solid #c9cccf",
  borderRadius: "6px",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
};

const dangerButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "#fff",
  color: "#d72c0d",
  border: "1px solid #d72c0d",
  borderRadius: "6px",
  fontSize: "12px",
  fontWeight: 500,
  cursor: "pointer",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e1e3e5",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "12px",
};

export default function StorefrontUxRoute() {
  const { contentRules, catalogProductCount, catalogCollectionCount } =
    useLoaderData<typeof loader>();
  const catalogImportRequired = catalogProductCount === 0 && catalogCollectionCount === 0;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const requestedSection = String(searchParams.get("section") ?? "").trim();
  const showLegacyCollectionVisibilityNotice =
    requestedSection === "collection-visibility";
  const activeSection: Section = "content-rules";
  const [showContentForm, setShowContentForm] = useState(false);
  const [editingContentRule, setEditingContentRule] = useState<any>(null);

  function handleSectionSelect(section: Section) {
    navigate(`/app/storefront-ux?section=${section}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <s-page heading="Storefront UX">
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", width: "100%" }}>
        {/* Sidebar */}
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
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", paddingTop: "6px" }}>
            {SECTION_OPTIONS.map((section) => (
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
                  padding: "6px 12px",
                  textAlign: "left",
                  fontSize: "13px",
                  fontWeight: section.id === activeSection ? 600 : 400,
                  transition: "all 0.15s ease",
                }}
              >
                {section.label}
              </button>
            ))}
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {catalogImportRequired && (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: "14px",
                border: "1px solid rgba(183, 121, 0, 0.25)",
                background: "rgba(255, 236, 213, 0.5)",
                color: "#7a4f01",
                fontSize: "14px",
                lineHeight: 1.5,
                marginBottom: "16px",
              }}
            >
              <strong>Product catalog not imported.</strong> Collection pickers
              and content rules require imported products and collections. Go to{" "}
              <a
                href="/app/settings?area=global&section=global"
                style={{
                  color: "#005bd3",
                  fontWeight: 600,
                  textDecoration: "underline",
                }}
              >
                Settings &rarr; Global Settings
              </a>{" "}
              and run a Shopify catalog import first.
            </div>
          )}
          {showLegacyCollectionVisibilityNotice && (
            <div
              style={{
                padding: "14px 16px",
                borderRadius: "14px",
                border: "1px solid rgba(10, 132, 255, 0.18)",
                background: "rgba(10, 132, 255, 0.06)",
                color: "#0b4f8a",
                fontSize: "14px",
                lineHeight: 1.5,
                marginBottom: "16px",
              }}
            >
              Collection visibility moved into{" "}
              <a
                href="/app/settings?area=catalog-rules&section=products&view=collection-visibility"
                style={{
                  color: "#005bd3",
                  fontWeight: 600,
                  textDecoration: "underline",
                }}
              >
                Catalog Rules &rarr; Products &rarr; Collection visibility
              </a>
              , so Storefront UX stays focused on content and messaging.
            </div>
          )}
          {!catalogImportRequired && activeSection === "content-rules" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 600 }}>Content Rules</h2>
                  <p style={{ margin: "4px 0 0", fontSize: "13px", color: "#6d7175" }}>
                    Dynamically modify storefront content based on customer segment (B2B/B2C).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingContentRule(null);
                    setShowContentForm(true);
                  }}
                  style={primaryButtonStyle}
                >
                  + Add rule
                </button>
              </div>

              {showContentForm && (
                <div style={{ ...cardStyle, borderColor: "#07213a" }}>
                  <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 600 }}>
                    {editingContentRule ? "Edit rule" : "New content rule"}
                  </h3>
                  <ContentRuleForm
                    rule={editingContentRule}
                    isSubmitting={isSubmitting}
                    onCancel={() => {
                      setShowContentForm(false);
                      setEditingContentRule(null);
                    }}
                  />
                </div>
              )}

              {(contentRules as any[]).length === 0 && !showContentForm ? (
                <div style={{ ...cardStyle, textAlign: "center", color: "#6d7175", padding: "40px" }}>
                  No content rules yet. Click "+ Add rule" to create one.
                </div>
              ) : (
                (contentRules as any[]).map((rule: any) => (
                  <div key={rule.id} style={cardStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <strong style={{ fontSize: "14px" }}>{rule.name}</strong>
                          <span
                            style={{
                              fontSize: "11px",
                              padding: "2px 8px",
                              borderRadius: "10px",
                              background: rule.segment === "B2B" ? "#e0f0ff" : "#ffecd5",
                              color: rule.segment === "B2B" ? "#005bd3" : "#b95c00",
                              fontWeight: 600,
                            }}
                          >
                            {rule.segment}
                          </span>
                          <span
                            style={{
                              fontSize: "11px",
                              padding: "2px 8px",
                              borderRadius: "10px",
                              background: rule.active ? "#e3f5e1" : "#f1f2f4",
                              color: rule.active ? "#23802a" : "#6d7175",
                              fontWeight: 500,
                            }}
                          >
                            {rule.active ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <div style={{ fontSize: "12px", color: "#6d7175", marginTop: "4px" }}>
                          {rule.targetType === "CSS_SELECTOR"
                            ? `Selector: ${rule.targetSelector}`
                            : `Position: ${rule.targetPosition}`}
                          {" | "}Action: {rule.action}
                          {" | "}Page: {rule.pageType}
                          {" | "}Priority: {rule.priority}
                        </div>
                        {rule.value && (
                          <div style={{ fontSize: "12px", color: "#8c9196", marginTop: "2px", maxWidth: "500px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            Value: {rule.value}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingContentRule(rule);
                            setShowContentForm(true);
                          }}
                          style={secondaryButtonStyle}
                        >
                          Edit
                        </button>
                        <form method="post" style={{ margin: 0 }}>
                          <input type="hidden" name="intent" value="delete-content-rule" />
                          <input type="hidden" name="ruleId" value={rule.id} />
                          <button type="submit" style={dangerButtonStyle} disabled={isSubmitting}>
                            Delete
                          </button>
                        </form>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </s-page>
  );
}
