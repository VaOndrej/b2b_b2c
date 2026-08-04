// MVP13 — AI advisor with SUBSTANCE. The LLM (Claude) is asked to return a
// strict JSON action list, which this module validates before anything reaches
// the merchant (invalid → dropped, never applied blindly). A deterministic
// rule-based fallback runs with no API key so the feature always does something
// useful and stays unit-testable. Suggestions are proposals — the merchant
// confirms before they apply.

import type { RuleCounters } from "./analytics.ts";
import { computeMetrics } from "./analytics.ts";

export type AdvisorAction =
  | "disable_rule"
  | "enable_rule"
  | "shorten_duration"
  | "move_position"
  | "adjust_threshold";

export const ADVISOR_ACTIONS: readonly AdvisorAction[] = [
  "disable_rule",
  "enable_rule",
  "shorten_duration",
  "move_position",
  "adjust_threshold",
];

export interface AdvisorSuggestion {
  action: AdvisorAction;
  ruleId?: string;
  rationale: string;
  /** Optional numeric/string parameter (e.g. new durationMs, new position). */
  value?: number | string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate a raw LLM response into a safe suggestion list. Accepts either
 * `{ suggestions: [...] }` or a bare array. Unknown actions and entries missing
 * a rationale are dropped. Never throws — bad input yields [].
 */
export function parseAdvisorResponse(json: string | unknown): AdvisorSuggestion[] {
  let parsed: unknown = json;
  if (typeof json === "string") {
    try {
      parsed = JSON.parse(json);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(parsed)
    ? parsed
    : isPlainObject(parsed) && Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : null;
  if (!list) return [];

  const out: AdvisorSuggestion[] = [];
  for (const raw of list) {
    if (!isPlainObject(raw)) continue;
    const action = raw.action;
    if (
      typeof action !== "string" ||
      !(ADVISOR_ACTIONS as readonly string[]).includes(action)
    ) {
      continue;
    }
    const rationale = typeof raw.rationale === "string" ? raw.rationale.trim() : "";
    if (!rationale) continue;
    const suggestion: AdvisorSuggestion = {
      action: action as AdvisorAction,
      rationale: rationale.slice(0, 300),
    };
    if (typeof raw.ruleId === "string" && raw.ruleId) {
      suggestion.ruleId = raw.ruleId.slice(0, 60);
    }
    if (typeof raw.value === "number" || typeof raw.value === "string") {
      suggestion.value = raw.value;
    }
    out.push(suggestion);
    if (out.length >= 20) break;
  }
  return out;
}

/** Compact JSON metrics summary used as the LLM prompt context. */
export function buildAdvisorContext(
  countersByRule: Record<string, RuleCounters>,
): string {
  const rows = Object.keys(countersByRule).map((ruleId) => {
    const m = computeMetrics(countersByRule[ruleId]);
    return {
      ruleId,
      impressions: m.impressions,
      ctr: Number(m.ctr.toFixed(3)),
      dismissRate: Number(m.dismissRate.toFixed(3)),
      undoRate: Number(m.undoRate.toFixed(3)),
    };
  });
  return JSON.stringify(rows);
}

/**
 * Deterministic, no-LLM fallback (also a sane default the LLM output is graded
 * against). Flags concrete, defensible actions from REAL metrics:
 *  - high-impression, zero-click rule → disable
 *  - very high dismiss rate → shorten duration
 */
export function ruleBasedSuggestions(
  countersByRule: Record<string, RuleCounters>,
): AdvisorSuggestion[] {
  const out: AdvisorSuggestion[] = [];
  for (const ruleId of Object.keys(countersByRule)) {
    const c = countersByRule[ruleId];
    const m = computeMetrics(c);
    if (m.impressions >= 100 && m.clicks === 0) {
      out.push({
        action: "disable_rule",
        ruleId,
        rationale: `${m.impressions} impressions, 0 clicks — no measurable value.`,
      });
    } else if (m.impressions >= 50 && m.dismissRate >= 0.6) {
      out.push({
        action: "shorten_duration",
        ruleId,
        rationale: `High dismiss rate (${Math.round(m.dismissRate * 100)}%) — try a shorter, less intrusive toast.`,
        value: 2500,
      });
    }
  }
  return out;
}
