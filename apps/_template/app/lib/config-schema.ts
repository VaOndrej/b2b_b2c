// STARTER PATTERN — config safety (doctrine DATA-2 + DATA-3). Copy + adapt this
// for your app's config. The rules that make it safe:
//   • server-side sanitize: an invalid/partial/unknown-shaped config can't be
//     persisted or rendered — every field is validated + clamped, unknowns dropped;
//   • strong defaults fill gaps, so a shop that never touched a setting still works;
//   • a SCHEMA_VERSION + tolerant reader means an OLDER stored shape still renders
//     after a deploy (migrations are additive, never a silent break).
// Wire it up: store `{ version: SCHEMA_VERSION, ...sanitizeConfig(input) }` as JSON
// on your Prisma model, and read it back through readStoredConfig(row.data).

export const SCHEMA_VERSION = 1;

export interface AppConfig {
  enabled: boolean;
  label: string;
  /** Example numeric setting with hard bounds. */
  limit: number;
}

export const DEFAULT_CONFIG: AppConfig = {
  enabled: false,
  label: "",
  limit: 10,
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Validate + clamp arbitrary input into a complete, safe config. Unknown keys are
 * dropped; missing/invalid fields fall back to the default. Never throws.
 */
export function sanitizeConfig(input: unknown): AppConfig {
  if (!isRecord(input)) return { ...DEFAULT_CONFIG };
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_CONFIG.enabled,
    label:
      typeof input.label === "string" ? input.label.slice(0, 200) : DEFAULT_CONFIG.label,
    limit: clampInt(input.limit, 0, 1000, DEFAULT_CONFIG.limit),
  };
}

/**
 * Tolerant reader for a stored row's JSON — accepts any prior shape and returns a
 * complete current-version config (DATA-3). Re-runs the sanitizer so an older or
 * partial persisted shape is upgraded/default-filled on read.
 */
export function readStoredConfig(stored: unknown): AppConfig {
  if (!isRecord(stored)) return { ...DEFAULT_CONFIG };
  // (If you add breaking shape changes, branch on stored.version here before
  //  sanitizing — older versions get migrated forward, never rejected.)
  return sanitizeConfig(stored);
}
