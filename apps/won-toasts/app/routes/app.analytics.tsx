import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import type { RuleMetrics } from "@won/core/toasts/analytics";

import { authenticate } from "../shopify.server";
import { getToastConfig } from "../services/toast-config.server";
import { ruleLabel } from "../lib/labels";
import { summarizeAnalytics } from "../services/analytics.server";

// NOTE: on-device "Suggestions" (ruleBasedSuggestions) were pulled from this page
// and deferred to MVP13 — their premise (0 clicks = no value) is wrong for
// informational toasts like "Added to cart", which are read but never clicked.
// See docs/won-toasts-mvp-plan.md → MVP13 for the corrected (per-type metric) spec.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  if (config.plan !== "pro") {
    return { pro: false as const, metrics: {} };
  }
  const metrics = await summarizeAnalytics(session.shop);
  return { pro: true as const, metrics };
};

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

// --- lightweight coloured data-viz (doctrine §3f: metrics = charts + colour) ---

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ border: "1px solid #e3e6ea", borderRadius: 12, padding: "14px 16px", minWidth: 150, background: "#fff" }}>
      <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, color }}>{value}</div>
    </div>
  );
}

function ImpressionBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 120, fontSize: 13, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ flex: 1, background: "#eef1f4", borderRadius: 6, height: 16, overflow: "hidden" }}>
        <div style={{ width: `${w}%`, background: color, height: "100%", borderRadius: 6, minWidth: value > 0 ? 6 : 0, transition: "width .3s ease" }} />
      </div>
      <div style={{ width: 52, textAlign: "right", fontSize: 13, color: "#111827", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function RateBar({ label, value, color }: { label: string; value: number; color: string }) {
  const w = Math.min(100, Math.round(value * 100));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 96, fontSize: 12, color: "#6b7280" }}>{label}</div>
      <div style={{ flex: 1, background: "#eef1f4", borderRadius: 5, height: 8 }}>
        <div style={{ width: `${w}%`, background: color, height: "100%", borderRadius: 5, transition: "width .3s ease" }} />
      </div>
      <div style={{ width: 48, textAlign: "right", fontSize: 12, color, fontWeight: 600 }}>{pct(value)}</div>
    </div>
  );
}

export default function AnalyticsRoute() {
  const data = useLoaderData<typeof loader>();

  if (!data.pro) {
    return (
      <s-page heading="Insights" inlineSize="large">
        <s-section heading="Analytics is a Pro feature">
          <s-banner tone="info" heading="Measure what your toasts do">
            Impressions, click-through, dismiss and undo rates per rule — plus
            on-device suggestions that turn them into concrete changes.
          </s-banner>
          <s-paragraph>
            <s-link href="/app/plan">Upgrade to Pro</s-link> to see analytics.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const rows = Object.entries(data.metrics as Record<string, RuleMetrics>);
  const totImpr = rows.reduce((a, [, m]) => a + m.impressions, 0);
  const totClicks = rows.reduce((a, [, m]) => a + m.clicks, 0);
  const avgCtr = totImpr > 0 ? totClicks / totImpr : 0;
  const avgDismiss = totImpr > 0 ? rows.reduce((a, [, m]) => a + m.impressions * m.dismissRate, 0) / totImpr : 0;
  const maxImpr = Math.max(1, ...rows.map(([, m]) => m.impressions));

  return (
    <s-page heading="Insights" inlineSize="large">
      {rows.length === 0 ? (
        <s-section heading="Performance (last 30 days)">
          <s-paragraph>
            No events yet. Once toasts show on your storefront, impressions and
            clicks appear here. A toast is an assist — we never claim attributed
            revenue.
          </s-paragraph>
        </s-section>
      ) : (
        <>
          <s-section heading="At a glance (last 30 days)">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              <StatCard label="Impressions" value={String(totImpr)} color="#2563eb" />
              <StatCard label="Clicks" value={String(totClicks)} color="#16a34a" />
              <StatCard label="Avg click-through" value={pct(avgCtr)} color="#16a34a" />
              <StatCard label="Avg dismiss" value={pct(avgDismiss)} color="#d97706" />
            </div>
          </s-section>

          <s-section heading="Impressions by rule">
            <s-stack direction="block" gap="base">
              {rows
                .slice()
                .sort((a, b) => b[1].impressions - a[1].impressions)
                .map(([ruleId, m]) => (
                  <ImpressionBar key={ruleId} label={ruleLabel(ruleId)} value={m.impressions} max={maxImpr} color="#2563eb" />
                ))}
            </s-stack>
          </s-section>

          <s-section heading="Engagement by rule">
            {/* Grid, not a stack — cards flow into columns so the page never
                becomes an endless scroll (doctrine §3i). */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: 12,
              }}
            >
              {rows.map(([ruleId, m]) => (
                <div key={ruleId} style={{ border: "1px solid #e3e6ea", borderRadius: 12, padding: 14, background: "#fff" }}>
                  <div style={{ fontWeight: 700, marginBottom: 8 }}>{ruleLabel(ruleId)}</div>
                  <s-stack direction="block" gap="small">
                    <RateBar label="Click-through" value={m.ctr} color="#16a34a" />
                    <RateBar label="Dismiss rate" value={m.dismissRate} color="#d97706" />
                    <RateBar label="Undo rate" value={m.undoRate} color="#2563eb" />
                  </s-stack>
                </div>
              ))}
            </div>
          </s-section>
        </>
      )}
    </s-page>
  );
}

