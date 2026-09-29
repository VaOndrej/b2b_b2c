// View models the admin screens render. Plain serializable data (loaders hand
// them over the wire), no raw enum ever reaches the screen as text: every union
// member below is translated by the component that renders it (§4c).
//
// Sync, native-discount detection and the cart engine are wired (integration
// step, app/lib/integration/*). What is still not connected (checkout
// verification) keeps an explicit `not_wired` state and the UI says so honestly
// (§12) instead of pretending or hiding the block. The harness may still render
// the `not_wired` states (v0 overview contract).

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
   * metafields being written right now (item 7: "propisuje se na N produktů").
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
  /** The collection's Shopify title (the id when unknown). */
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
}

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
  | { ok: false; reason: "invalid"; errors: FieldError[] }
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
}

/** One human sentence from explainPlan (engine), tied to lines when it is about them. */
export interface ExplainView {
  tone: "success" | "info" | "warning";
  text: string;
  lineIds?: string[];
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
