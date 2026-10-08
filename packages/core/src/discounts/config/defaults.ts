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
  engine: {
    combination: {
      outletWithAnything: false,
      productWithProduct: "best",
      productWithOrder: true,
      productWithShipping: true,
      orderWithShipping: true,
    },
  },
  modules: {
    codes: { rules: [] },
    tiers: { sets: [] },
    rewards: { gifts: [], countOtherDiscounts: false, giftDeclinable: true },
    outlet: { display: "strike_badge", reopenOnReturnAfterEnd: "ask" },
    margin: { enabled: false, global: { maxDiscountPercent: 50 }, perCollection: [] },
  },
  campaigns: [],
  // A new shop starts with the highlighted look (plan 2026-10-06, dávka 5); a stored value is never changed by this.
  storefront: { appearancePreset: "highlight", cardPricesEnabled: false, looks: {} },
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
