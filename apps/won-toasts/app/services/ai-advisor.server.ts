// MVP13 — AI advisor server bridge. Calls Claude with a strict JSON contract and
// validates the response through @won/core (invalid → dropped). With no API key
// it falls back to the deterministic rule-based advisor, so the feature always
// returns something defensible. Suggestions are proposals — the merchant applies.

import {
  buildAdvisorContext,
  parseAdvisorResponse,
  ruleBasedSuggestions,
  type AdvisorSuggestion,
} from "@won/core/toasts/ai-advisor";
import type { RuleCounters } from "@won/core/toasts/analytics";

const MODEL = "claude-sonnet-5";

const SYSTEM = [
  "You are a Shopify merchant advisor for the Won Toasts app.",
  "You get real per-rule toast metrics (impressions, ctr, dismissRate, undoRate).",
  "Return ONLY JSON: {\"suggestions\":[{\"action\",\"ruleId\",\"rationale\",\"value\"?}]}.",
  "Allowed actions: disable_rule, enable_rule, shorten_duration, move_position, adjust_threshold.",
  "Be concrete and grounded in the numbers. Never fabricate metrics. A toast is an assist, not attributed revenue.",
].join(" ");

export interface AdvisorResult {
  source: "ai" | "rules";
  suggestions: AdvisorSuggestion[];
}

export async function adviseFromMetrics(
  countersByRule: Record<string, RuleCounters>,
): Promise<AdvisorResult> {
  const fallback = ruleBasedSuggestions(countersByRule);
  // eslint-disable-next-line no-undef
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { source: "rules", suggestions: fallback };

  try {
    const context = buildAdvisorContext(countersByRule);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: `Per-rule metrics (JSON): ${context}\n\nReturn your JSON suggestions.`,
          },
        ],
      }),
    });
    if (!res.ok) return { source: "rules", suggestions: fallback };
    const data = (await res.json()) as {
      content?: Array<{ text?: string }>;
    };
    const text = data?.content?.[0]?.text ?? "";
    const parsed = parseAdvisorResponse(text);
    return parsed.length
      ? { source: "ai", suggestions: parsed }
      : { source: "rules", suggestions: fallback };
  } catch {
    return { source: "rules", suggestions: fallback };
  }
}
