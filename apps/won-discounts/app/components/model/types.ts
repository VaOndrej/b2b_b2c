// View models the admin screens render. Plain serializable data (loaders hand
// them over the wire), no raw enum ever reaches the screen as text: every union
// member below is translated by the component that renders it (§4c).
//
// Sync, native-discount detection and the cart engine are wired (integration
// step, app/lib/integration/*). What is still not connected (checkout
// verification) keeps an explicit `not_wired` state and the UI says so honestly
// (§12) instead of pretending or hiding the block. The harness may still render
// the `not_wired` states (v0 overview contract).

import type { PlacementLinks } from "./embed";
import type { AnalyticsOverviewView } from "./analytics";
import type { ModuleStatus } from "./module-status";
import type { MessageKey } from "../../i18n";

/** A Won market as the merchant knows it: its Shopify name (the handle when the name is unknown). */
export interface MarketView {
  handle: string;
  name: string;
}

/** One currency the shop sells in, with the enabled Won markets that use it. */
export interface CurrencyView {
  code: string;
  markets: MarketView[];
}

/**
 * Active code rules vs. the cap (C2: each active code rule is its own Shopify
 * discount; Shopify runs at most 25 discount functions per store, Won keeps 20).
 */
/** A generated batch of codes as the editor lists it (the seed never leaves the server). */
export interface GeneratedBatchView {
  id: string;
  /** "BF-XXXXX-XXXXX": the pattern with X for every random character. */
  pattern: string;
  /** The codes in force (deleted ones left out). */
  codes: string[];
  /** Made with a Pro pattern (the plan gate removes it on Free). */
  pro: boolean;
}

export interface CodeRuleLimit {
  active: number;
  limit: number;
  /** Shopify's store-wide cap the limit is derived from. */
  shopifyLimit: number;
}

/**
 * A sentence built on the server but worded by the screen: an i18n key and its
 * params, so it follows the admin language the page is rendered in (§4c, A10).
 */
export interface UiText {
  key: MessageKey;
  params?: Record<string, string | number>;
}

// --- Store signals (Přehled, onboarding) ---------------------------------------------

export type EmbedState = "on" | "off" | "draft_only" | "unknown" | "no_scope";

export interface EmbedView {
  state: EmbedState;
  /** Theme-editor deep link that activates the app embed (null when the shop is unknown). */
  activateUrl: string | null;
}

export type CheckoutView =
  | { state: "not_wired" }
  | { state: "verified"; at: string }
  | { state: "failing"; at: string };

/**
 * The shop's sync with Shopify (app/lib/sync SyncRun, Přehled). Times are
 * shop-local `YYYY-MM-DDTHH:MM:SS`.
 */
export type SyncView =
  | { state: "not_wired" }
  /** Nothing saved yet, so nothing to write into Shopify. */
  | { state: "never" }
  /** Saved, not written into Shopify yet (the next Přehled load retries; "Synchronizovat znovu"). */
  | { state: "pending" }
  /**
   * A sync is running (the page did not wait, REL-1). `products` = product
   * metafields being written right now (item 7: "zapisuje se na N produktů").
   */
  | { state: "running"; products?: number }
  /**
   * The last run went through. `attention` = something that stops Won
   * discounts although the run was fine (the automatic node switched off or
   * deleted in Shopify, audit P2-3) — shown in red with "Synchronizovat znovu".
   */
  | { state: "ok"; at: string; warnings?: UiText[]; attention?: UiText[] }
  /** The last run failed; `problems` = what did not reach Shopify. */
  | { state: "error"; at: string; problems?: UiText[] }
  /** The stored config is not synced at all (unreadable row, or a newer app version wrote it). */
  | { state: "blocked"; reason: "unreadable_config" | "newer_schema" };

/**
 * Is THIS version of a rule in Shopify? (Běží, §17c) From real sync facts
 * (app/lib/integration/sync-status.server.ts): the last successful shop-config
 * write covered the rule as it is now, and a code rule's Won node is active
 * with its current codes.
 */
/**
 * refreshing  the rule is in Shopify, but its product targeting is being
 *             written or refreshed right now (collection membership changed,
 *             or a save's products are still being written, items 2 + 7).
 */
export type RuleSyncState = "synced" | "pending" | "failed" | "refreshing";
export type RuleSyncMap = Readonly<Record<string, RuleSyncState>>;

/** What a save (or a resync) did in Shopify, for the result banner. */
export interface SyncOutcomeView {
  /** Everything reached Shopify. */
  ok: boolean;
  /** What did not reach Shopify. */
  problems: UiText[];
  /** Fine, but worth knowing (e.g. a product reduced to fit its budget, markets not read). */
  warnings: UiText[];
}

export type NativeBlockedReason = "bxgy" | "app" | "other";

/** A Shopify discount that is not managed by Won (detected by app/lib/native). */
export interface NativeDiscountView {
  /** Shopify discount node GID. */
  id: string;
  title: string;
  method: "code" | "automatic";
  code?: string;
  /** Human summary, already localized by the detector ("10 % z objednávky"). */
  summary?: string;
  movable: boolean;
  blockedReason?: NativeBlockedReason;
  /** Why it stays in Shopify: the detector's sentence in the admin language. */
  reason?: string;
  /** What a move loses (planMove sentences; the dialog states them before the click, §14c). */
  losses: string[];
  /** What changes or needs attention after a move (planMove sentences). */
  warnings?: string[];
}

