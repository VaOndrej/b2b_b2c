import type { ReactNode } from "react";

export interface CatalogRuleItem {
  id: string;
  label: string;
  badges?: Array<{
    text: string;
    variant?: "info" | "warning" | "success" | "neutral";
  }>;
  detail?: string;
}

export interface CompactRulePanelProps {
  heading: string;
  description?: ReactNode;
  saveIntent: string;
  submitLabel: string;
  deleteIntent: string;
  deleteFieldName?: string;
  rulesHeading: string;
  emptyMessage: string;
  isSubmitting: boolean;
  items: CatalogRuleItem[];
  children: ReactNode;
}

const BADGE_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  info: { bg: "#eaf3ff", color: "#004c97", border: "rgba(0, 91, 211, 0.18)" },
  warning: { bg: "#fff3e5", color: "#9a4600", border: "rgba(185, 92, 0, 0.16)" },
  success: { bg: "#ecfdf3", color: "#067647", border: "rgba(6, 118, 71, 0.16)" },
  neutral: { bg: "#f5f7fa", color: "#475467", border: "rgba(7, 33, 58, 0.08)" },
};

export function CompactRulePanel(props: CompactRulePanelProps) {
  return (
    <div
      style={{
        border: "1px solid rgba(7, 33, 58, 0.10)",
        borderRadius: "18px",
        background: "#ffffff",
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(7, 33, 58, 0.04)",
      }}
    >
      <div
        style={{
          padding: "18px 18px 14px 18px",
          borderBottom: "1px solid rgba(7, 33, 58, 0.08)",
          background: "linear-gradient(180deg, #ffffff 0%, #f8fbfd 100%)",
        }}
      >
        <div
          style={{
            fontSize: "16px",
            fontWeight: 700,
            color: "#07213a",
            marginBottom: props.description ? "6px" : 0,
          }}
        >
          {props.heading}
        </div>
        {props.description ? (
          <div
            style={{
              fontSize: "13px",
              lineHeight: 1.55,
              color: "#51606f",
              maxWidth: "860px",
            }}
          >
            {props.description}
          </div>
        ) : null}
      </div>

      <form method="post" style={{ margin: 0 }}>
        <input type="hidden" name="intent" value={props.saveIntent} />
        <div
          style={{
            padding: "16px 18px 18px 18px",
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "12px",
              alignItems: "start",
            }}
          >
            {props.children}
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              paddingTop: "2px",
            }}
          >
            <button type="submit" disabled={props.isSubmitting}>
              {props.submitLabel}
            </button>
          </div>
        </div>
      </form>

      <div
        style={{
          borderTop: "1px solid rgba(7, 33, 58, 0.08)",
          padding: "16px 18px 18px 18px",
          background: "#fcfcfd",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            marginBottom: "12px",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#667085",
            }}
          >
            {props.rulesHeading}
          </div>
          <div
            style={{
              minWidth: "28px",
              height: "28px",
              borderRadius: "999px",
              padding: "0 10px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              fontWeight: 700,
              color: "#07213a",
              background: "rgba(7, 33, 58, 0.06)",
            }}
          >
            {props.items.length}
          </div>
        </div>

        {props.items.length === 0 ? (
          <div
            style={{
              border: "1px dashed rgba(7, 33, 58, 0.12)",
              borderRadius: "14px",
              padding: "14px 16px",
              color: "#667085",
              fontSize: "13px",
              background: "#ffffff",
            }}
          >
            {props.emptyMessage}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {props.items.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "14px",
                  border: "1px solid rgba(7, 33, 58, 0.08)",
                  borderRadius: "14px",
                  padding: "12px 14px",
                  background: "#ffffff",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "8px",
                      alignItems: "center",
                      marginBottom: item.detail ? "6px" : 0,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "14px",
                        lineHeight: 1.45,
                        fontWeight: 700,
                        color: "#07213a",
                      }}
                    >
                      {item.label}
                    </div>
                    {item.badges?.map((badge, index) => {
                      const colors = BADGE_COLORS[badge.variant ?? "neutral"];
                      return (
                        <span
                          key={`${item.id}-${index}`}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            minHeight: "22px",
                            padding: "0 8px",
                            borderRadius: "999px",
                            border: `1px solid ${colors.border}`,
                            background: colors.bg,
                            color: colors.color,
                            fontSize: "11px",
                            fontWeight: 700,
                          }}
                        >
                          {badge.text}
                        </span>
                      );
                    })}
                  </div>
                  {item.detail ? (
                    <div
                      style={{
                        fontSize: "12px",
                        lineHeight: 1.5,
                        color: "#51606f",
                      }}
                    >
                      {item.detail}
                    </div>
                  ) : null}
                </div>

                <form method="post" style={{ margin: 0 }}>
                  <input type="hidden" name="intent" value={props.deleteIntent} />
                  <input
                    type="hidden"
                    name={props.deleteFieldName ?? "id"}
                    value={item.id}
                  />
                  <button type="submit" disabled={props.isSubmitting}>
                    Delete
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
