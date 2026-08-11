// MVP13b — Monthly ROI, the honest way. The ONLY defensible "Won earned you X"
// number comes from a holdout: compare per-session revenue of the exposed cohort
// (saw toasts) against the holdout cohort (saw none), and extrapolate the
// difference across the exposed sessions. Anything else is assisted, not proven —
// so when the holdout is off or under-sampled this returns `insufficient` and
// claims nothing (doctrine: never assert causation outside the holdout).

export interface HoldoutRevenue {
  /** Sessions that were shown toasts. */
  exposedSessions: number;
  /** Total revenue (minor units) from exposed sessions. */
  exposedRevenue: number;
  /** Sessions deliberately held out (shown no toasts). */
  holdoutSessions: number;
  /** Total revenue (minor units) from holdout sessions. */
  holdoutRevenue: number;
}

export interface RoiResult {
  available: boolean;
  attribution: "holdout-proven" | "insufficient";
  /** Per-session revenue lift (minor units); may be negative. */
  perSessionLift: number;
  /** Extrapolated incremental revenue over the exposed cohort (minor units). */
  provenRevenue: number;
}

const INSUFFICIENT: RoiResult = {
  available: false,
  attribution: "insufficient",
  perSessionLift: 0,
  provenRevenue: 0,
};

function avg(total: number, n: number): number {
  return n > 0 ? total / n : 0;
}

export function monthlyRoi(
  h: HoldoutRevenue,
  opts: { minSessions?: number } = {},
): RoiResult {
  const minSessions = opts.minSessions ?? 100;
  const exposedOk = Number(h.exposedSessions) >= minSessions;
  const holdoutOk = Number(h.holdoutSessions) >= minSessions;
  if (!exposedOk || !holdoutOk) return { ...INSUFFICIENT };

  const perSessionLift = avg(h.exposedRevenue, h.exposedSessions) - avg(h.holdoutRevenue, h.holdoutSessions);
  return {
    available: true,
    attribution: "holdout-proven",
    perSessionLift,
    provenRevenue: Math.round(perSessionLift * h.exposedSessions),
  };
}
