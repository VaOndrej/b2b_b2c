import { SCHEMA_VERSION } from "./enums.ts";
import type { ReadonlyDeep, WonDiscountsConfig } from "./types.ts";

// --- Defaults ------------------------------------------------------------------------

/**
 * The shared defaults. Deep-frozen (audit P1-1, SEC-2): it is one object per
 * process, so a caller that mutated it would leak its change into every other
 * shop that falls back to the default. Never hand this object out as a shop's
 * config — use createDefaultConfig() / readStoredConfig() for a fresh copy.
 */
export const DEFAULT_CONFIG: ReadonlyDeep<WonDiscountsConfig> = deepFreeze<WonDiscountsConfig>({
  schemaVersion: SCHEMA_VERSION,
  markets: [],
  // Combining (combine.ts), a new shop: price discounts — automatic, with a code, quantity tiers — never add up
  // with each other (the better one wins); free shipping and the rewards of Milníky add to any of them; a line
  // on sale takes nothing else.
  engine: { combineDefault: ["shipping", "rewards"] },
  modules: {
    codes: { rules: [] },
    tiers: { sets: [], combine: { types: ["shipping", "rewards"] } },
    rewards: { gifts: [], countOtherDiscounts: false, giftDeclinable: true, combine: { types: ["automatic", "code", "shipping", "tiers", "rewards"] } },
    outlet: { display: "strike_badge", reopenOnReturnAfterEnd: "ask", combine: { types: [] } },
    margin: { enabled: false, global: { maxDiscountPercent: 50 }, perCollection: [], perProduct: [] },
  },
  campaigns: [],
  // A new shop starts with the highlighted look (plan 2026-10-06, dávka 5); a stored value is never changed by this.
  storefront: { cardPricesEnabled: false, looks: { tiers: { preset: "highlight" } } },
  locales: {},
  onboarding: { goals: [], step: 1 },
});

function deepFreeze<T>(value: T): ReadonlyDeep<T> {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as ReadonlyDeep<T>;
}

/** A fresh, mutable copy of the defaults: what a shop with no stored config gets. */
export function createDefaultConfig(): WonDiscountsConfig {
  // DEFAULT_CONFIG is plain JSON data by construction, so a JSON round trip is an
  // exact deep copy (and works in runtimes without structuredClone).
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as WonDiscountsConfig;
}
