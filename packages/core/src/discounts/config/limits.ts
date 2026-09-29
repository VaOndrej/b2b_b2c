// --- Limits (audit P2-1) ---------------------------------------------------------------

/**
 * Hard caps on every list that reaches ShopConfig/ConfigVersion, so a buggy or
 * hostile admin request cannot bloat storage or the per-request read. Anything over
 * a cap is dropped with a human-readable issue (never silently). The part of the
 * config the discount function reads is additionally bounded at save time by the
 * byte budget in function-config.ts (C3). Exported so the admin can explain a limit
 * instead of hard-coding the number (§4c, "no magic numbers").
 */
export const CONFIG_LIMITS = Object.freeze({
  rules: 200,
  codesPerRule: 1000,
  /** Shopify's own maximum discount code length. */
  codeLength: 255,
  tierSets: 50,
  breaksPerTierSet: 10,
  giftTiers: 10,
  campaigns: 50,
  overridesPerCampaign: 200,
  localeStringLength: 500,
  localeKeysPerLanguage: 200,
  /** Rule, tier set, gift tier and campaign ids: `[A-Za-z0-9_-]{1,64}` (see sanitizeEntityId). */
  idLength: 64,
  markets: 50,
  /** Currencies per MoneyByCurrency map (one per market at most). */
  currenciesPerAmount: 50,
  /** Items in any list of references (product/variant/collection ids, segments, rule ids, gift choices). */
  listItems: 250,
  /** Length of one reference (a Shopify GID, a market handle, a segment id). */
  referenceLength: 100,
  /**
   * Margin overrides per collection. With margin percents kept to one decimal
   * (config/margin.ts) the compact margin of 100 collections (13-digit ids) fits
   * the function config budget next to the largest codes content.
   */
  marginOverrides: 100,
  /**
   * Highest minimum margin, percent (MVP 2). The floor is cost / (1 − m/100):
   * at 100 % no price would do, and near it the floor explodes, so 95 % (the
   * price at least 20 × the cost) is the cap, in the sanitizer and the engine.
   */
  minMarginPercent: 95,
  /**
   * Highest amount of money anywhere in the config, minor units (10 000 000 000
   * CZK / EUR): far above any real price or threshold, and far below where the
   * TS engine (floats) and the Rust function (i64) could read an amount
   * differently (audit MVP 1 drift #6). Higher amounts are clamped, with an issue.
   */
  moneyMinorUnits: 1e12,
  /** Highest rule priority (0 = default); ties in the engine go to priority desc, id asc. */
  rulePriority: 1000,
  /**
   * Backstop on the WHOLE stored config (UTF-8 bytes of the sanitized JSON),
   * enforced by the app's saveConfig: 256 KiB. The per-field caps above bound
   * each list, but multiplied out (50 campaigns × 200 overrides × lists, three
   * languages × 200 texts) they still allow MBs; nothing a merchant builds by
   * hand comes near 256 KiB, and it keeps every ShopConfig/ConfigVersion row
   * small (audit P2-1, re-review of fix round 1).
   */
  storedConfigBytes: 256 * 1024,
  /**
   * The issues list itself must stay bounded (audit P3-10 followup): an input with
   * tens of thousands of invalid entries (e.g. 30 000 markets each missing a
   * handle) would otherwise push one ConfigIssue per bad entry, growing the
   * response without limit even though sanitization itself is already capped.
   * sanitizeConfig keeps only the first `maxIssues` and adds one summary issue for
   * the rest.
   */
  maxIssues: 100,
});
