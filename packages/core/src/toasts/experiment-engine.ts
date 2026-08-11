// MVP13c — experiments: the money + safety layer. Every config change (AI or
// manual) can ship as an experiment; a holdout proves revenue; a guardrail
// circuit breaker makes "never breaks the store" literal. The SOPHISTICATION
// lives here (doctrine A6) — deterministic split, Bayesian significance,
// auto-promote/rollback, segment-aware evaluation, what-if forecast — while the
// merchant UI stays a couple of honest toggles.
//
// Honest attribution: only a holdout proves causation (see ./roi.ts). Everything
// here that is not holdout-derived is an assist, never a proven cause.

import { hashToken } from "./experiments.ts";

// ---- deterministic assignment (stable per shopper) ----

/** Whether a cart token is in the holdout cohort (sees NO toasts). Deterministic:
 *  the same token always lands the same way, so a shopper's experience is stable
 *  and the measurement honest. Holdout and exposed never overlap by construction. */
export function inHoldout(token: string, holdoutPercent: number): boolean {
  const p = Math.max(0, Math.min(100, holdoutPercent));
  if (p <= 0) return false;
  if (p >= 100) return true;
  // Distinct salt from arm assignment so holdout and A/B splits are independent.
  return hashToken("holdout:" + token) % 100 < p;
}

export type Arm = "control" | "variant";

/** Deterministically place an (exposed) token into control or variant. */
export function assignArm(token: string, variantPercent: number): Arm {
  const p = Math.max(0, Math.min(100, variantPercent));
  return hashToken("arm:" + token) % 100 < p ? "variant" : "control";
}

// ---- Bayesian significance (Beta-Bernoulli, normal approximation) ----

export interface ArmStat {
  conversions: number;
  sessions: number;
}

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 — deterministic, no RNG.
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function betaMoments(s: ArmStat): { mean: number; var: number } {
  const a = Math.max(0, s.conversions) + 1;
  const b = Math.max(0, s.sessions - s.conversions) + 1;
  const n = a + b;
  return { mean: a / n, var: (a * b) / (n * n * (n + 1)) };
}

/**
 * P(variant conversion rate > control) under independent Beta posteriors,
 * approximated as Normals. ~0.5 when arms are identical, →1 as the variant
 * dominates. Deterministic.
 */
export function probVariantBeatsControl(control: ArmStat, variant: ArmStat): number {
  const c = betaMoments(control);
  const v = betaMoments(variant);
  const sd = Math.sqrt(c.var + v.var);
  if (sd === 0) return 0.5;
  return normCdf((v.mean - c.mean) / sd);
}

// ---- experiment evaluation ----

export type ExperimentDecision = "continue" | "promote" | "rollback" | "expired";

export interface EvaluateOptions {
  ageDays: number;
  /** Minimum run length before any promote/rollback (default 7). */
  minDays?: number;
  /** Minimum combined sessions before trusting significance (default 200). */
  minSample?: number;
  /** Auto-expire → keep original after this many days (default 14). */
  maxDays?: number;
  /** Probability-to-be-best threshold (default 0.95). */
  threshold?: number;
}

export interface EvaluateResult {
  decision: ExperimentDecision;
  probBest: number;
}

/**
 * Decide an experiment's fate. Promotes ONLY when the variant is significant
 * (prob-to-be-best ≥ threshold) AND past the minimum duration AND above the
 * minimum sample — never on noise. Rolls back a clear loser. Auto-expires to the
 * original after maxDays with no decision.
 */
export function evaluateExperiment(
  control: ArmStat,
  variant: ArmStat,
  opts: EvaluateOptions,
): EvaluateResult {
  const minDays = opts.minDays ?? 7;
  const minSample = opts.minSample ?? 200;
  const maxDays = opts.maxDays ?? 14;
  const threshold = opts.threshold ?? 0.95;
  const probBest = probVariantBeatsControl(control, variant);
  const totalSessions = control.sessions + variant.sessions;

  if (opts.ageDays >= minDays && totalSessions >= minSample) {
    if (probBest >= threshold) return { decision: "promote", probBest };
    if (probBest <= 1 - threshold) return { decision: "rollback", probBest };
  }
  if (opts.ageDays >= maxDays) return { decision: "expired", probBest };
  return { decision: "continue", probBest };
}

