// MVP13e — AI advisor orchestration (on-demand "AI Optimize"). Assembles the
// per-type success context, calls Claude, validates the structured JSON via
// @won/core/toasts/ai-advisor-v2, and caches by config-hash so we never re-run
// the LLM for an unchanged config (decision #8: on-demand, cache by config-hash,
// no periodic LLM). The LLM call is injected so this is fully unit-testable with
// a mock; the default caller uses the Claude API (claude-opus-4-8) over fetch.

import {
  buildAdvisorContext,
  parseAdvisorResponse,
  type AdvisorSuggestion,
  type TypeContext,
} from "@won/core/toasts/ai-advisor-v2";
import {
  successMetric,
  metricKindForType,
  defaultGoalForType,
} from "@won/core/toasts/insights-metrics";
import { emptyRollupCounters, mergeCounters, dateKeyUTC, type RollupCounters } from "@won/core/toasts/insights";
import { hashToken } from "@won/core/toasts/experiments";
import type { TypeBenchmark } from "@won/core/toasts/benchmarks";

import { getRawConfig } from "./toast-config.server";
import { readRollups, crossStoreBenchmark } from "./analytics.server";

const CACHE_TTL_MS = 6 * 3_600_000; // 6h
const WINDOW_DAYS = 30;

// Honest, per-type framing baked into the prompt so the model never judges an
// informational toast by CTR.
const PROMPT_PREAMBLE =
  "You are a Shopify toast-notification optimization advisor. Return ONLY a JSON " +
  "object {\"suggestions\":[...]}. Each suggestion: {action, type, value?, rationale}. " +
  "Actions: shorten_duration, lengthen_duration, move_position, change_goal, " +
  "change_cooldown, switch_look, enable_rule, disable_rule. Judge each toast by its " +
  "OWN metric (action=CTR, informational=read-through, cart=AOV). NEVER suggest " +
  "disabling an informational toast for low clicks. Context:\n";

export interface AdvisorDeps {
  loadTypeContext: (
    shop: string,
  ) => Promise<{ types: Record<string, TypeContext>; benchmark: Record<string, { readRateP50?: number; ctrP50?: number }> }>;
  configHash: (shop: string) => Promise<string>;
  generate: (prompt: string) => Promise<string>;
}

export interface OptimizeResult {
  suggestions: AdvisorSuggestion[];
  cached: boolean;
  available: boolean;
}

export function createAdvisorService(deps: AdvisorDeps) {
  const cache = new Map<string, { hash: string; at: number; suggestions: AdvisorSuggestion[] }>();

  async function optimize(shop: string, now: number = Date.now()): Promise<OptimizeResult> {
    const hash = await deps.configHash(shop).catch(() => "");
    const cached = cache.get(shop);
    if (cached && cached.hash === hash && now - cached.at < CACHE_TTL_MS) {
      return { suggestions: cached.suggestions, cached: true, available: true };
    }

    const { types, benchmark } = await deps.loadTypeContext(shop);
    const context = buildAdvisorContext({ types, benchmark });

    let raw: string;
    try {
      raw = await deps.generate(PROMPT_PREAMBLE + context);
    } catch {
      // LLM unavailable (no key / network) — degrade honestly, suggest nothing.
      return { suggestions: [], cached: false, available: false };
    }

    const suggestions = parseAdvisorResponse(raw, types);
    cache.set(shop, { hash, at: now, suggestions });
    return { suggestions, cached: false, available: true };
  }

  return { optimize };
}

// ---- production wiring ----------------------------------------------------

/** Assemble per-type context from this shop's rollups + the cross-store benchmark. */
async function loadTypeContext(shop: string) {
  const since = dateKeyUTC(Date.now() - WINDOW_DAYS * 86_400_000);
  const [rollups, cohort] = await Promise.all([
    readRollups(shop, since),
    crossStoreBenchmark(since, 10).catch(() => ({}) as Record<string, TypeBenchmark>),
  ]);

  const byType = new Map<string, RollupCounters>();
  for (const r of rollups) {
    byType.set(r.dims.type, mergeCounters(byType.get(r.dims.type) ?? emptyRollupCounters(), r.counters));
  }

  const types: Record<string, TypeContext> = {};
  for (const [type, counters] of byType) {
    const m = successMetric(type, counters, defaultGoalForType(type));
    types[type] = {
      metricKind: metricKindForType(type),
      goal: m.goal,
      ctr: m.rates.ctr,
      readThroughRate: m.rates.readThroughRate,
      sample: m.sample,
    };
  }

  const benchmark: Record<string, { readRateP50?: number; ctrP50?: number }> = {};
  for (const type of Object.keys(cohort)) {
    benchmark[type] = { readRateP50: cohort[type].readRate.p50, ctrP50: cohort[type].ctr.p50 };
  }

  return { types, benchmark };
}

async function configHash(shop: string): Promise<string> {
  const cfg = await getRawConfig(shop).catch(() => ({}));
  return String(hashToken(JSON.stringify(cfg)));
}

/** Default LLM caller — Claude API over fetch (no SDK dependency). On-demand only. */
async function callClaude(prompt: string): Promise<string> {
  // eslint-disable-next-line no-undef
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`advisor LLM ${res.status}`);
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
  return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
}

const advisorService = createAdvisorService({ loadTypeContext, configHash, generate: callClaude });

export const optimizeToasts = advisorService.optimize;