/** A backup of a moved discount (NativeDiscountBackup), with its undo. */
export interface MovedDiscountView {
  backupId: string;
  title: string;
  /** Shop-local `YYYY-MM-DDTHH:MM:SS` of the last change. */
  movedAt: string;
  /**
   * moved     the rule is in Won, the native deleted: "Vrátit zpět" undoes it;
   * attention a move or undo did not finish (only in the backup, codes missing,
   *           outcome unknown): `note` says where it is, "Vrátit zpět" finishes it.
   */
  state?: "moved" | "attention";
  note?: string;
  /** What an undo will change, shown BEFORE the merchant confirms it (F11, §14c). */
  undoCosts?: string[];
  /** How the moved discount now stacks with discounts that stayed in Shopify (F4). */
  stacking?: string[];
}

/** A live native discount that fights a Won rule (detection, spec §4.1). */
export interface NativeConflictView {
  nativeTitle: string;
  ruleName: string;
  /** The Won discount it fights (the row links to its codes); absent = not known. */
  ruleId?: string;
  /** The detector's sentence, with its fix. */
  message: string;
}

export type NativeView =
  | { state: "not_wired" }
  /** Detection is still running (the page did not wait for it, REL-1). */
  | { state: "loading"; moved?: MovedDiscountView[] }
  | { state: "error"; message?: string; moved?: MovedDiscountView[] }
  | { state: "ok"; discounts: NativeDiscountView[]; moved: MovedDiscountView[]; conflicts?: NativeConflictView[] };

/**
 * Product / collection targeting freshness (item 2): checkout reads refs the
 * sync wrote from collection membership at sync time.
 *   none        no rule targets products or collections;
 *   fresh       last refreshed `at` (shop-local), nothing known to be stale;
 *   refreshing  Shopify reported a change (`since`, shop-local) or a save's
 *               products are still being written; a refresh is on its way.
 */
export type TargetingView =
  | { state: "none" }
  | { state: "fresh"; at: string | null }
  | { state: "refreshing"; since: string | null; products?: number };

export interface AdminSignals {
  embed: EmbedView;
  checkout: CheckoutView;
  sync: SyncView;
  native: NativeView;
  /** Absent = not known (harness v0 states). */
  targeting?: TargetingView;
  /** Ochrana marže card on Přehled (MVP 2). Absent = not known. */
  margin?: MarginOverviewView;
  /** Množstevní slevy card on Přehled (MVP 3). Absent = not known. Additive (T5). */
  tiers?: TiersOverviewView;
  /** Odměny card on Přehled (MVP 4). Absent = not known. */
  rewards?: RewardsOverviewView;
  /** Výprodej card on Přehled (MVP 5). Absent = not known. */
  outlet?: OutletOverviewView;
  /** Kampaně card (MVP 6, Přehled only; absent = not known). */
  campaigns?: CampaignsOverviewView;
  /** Přehledy card (MVP 7, Přehled only; absent = not known). */
  analytics?: AnalyticsOverviewView;
}

// --- Ochrana marže (MVP 2) ------------------------------------------------------------------
// Contract between the sync/integration layer (app/lib/integration/margin.server.ts,
// Task 3) and the screens (Task 4). Money is minor units of `shopCurrency`.

/** The cost mirror (inventoryItem.unitCost → variant metafield). Times shop-local. */
export type CostMirrorView =
  /** Margin protection is off: nothing is mirrored. */
  | { state: "off" }
  /** A full pass is running (`total` null until the first page tells). */
  | { state: "running"; done: number; total: number | null; since: string }
  | { state: "fresh"; at: string }
  /** Last full pass older than 24 h, or never finished: a refresh is due. */
  | { state: "stale"; at: string | null }
  | { state: "failed"; at: string; problems: UiText[] };

/** How many variants/products have a purchase cost (A2: the admin shows how many do not). */
export interface CostCoverageView {
  variants: number;
  variantsWithCost: number;
  productsWithoutCost: number;
  /** Up to 20 products without a cost, most variants first. `title` "" = untitled (the screen says so; never a GID). */
  sample: { productId: string; title: string; variantsWithoutCost: number }[];
}

export interface MarginCollectionView {
  collectionId: string;
  /** The collection's Shopify title ("" when unknown: the screen says "Kolekce bez názvu", never the id). */
  title: string;
  minMarginPercent: number | null;
  maxDiscountPercent: number | null;
}

/** The stored margin settings as the form edits them. */
export interface MarginSettingsView {
  enabled: boolean;
  /** null = not set (never below the purchase cost). */
  minMarginPercent: number | null;
  maxDiscountPercent: number;
  /** Pro. Stored even on Free (then folded into the global values, see gateNotes). */
  collections: MarginCollectionView[];
}

/** One place where margin protection lowers an active product discount (1 item, shop currency). */
export interface MarginImpactRowView {
  productId: string;
  variantId: string;
  /** Product (variant) title from the cost mirror; "" when Shopify gave none (the screen says "bez názvu"). */
  title: string;
  wanted: number;
  allowed: number;
  basis: "cost" | "max_percent";
  source: "global" | "collection";
}

/** One rule margin protection lowers (Přehled zásahů, audit P2-2: counted per rule, never from the shown rows). */
export interface MarginImpactRuleView {
  ruleId: string;
  ruleName: string;
  discountClass: "product" | "order";
  /**
   * Variants protection lowers this rule on — ALL of them (core marginImpact),
   * the same number the rule editor's note gives. An order rule: variants on
   * which the discount would go below the floor if the item were the whole order.
   */
  variants: number;
  /** Product rules: its largest losses first (at most 10; fewer when the screen's 200-row cap was reached). Order rules: none. */
  rows: MarginImpactRowView[];
}

