// Minimal toast queue planning (MVP1). Given the events to show and the
// behaviour config, decide which are visible and how many overflow. Grouping,
// dedupe, rate-limiting and the conflict/summary engine arrive in MVP3 — this
// stays intentionally small so those can layer on without a rewrite.

import type { OverflowStrategy, StackDirection } from "./config.types.ts";

export interface QueuePlanOptions {
  maxVisible: number;
  stackDirection: StackDirection;
  overflowStrategy: OverflowStrategy;
}

export interface QueuePlan<T> {
  /** Ordered for rendering: index 0 is the slot nearest the stack origin. */
  visible: T[];
  /** How many incoming toasts did not fit the visible cap. */
  overflowCount: number;
}

/**
 * Order newest-first or newest-last per config, then cap at maxVisible. The
 * caller passes events oldest→newest; "newest-top" surfaces the newest event
 * in slot 0.
 */
export function planToastQueue<T>(
  incomingOldestFirst: readonly T[],
  { maxVisible, stackDirection }: QueuePlanOptions,
): QueuePlan<T> {
  const cap = Number.isFinite(maxVisible) && maxVisible > 0 ? maxVisible : 1;
  const ordered =
    stackDirection === "newest-top"
      ? [...incomingOldestFirst].reverse()
      : [...incomingOldestFirst];
  const visible = ordered.slice(0, cap);
  const overflowCount = Math.max(0, incomingOldestFirst.length - cap);
  return { visible, overflowCount };
}
