import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";

import { optimizeToasts } from "../services/ai-advisor.server";
import { captureGuardrailBaseline } from "../services/guardrail.server";
import { ruleLabel } from "../lib/labels";

import { whatIfForecast } from "@won/core/toasts/experiment-engine";
import { suggestionToOverlay, type AdvisorSuggestion } from "@won/core/toasts/ai-advisor-v2";
import { emptyRollupCounters, mergeCounters, dateKeyUTC, type RollupCounters } from "@won/core/toasts/insights";

import { authenticate } from "../shopify.server";
import { getRawConfig, getToastConfig } from "../services/toast-config.server";
import {
  getActiveExperiment,
  listExperiments,
  startExperiment,
  decideExperiment,
} from "../services/experiments.server";
import { readRollups } from "../services/analytics.server";

const WINDOW_DAYS = 30;

// Decision #2: holdout default 10%, Pro-only, with an explainer; 0 disables.
const DEFAULT_HOLDOUT = 10;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  if (config.plan !== "pro") return { pro: false as const };

  const active = await getActiveExperiment(session.shop);
  const experiments = await listExperiments(session.shop);

  // What-if baseline: overall read-through across the window (grounded in history).
  const since = dateKeyUTC(Date.now() - WINDOW_DAYS * 86_400_000);
  const rollups = await readRollups(session.shop, since);
  const totals = rollups.reduce<RollupCounters>((a, r) => mergeCounters(a, r.counters), emptyRollupCounters());
  const baselineRate = totals.shown > 0 ? totals.readThrough / totals.shown : 0;
  const forecast = whatIfForecast(
    { baselineRate, sessions: totals.shown },
    { expectedRelLift: 0.1 },
  );

  return {
    pro: true as const,
    active: active
      ? {
          id: active.id,
          name: active.name,
          status: active.status,
          holdoutPercent: active.holdoutPercent,
          variantPercent: active.variantPercent,
          source: active.source,
          createdAt: active.createdAt.toISOString(),
          audit: (Array.isArray(active.audit) ? active.audit : []) as { summary: string }[],
        }
      : null,
    history: experiments
      .filter((e) => e.status !== "running")
      .map((e) => ({ id: e.id, name: e.name, status: e.status, createdAt: e.createdAt.toISOString() })),
    forecast,
    baselineRate,
    sample: totals.shown,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "start_holdout") {
    const pct = Math.min(50, Math.max(1, Number(form.get("holdoutPercent")) || DEFAULT_HOLDOUT));
    // A pure holdout: control === variant, but `holdoutPercent` of visitors see
    // no toasts so we can prove revenue impact honestly.
    const current = await getRawConfig(session.shop).catch(() => ({}));
    const baseline = await captureGuardrailBaseline(session.shop).catch(() => null);
    await startExperiment(session.shop, {
      name: `Holdout ${pct}%`,
      control: current,
      variant: current,
      variantPercent: 0,
      holdoutPercent: pct,
      gatingMode: "test_first",
      source: "manual",
      baseline,
    });
    return { ok: true };
  }

  if (intent === "stop") {
    const id = String(form.get("experimentId") ?? "");
    if (id) await decideExperiment(session.shop, id, "reverted", "Stopped by merchant");
    return { ok: true };
  }

  if (intent === "ai_optimize") {
    // On-demand AI Optimize (decision #8). Every suggestion carries evidence and
    // would be applied via an experiment (MVP13c), never straight to the store.
    const result = await optimizeToasts(session.shop);
    return { suggestions: result.suggestions, aiAvailable: result.available };
  }

  if (intent === "apply_suggestion") {
    // MVP13c: apply an advisor suggestion as a live A/B experiment — the variant
    // config runs for 50% of visitors, the control for the rest. Nothing goes
    // straight to the store.
    const rawValue = String(form.get("sValue") ?? "");
    const numValue = Number(rawValue);
    const suggestion: AdvisorSuggestion = {
      action: String(form.get("sAction") ?? "") as AdvisorSuggestion["action"],
      type: form.get("sType") ? String(form.get("sType")) : undefined,
      value: rawValue === "" ? undefined : Number.isFinite(numValue) && /^-?\d/.test(rawValue) ? numValue : rawValue,
      rationale: "AI Optimize",
      evidence: { impressions: 0, metricKind: "", goal: "" },
    };
    const overlay = suggestionToOverlay(suggestion);
    if (overlay) {
      const baseline = await captureGuardrailBaseline(session.shop).catch(() => null);
      await startExperiment(session.shop, {
        name: `AI: ${suggestion.action}${suggestion.type ? " · " + suggestion.type : ""}`,
        control: {},
        variant: overlay,
        variantPercent: 50,
        holdoutPercent: 0,
        gatingMode: "test_first",
        source: "ai",
        baseline,
      });
    }
    return { appliedExperiment: !!overlay };
  }

  return { ok: false };
};

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

interface AiActionData {
  suggestions?: {
    action: string;
    type?: string;
    value?: number | string;
    rationale: string;
    evidence: { impressions: number; metricKind: string; goal: string };
  }[];
  aiAvailable?: boolean;
}

// Actions that map to a config overlay (see @won/core suggestionToOverlay) and
// can therefore be applied as an A/B experiment straight from a suggestion.
const APPLYABLE_ACTIONS = new Set([
  "shorten_duration",
  "lengthen_duration",
  "move_position",
  "change_cooldown",
  "switch_look",
]);

