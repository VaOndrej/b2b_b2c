// MVP10 — exclusions (Free). Where the app must NOT run: whole page types
// (quick toggles) and specific URL patterns. The storefront also honours a
// per-page meta opt-out (<meta name="won-toasts:active" content="false">),
// which needs no config. Pure sanitizer; storefront enforces via url-match.

import type { PageType } from "./targeting.ts";
import { PAGE_TYPES } from "./targeting.ts";

export interface ExclusionSettings {
  /** Page types on which the app is fully suppressed. */
  pages: PageType[];
  /** URL patterns (see url-match) on which the app is fully suppressed. */
  urls: string[];
}

export const DEFAULT_EXCLUSIONS: ExclusionSettings = { pages: [], urls: [] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PAGE_SET = new Set<string>(PAGE_TYPES);

export function sanitizeExclusions(input: unknown): ExclusionSettings {
  if (!isPlainObject(input)) return { pages: [], urls: [] };

  const pages = Array.isArray(input.pages)
    ? (Array.from(
        new Set(input.pages.filter((p) => PAGE_SET.has(p as string))),
      ) as PageType[])
    : [];

  const urls = Array.isArray(input.urls)
    ? input.urls
        .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
        .map((u) => u.trim().slice(0, 200))
        .slice(0, 50)
    : [];

  return { pages, urls };
}
