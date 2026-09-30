import { DEFAULT_CONFIG } from "./defaults.ts";
import { CONFIG_LIMITS } from "./limits.ts";
import { isRecord, preview, pushIssue, sanitizeBoolWithIssue, sanitizeReference } from "./sanitize-helpers.ts";
import type { ConfigIssue, MarginCollectionOverride, MarginModule } from "./types.ts";

// Margin percents (MVP 2) keep ONE decimal, rounded to the stricter side: a
// minimum margin up, a maximum discount down — never a larger discount than the
// merchant set. Together with CONFIG_LIMITS.marginOverrides (50) this bounds
// the compact margin in the function payload: no collection entry is longer than
// `"1234567890123":[94.9,99.9]`, so the worst case fits the 9 000 B budget next
// to the largest codes content and a realistic Pro tier setup
// (tests/discounts/margin-sync.test.ts). A count
// limit alone could not guarantee that: an unrounded float such as
// 33.333333333333336 is 18 bytes on its own.

/** Tolerance of the one-decimal rounding (0.1 × 3 = 0.30000000000000004 stays 0.3, no issue). */
const ROUNDING_EPSILON = 1e-9;

type Stricter = "up" | "down";

function roundToTenth(n: number, direction: Stricter): number {
  const tenths = direction === "up" ? Math.ceil(n * 10 - ROUNDING_EPSILON) : Math.floor(n * 10 + ROUNDING_EPSILON);
  // Never -0: rounding 0 (or a tiny positive) up is the ceil of a tiny negative,
  // which is -0 — equal to 0 for every comparison, but printed "-0" by
  // Intl.NumberFormat and kept apart by Object.is.
  return tenths === 0 ? 0 : tenths / 10;
}

/**
 * One margin percent, with at most ONE issue: absent → `fallback` (silently);
 * not a finite number → `fallback` (invalid_percent); outside 0–`max` → clamped
 * (clamped_percent); more than one decimal → rounded to the stricter tenth
 * (rounded_percent).
 */
function marginPercent<F extends number | undefined>(
  v: unknown,
  opts: { max: number; direction: Stricter; fallback: F; fallbackText: string },
  path: string,
  issues: ConfigIssue[],
): number | F {
  if (v === undefined) return opts.fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    pushIssue(issues, path, "invalid_percent", `Expected a number between 0 and ${opts.max}, got ${preview(v)}; ${opts.fallbackText}.`, {
      min: 0,
      max: opts.max,
      value: preview(v),
      ...(opts.fallback === undefined ? { fallback: "global" } : { fallback: opts.fallback }),
    });
    return opts.fallback;
  }
  if (v < 0 || v > opts.max) {
    const clamped = Math.min(opts.max, Math.max(0, v));
    pushIssue(issues, path, "clamped_percent", `Percent ${v} is out of range 0-${opts.max}; clamped to ${clamped}.`, {
      value: v,
      min: 0,
      max: opts.max,
      to: clamped,
    });
    return clamped;
  }
  const rounded = roundToTenth(v, opts.direction);
  if (Math.abs(rounded - v) > ROUNDING_EPSILON) {
    pushIssue(
      issues,
      path,
      "rounded_percent",
      `Margin percents keep one decimal; ${v} was rounded to ${rounded} (the stricter side, never a larger discount).`,
      { value: v, to: rounded, decimals: 1 },
    );
  }
  return rounded;
}

const MIN_MARGIN = { max: CONFIG_LIMITS.minMarginPercent, direction: "up" } as const;
const MAX_DISCOUNT = { max: 100, direction: "down" } as const;

function sanitizeMarginOverride(v: unknown, issues: ConfigIssue[], path: string): MarginCollectionOverride | null {
  if (!isRecord(v)) return null;
  const collectionId = sanitizeReference(v.collectionId, issues, `${path}.collectionId`) ?? "";
  if (!collectionId) return null;
  const out: MarginCollectionOverride = { collectionId };
  const inherit = { fallback: undefined, fallbackText: "the global value applies" };
  const min = marginPercent(v.minMarginPercent, { ...MIN_MARGIN, ...inherit }, `${path}.minMarginPercent`, issues);
  if (min !== undefined) out.minMarginPercent = min;
  const max = marginPercent(v.maxDiscountPercent, { ...MAX_DISCOUNT, ...inherit }, `${path}.maxDiscountPercent`, issues);
  if (max !== undefined) out.maxDiscountPercent = max;
  return out;
}

export function sanitizeMargin(v: unknown, issues: ConfigIssue[]): MarginModule {
  const def = DEFAULT_CONFIG.modules.margin;
  const rec = isRecord(v) ? v : {};
  const g = isRecord(rec.global) ? rec.global : {};
  const defaultMax = def.global.maxDiscountPercent;
  const global: MarginModule["global"] = {
    maxDiscountPercent: marginPercent(
      g.maxDiscountPercent,
      { ...MAX_DISCOUNT, fallback: defaultMax, fallbackText: `using default ${defaultMax}` },
      "modules.margin.global.maxDiscountPercent",
      issues,
    ),
  };
  if (g.minMarginPercent !== undefined) {
    global.minMarginPercent = marginPercent(
      g.minMarginPercent,
      { ...MIN_MARGIN, fallback: 0, fallbackText: "using 0 (never below the cost)" },
      "modules.margin.global.minMarginPercent",
      issues,
    );
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
      `At most ${CONFIG_LIMITS.marginOverrides} collections can have their own margin setting (the discount function reads them from a size-limited config); the first ${CONFIG_LIMITS.marginOverrides} are kept, ${perCollection.length - CONFIG_LIMITS.marginOverrides} more were dropped.`,
      { max: CONFIG_LIMITS.marginOverrides, count: perCollection.length - CONFIG_LIMITS.marginOverrides },
    );
    perCollection = perCollection.slice(0, CONFIG_LIMITS.marginOverrides);
  }
  // Off unless the merchant turned it on: a config stored before MVP 2 has no key and stays off.
  const enabled = sanitizeBoolWithIssue(rec.enabled, def.enabled, "modules.margin.enabled", issues);
  return { enabled, global, perCollection };
}
