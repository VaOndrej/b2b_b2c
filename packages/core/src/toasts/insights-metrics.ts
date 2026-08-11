// MVP13b — per-type SUCCESS metric + honest insight cards.
//
// Premise correction (admin review 2026-08-06): clicks are NOT the value signal
// for informational toasts. "Added to cart" is read, not clicked — ~0 CTR is
// expected and does NOT mean worthless. So each toast TYPE is measured by the
// metric that actually reflects its job:
//   • action  (announcement/countdown/CTA)          → CTR
//   • informational (stock.low/cart.activity/order.*) → read-through / low-dismiss / reach
//   • cart / milestone (free-shipping/gift)          → AOV / progression (needs holdout revenue)
//
// HONEST ATTRIBUTION (non-negotiable): every metric is labelled `assisted` — a
// toast is an assist, never a proven cause. Proven revenue only ever comes from a
// holdout (MVP13c); this module never claims causation.

import type { RollupCounters } from "./insights.ts";

export type MetricKind = "action" | "informational" | "cart";

/** Predefined goal enum (decision #5 — no free text). */
export type SuccessGoal =
  | "clicks" // CTR
  | "read_through"
  | "reach"
  | "low_dismiss"
  | "aov" // needs holdout revenue
  | "progression"; // needs cart-value instrumentation

export const SUCCESS_GOALS: readonly SuccessGoal[] = [
  "clicks",
  "read_through",
  "reach",
  "low_dismiss",
  "aov",
  "progression",
];

const KIND_BY_TYPE: Record<string, MetricKind> = {
  announcement: "action",
  countdown: "action",
  "stock.low": "informational",
  "cart.activity": "informational",
  "order.summary": "informational",
  "order.created": "informational",
  cart: "cart",
};

const DEFAULT_GOAL_BY_TYPE: Record<string, SuccessGoal> = {
  announcement: "clicks",
  countdown: "clicks",
  "stock.low": "read_through",
  "cart.activity": "read_through",
  "order.summary": "read_through",
  "order.created": "read_through",
  cart: "aov",
};

export function metricKindForType(type: string): MetricKind {
  return KIND_BY_TYPE[type] ?? "informational";
}

export function defaultGoalForType(type: string): SuccessGoal {
  return DEFAULT_GOAL_BY_TYPE[type] ?? "read_through";
}

