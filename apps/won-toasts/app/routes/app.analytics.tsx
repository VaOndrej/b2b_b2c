import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import {
  successMetric,
  buildInsightCards,
  defaultGoalForType,
  type MetricInput,
  type InsightCard,
} from "@won/core/toasts/insights-metrics";
import { emptyRollupCounters, mergeCounters, dateKeyUTC, type RollupCounters } from "@won/core/toasts/insights";
import { monthlyRoi } from "@won/core/toasts/roi";

import { authenticate } from "../shopify.server";
import { getToastConfig } from "../services/toast-config.server";
import { ruleLabel } from "../lib/labels";
import {
  readRollups,
  crossStoreBenchmark,
  ownTypeRates,
  getBenchmarkOptOut,
  setBenchmarkOptOut,
  getBenchmarkIndustry,
  setBenchmarkIndustry,
} from "../services/analytics.server";

const WINDOW_DAYS = 30;

// The set of toast types the merchant has "configured" — used to detect a
// configured-but-silent gap. Cart is always on; each enabled notification adds
// its type; milestones map to the shared cart type.
function configuredTypes(config: Awaited<ReturnType<typeof getToastConfig>>): string[] {
  const types = new Set<string>(["cart"]);
  for (const n of config.notifications ?? []) {
    if (n && (n as { enabled?: boolean }).enabled !== false) types.add((n as { type: string }).type);
  }
  return Array.from(types);
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  const since = dateKeyUTC(Date.now() - WINDOW_DAYS * 86_400_000);

  // History & rollback live on Design (single source) — Insights is observation
  // only (merchant-review point 11).
  if (config.plan !== "pro") {
    // Free: reach + on/off health.
    const rollups = await readRollups(session.shop, since);
    const reach = rollups.reduce((a, r) => a + (r.counters.shown ?? 0), 0);
    return {
      pro: false as const,
      reach,
      firing: reach > 0,
    };
  }

  const rollups = await readRollups(session.shop, since);

  // Aggregate counters per type across all days/segments.
  const byType = new Map<string, RollupCounters>();
  for (const r of rollups) {
    const prev = byType.get(r.dims.type) ?? emptyRollupCounters();
    byType.set(r.dims.type, mergeCounters(prev, r.counters));
  }
  const metricInputs: MetricInput[] = Array.from(byType.entries()).map(([type, counters]) => ({
    type,
    counters,
  }));

  const perType = metricInputs
    .map((m) => {
      const metric = successMetric(m.type, m.counters, defaultGoalForType(m.type));
      return { type: m.type, metric, counters: m.counters };
    })
    .sort((a, b) => b.counters.shown - a.counters.shown);

  const cards = buildInsightCards(metricInputs, { configuredTypes: configuredTypes(config) });

  const totalReach = metricInputs.reduce((a, m) => a + (m.counters.shown ?? 0), 0);

  // Monthly ROI — holdout-proven only. No holdout data yet (arrives with MVP13c),
  // so this is honestly "insufficient" rather than a fabricated number.
  const roi = monthlyRoi({ exposedSessions: 0, exposedRevenue: 0, holdoutSessions: 0, holdoutRevenue: 0 });

  // MVP13d — "stores like you" (opt-out; industry-cohorted; only types that clear
  // k-anonymity show).
  const optedOut = await getBenchmarkOptOut(session.shop);
  const industry = await getBenchmarkIndustry(session.shop);
  let benchmark: { type: string; mine: number; p50: number; p25: number; p75: number; stores: number }[] | null =
    null;
  if (!optedOut) {
    const [cohort, mine] = await Promise.all([
      crossStoreBenchmark(since, 10, industry ?? undefined),
      ownTypeRates(session.shop, since),
    ]);
    const rows = Object.keys(mine)
      .filter((t) => cohort[t])
      .map((t) => ({
        type: t,
        mine: mine[t].readRate,
        p50: cohort[t].readRate.p50,
        p25: cohort[t].readRate.p25,
        p75: cohort[t].readRate.p75,
        stores: cohort[t].stores,
      }));
    benchmark = rows.length ? rows : null;
  }

  return { pro: true as const, perType, cards, totalReach, roi, benchmark, optedOut, industry };
};

