import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import type { RuleMetrics } from "@won/core/toasts/analytics";
import type { AdvisorSuggestion } from "@won/core/toasts/ai-advisor";

import { authenticate } from "../shopify.server";
import { getToastConfig } from "../services/toast-config.server";
import {
  analyticsCounters,
  summarizeAnalytics,
} from "../services/analytics.server";
import { adviseFromMetrics } from "../services/ai-advisor.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  if (config.plan !== "pro") return { pro: false as const, metrics: {} };
  const metrics = await summarizeAnalytics(session.shop);
  return { pro: true as const, metrics };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  if (config.plan !== "pro") return { advisor: null };
  const counters = await analyticsCounters(session.shop);
  const advisor = await adviseFromMetrics(counters);
  return { advisor };
};

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export default function AnalyticsRoute() {
  const data = useLoaderData<typeof loader>();

  if (!data.pro) {
    return (
      <s-page heading="Analytics">
        <s-section heading="Analytics is a Pro feature">
          <s-banner tone="info" heading="Measure what your toasts do">
            Impressions, click-through, dismiss and undo rates per rule — plus an
            AI advisor that turns them into concrete changes.
          </s-banner>
          <s-paragraph>
            <s-link href="/app/plan">Upgrade to Pro</s-link> to see analytics.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const rows = Object.entries(data.metrics as Record<string, RuleMetrics>);

  return (
    <s-page heading="Analytics">
      <s-section heading="Per-rule performance (last 30 days)">
        {rows.length === 0 ? (
          <s-paragraph>
            No events yet. Once toasts show on your storefront, impressions and
            clicks appear here. A toast is an assist — we never claim attributed
            revenue.
          </s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Rule</s-table-header>
              <s-table-header>Impressions</s-table-header>
              <s-table-header>Clicks</s-table-header>
              <s-table-header>CTR</s-table-header>
              <s-table-header>Dismiss rate</s-table-header>
              <s-table-header>Undo rate</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map(([ruleId, m]) => (
                <s-table-row key={ruleId}>
                  <s-table-cell>{ruleId}</s-table-cell>
                  <s-table-cell>{String(m.impressions)}</s-table-cell>
                  <s-table-cell>{String(m.clicks)}</s-table-cell>
                  <s-table-cell>{pct(m.ctr)}</s-table-cell>
                  <s-table-cell>{pct(m.dismissRate)}</s-table-cell>
                  <s-table-cell>{pct(m.undoRate)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      <s-section heading="AI advisor">
        <s-paragraph>
          Turn these real metrics into concrete, reviewable actions — disable a
          rule with no clicks, shorten a high-dismiss toast. You confirm before
          anything changes.
        </s-paragraph>
        <Form method="post">
          <s-button variant="primary" type="submit">
            Get suggestions
          </s-button>
        </Form>
        <AdvisorResults />
      </s-section>
    </s-page>
  );
}

// Render suggestions returned by the action (if any).
function AdvisorResults() {
  const actionData = useActionData<typeof action>();
  const advisor = actionData?.advisor as
    | { source: "ai" | "rules"; suggestions: AdvisorSuggestion[] }
    | null
    | undefined;
  if (!advisor) return null;
  if (advisor.suggestions.length === 0) {
    return (
      <s-banner tone="success" heading="Nothing to change">
        Your rules look healthy — no actionable issues found.
      </s-banner>
    );
  }
  return (
    <s-stack direction="block" gap="base">
      <s-badge tone={advisor.source === "ai" ? "info" : "neutral"}>
        {advisor.source === "ai" ? "AI suggestions" : "Rule-based suggestions"}
      </s-badge>
      <s-unordered-list>
        {advisor.suggestions.map((s, i) => (
          <s-list-item key={i}>
            <s-text type="strong">{s.action}</s-text>
            {s.ruleId ? ` · ${s.ruleId}` : ""}
            {s.value !== undefined ? ` · ${String(s.value)}` : ""} — {s.rationale}
          </s-list-item>
        ))}
      </s-unordered-list>
    </s-stack>
  );
}