/** Přehled zásahů (Pro): where protection lowers active discounts, from the config and the cost mirror. */
export interface MarginImpactView {
  /** The rules protection lowers (variants > 0), config order — only `focus`'s when narrowed. */
  rules: MarginImpactRuleView[];
  withoutCost: number;
  /**
   * ready     computed for the current settings and costs;
   * updating  a recompute runs in the background: these are the previous numbers ("počítá se");
   * computing nothing computed yet (rules empty).
   */
  status: "ready" | "updating" | "computing";
  /** Narrowed on the server to one rule (`?rule=`, the rule editor's link). */
  focus?: { ruleId: string; ruleName: string };
}

/** A margin collection the sync could not read (over the 10 000-product limit): its values apply to the whole store (P1-1). */
export interface MarginTooLargeView {
  collectionId: string;
  /** Its Shopify title at the sync ("" when unknown). */
  title: string;
  /** Products in it; null = Shopify only said "more than 10 000". */
  count: number | null;
}

export interface MarginScreenData {
  /** The module's state from what is stored (model/module-status.ts, the same as its home tile; absent = not known). */
  status?: ModuleStatus;
  plan: "free" | "pro";
  shopCurrency: string;
  /** F12 expected-version token for the save. */
  configVersion: string | null;
  settings: MarginSettingsView;
  mirror: CostMirrorView;
  /** null = no complete read of the costs yet (never switched on, or the first pass has not finished). */
  coverage: CostCoverageView | null;
  /** Pro only; null on Free (BILL-1: Free sees the amber preview, never the data). */
  impact: MarginImpactView | null;
  /** Pro settings stored but not in force on this plan (core explainGate). */
  gateNotes: GateNoteView[];
  /** Pro collections the last product pass could not read (their values apply to the whole store). */
  tooLarge: MarginTooLargeView[];
}

/**
 * The rule editor's margin note (null = protection off, or it lowers nothing here).
 * computing  no result yet (the background computes it);
 * ready / updating  protection lowers the saved rule; `variants` only on Pro — Free gets no
 *            number ("přehled zásahů" is Pro), just that it happens, with the Pro preview.
 */
export type MarginRuleImpactView =
  | { state: "computing" }
  | { state: "ready" | "updating"; discountClass: "product" | "order"; variants?: number };

/** Přehled card. */
export interface MarginOverviewView {
  enabled: boolean;
  minMarginPercent: number | null;
  maxDiscountPercent: number;
  /** null = not known yet: no complete read of the costs (the percent ceiling is then all there is for unread products). */
  productsWithoutCost: number | null;
  mirror: CostMirrorView;
  /** Pro collections the last product pass could not read (absent = none). */
  tooLarge?: MarginTooLargeView[];
}

/**
 * A Pro setting that is stored but not in force on the shop's plan (BILL-1,
 * core explainGate): one sentence in the admin language, with the rule it is on.
 */
export interface GateNoteView {
  text: string;
  ruleId?: string;
}

// --- Action results ----------------------------------------------------------------------

export interface FieldError {
  /** Form field name the message belongs to. */
  field: string;
  key: MessageKey;
  params?: Record<string, string | number>;
  /** Kampaně: the discount or tier set the message belongs to (shown at that row, not under the whole list). */
  at?: string;
}

/**
 * What a refused form posted, by field name (B14): the screen seeds its fields from it on the re-render, so
 * nothing typed is lost. Display only: the server never trusts it back.
 */
export type SubmittedValues = Record<string, string[]>;

export type UiFailure =
  | { ok: false; reason: "not_wired"; what: "move" | "undo" | "tryCart" }
  /**
   * The config was changed by someone else (another tab, another admin, a
   * move) since this page read it, and the change touches the same thing
   * (F12): nothing was saved; reload and do it again.
   */
  | { ok: false; reason: "base_changed" }
  /**
   * Another action is writing the shop's config right now (a save and its
   * sync, a move, a resync) and did not finish within the wait (F2 re-review
   * I-1): nothing was saved; try again in a moment.
   */
  | { ok: false; reason: "busy" }
  /**
   * The stored config cannot be read (I3): saving would replace it with the
   * defaults + this change. Nothing was written; the merchant confirms with
   * "Nahradit neplatnou konfiguraci" (re-submit with replaceUnreadable).
   */
  | { ok: false; reason: "unreadable_config" }
  /** A move / undo of native discounts failed: the native layer's sentences (why, where the discount is now, what to do). */
  | { ok: false; reason: "native_failed"; op: "move" | "undo"; messages: string[]; done: number }
  /** "Synchronizovat znovu" did not get everything into Shopify. */
  | { ok: false; reason: "sync_failed"; problems: UiText[] }
  /** Vyzkoušet košík: Shopify has no price in the chosen currency for these products. */
  | { ok: false; reason: "prices_unavailable"; currency: string; products: string[] }
  /** Shopify could not be read (Vyzkoušet košík); `detail` is technical. */
  | { ok: false; reason: "shopify_unavailable"; detail?: string }
  | { ok: false; reason: "invalid"; errors: FieldError[]; values?: SubmittedValues }
  /** Saving would make more code rules active than Shopify can run (C2). */
  | { ok: false; reason: "too_many_code_rules"; count: number; limit: number; shopifyLimit: number }
  /** Codes the discount function cannot tell apart (8-hex code hashes). */
  | { ok: false; reason: "code_hash_collision"; codes: string[][] }
  | { ok: false; reason: "newer_schema" }
  | { ok: false; reason: "function_config_too_large"; bytes: number; budget: number }
  | { ok: false; reason: "config_too_large"; bytes: number; limit: number }
  | { ok: false; reason: "not_found" }
  /** A Move was submitted without any discount selected. */
  | { ok: false; reason: "nothing_selected" }
  /** The request itself made no sense (unknown intent, missing id): a stale page or a tampered form. */
  | { ok: false; reason: "bad_request" }
  | { ok: false; reason: "preview_only" }
  | { ok: false; reason: "error" };