export default function ExperimentsRoute() {
  const data = useLoaderData<typeof loader>();
  const ai = useActionData<AiActionData>();

  if (!data.pro) {
    return (
      <s-page heading="Experiments" inlineSize="large">
        <s-section heading="Experiments are a Pro feature">
          <s-banner tone="info" heading="Prove what your toasts earn">
            Hold a small share of visitors out to measure real impact, and test any
            change safely before it goes live.
          </s-banner>
          <s-paragraph>
            <s-link href="/app/plan">Upgrade to Pro</s-link> to run experiments.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const { active, history, forecast, baselineRate, sample } = data;

  return (
    <s-page heading="Experiments" inlineSize="large">
      <s-section heading="Holdout — the only honest proof of ROI">
        <s-paragraph>
          A holdout shows <strong>no toasts</strong> to a small, random share of
          visitors. Comparing their orders against everyone else is the one
          defensible way to say "Won earned you X" — everything else is an assist,
          not a proven cause. Safe and fully reversible.
        </s-paragraph>
        {active ? (
          <div style={{ border: "1px solid #e3e6ea", borderRadius: 12, padding: 16, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{active.name}</div>
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  Running since {new Date(active.createdAt).toLocaleString()} · {active.holdoutPercent}% held out ·{" "}
                  {active.source}
                </div>
              </div>
              <Form method="post">
                <input type="hidden" name="intent" value="stop" />
                <input type="hidden" name="experimentId" value={active.id} />
                <s-button type="submit" variant="secondary" tone="critical">
                  Stop
                </s-button>
              </Form>
            </div>
            {active.audit.length ? (
              <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "#374151", fontSize: 13 }}>
                {active.audit.map((a, i) => (
                  <li key={i}>{a.summary}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="start_holdout" />
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-number-field label="Holdout %" name="holdoutPercent" defaultValue={String(DEFAULT_HOLDOUT)} min={1} max={50} />
              <s-button type="submit" variant="primary">
                Start holdout
              </s-button>
            </s-stack>
          </Form>
        )}
      </s-section>

      <s-section heading="What-if forecast">
        <s-paragraph>
          Based on {sample} recent impressions (read-through {pct(baselineRate)}), a
          10% relative improvement would land around{" "}
          <strong>{pct(forecast.expected)}</strong> (range {pct(forecast.low)}–{pct(forecast.high)}).
          An estimate from your own history — so you never launch blind.
        </s-paragraph>
      </s-section>

      <s-section heading="AI Optimize">
        <s-paragraph>
          Ask the advisor to read your <strong>per-type</strong> metrics and
          benchmarks and propose concrete changes. Every suggestion shows its
          evidence, and each one is applied as an experiment — never straight to
          your store. It will never tell you to switch off an informational toast
          just because it has few clicks.
        </s-paragraph>
        <Form method="post">
          <input type="hidden" name="intent" value="ai_optimize" />
          <s-button type="submit" variant="primary">Run AI Optimize</s-button>
        </Form>
        {ai?.suggestions ? (
          ai.aiAvailable === false ? (
            <s-banner tone="info" heading="AI advisor unavailable">
              Configure an Anthropic API key to enable AI Optimize. Your metrics and
              benchmarks are ready — the advisor just needs a model to call.
            </s-banner>
          ) : ai.suggestions.length === 0 ? (
            <s-paragraph>No changes recommended right now — your toasts look healthy.</s-paragraph>
          ) : (
            <s-stack direction="block" gap="small">
              {ai.suggestions.map((s, i) => (
                <div key={i} style={{ border: "1px solid #e3e6ea", borderRadius: 12, padding: 12, background: "#fff" }}>
                  <div style={{ fontWeight: 700 }}>
                    {s.action.replace(/_/g, " ")}
                    {s.type ? ` · ${ruleLabel(s.type)}` : ""}
                    {s.value != null ? ` → ${s.value}` : ""}
                  </div>
                  <div style={{ fontSize: 13, color: "#374151", marginTop: 4 }}>{s.rationale}</div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                    Evidence: {s.evidence.impressions} impressions · measured by {s.evidence.metricKind} ({s.evidence.goal})
                  </div>
                  {APPLYABLE_ACTIONS.has(s.action) && s.value != null ? (
                    <Form method="post" style={{ marginTop: 8 }}>
                      <input type="hidden" name="intent" value="apply_suggestion" />
                      <input type="hidden" name="sAction" value={s.action} />
                      {s.type ? <input type="hidden" name="sType" value={s.type} /> : null}
                      <input type="hidden" name="sValue" value={String(s.value)} />
                      <s-button type="submit" variant="secondary">Apply as A/B test (50%)</s-button>
                    </Form>
                  ) : null}
                </div>
              ))}
            </s-stack>
          )
        ) : null}
      </s-section>

      <s-section heading="Safety net">
        <s-banner tone="info" heading="Guardrail circuit breaker: armed">
          If a live change drops conversion sharply, spikes dismissals, or throws
          storefront errors (above a traffic floor, so no false alarms), it is
          auto-paused and rolled back. Conversion-rate telemetry is required to
          activate live monitoring.
        </s-banner>
      </s-section>

      {history.length ? (
        <s-section heading="Past experiments">
          <s-stack direction="block" gap="small">
            {history.map((h) => (
              <div key={h.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span>{h.name}</span>
                <span style={{ color: "#6b7280" }}>
                  {h.status} · {new Date(h.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}
