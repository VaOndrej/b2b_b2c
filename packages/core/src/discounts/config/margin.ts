import { DEFAULT_CONFIG } from "./defaults.ts";
import { CONFIG_LIMITS } from "./limits.ts";
import { isRecord, pushIssue, sanitizePercent, sanitizeReference } from "./sanitize-helpers.ts";
import type { ConfigIssue, MarginCollectionOverride, MarginModule } from "./types.ts";

function sanitizeMarginOverride(v: unknown, issues: ConfigIssue[], path: string): MarginCollectionOverride | null {
  if (!isRecord(v)) return null;
  const collectionId = sanitizeReference(v.collectionId, issues, `${path}.collectionId`) ?? "";
  if (!collectionId) return null;
  const out: MarginCollectionOverride = { collectionId };
  if (typeof v.minMarginPercent === "number" && Number.isFinite(v.minMarginPercent)) {
    out.minMarginPercent = Math.min(100, Math.max(0, v.minMarginPercent));
  }
  if (typeof v.maxDiscountPercent === "number" && Number.isFinite(v.maxDiscountPercent)) {
    out.maxDiscountPercent = Math.min(100, Math.max(0, v.maxDiscountPercent));
  }
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
    global.minMarginPercent = sanitizePercent(
      g.minMarginPercent,
      0,
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
      `Only the first ${CONFIG_LIMITS.marginOverrides} collection margin settings are kept; ${perCollection.length - CONFIG_LIMITS.marginOverrides} more were dropped.`,
    );
    perCollection = perCollection.slice(0, CONFIG_LIMITS.marginOverrides);
  }
  return { global, perCollection };
}
