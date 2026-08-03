// Priority & conflict engine — when several things happen at once (product
// added AND free shipping reached AND gift unlocked), decide the order, and
// optionally collapse multiple reward milestones into ONE summary toast instead
// of stacking three. Deterministic + pure.

export type ToastSeverity = "info" | "success" | "reward" | "warning";

const SEVERITY_RANK: Record<ToastSeverity, number> = {
  warning: 3,
  reward: 2,
  success: 1,
  info: 0,
};

export interface ToastCandidate {
  id: string;
  severity: ToastSeverity;
  /** Higher wins ties within a severity. */
  priority: number;
  /** Short text used when several rewards collapse into a summary. */
  summaryLabel?: string;
  /** Arbitrary payload the caller renders. */
  payload?: unknown;
}

export interface ResolvedToasts {
  /** Ordered, highest-priority first. */
  toasts: ToastCandidate[];
  /** Present when 2+ reward candidates were summarised into one. */
  summary?: {
    id: string;
    severity: "reward";
    labels: string[];
    sources: ToastCandidate[];
  };
}

function bySeverityThenPriority(a: ToastCandidate, b: ToastCandidate): number {
  const s = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (s !== 0) return s;
  return b.priority - a.priority;
}

export interface ResolveOptions {
  summarizeConcurrent: boolean;
}

/**
 * Resolve concurrent candidates into an ordered toast list. When
 * summarizeConcurrent is on and 2+ reward candidates fire together, they are
 * replaced by a single summary toast (placed where the rewards would rank),
 * keeping non-reward toasts as-is.
 */
export function resolveToasts(
  candidates: readonly ToastCandidate[],
  { summarizeConcurrent }: ResolveOptions,
): ResolvedToasts {
  const sorted = [...candidates].sort(bySeverityThenPriority);
  const rewards = sorted.filter((c) => c.severity === "reward");

  if (!summarizeConcurrent || rewards.length < 2) {
    return { toasts: sorted };
  }

  const summary: ResolvedToasts["summary"] = {
    id: "summary",
    severity: "reward",
    labels: rewards.map((r) => r.summaryLabel ?? r.id),
    sources: rewards,
  };

  const nonReward = sorted.filter((c) => c.severity !== "reward");
  // Place the single summary among the non-reward toasts by reward rank.
  const summaryCandidate: ToastCandidate = {
    id: summary.id,
    severity: "reward",
    priority: Math.max(...rewards.map((r) => r.priority)),
    payload: summary,
  };
  const toasts = [...nonReward, summaryCandidate].sort(bySeverityThenPriority);
  return { toasts, summary };
}
