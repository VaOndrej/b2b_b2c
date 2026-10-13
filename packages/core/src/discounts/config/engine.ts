import { sanitizeCombineTypes } from "./combine.ts";
import { DEFAULT_CONFIG } from "./defaults.ts";
import { UNKNOWN_MARKET_KINDS } from "./enums.ts";
import { isRecord } from "./sanitize-helpers.ts";
import type { ConfigIssue, EngineSettings } from "./types.ts";

export function sanitizeEngine(v: unknown, issues: ConfigIssue[]): EngineSettings {
  const rec = isRecord(v) ? v : {};
  const given = Array.isArray(rec.unknownMarketHighest) ? rec.unknownMarketHighest : [];
  const highest = UNKNOWN_MARKET_KINDS.filter((kind) => given.includes(kind));
  return {
    combineDefault: sanitizeCombineTypes(rec.combineDefault, DEFAULT_CONFIG.engine.combineDefault, "engine.combineDefault", issues),
    ...(rec.unknownMarketLowest === true ? { unknownMarketLowest: true as const } : {}),
    ...(highest.length > 0 ? { unknownMarketHighest: highest } : {}),
  };
}