export type UiResult =
  | {
      ok: true;
      message: "saved" | "deleted" | "synced" | "moved" | "undone";
      /**
       * What the sanitizer adjusted in this save, already worded in the admin
       * language on the server (app/lib/integration/issue-copy.ts: one i18n key
       * per core ConfigIssue code) — never the core's English messages.
       */
      fixes?: string[];
      /** What the save did in Shopify (absent = nothing was sent, e.g. onboarding steps). */
      sync?: SyncOutcomeView;
      /** Move / undo: how many discounts, and what the merchant should know (losses, what undo could not bring back). */
      count?: number;
      notes?: string[];
      /** "Přesunout vše" where some failed: their sentences. */
      failures?: string[];
      /**
       * Saved, and the sync goes on in the background (item 7): the deadline
       * passed (`products` absent), or products that only gain rules are being
       * written (`products` = how many); `targeting` = "Obnovit cílení" was
       * queued (collections are read again in the background).
       */
      syncing?: { products?: number; targeting?: boolean; costs?: boolean };
    }
  | UiFailure;

// --- Vyzkoušet košík ---------------------------------------------------------------------

/** A product line the merchant put into the simulated cart. */
export interface TryCartLineView {
  variantId: string;
  productId: string;
  title: string;
  variantTitle?: string;
  quantity: number;
  /** Unit price per currency in minor units; a missing currency is "unknown", never 0. */
  unitPrice: Record<string, number>;
}

export interface CartPlanLineView {
  lineId: string;
  title: string;
  quantity: number;
  subtotal: number;
  discount: number;
  total: number;
  /** Margin protection lowered this line's discount (the explain sentence says why). */
  marginCapped?: boolean;
  /** The line's product discount is a quantity tier (MVP 3; the explain sentence names the break). Additive (T5). */
  tier?: boolean;
  /** MVP 4: the gift line the cart on the website adds (simulated, 1 item); `giftChoices` = how many the customer picks from. */
  gift?: boolean;
  giftChoices?: number;
}

/** One human sentence from explainPlan (engine), tied to lines when it is about them. */
export interface ExplainView {
  tone: "success" | "info" | "warning";
  text: string;
  lineIds?: string[];
  /** The Won discount the sentence is about (it won or lost): the sentence links to it. Absent = not about one discount. */
  ruleId?: string;
}

/** The engine's plan for the simulated cart, already computed (planCart + explainPlan). */
export interface CartPlanView {
  /** Market the prices and the country came from (its Shopify name), when known. */
  market?: string | null;
  currency: string;
  /** Shop-local date the plan was evaluated on. */
  date: string | null;
  /** Per line what CHECKOUT applies (core checkoutPreview: the function's own output mapping). */
  lines: CartPlanLineView[];
  explain: ExplainView[];
  /** What checkout takes off (after the output mapping), not the plan's own numbers. */
  totals: { subtotal: number; productDiscount: number; orderDiscount: number; total: number };
  /**
   * Where checkout may differ from the plan, or the plan from checkout right
   * now (item 8): output over Shopify's size budget, rounding ties, a split
   * shipment, the last sync failed, targeting being refreshed.
   */
  warnings?: UiText[];
  /**
   * Margin protection in this simulation (absent = off). `rateEstimated`: the cart is not in
   * the shop currency, so purchase costs were converted with a rate estimated from market
   * prices — checkout uses Shopify's current rate. Lines margin protection applies to (not
   * outlet, not gift lines) whose purchase cost is unknown in the cart currency — the "no
   * purchase cost" percent ceiling is their floor, whether or not it lowered their discount
   * in this cart: `linesWithoutCost` have no cost at all (none in Shopify, or not read yet);
   * `linesCostNotConverted` HAVE one that could not be converted into the cart currency (no
   * usable rate, or a cost in another currency) — never called "no purchase cost".
   */
  margin?: { rateEstimated: boolean; linesWithoutCost: number; linesCostNotConverted: number };
}

// --- MVP 3: Množstevní slevy, Vzhled, Nastavení kombinování ----------------------------
// Contract K9 (docs/plans/2026-09-30-won-discounts-mvp3.md). Loaders: app/lib/integration/
// {tiers,appearance,settings}.server.ts; screens: TiersScreen, AppearanceScreen, SettingsScreen.

/** One quantity break as the form edits it. */
export interface TierBreakView {
  minQty: number;
  kind: "percent" | "amount";
  /** kind "percent": 0–100. */
  percent: number | null;
  /** kind "amount": per item, per currency, minor units. A missing currency = the break is not offered there (MKT-1). */
  amount: Record<string, number>;
}

/** Where a set applies. Titles come from Shopify ("" = unknown: the screen says "bez názvu", never an id). */
export type TierScopeView =
  | { kind: "global" }
  | {
      kind: "selection";
      products: { id: string; title: string }[];
      collections: { id: string; title: string }[];
    };

