// MVP13e — AI advisor WITH SUBSTANCE (re-enabled on per-type metrics).
//
// The parked v1 advisor (./ai-advisor.ts) stood on a wrong premise: it flagged
// high-impression / zero-click rules as low value. That is exactly wrong for
// informational toasts ("Added to cart" is read, not clicked). This v2 module:
//   • builds context from PER-TYPE success metrics + benchmarks + holdout,
//   • validates the LLM's structured JSON before anything reaches the merchant,
//   • REQUIRES evidence on every suggestion (explainability, no black box),
//   • hard-refuses "disable this informational toast because 0 CTR",
//   • gates auto-pilot to safe levers + a daily cap, off by default.
//
// The LLM call itself lives in the app layer (on-demand, cached by config-hash);
// this module is pure and deterministic so it is fully unit-testable with a mock
// LLM response. Every suggestion is applied via an experiment (MVP13c), never
// straight to the live store.

export type AdvisorAction =
  | "shorten_duration"
  | "lengthen_duration"
  | "move_position"
  | "change_goal"
  | "change_cooldown"
  | "switch_look"
  | "enable_rule"
  | "disable_rule";

export const ADVISOR_ACTIONS: readonly AdvisorAction[] = [
  "shorten_duration",
  "lengthen_duration",
  "move_position",
  "change_goal",
  "change_cooldown",
  "switch_look",
  "enable_rule",
  "disable_rule",
];

/** Levers auto-pilot may pull on its own — never enabling/disabling rules
 *  (decision #12: safe levers only). */
export const SAFE_AUTOPILOT_LEVERS: readonly AdvisorAction[] = [
  "shorten_duration",
  "lengthen_duration",
  "move_position",
  "change_cooldown",
  "switch_look",
];

export interface AdvisorEvidence {
  impressions: number;
  metricKind: string;
  goal: string;
  [k: string]: number | string;
}

export interface AdvisorSuggestion {
  action: AdvisorAction;
  type?: string;
  value?: number | string;
  rationale: string;
  evidence: AdvisorEvidence;
}

/** What the advisor knows about one toast type when validating a suggestion. */
export interface TypeContext {
  metricKind: "action" | "informational" | "cart";
  goal: string;
  ctr: number;
  readThroughRate: number;
  sample: number;
}

// ---- context builder -----------------------------------------------------

export function buildAdvisorContext(input: {
  types: Record<string, TypeContext>;
  benchmark?: Record<string, { readRateP50?: number; ctrP50?: number }>;
  holdout?: { available: boolean; provenRevenue?: number };
}): string {
  const rows = Object.keys(input.types).map((type) => {
    const t = input.types[type];
    const bench = input.benchmark?.[type];
    return {
      type,
      metricKind: t.metricKind,
      goal: t.goal,
      // Only the metric that matters for this kind is emphasised — the LLM must
      // NOT judge an informational toast by CTR.
      primaryMetric:
        t.metricKind === "action"
          ? { ctr: round(t.ctr) }
          : { readThroughRate: round(t.readThroughRate) },
      sample: t.sample,
      ...(bench ? { benchmark: bench } : {}),
    };
  });
  return JSON.stringify({
    guidance:
      "Judge each toast by its OWN metric: action=CTR, informational=read-through (clicks are NOT value for informational toasts), cart=AOV via holdout. Never recommend disabling an informational toast for low clicks.",
    holdout: input.holdout ?? { available: false },
    types: rows,
  });
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---- response validation -------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validate a raw LLM response into safe, evidence-bearing suggestions. Applies
 * the informational-toast guard. Never throws — bad input yields [].
 */
export function parseAdvisorResponse(
  json: string | unknown,
  typeInfo: Record<string, TypeContext>,
): AdvisorSuggestion[] {
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
    if (typeof action !== "string" || !(ADVISOR_ACTIONS as readonly string[]).includes(action)) {
      continue;
    }
    const rationale = typeof raw.rationale === "string" ? raw.rationale.trim() : "";
    if (!rationale) continue;

    const type = typeof raw.type === "string" && raw.type ? raw.type.slice(0, 60) : undefined;
    const ctx = type ? typeInfo[type] : undefined;

    // GUARD: refuse to disable an informational toast that is still being read.
    // (The premise "0 CTR = no value" is wrong for informational toasts.)
    if (action === "disable_rule" && ctx?.metricKind === "informational" && ctx.readThroughRate >= 0.1) {
      continue;
    }

    // Evidence is required — synthesize from the trusted context if the LLM
    // omitted it, so nothing is a black box.
    const rawEvidence = isPlainObject(raw.evidence) ? raw.evidence : {};
    const evidence: AdvisorEvidence = {
      impressions:
        typeof rawEvidence.impressions === "number"
          ? rawEvidence.impressions
          : (ctx?.sample ?? 0),
      metricKind: ctx?.metricKind ?? "informational",
      goal: ctx?.goal ?? "read_through",
    };
    if (ctx) {
      if (ctx.metricKind === "action") evidence.ctr = round(ctx.ctr);
      else evidence.readThroughRate = round(ctx.readThroughRate);
    }

    const suggestion: AdvisorSuggestion = {
      action: action as AdvisorAction,
      rationale: rationale.slice(0, 300),
      evidence,
    };
    if (type) suggestion.type = type;
    if (typeof raw.value === "number" || typeof raw.value === "string") suggestion.value = raw.value;

    out.push(suggestion);
    if (out.length >= 20) break;
  }
  return out;
}

// ---- auto-pilot ----------------------------------------------------------

/**
 * Map a suggestion to a config OVERLAY (a partial config) so it can be applied
 * as an experiment variant (MVP13c live A/B). Only the safe levers that map to a
 * concrete config field are supported; anything else (disable/enable/change_goal,
 * which need merchant judgement or a target) returns null and must be applied
 * manually. `move_position`/`change_cooldown` are global; duration/look are
 * per-type when a type is given.
 */
export function suggestionToOverlay(s: AdvisorSuggestion): Record<string, unknown> | null {
  const num = typeof s.value === "number" ? s.value : Number(s.value);
  switch (s.action) {
    case "shorten_duration":
    case "lengthen_duration":
      if (!Number.isFinite(num)) return null;
      return s.type
        ? { byType: { [s.type]: { behavior: { durationMs: num } } } }
        : { global: { durationMs: num } };
    case "move_position":
      if (typeof s.value !== "string" || !s.value) return null;
      return { global: { position: s.value } };
    case "change_cooldown":
      if (!Number.isFinite(num)) return null;
      return { global: { frequency: { cooldownMs: num } } };
    case "switch_look":
      if (typeof s.value !== "string" || !s.value) return null;
      return { theme: { mode: s.value } };
    default:
      return null;
  }
}

export interface AutoPilotConfig {
  enabled: boolean;
  /** Max experiments auto-pilot may start per day (decision #12: 1). */
  dailyCap: number;
}

/**
 * Whether auto-pilot may act on a suggestion now. Off by default; only safe
 * levers (never enable/disable); respects the daily experiment cap. Guardrail
 * enforcement (auto-rollback on a bad live metric) is the experiment engine's
 * job — this only decides whether to START.
 */
export function autoPilotAllows(
  config: AutoPilotConfig,
  suggestion: AdvisorSuggestion,
  state: { experimentsToday: number },
): boolean {
  if (!config?.enabled) return false;
  if (!(SAFE_AUTOPILOT_LEVERS as readonly string[]).includes(suggestion.action)) return false;
  if (state.experimentsToday >= (config.dailyCap ?? 1)) return false;
  return true;
}
