// MVP8 — frequency governance (the GATE before any page-view type). Pure
// decision + state helpers; the storefront persists the state per cart token in
// sessionStorage and passes `now`. Every page-view type must pass governanceOK
// before it renders.

export interface GovernanceState {
  /** per-rule emit count this session */
  sessionCounts: Record<string, number>;
  /** per-rule last emit timestamp (for cooldown) */
  lastEmit: Record<string, number>;
  /** groupKey → dismiss timestamp (for suppress-after-dismiss) */
  dismissedAt: Record<string, number>;
  /** quiet mode: mute anything emitted before this timestamp */
  quietUntil?: number;
}

export interface GovernanceRule {
  /** stable rule identifier (counts + cooldown key off this) */
  key: string;
  /** max toasts for this rule per session (0 = never; undefined = unlimited) */
  maxPerSession?: number;
  /** minimum ms between emits of this rule */
  cooldownMs?: number;
  /** after a dismiss of the same groupKey, stay hidden this long */
  suppressAfterDismissMs?: number;
}

export function emptyGovernanceState(): GovernanceState {
  return { sessionCounts: {}, lastEmit: {}, dismissedAt: {} };
}

/** True if this rule may render `groupKey` at `now` under all governance limits. */
export function governanceOK(
  state: GovernanceState,
  rule: GovernanceRule,
  groupKey: string,
  now: number,
): boolean {
  // Quiet mode mutes everything until it expires.
  if (typeof state.quietUntil === "number" && now < state.quietUntil) {
    return false;
  }

  // Per-session cap.
  if (typeof rule.maxPerSession === "number" && rule.maxPerSession >= 0) {
    const count = state.sessionCounts[rule.key] ?? 0;
    if (count >= rule.maxPerSession) return false;
  }

  // Per-rule cooldown.
  if (typeof rule.cooldownMs === "number" && rule.cooldownMs > 0) {
    const last = state.lastEmit[rule.key];
    if (typeof last === "number" && now - last < rule.cooldownMs) return false;
  }

  // Suppress the same group after it was dismissed.
  if (
    typeof rule.suppressAfterDismissMs === "number" &&
    rule.suppressAfterDismissMs > 0
  ) {
    const dismissed = state.dismissedAt[groupKey];
    if (typeof dismissed === "number" && now - dismissed < rule.suppressAfterDismissMs) {
      return false;
    }
  }

  return true;
}

/** Record that a rule emitted at `now` (returns a new state — pure). */
export function recordEmit(
  state: GovernanceState,
  rule: GovernanceRule,
  now: number,
): GovernanceState {
  return {
    ...state,
    sessionCounts: {
      ...state.sessionCounts,
      [rule.key]: (state.sessionCounts[rule.key] ?? 0) + 1,
    },
    lastEmit: { ...state.lastEmit, [rule.key]: now },
  };
}

/** Record that a group was dismissed at `now` (returns a new state — pure). */
export function recordDismiss(
  state: GovernanceState,
  groupKey: string,
  now: number,
): GovernanceState {
  return {
    ...state,
    dismissedAt: { ...state.dismissedAt, [groupKey]: now },
  };
}

/** Enter quiet mode until `quietUntil` (returns a new state — pure). */
export function setQuietMode(
  state: GovernanceState,
  quietUntil: number,
): GovernanceState {
  return { ...state, quietUntil };
}