export interface TierSetView {
  id: string;
  scope: TierScopeView;
  countAcross: "line" | "product" | "cart";
  /** Ascending minQty. */
  breaks: TierBreakView[];
}

/** Is the quantity table on the live theme's product page (read_themes, templates/product*.json)? */
export type TiersBlockView =
  /** In `templates/product.json` (audit P3-8). `alternates` = alternate product templates that have it too (additive, T5). */
  | { state: "on"; themeName: string; alternates?: string[] }
  /**
   * Not in `templates/product.json`. `addUrl`: theme-editor deep link with addAppBlockId (null when the shop / API key is
   * unknown). `alternates` = alternate product templates that do have it ("jen v šabloně X"; additive, T5).
   */
  | { state: "off"; addUrl: string | null; alternates?: string[] }
  | { state: "unknown"; addUrl: string | null }
  | { state: "no_scope" };

/**
 * Where the app's pieces sit in the LIVE theme besides the quantity table (feedback 3, bod 5): the blocks by
 * the template they are in and the top bar by the embed's own settings. A key that is absent was not read
 * (no access to the theme, a Liquid template): "not verified", never "missing".
 */
export type PlacementKey = "cartBlock" | "rewardsProduct" | "rewardsHome" | "topBarRewards" | "campaignHome" | "campaignProduct" | "topBarCampaign" | "outletBadge";
export type ThemePlacements = Partial<Record<PlacementKey, boolean>>;

/**
 * The storefront config metafield (K5) as the last sync left it: `cv` (the
 * config version it was built from, app/lib/config.server.ts configVersionToken)
 * is the stored config's → synced; another version → pending; the last sync
 * failed and the metafield is not current → failed; never written → missing;
 * the metafield could not be read → unknown (additive, T5).
 */
export type StorefrontSyncView =
  | { state: "synced"; at: string }
  | { state: "pending" }
  /** `previous` = an older storefront config is still on the site (absent = none was ever written). */
  | { state: "failed"; at: string; problems: UiText[]; previous?: boolean }
  | { state: "missing" }
  | { state: "unknown" };

/**
 * The live theme's look for a faithful preview (C5 fallback: settings_data via
 * read_themes). Colors are CSS colors; null = the theme does not say (the preview
 * falls back to neutral values and says so).
 */
export interface ThemeTokensView {
  themeName: string | null;
  fontBody: string | null;
  fontHeading: string | null;
  colorText: string | null;
  colorBackground: string | null;
  colorAccent: string | null;
  /** Corner radius of inputs in px (the storefront block's CSS rounds its rows with the theme's input radius). */
  radius: number | null;
  /** Body text size in px (Horizon: paragraph size; Dawn: 1.6rem × body scale). Additive (T5). */
  fontSize?: number | null;
}

/** A real product for the preview and "Zobrazit na mém webu". */
export interface PreviewProductView {
  productId: string;
  title: string;
  /** Minor units of `currency`. */
  unitPrice: number;
  currency: string;
  /** Storefront URL of the product (null when the shop domain is unknown). */
  url: string | null;
  /** The shop's money format (`{{amount_with_comma_separator}} Kč`), so the preview writes prices like the storefront. Additive (T5). */
  moneyFormat?: string | null;
}

export interface TiersPreviewView {
  tokens: ThemeTokensView | null;
  preset: AppearancePresetView;
  product: PreviewProductView | null;
  /** What the stored config adds to the preview (the Pro custom look, the merchant's texts). Additive (plan 2026-10-06). */
  look?: PreviewLookView;
}

/**
 * What the storefront gets on top of the ready-made look, for the faithful preview (plan 2026-10-06, dávka 5):
 * `customCss` = the Pro custom look exactly as the storefront config carries it (core customLookCss: the variables
 * and the CSS scoped under the Won blocks; null on Free or when none is stored); `texts` = the storefront texts the
 * merchant changed, per language, by the extension's key (`tiers.heading`).
 */
export interface PreviewLookView {
  /** The stored ready-made highlight colour (core ACCENT_PRESETS); absent = "theme". */
  accent?: string;
  customCss: string | null;
  texts: Record<string, Record<string, string>>;
}

/** Mirrors core APPEARANCE_PRESETS (K7). */
export type AppearancePresetView = "default" | "highlight" | "chips" | "tiles";

export interface TiersScreenData {
  /** What the amount fields suggest for the other markets with (the manual rates set in Shopify; návrh 2). Absent = no suggestions. */
  suggest?: import("./markets").AmountSuggestView;
  plan: "free" | "pro";
  shopCurrency: string;
  /** F12 expected-version token for the save. */
  configVersion: string | null;
  /** The table's custom look (Pro) for its section; additive in fixtures. */
  look?: LookView;
  /** BETA: prices by quantity on product cards, and the deep link that adds the card block to the theme. */
  cards?: { on: boolean; blockUrl: string | null };
  /** Currencies of the enabled markets (amount inputs per currency). */
  currencies: CurrencyView[];
  /** Config order; the global set first when there is one. Pro sets are listed on Free too (gateNotes say they do not apply). */
  sets: TierSetView[];
  gateNotes: GateNoteView[];
  /** Margin protection is on: the screen says tiers may come out lower on some products. */
  marginOn: boolean;
  /** Active product rules that compete with tiers on the same lines (A1: the better one wins). */
  competingRules: number;
  block: TiersBlockView;
  /** The state of the page's two sections, from what is stored (model/module-status.ts; absent = not known). */
  status?: { global: ModuleStatus; sets: ModuleStatus };
  storefront: StorefrontSyncView;
  preview: TiersPreviewView;
  /** Won on the storefront (the app embed): the picked colour reaches the storefront only through it. Absent = not known. */
  embed?: EmbedView;
  /**
   * Pro: how many products carry each Pro set (`tierRef`), by set id, as the
   * last sync wrote them (app/lib/sync/storefront.ts tierProductCounts); null
   * on Free or when unknown. Additive (T5 fix round 1).
   */
  productsWithSets?: Record<string, number> | null;
  /**
   * engine.combination.outletWithAnything: clearance items can get a tier too
   * (the honest sentence says so). Additive (T5 fix round 1).
   */
  outletWithAnything?: boolean;
}

