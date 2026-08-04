// MVP13 — analytics aggregation. Pure rollup of toast lifecycle events into
// per-rule counters and derived rates. NO false attribution: a toast is an
// assist, not a proven cause — we report impressions/clicks/dismisses/undos and
// their rates, nothing more. The storefront beacons the raw events; this turns
// them into the numbers the admin dashboard and the AI advisor read.

export type LifecycleEvent = "impression" | "click" | "dismiss" | "undo";

export const LIFECYCLE_EVENTS: readonly LifecycleEvent[] = [
  "impression",
  "click",
  "dismiss",
  "undo",
];

export interface RuleCounters {
  impressions: number;
  clicks: number;
  dismisses: number;
  undos: number;
}

export interface RuleMetrics extends RuleCounters {
  /** clicks / impressions (0 when no impressions). */
  ctr: number;
  /** dismisses / impressions. */
  dismissRate: number;
  /** undos / impressions (relevant for removal toasts). */
  undoRate: number;
}

export function emptyCounters(): RuleCounters {
  return { impressions: 0, clicks: 0, dismisses: 0, undos: 0 };
}

const FIELD: Record<string, keyof RuleCounters | undefined> = {
  impression: "impressions",
  click: "clicks",
  dismiss: "dismisses",
  undo: "undos",
};

/** Tally raw lifecycle events into counters keyed by rule id. */
export function aggregateEvents(
  events: ReadonlyArray<{ ruleId: string; type: LifecycleEvent }>,
): Record<string, RuleCounters> {
  const out: Record<string, RuleCounters> = {};
  if (!Array.isArray(events)) return out;
  for (const e of events) {
    if (!e || typeof e.ruleId !== "string" || !e.ruleId) continue;
    const field = FIELD[String(e.type)];
    if (!field) continue;
    const bucket = out[e.ruleId] ?? (out[e.ruleId] = emptyCounters());
    bucket[field] += 1;
  }
  return out;
}

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function computeMetrics(counters: RuleCounters): RuleMetrics {
  return {
    ...counters,
    ctr: rate(counters.clicks, counters.impressions),
    dismissRate: rate(counters.dismisses, counters.impressions),
    undoRate: rate(counters.undos, counters.impressions),
  };
}

/** Convenience: aggregate then derive metrics per rule in one call. */
export function summarizeByRule(
  events: ReadonlyArray<{ ruleId: string; type: LifecycleEvent }>,
): Record<string, RuleMetrics> {
  const counters = aggregateEvents(events);
  const out: Record<string, RuleMetrics> = {};
  for (const ruleId of Object.keys(counters)) {
    out[ruleId] = computeMetrics(counters[ruleId]);
  }
  return out;
}
