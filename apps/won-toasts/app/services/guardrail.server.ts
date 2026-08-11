// MVP13c — guardrail live monitoring + auto-promote/rollback. There is no cron
// in a Shopify app, so the orders/create webhook is the trigger: on each order
// we (a) run the guardrail circuit breaker (live conversion/dismiss/JS-error vs
// the baseline captured at experiment start) and auto-rollback on a breach, and
// (b) for a real A/B, auto-promote the variant once it wins significantly past
// the minimum duration. All decision maths live in @won/core/toasts/
// experiment-engine; this layer wires data + transitions and is dependency-
// injected so it is unit-testable without a DB.

import {
  guardrailBreach,
  evaluateExperiment,
  liveGuardMetrics,
  type GuardMetrics,
  type ArmStat,
} from "@won/core/toasts/experiment-engine";
import { applyConfigOverlay } from "@won/core/toasts/config-overlay";
import { emptyRollupCounters, mergeCounters, dateKeyUTC, type RollupCounters } from "@won/core/toasts/insights";

// Traffic floor (decision #11): below this many live sessions, don't act.
const TRAFFIC_FLOOR = 200;
const MIN_DAYS = 7;
const MAX_DAYS = 14;
const MIN_SAMPLE = 200;
const WINDOW_DAYS = 7;

export interface WindowCounts {
  orders: number;
  sessions: number;
  dismisses: number;
  shown: number;
  jsErrors: number;
}

interface ActiveExperiment {
  id: string;
  variantPercent: number;
  variant: unknown;
  baseline: unknown;
  createdAt: Date;
}

export interface GuardrailDeps {
  getActiveExperiment: (shop: string) => Promise<ActiveExperiment | null>;
  loadWindowCounts: (shop: string, sinceDate: string) => Promise<WindowCounts>;
  loadArmStats: (shop: string, sinceDate: string) => Promise<{ control: ArmStat; variant: ArmStat }>;
  decideExperiment: (shop: string, id: string, outcome: string, detail?: string) => Promise<unknown>;
  applyVariant: (shop: string, overlay: unknown) => Promise<void>;
}

export interface CheckResult {
  checked: boolean;
  action?: "rollback" | "promote" | "revert" | "expire" | "continue";
  reason?: string;
}

function daysBetween(from: Date, nowMs: number): number {
  return Math.max(0, (nowMs - from.getTime()) / 86_400_000);
}

export function createGuardrailService(deps: GuardrailDeps) {
  async function captureBaseline(shop: string, sinceDate: string): Promise<GuardMetrics> {
    return liveGuardMetrics(await deps.loadWindowCounts(shop, sinceDate));
  }

  async function runChecks(
    shop: string,
    opts: { sinceDate: string; now: number },
  ): Promise<CheckResult> {
    const exp = await deps.getActiveExperiment(shop);
    if (!exp) return { checked: false };

    const live = liveGuardMetrics(await deps.loadWindowCounts(shop, opts.sinceDate));

    // (a) Circuit breaker — independent of the A/B outcome.
    if (exp.baseline && typeof exp.baseline === "object") {
      const reason = guardrailBreach(exp.baseline as GuardMetrics, live, {
        minSessions: TRAFFIC_FLOOR,
      });
      if (reason) {
        await deps.decideExperiment(shop, exp.id, "guardrail_rollback", reason);
        return { checked: true, action: "rollback", reason };
      }
    }

    // (b) Auto-promote — only for a real A/B (variant serving live).
    if (exp.variantPercent > 0) {
      const arms = await deps.loadArmStats(shop, opts.sinceDate);
      const ageDays = daysBetween(exp.createdAt, opts.now);
      const result = evaluateExperiment(arms.control, arms.variant, {
        ageDays,
        minDays: MIN_DAYS,
        minSample: MIN_SAMPLE,
        maxDays: MAX_DAYS,
      });
      if (result.decision === "promote") {
        await deps.applyVariant(shop, exp.variant);
        await deps.decideExperiment(shop, exp.id, "promoted", `prob ${result.probBest.toFixed(2)}`);
        return { checked: true, action: "promote" };
      }
      if (result.decision === "rollback") {
        await deps.decideExperiment(shop, exp.id, "reverted", "variant underperformed");
        return { checked: true, action: "revert" };
      }
      if (result.decision === "expired") {
        await deps.decideExperiment(shop, exp.id, "expired", "kept original");
        return { checked: true, action: "expire" };
      }
    }

    return { checked: true, action: "continue" };
  }

  return { captureBaseline, runChecks };
}