/** Přehled card. */
export interface TiersOverviewView {
  sets: number;
  /** What the own sets are for, by name (product / collection titles), when the loader read them (P4). */
  setNames?: string[];
  /** The global set's breaks, for one sentence ("Od 3 ks −10 %, od 5 ks −15 %"); null = no global set. */
  global: TierSetView | null;
  block: TiersBlockView;
  /**
   * Currencies of the enabled markets a set with an amount per piece has no amount in, on some level (MKT-1: the
   * level is not offered there). `sets` = one entry per own set that misses some. Absent = none. Audit 6 Oct 2026, N2.
   */
  missing?: { global: string[]; sets: string[][] };
}

/** One storefront element's stored look, as its section shows it (looks.server.ts lookView). */
export interface LookView {
  element: "tiers" | "milestones" | "outlet" | "campaign";
  /** The ready-made looks to pick from; [] for the table (its look is picked in its preview). */
  presets: string[];
  preset: string;
  /** The ready-made highlight colour ("theme" = the theme's). */
  accent: string;
  /** Milníky: the flash of a step just reached. */
  blink: boolean;
  /** The Pro custom look as the form shows it ("" = not set). */
  custom: { accent: string; line: string; tint: string; radius: string; css: string };
  /** The stored custom CSS cannot be used (a hand-made config): why, for the notice. */
  customIssue: string | null;
  /** The brief for an AI: this element's classes and variables. */
  aiPrompt: string;
}

/** Překlady: the storefront texts, one table per language (model/translations.ts). */
export interface TranslationsScreenData {
  plan: "free" | "pro";
  configVersion: string | null;
  /** The languages switched on in Shopify, the default first; null = the app may not read them (or the read failed). */
  shopLanguages: string[] | null;
  /** The page's tables in order: the shop's default language, then the ones the merchant added. */
  languages: string[];
  /** Languages the plan puts on the storefront; null = every one. */
  limit: number | null;
  rows: import("./translations").TextRow[];
  /** Per language the texts the merchant changed. */
  values: Record<string, Record<string, string>>;
}

/** Free per-category combination switches (A1, engine.combination). */
export interface CombinationView {
  outletWithAnything: boolean;
  productWithOrder: boolean;
  productWithShipping: boolean;
  orderWithShipping: boolean;
}

export interface SettingsScreenData {
  plan: "free" | "pro";
  configVersion: string | null;
  currencies: CurrencyView[];
  combination: CombinationView;
  /** engine.unknownMarketLowest: a customer from a country in no market gets the lowest amount of the markets of their currency (off = nothing). */
  unknownMarketLowest?: boolean;
  /** engine.unknownMarketHighest: the kinds of amount where that customer gets the highest amount instead of the lowest. */
  unknownMarketHighest?: import("@won/core/discounts/config").UnknownMarketKind[];
  /** The shop's Shopify markets and what each part of the app offers in them (model/markets-overview.ts). Absent = not built (older callers). */
  markets?: import("./markets-overview").MarketRowView[];
}

// --- MVP 4: Odměny (contracts R1–R9, plan docs/plans/2026-10-01-won-discounts-mvp4.md) ----------------------------

/** A gift variant with its Shopify name ("Mikina — M"); an unknown one (deleted) has an empty title. */
export interface GiftVariantView {
  id: string;
  title: string;
}

/** One step of the Milníky ladder as the screen edits it (model/milestones.ts). */
export interface MilestoneStepView {
  /** The stored step's id ("shipping", a gift tier's id, an "ms-…" rule's id); "new-…" for a row added on the page. */
  id: string;
  kind: "shipping" | "gift" | "discount";
  /** The cart value the step starts at: minor units per amount column; a column without one offers nothing there (MKT-1). */
  threshold: Record<string, number>;
  /** kind "gift": Free 1, Pro up to 3 (CONFIG_LIMITS.giftChoices). */
  choices: GiftVariantView[];
  /** kind "gift": the fallback gift (A4), offered when every choice is sold out. */
  fallback: GiftVariantView | null;
  /** kind "discount": a percentage, or a fixed amount per amount column. */
  value: "percentage" | "fixed";
  percent: number | null;
  off: Record<string, number>;
}