export const INDUSTRIES = ["fashion", "electronics", "beauty", "food", "home", "b2b", "other"];

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "benchmark_optout") {
    await setBenchmarkOptOut(session.shop, form.get("optOut") === "true");
    return { ok: true };
  }
  if (intent === "benchmark_industry") {
    await setBenchmarkIndustry(session.shop, String(form.get("industry") ?? "") || null);
    return { ok: true };
  }
  return { ok: true };
};

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

const GOAL_LABEL: Record<string, string> = {
  clicks: "Click-through",
  read_through: "Read-through",
  reach: "Reach",
  low_dismiss: "Low dismiss",
  aov: "Order value (needs holdout)",
  progression: "Progression (needs holdout)",
};

const CARD_COPY: Record<string, (t: string, e: Record<string, number | string>) => string> = {
  best_performer: (t) => `${ruleLabel(t)} is your best-performing toast right now.`,
  attention_loss: (t, e) =>
    `${ruleLabel(t)} loses attention — ${pct(Number(e.dismissRate))} dismiss it fast. Try a shorter, calmer toast.`,
  best_day: (t) => `${ruleLabel(t)} performs best on some days — worth scheduling.`,
};

const CARD_TONE: Record<string, "success" | "warning" | "info"> = {
  best_performer: "success",
  attention_loss: "warning",
  best_day: "info",
  silent_gap: "info",
};