/** Segment-aware evaluation — a win on mobile ≠ a win on desktop. */
export function evaluateBySegment(
  bySegment: Record<string, { control: ArmStat; variant: ArmStat }>,
  opts: EvaluateOptions,
): Record<string, EvaluateResult> {
  const out: Record<string, EvaluateResult> = {};
  for (const seg of Object.keys(bySegment).sort()) {
    const { control, variant } = bySegment[seg];
    out[seg] = evaluateExperiment(control, variant, opts);
  }
  return out;
}

// ---- guardrail circuit breaker ----

export interface GuardMetrics {
  conversionRate: number;
  dismissRate: number;
  jsErrors: number;
  sessions: number;
}

export type GuardReason = "conversion_drop" | "dismiss_spike" | "js_error";

export interface GuardOptions {
  /** Below this many live sessions, stay silent — no false alarms (decision #11). */
  minSessions?: number;
  /** Relative conversion drop that trips the breaker (default 0.15). */
  maxConversionDrop?: number;
  /** Relative dismiss-rate spike that trips the breaker (default 0.5). */
  maxDismissSpike?: number;
}

/**
 * Independent of experiments: if the LIVE config drops a hard metric versus the
 * baseline, return the breach reason (caller auto-pauses + rolls back + alerts).
 * Returns null when nothing is wrong — or when traffic is below the floor.
 */
export function guardrailBreach(
  baseline: GuardMetrics,
  live: GuardMetrics,
  opts: GuardOptions = {},
): GuardReason | null {
  const minSessions = opts.minSessions ?? 200;
  if (live.sessions < minSessions) return null; // traffic floor

  if (live.jsErrors > 0) return "js_error";

  const maxDrop = opts.maxConversionDrop ?? 0.15;
  if (baseline.conversionRate > 0) {
    const drop = (baseline.conversionRate - live.conversionRate) / baseline.conversionRate;
    if (drop > maxDrop) return "conversion_drop";
  }

  const maxSpike = opts.maxDismissSpike ?? 0.5;
  if (baseline.dismissRate > 0) {
    const spike = (live.dismissRate - baseline.dismissRate) / baseline.dismissRate;
    if (spike > maxSpike) return "dismiss_spike";
  }

  return null;
}

/** Build guardrail metrics from raw window counts (conversion = orders/sessions,
 *  dismiss = dismisses/shown). Used for both the baseline (captured at experiment
 *  start) and the live window the breaker checks against it. */
export function liveGuardMetrics(counts: {
  orders: number;
  sessions: number;
  dismisses: number;
  shown: number;
  jsErrors: number;
}): GuardMetrics {
  const rate = (n: number, d: number) => (d > 0 ? n / d : 0);
  return {
    conversionRate: rate(counts.orders, counts.sessions),
    dismissRate: rate(counts.dismisses, counts.shown),
    jsErrors: counts.jsErrors,
    sessions: counts.sessions,
  };
}

// ---- what-if forecast ----

export interface WhatIfHistory {
  baselineRate: number;
  sessions: number;
}
export interface WhatIfResult {
  low: number;
  expected: number;
  high: number;
}

/**
 * Pre-launch estimate of a change's impact, grounded in historical volume so the
 * merchant knows what to expect and never launches blind. Range width comes from
 * the binomial standard error at the projected rate.
 */
export function whatIfForecast(
  history: WhatIfHistory,
  change: { expectedRelLift: number },
): WhatIfResult {
  const expected = history.baselineRate * (1 + change.expectedRelLift);
  const p = Math.min(1, Math.max(0, expected));
  const se = history.sessions > 0 ? Math.sqrt((p * (1 - p)) / history.sessions) : 0;
  return {
    low: Math.max(0, expected - 1.96 * se),
    expected,
    high: expected + 1.96 * se,
  };
}

// ---- audit log ----

export type AuditOutcome = "started" | "promoted" | "reverted" | "expired" | "guardrail_rollback";

export interface AuditEntry {
  experimentId: string;
  outcome: AuditOutcome;
  detail: string;
  summary: string;
}

/** Build a readable audit entry for the experiment timeline (support + merchant). */
export function auditEntry(input: {
  experimentId: string;
  outcome: AuditOutcome;
  detail?: string;
}): AuditEntry {
  const detail = input.detail ?? "";
  const label: Record<AuditOutcome, string> = {
    started: "Experiment started",
    promoted: "Variant promoted",
    reverted: "Reverted to original",
    expired: "Expired → kept original",
    guardrail_rollback: "Guardrail rollback",
  };
  return {
    experimentId: input.experimentId,
    outcome: input.outcome,
    detail,
    summary: detail ? `${label[input.outcome]} — ${detail}` : label[input.outcome],
  };
}
