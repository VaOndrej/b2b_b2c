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
  /**
   * Longest Won discount code, characters (UTF-16 units, trimmed and
   * upper-cased): 64, although Shopify accepts 255 (audit round 6). The
   * discount function hashes every entered code that could be a Won code;
   * with the shared config's `maxCodeLength` it never upper-cases an entered
   * code longer than the longest Won code, so this bounds its work per code.
   */
  codeLength: 64,
  /**
   * Generated code batches (plan 2026-10-06, dávka 4; code-batch.ts). A batch is
   * regenerated from its seed, so the stored config and the function payload
   * carry a constant few bytes a batch whatever its size, and a batch's codes
   * do not count toward `codesPerRule` (that caps the hand-typed list, each of
   * which ships as an 11-byte hash). `codeBatchSize`: codes a batch generates
   * (Pro); `codeBatchSizeFree`: on Free; `codeBatchesPerRule`: batches a rule
   * holds — so a rule adds at most 5 000 generated codes to Shopify, 250 a call
   * (the sync's existing bulk path: 20 calls).
   */
  codeBatchesPerRule: 5,
  codeBatchSize: 1000,
  codeBatchSizeFree: 100,
  /** Literal parts of a batch code (`[A-Z0-9_-]`): the prefix 2–12 characters, the middle and the suffix up to 12. */
  codeBatchPrefixMin: 2,
  codeBatchLiteralLength: 12,
  /** The random part of a batch code, characters (check characters included): at most this many. */
  codeBatchRandomLength: 24,
  tierSets: 50,
  breaksPerTierSet: 10,
  /** Largest `minQty` of a quantity break, whole items (MVP 3): larger is lowered to it, with an issue. */
  tierMinQty: 10_000,
  /**
   * Largest per-item minimum quantity of a product / collection rule (plan
   * 2026-10-06, bod 8; `target.itemMinimums[].quantity`), whole items: the same
   * cap as a quantity break's. Larger is lowered to it, with an issue. The list
   * itself holds at most `listItems` entries (one per selected product or
   * collection). It costs the shared function config NOTHING: a minimum
   * travels in the product metafield's rule ref (targeting.ts, `ruleId#min.key`).
   */
  itemMinQty: 10_000,
  /**
   * Most UTF-8 bytes of the quantity tiers in the shop config (`modules.tiers`
   * as tiers.ts buildTiersPayload writes it), for the stored config AND the
   * config gated for Free (MVP 3 audit, controller ruling on the measured
   * function budget, task-2-report "Cap measurement": every constructed
   * family ≤ 99.16 %, the realistic Pro carts ≤ 89.72 % of Shopify's
   * instruction limit). Over it the config does not fit (function-payload.ts
   * `fits`, its own figures in `tiers`): saving refuses it, the sync never
   * ships it. Holds a global set and 7 scoped percent sets of 3 breaks, or 4
   * CZK + EUR amount sets of 3 breaks.
   */
  tierPayloadBytes: 550,
  /**
   * Gift thresholds (Pro ladder). 5 × (3 choices + 1 fallback) = 20 gift products at most: the storefront
   * embed reads each through Liquid `all_products`, which serves 20 handles a page (MVP 4 audit L1).
   */
  giftTiers: 5,
  /** Gifts a tier offers to choose from (Pro: up to 3, rozhodnuti.md "výběr ze 3"); the fallback comes on top. */
  giftChoices: 3,
  campaigns: 50,
  overridesPerCampaign: 200,
  localeStringLength: 500,
  /** Languages with storefront texts (Shopify publishes at most 20 a shop; the rest is room). */
  languages: 50,
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
   * (config/margin.ts) the compact margin of 50 collections (13-digit ids) fits
   * the function config budget next to the largest codes content AND a
   * realistic Pro set of quantity tiers (10 sets × 5 breaks, amounts in 2
   * currencies, MVP 3; tests/discounts/margin-sync.test.ts). It was 100 in MVP
   * 2: 500 codes + 100 collections alone took 8 890 of the 9 000 B.
   */
  marginOverrides: 50,
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
   * each list, but multiplied out (50 campaigns × 200 overrides × lists, 50
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
