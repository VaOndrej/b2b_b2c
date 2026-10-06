// Storefront settings, locale texts and onboarding: never read by the function.

import { sanitizeCustomLook } from "../custom-look.ts";
import { DEFAULT_CONFIG } from "./defaults.ts";
import { APPEARANCE_PRESETS, type AppearancePreset, ONBOARDING_GOALS, type OnboardingGoal } from "./enums.ts";
import { CONFIG_LIMITS } from "./limits.ts";
import { isRecord, listParams, listPreview, preview, pushIssue, sanitizeBool } from "./sanitize-helpers.ts";
import type { ConfigIssue, LocaleDictionary, OnboardingState, StorefrontSettings } from "./types.ts";

/**
 * K7: one of APPEARANCE_PRESETS. Left out → the default, silently; anything
 * else → the default with `unknown_appearance_preset` {value, fallback}.
 */
function sanitizeAppearancePreset(v: unknown, fallback: AppearancePreset, issues: ConfigIssue[]): AppearancePreset {
  if (v === undefined) return fallback;
  if (typeof v === "string" && (APPEARANCE_PRESETS as readonly string[]).includes(v)) return v as AppearancePreset;
  pushIssue(
    issues,
    "storefront.appearancePreset",
    "unknown_appearance_preset",
    `Appearance ${preview(v, 60)} is not one of ${APPEARANCE_PRESETS.join(", ")}; "${fallback}" was used.`,
    { value: preview(v, 60), fallback },
  );
  return fallback;
}

export function sanitizeStorefront(v: unknown, issues: ConfigIssue[]): StorefrontSettings {
  const def = DEFAULT_CONFIG.storefront;
  const rec = isRecord(v) ? v : {};
  const custom = sanitizeCustomLook(rec.custom, issues);
  return {
    // A stored config without a (valid) look keeps the look it always had, the table: only a NEW shop
    // starts with DEFAULT_CONFIG's look (2026-10-06), so no existing storefront changes on its own.
    appearancePreset: sanitizeAppearancePreset(rec.appearancePreset, rec.appearancePreset === undefined && v === undefined ? def.appearancePreset : "default", issues),
    cardPricesEnabled: sanitizeBool(rec.cardPricesEnabled, def.cardPricesEnabled),
    ...(custom ? { custom } : {}),
  };
}

function sanitizeLocaleTexts(v: unknown, issues: ConfigIssue[], path: string): Record<string, string> {
  if (!isRecord(v)) return {};
  const out = new Map<string, string>();
  let overLimit = 0;
  for (const [k, val] of Object.entries(v)) {
    if (typeof val !== "string") continue;
    const key = k.slice(0, 100);
    if (key === "__proto__") continue;
    if (!out.has(key) && out.size >= CONFIG_LIMITS.localeKeysPerLanguage) {
      overLimit++;
      continue;
    }
    if (val.length > CONFIG_LIMITS.localeStringLength) {
      pushIssue(
        issues,
        `${path}.${key}`,
        "locale_text_too_long",
        `Text is longer than ${CONFIG_LIMITS.localeStringLength} characters; it was shortened.`,
        { max: CONFIG_LIMITS.localeStringLength },
      );
    }
    out.set(key, val.slice(0, CONFIG_LIMITS.localeStringLength));
  }
  if (overLimit > 0) {
    pushIssue(
      issues,
      path,
      "too_many_locale_keys",
      `Only the first ${CONFIG_LIMITS.localeKeysPerLanguage} texts per language are kept; ${overLimit} more were dropped.`,
      { max: CONFIG_LIMITS.localeKeysPerLanguage, count: overLimit },
    );
  }
  return Object.fromEntries(out);
}

export function sanitizeLocales(v: unknown, issues: ConfigIssue[]): LocaleDictionary {
  const rec = isRecord(v) ? v : {};
  return {
    cs: sanitizeLocaleTexts(rec.cs, issues, "locales.cs"),
    sk: sanitizeLocaleTexts(rec.sk, issues, "locales.sk"),
    en: sanitizeLocaleTexts(rec.en, issues, "locales.en"),
  };
}

/** Known goals only (ONBOARDING_GOALS), each once, in the merchant's order. */
function sanitizeGoals(v: unknown, issues: ConfigIssue[]): OnboardingGoal[] {
  if (!Array.isArray(v)) return [];
  const out: OnboardingGoal[] = [];
  const unknown: unknown[] = [];
  for (const goal of v) {
    if (typeof goal === "string" && (ONBOARDING_GOALS as readonly string[]).includes(goal)) {
      if (!out.includes(goal as OnboardingGoal)) out.push(goal as OnboardingGoal);
    } else {
      unknown.push(goal);
    }
  }
  if (unknown.length > 0) {
    pushIssue(
      issues,
      "onboarding.goals",
      "unknown_onboarding_goal",
      `${unknown.length} unknown onboarding goal(s) (${listPreview(unknown.map((g) => preview(g, 30)))}) were dropped; known goals: ${ONBOARDING_GOALS.join(", ")}.`,
      { count: unknown.length, ...listParams("values", unknown.map((g) => preview(g, 30))), allowed: ONBOARDING_GOALS.join(", ") },
    );
  }
  return out;
}

export function sanitizeOnboarding(v: unknown, issues: ConfigIssue[]): OnboardingState {
  const def = DEFAULT_CONFIG.onboarding;
  const rec = isRecord(v) ? v : {};
  return {
    goals: sanitizeGoals(rec.goals, issues),
    step:
      typeof rec.step === "number" && Number.isFinite(rec.step)
        ? Math.min(5, Math.max(1, Math.floor(rec.step)))
        : def.step,
  };
}