export default function AnalyticsRoute() {
  const data = useLoaderData<typeof loader>();

  if (!data.pro) {
    return (
      <s-page heading="Insights" inlineSize="large">
        <s-section heading="Reach">
          <s-banner tone={data.firing ? "success" : "info"} heading={data.firing ? "Your toasts are firing" : "No toasts shown yet"}>
            {data.firing
              ? `${data.reach} toasts shown in the last ${WINDOW_DAYS} days.`
              : "Once toasts show on your storefront, reach appears here."}
          </s-banner>
          <s-paragraph>
            Per-type success metrics, insight cards and monthly ROI are a{" "}
            <s-link href="/app/plan">Pro</s-link> feature.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const { perType, cards, totalReach, roi, benchmark, optedOut, industry } = data;

  return (
    <s-page heading="Insights" inlineSize="large">
      {/* Insight cards — the honest headline, not a wall of numbers (doctrine A6). */}
      <s-section heading="What we noticed">
        {cards.length === 0 ? (
          <s-paragraph>
            Not enough data yet. Insights appear as your toasts gather impressions.
            A toast is an assist — we never claim attributed revenue.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {(cards as InsightCard[]).map((c) => {
              // Golden platter (merchant-review point 10): don't tell the merchant
              // to "check triggers or targeting" — diagnose the likely cause and
              // deep-link to the fix. If nothing shows at all, the embed is the
              // usual culprit; if others fire but this one doesn't, it's this
              // type's targeting/on-off.
              if (c.kind === "silent_gap") {
                const globalSilent = totalReach === 0;
                const name = ruleLabel(c.metricType ?? "");
                return (
                  <s-banner key={c.id} tone="warning">
                    <s-stack direction="block" gap="small-200">
                      <s-text>
                        {globalSilent
                          ? `${name} hasn't shown once — and nothing else has either. Your app embed is probably off, or Targeting is excluding every page.`
                          : `${name} is set up but hasn't shown once, while other toasts are firing — it's likely turned off or excluded in Targeting.`}
                      </s-text>
                      <s-stack direction="inline" gap="base">
                        {globalSilent ? <s-button href="/app">Check setup</s-button> : null}
                        <s-button href="/app/targeting">Open Targeting</s-button>
                      </s-stack>
                    </s-stack>
                  </s-banner>
                );
              }
              return (
                <s-banner key={c.id} tone={CARD_TONE[c.kind] ?? "info"}>
                  {(CARD_COPY[c.kind] ?? ((t: string) => ruleLabel(t)))(c.metricType ?? "", c.evidence)}
                </s-banner>
              );
            })}
          </s-stack>
        )}
      </s-section>

      {/* Monthly ROI — proven, or honestly insufficient. */}
      <s-section heading="Monthly ROI">
        {roi.available ? (
          <s-banner tone="success" heading="Holdout-proven">
            Won brought you a proven {roi.provenRevenue} (minor units) this period.
          </s-banner>
        ) : (
          <s-banner tone="info" heading="Turn on a holdout to prove ROI">
            The only honest "Won earned you X" number comes from a holdout — a small
            share of visitors who see no toasts, so we can measure the real
            difference. Enable it in <s-link href="/app/experiments">Experiments</s-link>.
          </s-banner>
        )}
      </s-section>

      {/* Per-type success — each type judged by its OWN metric, not clicks. */}
      <s-section heading={`Per-type success (last ${WINDOW_DAYS} days · reach ${totalReach})`}>
        {perType.length === 0 ? (
          <s-paragraph>No events yet.</s-paragraph>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 12,
            }}
          >
            {perType.map(({ type, metric, counters }) => (
              <div key={type} style={{ border: "1px solid #e3e6ea", borderRadius: 12, padding: 14, background: "#fff" }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{ruleLabel(type)}</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>
                  Goal: {GOAL_LABEL[metric.goal] ?? metric.goal}
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: metric.available ? "#16a34a" : "#9ca3af" }}>
                  {metric.available
                    ? metric.goal === "reach"
                      ? String(metric.value)
                      : pct(metric.value)
                    : "—"}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                  {counters.shown} shown · {counters.readThrough} read · {counters.dismiss} dismissed
                  {metric.attribution === "assisted" ? " · assisted" : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </s-section>

      {/* MVP13d — cross-store benchmarks: the portfolio moat. Only anonymous
          aggregates, only types with enough contributing stores (k-anonymity). */}
      <s-section heading={industry ? `Stores like you (${industry})` : "Stores like you"}>
        {!optedOut ? (
          <Form method="post" style={{ marginBottom: 10 }}>
            <input type="hidden" name="intent" value="benchmark_industry" />
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-select label="Your industry (for a closer cohort)" name="industry" value={industry ?? ""}>
                <s-option value="">All stores</s-option>
                {INDUSTRIES.map((ind) => (
                  <s-option key={ind} value={ind}>
                    {ind}
                  </s-option>
                ))}
              </s-select>
              <s-button type="submit" variant="secondary">Save industry</s-button>
            </s-stack>
          </Form>
        ) : null}
        {optedOut ? (
          <>
            <s-paragraph>
              You've opted out of anonymous benchmarks. No aggregate data is shared,
              and you don't see how you compare.
            </s-paragraph>
            <Form method="post">
              <input type="hidden" name="intent" value="benchmark_optout" />
              <input type="hidden" name="optOut" value="false" />
              <s-button type="submit" variant="secondary">Opt back in</s-button>
            </Form>
          </>
        ) : !benchmark ? (
          <s-paragraph>
            Not enough comparable stores yet — benchmarks appear once at least 10
            stores contribute a type (k-anonymity keeps every store anonymous). Only
            aggregate percentiles are ever used.
          </s-paragraph>
        ) : (
          <>
            <s-stack direction="block" gap="small">
              {benchmark.map((b) => (
                <div key={b.type} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, gap: 12 }}>
                  <span style={{ width: 160 }}>{ruleLabel(b.type)} read-rate</span>
                  <span style={{ fontWeight: 700, color: b.mine >= b.p50 ? "#16a34a" : "#d97706" }}>
                    you {pct(b.mine)}
                  </span>
                  <span style={{ color: "#6b7280" }}>
                    peers {pct(b.p25)} · {pct(b.p50)} · {pct(b.p75)} (n={b.stores})
                  </span>
                </div>
              ))}
            </s-stack>
            <Form method="post" style={{ marginTop: 10 }}>
              <input type="hidden" name="intent" value="benchmark_optout" />
              <input type="hidden" name="optOut" value="true" />
              <s-button type="submit" variant="secondary">Opt out of benchmarks</s-button>
            </Form>
          </>
        )}
      </s-section>

    </s-page>
  );
}