export interface RewardsScreenData {
  /** The module's state from what is stored (model/module-status.ts, the same as its home tile; absent = not known). */
  status?: ModuleStatus;
  plan: "free" | "pro";
  configVersion: string | null;
  /** The ladder's look on the storefront. */
  look?: LookView;
  currencies: CurrencyView[];
  /** The stored ladder, in ladder order (core milestones.ts). */
  steps: MilestoneStepView[];
  /** Steps the plan runs IN EACH MARKET (Free 2, Pro 6) and the Pro figure for the upsell sentence. */
  limit: number;
  limitPro: number;
  /** countOtherDiscounts: the cart value counts after the other discounts (the cart warns; checkout never takes the gift). */
  countOther: boolean;
  /** engine.combination.productWithOrder: a discount step adds up with product discounts (said at the step). */
  productWithOrder: boolean;
  /** Margin protection is on: it may lower a discount step (said at the step). */
  marginOn: boolean;
  gateNotes: GateNoteView[];
  /** The app embed: the cart panel needs it. */
  embed: EmbedView;
  /** "Přidat blok košíku": the theme editor on the cart template (null when the shop / API key is unknown). */
  cartBlockAddUrl: string | null;
  /** Where else the ladder can show (the "Milestones" block, the top bar). */
  placements?: PlacementLinks;
  /** Which of those places the live theme already has (absent key = not verified). */
  placed?: ThemePlacements;
  /** What the amount fields suggest for the other markets with (the manual rates set in Shopify; návrh 2). Absent = no suggestions. */
  suggest?: import("./markets").AmountSuggestView;
}

/** Přehled card. */
export interface RewardsOverviewView {
  /** Free shipping threshold in the shop currency (minor units), null = none. */
  shipping: number | null;
  /** Gift thresholds the PLAN runs, in the shop currency (minor units, config order); null = none in that currency. */
  gifts: (number | null)[];
  currency: string;
  /** The gift of each threshold by name (same order as `gifts`), when the loader read the titles (P4). */
  giftNames?: (string | null)[];
  /**
   * Currencies of the enabled markets a reward has no amount in (MKT-1: it is not offered there). Absent = none.
   * `gifts` follows the order of `gifts` above. Audit 6 Oct 2026, N2. `discounts` likewise (Milníky).
   */
  missing?: { shipping: string[]; gifts: string[][]; discounts?: string[][] };
  /**
   * Milníky: the order-discount steps the PLAN runs — the cart value in the shop currency (minor units, null = none
   * in that currency) and the discount (`percent`, or `off` in the shop currency).
   */
  discounts?: { amount: number | null; percent?: number; off?: number | null }[];
}

// --- Výprodej (MVP 5, Pro; contract O10) --------------------------------------------------------------
// The server (app/lib/integration/outlet-admin.server.ts) words every date in the admin language and the shop's
// time zone; prices are minor units of the shop currency.

export type OutletRunStatus = "starting" | "active" | "ending" | "ended";

export interface OutletHistoryView {
  kind: string;
  /** Shop-local, formatted. */
  at: string;
  /** The step as a sentence in the admin language. */
  text: string;
}

export interface OutletRunView {
  id: string;
  variantId: string;
  /** "Product — Variant" as Shopify names it now; "" = not found (deleted). */
  title: string;
  percent: number;
  quota: number;
  sold: number;
  returned: number;
  left: number;
  /** Pieces sold past the quota (a late order webhook): the exact number. */
  oversold: number;
  /** The storefront badge block shows this variant (false = hidden for this sale by the merchant). */
  showBadge: boolean;
  status: OutletRunStatus;
  endReason: "quota" | "date" | "manual" | null;
  endsAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** The variant's price before and during the sale (minor units of `currency`); null = nothing written. */
  price: { before: number; sale: number; currency: string } | null;
  /** Price lists whose fixed price the sale changed. */
  lists: number;
  /** Their names (the catalog's title, else the list's name; a list Shopify no longer returns is named by its currency). */
  listNames: string[];
  /** The server can retry the failed step now ("Zkusit znovu"): a failed end, or the value for the web of a running sale. */
  retry: boolean;
  /** Pieces returned after the end that wait for the merchant (reopenOnReturnAfterEnd = ask). */
  returnPending: number;
  /** The last failed step, worded; null = none. */
  problem: string | null;
  /** Newest first, at most 20 steps. */
  history: OutletHistoryView[];
}

export interface OutletPriceListView {
  id: string;
  /** The catalog (market) title, else the list's name. */
  title: string;
  currency: string;
}

export interface OutletScreenData {
  /** The module's state from what is stored (model/module-status.ts, the same as its home tile; absent = not known). */
  status?: ModuleStatus;
  plan: "free" | "pro";
  configVersion: string | null;
  /** The sale badge's look on the storefront. */
  look?: LookView;
  shopCurrency: string;
  /** Today in the shop's zone (`YYYY-MM-DD`): the end date input's minimum is the day after. */
  today: string;
  display: "silent" | "strike" | "strike_badge" | "strike_badge_left";
  reopen: "auto" | "ask" | "never";
  /** Nastavení → "Výprodej s ostatními slevami" (engine.combination.outletWithAnything): the page says what combines with a sale. Absent = off. */
  withOthers?: boolean;
  running: OutletRunView[];
  /** The 20 last ended sales. */
  ended: OutletRunView[];
  priceLists: OutletPriceListView[];
  limits: { percentMin: number; percentMax: number; quotaMax: number; running: number; priceLists: number };
  /** "Přidat štítek výprodeje" (null when the shop / API key is unknown). */
  badgeBlockAddUrl: string | null;
  /** Is the sale badge on the live theme's product page (absent key = not verified). */
  placed?: ThemePlacements;
  /** The app can read orders (5a, F-O1): false = the quota is not counted, the sale ends by its date or by hand. */
  ordersCounted: boolean;
}

export type OutletActionResult =
  | { ok: true; kind: "started" | "ended" | "reopened" | "kept" | "retried" | "badgeShown" | "badgeHidden"; skippedLists?: number; pending?: boolean }
  | { ok: false; reason: "invalid"; errors: FieldError[]; values?: SubmittedValues }
  | { ok: false; reason: "failed"; message: string; values?: SubmittedValues };