// ---- production wiring ------------------------------------------------------

import { getActiveExperiment, decideExperiment } from "./experiments.server";
import { readRollups } from "./analytics.server";
import { getRawConfig, updateToastConfig } from "./toast-config.server";
import { recentToastEventTimestamps } from "./toast-events.server";

function sumRollups(rows: { dims: { abVariant: number }; counters: RollupCounters }[]) {
  let total = emptyRollupCounters();
  const byArm = new Map<number, RollupCounters>();
  for (const r of rows) {
    total = mergeCounters(total, r.counters);
    byArm.set(r.dims.abVariant, mergeCounters(byArm.get(r.dims.abVariant) ?? emptyRollupCounters(), r.counters));
  }
  return { total, byArm };
}

async function loadWindowCounts(shop: string, sinceDate: string): Promise<WindowCounts> {
  const rollups = await readRollups(shop, sinceDate);
  const { total } = sumRollups(rollups);
  const orders = await recentToastEventTimestamps(shop, "order", WINDOW_DAYS * 86_400_000).catch(() => []);
  return {
    orders: orders.length,
    sessions: total.sessions,
    dismisses: total.dismiss,
    shown: total.shown,
    jsErrors: total.jsErrors,
  };
}

async function loadArmStats(shop: string, sinceDate: string) {
  const rollups = await readRollups(shop, sinceDate);
  const { byArm } = sumRollups(rollups);
  // Engagement-based A/B signal (read-through rate) per arm — real revenue
  // attribution needs cohort-stamped orders (holdout proves that); this promotes
  // on a measurable engagement win, which is honest and never fabricated.
  const asStat = (c: RollupCounters | undefined): ArmStat => ({
    conversions: c?.readThrough ?? 0,
    sessions: c?.shown ?? 0,
  });
  return { control: asStat(byArm.get(0)), variant: asStat(byArm.get(1)) };
}

async function applyVariant(shop: string, overlay: unknown): Promise<void> {
  const row = await getRawConfig(shop);
  const stored = {
    enabled: row.enabled,
    plan: row.plan,
    global: row.global,
    theme: row.theme,
    byType: row.byType,
    cartEvents: row.cartEvents,
    messages: row.messages,
    locales: row.locales,
    milestones: row.milestones,
    targeting: row.targeting,
    notifications: row.notifications,
    exclusions: row.exclusions,
  };
  const merged = applyConfigOverlay(stored, overlay);
  await updateToastConfig(shop, merged as never);
}

const guardrailService = createGuardrailService({
  getActiveExperiment: getActiveExperiment as GuardrailDeps["getActiveExperiment"],
  loadWindowCounts,
  loadArmStats,
  decideExperiment: decideExperiment as GuardrailDeps["decideExperiment"],
  applyVariant,
});

/** Capture the guardrail baseline for a shop over the recent window (call at
 *  experiment start, before the change goes live). */
export async function captureGuardrailBaseline(shop: string): Promise<GuardMetrics> {
  const since = dateKeyUTC(Date.now() - WINDOW_DAYS * 86_400_000);
  return guardrailService.captureBaseline(shop, since);
}

/** Run guardrail + auto-decide for a shop's active experiment (call on
 *  orders/create). Best-effort; never throws into the webhook. */
export async function runExperimentGuardrails(shop: string): Promise<CheckResult> {
  const since = dateKeyUTC(Date.now() - WINDOW_DAYS * 86_400_000);
  return guardrailService
    .runChecks(shop, { sinceDate: since, now: Date.now() })
    .catch(() => ({ checked: false }) as CheckResult);
}
