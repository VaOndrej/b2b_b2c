// Tarif (MVP 7, contracts M1–M3) — the plan screen's view model and action results.

import type { CodeRuleLimit } from "./types";

export interface PlanScreenData {
  /** The plan in force (BILL-1: what the sync gates for). */
  plan: "free" | "pro";
  /** A verified Shopify subscription of Pro exists (false with the dev override alone). */
  subscribed: boolean;
  /** Development only: Pro is forced by WON_DEV_PLAN. */
  devOverride: boolean;
  /** Shopify answered the subscription read on this load. */
  billingKnown: boolean;
  /** The trial's end in the shop's time, while it is ahead. */
  trialEndsText: string | null;
  /** A test charge (development stores, non-production): no money moves. */
  test: boolean;
  price: { amount: string; currency: string; trialDays: number };
  codeRules: CodeRuleLimit;
  maxRules: number;
  /** What keeps running after a cancel (A6). */
  finishing: { campaigns: string[]; outlets: number };
  /** What "Připravit na odinstalaci" would do (A7). */
  uninstall: { outlets: number; natives: string[] };
}

export type PlanActionResult =
  | { ok: true; kind: "subscribe"; confirmationUrl: string }
  | { ok: true; kind: "cancel"; synced: boolean }
  | { ok: boolean; kind: "uninstall_prep"; ended: number; restored: number; failed: { what: "outlet" | "native"; detail: string }[] }
  | { ok: false; kind: "subscribe" | "cancel" | "unknown"; detail: string };
