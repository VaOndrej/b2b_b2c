// Milestone state machine — the reason "You have free shipping!" fires ONCE at
// the crossing instead of on every cart change. Pure: given the previous and
// next measured value (e.g. eligible subtotal) and a threshold, it classifies
// the transition. The caller persists announced flags per cart token.

export type MilestoneState =
  | "unreached"
  | "approaching"
  | "just_reached"
  | "reached"
  | "just_lost";

export interface MilestoneReading {
  state: MilestoneState;
  /** How much more is needed to reach the threshold (0 once reached). */
  remaining: number;
  /** 0..1 progress toward the threshold (capped at 1). */
  progress: number;
}

/**
 * Classify the transition from `prevValue` to `nextValue` against `threshold`.
 * `approachRatio` (default 0.8) is where "approaching" begins. Crossing up =
 * just_reached; dropping below after being at/above = just_lost; re-crossing
 * yields just_reached again (the caller resets its announced flag on just_lost).
 */
export function milestoneState(
  prevValue: number,
  nextValue: number,
  threshold: number,
  approachRatio = 0.8,
): MilestoneReading {
  const safeThreshold = threshold > 0 ? threshold : 1;
  const remaining = Math.max(0, safeThreshold - nextValue);
  const progress = Math.min(1, nextValue / safeThreshold);

  const prevReached = prevValue >= safeThreshold;
  const nextReached = nextValue >= safeThreshold;

  let state: MilestoneState;
  if (nextReached) {
    state = prevReached ? "reached" : "just_reached";
  } else if (prevReached) {
    state = "just_lost";
  } else if (nextValue >= safeThreshold * approachRatio) {
    state = "approaching";
  } else {
    state = "unreached";
  }

  return { state, remaining, progress };
}

/** A milestone toast should fire only on a fresh upward crossing. */
export function isFreshMilestone(state: MilestoneState): boolean {
  return state === "just_reached";
}
