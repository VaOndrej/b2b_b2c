import { DEFAULT_CONFIG } from "./defaults.ts";
import { CONFIG_LIMITS } from "./limits.ts";
import { isRecord, preview, pushIssue, sanitizeBoolWithIssue, sanitizePercent, sanitizeReference } from "./sanitize-helpers.ts";
import type { ConfigIssue, MarginCollectionOverride, MarginModule } from "./types.ts";

/**
 * A margin percent of an override: absent → absent; not a finite number →
 * dropped with an issue (the global value then applies); outside 0–`max` →
 * clamped with an issue.
 */
function overridePercent(v: unknown, max: number, path: string, issues: ConfigIssue[]): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    pushIssue(issues, path, "invalid_percent", `Expected a number between 0 and ${max}, got ${preview(v)}; the global value applies.`);
    return undefined;
  }
  return clampWithIssue(v, max, path, issues);
}

function clampWithIssue(n: number, max: number, path: string, issues: ConfigIssue[]): number {
  if (n >= 0 && n <= max) return n;
  const clamped = Math.min(max, Math.max(0, n));
  pushIssue(issues, path, "clamped_percent", `Percent ${n} is out of range 0-${max}; clamped to ${clamped}.`);
  return clamped;
}

function sanitizeMarginOverride(v: unknown, issues: ConfigIssue[], path: string): MarginCollectionOverride | null {
  if (!isRecord(v)) return null;
  const collectionId = sanitizeReference(v.collectionId, issues, `${path}.collectionId`) ?? "";
  if (!collectionId) return null;
  const out: MarginCollectionOverride = { collectionId };
  const min = overridePercent(v.minMarginPercent, CONFIG_LIMITS.minMarginPercent, `${path}.minMarginPercent`, issues);
  if (min !== undefined) out.minMarginPercent = min;
  const max = overridePercent(v.maxDiscountPercent, 100, `${path}.maxDiscountPercent`, issues);
  if (max !== undefined) out.maxDiscountPercent = max;
  return out;
}

export function sanitizeMargin(v: unknown, issues: ConfigIssue[]): MarginModule {
  const def = DEFAULT_CONFIG.modules.margin;
  const rec = isRecord(v) ? v : {};
  const g = isRecord(rec.global) ? rec.global : {};
  const global: MarginModule["global"] = {
    maxDiscountPercent: sanitizePercent(
      g.maxDiscountPercent,
      def.global.maxDiscountPercent,
      "modules.margin.global.maxDiscountPercent",
      issues,
    ),
  };
  if (g.minMarginPercent !== undefined) {
    const path = "modules.margin.global.minMarginPercent";
    // sanitizePercent handles junk (→ 0) and 0–100; the margin cap is lower (95).
    global.minMarginPercent = clampWithIssue(sanitizePercent(g.minMarginPercent, 0, path, issues), CONFIG_LIMITS.minMarginPercent, path, issues);
  }
  let perCollection = Array.isArray(rec.perCollection)
    ? rec.perCollection
        .map((item, i) => sanitizeMarginOverride(item, issues, `modules.margin.perCollection[${i}]`))
        .filter((x): x is MarginCollectionOverride => x !== null)
    : [];
  if (perCollection.length > CONFIG_LIMITS.marginOverrides) {
    pushIssue(
      issues,
      "modules.margin.perCollection",
      "too_many_margin_overrides",
      `Only the first ${CONFIG_LIMITS.marginOverrides} collection margin settings are kept; ${perCollection.length - CONFIG_LIMITS.marginOverrides} more were dropped.`,
    );
    perCollection = perCollection.slice(0, CONFIG_LIMITS.marginOverrides);
  }
  // Off unless the merchant turned it on: a config stored before MVP 2 has no key and stays off.
  const enabled = sanitizeBoolWithIssue(rec.enabled, def.enabled, "modules.margin.enabled", issues);
  return { enabled, global, perCollection };
}