/** Přehled card. */
export interface OutletOverviewView {
  running: number;
  /** The running sales by product name, when the loader read the titles (P4). */
  runningTitles?: string[];
  /** Ended sales with returned pieces waiting for "Znovu otevřít" / "Nechat skončené". */
  pendingReturns: { runId: string; title: string; qty: number }[];
  /** Sales with pieces sold past the quota. */
  oversold: number;
  /** Sales whose start or end failed and is being retried. */
  problems: number;
  /** The app can read orders (5a, F-O1): false = the card says the quota is not counted. */
  ordersCounted: boolean;
}


// --- Kampaně (MVP 6, contract K7) -----------------------------------------------------------------

export type CampaignStatusView = "running" | "scheduled" | "ended" | "killed";

/** A rule the campaign form offers (its value shape decides the value field). */
export interface CampaignRuleChoice {
  id: string;
  name: string;
  /** "percentage" | "fixed" | "freeShipping". */
  kind: string;
  enabled: boolean;
  method: "automatic" | "code";
  /** The rule's own value, worded ("10 %", "200 Kč / 8 €"). */
  valueText: string;
  /** Fixed rules: the currencies of the rule's amount whose market is enabled (the same fields as the discount's editor). */
  currencies: string[];
  /** Fixed rules: currencies of enabled markets the discount has no amount in — not offered there, in a campaign either (N14). */
  missing?: string[];
}

export interface CampaignOverrideView {
  ruleId: string;
  ruleName: string;
  /** true / false = switched on / off during the campaign; absent = unchanged. */
  enabled?: boolean;
  /** The campaign value worded; absent = unchanged. */
  valueText?: string;
  /** Form values for editing. */
  percent?: number;
  amount?: Record<string, string>;
}

/** One break row of a tier set in the campaign form: the quantity and the value as typed. */
export interface CampaignTierRow {
  qty: string;
  /** Percent sets. */
  percent?: string;
  /** Amount sets: per currency, major units. */
  amount?: Record<string, string>;
}

/** A quantity tier set the campaign form can change (MVP 6.1). */
export interface CampaignTierChoice {
  id: string;
  /** "Celý obchod" / "Vybrané produkty a kolekce (3)" — a set has no name. */
  label: string;
  kind: "percent" | "amount";
  currencies: string[];
  /** The set's own breaks, worded ("od 2 ks −10 %, od 5 ks −15 %"). */
  baseText: string;
  /** The set's own breaks as rows: the form's defaults. */
  rows: CampaignTierRow[];
}

/** A tier set as a campaign runs it (an override that applies). */
export interface CampaignTierView {
  setId: string;
  label: string;
  /** The campaign's breaks, worded. */
  text: string;
  /** Form values for editing. */
  rows: CampaignTierRow[];
}

export interface CampaignView {
  id: string;
  name: string;
  status: CampaignStatusView;
  /** Formatted in the shop's zone and the admin language. */
  startText: string;
  endText: string;
  start: { date: string; time: string };
  end: { date: string; time: string };
  overrides: CampaignOverrideView[];
  /** MVP 6.1: the tier sets the campaign changes (overrides that apply). */
  tiers: CampaignTierView[];
  /** Stored overrides that do not apply: gift tiers (never), tier sets whose breaks give less than the base. */
  unused: number;
  /** Their names (a tier set's label; "" = what it changed no longer exists). */
  unusedNames: string[];
  /** Free: running since the downgrade, it finishes (A6). */
  finishing: boolean;
  /** Vyzkoušet košík at the campaign's start + 1 minute. */
  tryCartUrl: string;
}

export interface CampaignsScreenData {
  /** The module's state from what is stored (model/module-status.ts, the same as its home tile; absent = not known). */
  status?: ModuleStatus;
  plan: "free" | "pro";
  configVersion: string | null;
  /** The campaign banner's look on the storefront. */
  look?: LookView;
  /** Shop-local today (`YYYY-MM-DD`) and now (`HH:MM`): the form's minimums and defaults. */
  today: string;
  nowTime: string;
  timezone: string | null;
  campaigns: CampaignView[];
  rules: CampaignRuleChoice[];
  /** MVP 6.1: the quantity tier sets a campaign can change (the sets a product can reach). */
  tierSets: CampaignTierChoice[];
  /** The enabled markets by currency, for naming a field by its market (absent = fields are named by the currency). */
  currencies?: CurrencyView[];
  /** What the amount fields suggest for the other markets with (the manual rates set in Shopify). Absent = no suggestions. */
  suggest?: import("./markets").AmountSuggestView;
  /** The campaign the form edits (?edit=<id>), when it can be edited. */
  editing: CampaignView | null;
  limits: { campaigns: number; maxDays: number; minLeadMinutes: number };
  /** Feedback 2, bod 7: where the running campaign can show on the storefront (the "Campaign banner" block, the top bar). */
  placements?: PlacementLinks;
  /** Which of those places the live theme already has (absent key = not verified). */
  placed?: ThemePlacements;
}

export type CampaignsActionResult =
  | { ok: true; kind: "saved" | "killed" | "deleted"; sync?: SyncOutcomeView; fixes?: string[] }
  | { ok: false; reason: "invalid"; errors: FieldError[]; values?: SubmittedValues };

/** Přehled card. */
export interface CampaignsOverviewView {
  running: { name: string; endText: string } | null;
  next: { name: string; startText: string } | null;
  /** Free shop with a campaign finishing after the downgrade (A6). */
  finishing: boolean;
}