function rate(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

export interface SuccessMetric {
  type: string;
  kind: MetricKind;
  goal: SuccessGoal;
  /** Headline number for the goal (a rate for rate-goals, a count for reach). */
  value: number;
  /** Whether `value` reflects real, sufficient data — false when no sample or the
   *  goal needs a data source we don't have yet (AOV/progression → holdout). */
  available: boolean;
  /** True when a lower value is better (e.g. low_dismiss). */
  lowerIsBetter: boolean;
  /** Denominator (shown count). */
  sample: number;
  /** Absolute reach (shown), always populated. */
  reach: number;
  /** Supporting rates for the dashboard — never presented as causation. */
  rates: {
    ctr: number;
    readThroughRate: number;
    dismissRate: number;
    visibleRate: number;
    avgDwellMs: number;
  };
  /** Constant honesty marker: a toast is an assist, not a proven cause. */
  attribution: "assisted";
}

const MIN_SAMPLE = 1;

export function successMetric(
  type: string,
  counters: RollupCounters,
  goal: SuccessGoal = defaultGoalForType(type),
): SuccessMetric {
  const shown = counters.shown ?? 0;
  const rates = {
    ctr: rate(counters.clicks ?? 0, shown),
    readThroughRate: rate(counters.readThrough ?? 0, shown),
    dismissRate: rate(counters.dismiss ?? 0, shown),
    visibleRate: rate(counters.visible ?? 0, shown),
    avgDwellMs: rate(counters.dwellMsTotal ?? 0, counters.dwellCount ?? 0),
  };

  let value = 0;
  let available = shown >= MIN_SAMPLE;
  let lowerIsBetter = false;
  switch (goal) {
    case "clicks":
      value = rates.ctr;
      break;
    case "read_through":
      value = rates.readThroughRate;
      break;
    case "reach":
      value = shown;
      break;
    case "low_dismiss":
      value = rates.dismissRate;
      lowerIsBetter = true;
      break;
    case "aov":
    case "progression":
      // Needs holdout revenue / cart-value events — not derivable from lifecycle
      // counters. Report reach as context, but never fabricate an AOV number.
      value = 0;
      available = false;
      break;
  }

  return {
    type,
    kind: metricKindForType(type),
    goal,
    value,
    available,
    lowerIsBetter,
    sample: shown,
    reach: shown,
    rates,
    attribution: "assisted",
  };
}

// ---- insight cards -------------------------------------------------------

export type InsightSeverity = "good" | "warn" | "info";
export type InsightKind =
  | "best_performer"
  | "attention_loss"
  | "best_day"
  | "silent_gap";

export interface InsightCard {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  metricType?: string;
  /** Machine-readable evidence — the admin renders human copy from this. Never
   *  a causal claim. */
  evidence: Record<string, number | string>;
}

export interface MetricInput {
  type: string;
  counters: RollupCounters;
}

export interface InsightOptions {
  /** Types the merchant has configured (to detect configured-but-silent gaps). */
  configuredTypes?: string[];
  /** Minimum shown before a type is eligible to be a "best performer". */
  minSample?: number;
  /** Dismiss-rate above this (with low read-through) triggers attention_loss. */
  fastDismissThreshold?: number;
}

/**
 * Turn per-type metrics into a small, honest set of insight cards (doctrine A6 —
 * cards, not dashboards). Pure + DETERMINISTIC: stable ids and a stable order so
 * the same data always yields the same cards.
 */
export function buildInsightCards(
  metrics: ReadonlyArray<MetricInput>,
  opts: InsightOptions = {},
): InsightCard[] {
  const minSample = opts.minSample ?? 50;
  const fastDismiss = opts.fastDismissThreshold ?? 0.5;
  const cards: InsightCard[] = [];

  const computed = metrics
    .map((m) => successMetric(m.type, m.counters))
    .slice()
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));

  // Best performer: highest goal value among available, sufficiently-sampled,
  // higher-is-better metrics.
  let best: SuccessMetric | null = null;
  for (const m of computed) {
    if (!m.available || m.lowerIsBetter || m.sample < minSample) continue;
    if (!best || m.value > best.value) best = m;
  }
  if (best) {
    cards.push({
      id: "best_performer",
      kind: "best_performer",
      severity: "good",
      metricType: best.type,
      evidence: { goal: best.goal, value: Number(best.value.toFixed(4)), sample: best.sample },
    });
  }

  // Attention loss: high fast-dismiss AND low read-through.
  for (const m of computed) {
    if (m.sample < minSample) continue;
    if (m.rates.dismissRate >= fastDismiss && m.rates.readThroughRate < 0.5) {
      cards.push({
        id: `attention_loss:${m.type}`,
        kind: "attention_loss",
        severity: "warn",
        metricType: m.type,
        evidence: {
          dismissRate: Number(m.rates.dismissRate.toFixed(4)),
          readThroughRate: Number(m.rates.readThroughRate.toFixed(4)),
          sample: m.sample,
        },
      });
    }
  }

  // Silent gaps: configured but never fired in the window.
  const seen = new Set(computed.filter((m) => m.sample > 0).map((m) => m.type));
  for (const t of (opts.configuredTypes ?? []).slice().sort()) {
    if (!seen.has(t)) {
      cards.push({
        id: `silent_gap:${t}`,
        kind: "silent_gap",
        severity: "info",
        metricType: t,
        evidence: { shown: 0 },
      });
    }
  }

  return cards;
}
