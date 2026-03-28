import type { ReactNode } from "react";
import { AdminCatalogPicker } from "./admin-catalog-picker";
import type { CatalogResourceType } from "./admin-catalog-picker.shared";

export interface CatalogRuleItem {
  id: string;
  label: string;
  badges?: Array<{
    text: string;
    variant?: "info" | "warning" | "success" | "neutral";
  }>;
  detail?: string;
}

export interface CatalogRuleSectionProps {
  heading: string;
  description?: string;
  resourceType: CatalogResourceType;
  pickerLabel: string;
  pickerName: string;
  saveIntent: string;
  deleteIntent: string;
  submitLabel: string;
  emptyMessage: string;
  rulesHeading: string;
  isSubmitting: boolean;
  items: CatalogRuleItem[];
  children?: ReactNode;
}

const BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  info: { bg: "#e0f0ff", color: "#005bd3" },
  warning: { bg: "#ffecd5", color: "#b95c00" },
  success: { bg: "#e3f5e1", color: "#23802a" },
  neutral: { bg: "#f1f2f4", color: "#6d7175" },
};

export function CatalogRuleSection(props: CatalogRuleSectionProps) {
  return (
    <s-section heading={props.heading}>
      {props.description && (
        <s-paragraph>{props.description}</s-paragraph>
      )}
      <form method="post">
        <input type="hidden" name="intent" value={props.saveIntent} />
        <s-stack direction="block" gap="base">
          <AdminCatalogPicker
            name={props.pickerName}
            label={props.pickerLabel}
            resourceType={props.resourceType}
            required
          />
          {props.children}
          <button type="submit" disabled={props.isSubmitting}>
            {props.submitLabel}
          </button>
        </s-stack>
      </form>

      <s-box padding="base" borderWidth="base" borderRadius="base">
        <s-heading>{props.rulesHeading}</s-heading>
        {props.items.length === 0 ? (
          <s-paragraph>{props.emptyMessage}</s-paragraph>
        ) : (
          <s-stack direction="block" gap="small">
            {props.items.map((item) => (
              <s-stack
                key={item.id}
                direction="inline"
                gap="base"
                alignItems="center"
              >
                <s-text>
                  <strong>{item.label}</strong>
                  {item.badges?.map((badge, i) => {
                    const colors = BADGE_COLORS[badge.variant ?? "neutral"];
                    return (
                      <span
                        key={i}
                        style={{
                          marginLeft: "8px",
                          fontSize: "11px",
                          padding: "2px 8px",
                          borderRadius: "10px",
                          background: colors.bg,
                          color: colors.color,
                          fontWeight: 600,
                        }}
                      >
                        {badge.text}
                      </span>
                    );
                  })}
                  {item.detail && (
                    <span
                      style={{
                        marginLeft: "8px",
                        fontSize: "12px",
                        color: "#6d7175",
                      }}
                    >
                      {item.detail}
                    </span>
                  )}
                </s-text>
                <form method="post">
                  <input
                    type="hidden"
                    name="intent"
                    value={props.deleteIntent}
                  />
                  <input type="hidden" name="ruleId" value={item.id} />
                  <button type="submit" disabled={props.isSubmitting}>
                    Delete
                  </button>
                </form>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-box>
    </s-section>
  );
}
