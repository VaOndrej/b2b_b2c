// View models the admin screens render. Plain serializable data (loaders hand
// them over the wire), no raw enum ever reaches the screen as text: every union
// member below is translated by the component that renders it (§4c).
//
// Where a value comes from a subsystem that is not connected yet (sync,
// native-discount detection, checkout verification, the cart engine), the type
// has an explicit `not_wired` state and the UI says so honestly (§12) instead of
// pretending or hiding the block. The integration step replaces those states
// with real data from app/lib/sync, app/lib/native and the engine.

import type { MessageKey } from "../../i18n";

/** One currency the shop sells in, with the Won markets that use it (handles). */
export interface CurrencyView {
  code: string;
  markets: string[];
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

export type SyncView =
  | { state: "not_wired" }
  | { state: "pending" }
  | { state: "ok"; at: string }
  | { state: "error"; at: string };

export type NativeBlockedReason = "bxgy" | "app" | "other";
export type NativeLoss = "usage_history" | "once_per_customer";

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
  /** What a move loses (the dialog states it before the click, §14c). */
  losses: NativeLoss[];
}

export interface MovedDiscountView {
  backupId: string;
  title: string;
  movedAt: string;
}

export type NativeView =
  | { state: "not_wired" }
  | { state: "error" }
  | { state: "ok"; discounts: NativeDiscountView[]; moved: MovedDiscountView[] };

export interface AdminSignals {
  embed: EmbedView;
  checkout: CheckoutView;
  sync: SyncView;
  native: NativeView;
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
  | { ok: false; reason: "invalid"; errors: FieldError[] }
  | { ok: false; reason: "newer_schema" }
  | { ok: false; reason: "function_config_too_large"; bytes: number; budget: number }
  | { ok: false; reason: "config_too_large"; bytes: number; limit: number }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "preview_only" }
  | { ok: false; reason: "error" };

export type UiResult =
  | {
      ok: true;
      message: "saved" | "deleted";
      /** Sanitizer notes about this save (core ConfigIssue messages). */
      fixes?: string[];
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
}

/** One human sentence from explainPlan (engine), tied to lines when it is about them. */
export interface ExplainView {
  tone: "success" | "info" | "warning";
  text: string;
  lineIds?: string[];
}

/** The engine's plan for the simulated cart, already computed (planCart + explainPlan). */
export interface CartPlanView {
  currency: string;
  /** Shop-local date the plan was evaluated on. */
  date: string | null;
  lines: CartPlanLineView[];
  explain: ExplainView[];
  totals: { subtotal: number; productDiscount: number; orderDiscount: number; total: number };
}
