// Tarif (MVP 7, contracts M1–M3) — the plan screen's view model and action results.

import type { MessageKey } from "../../i18n";
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
  /** The app runs in production: the sentences meant for developers (dev override, test charge) are not shown. */
  production?: boolean;
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

/** Where the plan's forms post: the plan route keeps the actions (Shopify's billing return lands there too). */
export const PLAN_ACTION = "/app/plan";

/** What Pro adds, each with the page where it is set up (the plan section lists them as links). */
export const PRO_FEATURES: readonly { label: MessageKey; href: string }[] = [
  { label: "plan.pro.feature.markets", href: "/app/discounts" },
  { label: "plan.pro.feature.combinations", href: "/app/discounts" },
  { label: "plan.pro.feature.tiers", href: "/app/tiers" },
  { label: "plan.pro.feature.gifts", href: "/app/rewards" },
  { label: "plan.pro.feature.outlet", href: "/app/outlet" },
  { label: "plan.pro.feature.campaigns", href: "/app/campaigns" },
  { label: "plan.pro.feature.margin", href: "/app/margin" },
  { label: "plan.pro.feature.analytics", href: "/app/analytics" },
  { label: "plan.pro.feature.appearance", href: "/app/tiers#look-tiers" },
  { label: "plan.pro.feature.tryCart", href: "/app/try-cart" },
];

/** A failure's sentence: a known cause in the merchant's words, the raw detail only when nothing matches. */
export type PlanFailure = { key: Exclude<MessageKey, "plan.fail.other"> } | { key: "plan.fail.other"; detail: string };

const KNOWN_FAILURES: readonly { test: RegExp; key: Exclude<MessageKey, "plan.fail.other"> }[] = [
  { test: /client id is not configured/i, key: "plan.fail.notConfigured" },
  { test: /bad request/i, key: "plan.fail.badRequest" },
  { test: /no confirmation page/i, key: "plan.fail.noConfirmation" },
  { test: /cannot accept charges|can ?not be charged|not eligible|billing (is )?(not|un)available|payment/i, key: "plan.fail.cannotCharge" },
  { test: /network|fetch failed|timed? ?out|ECONN|ENOTFOUND|EAI_AGAIN|socket|throttl|\b50[0-9]\b|unavailable/i, key: "plan.fail.network" },
];

/** The cause of a failed subscribe / cancel (the server reports Shopify's own text in `detail`). */
export function planFailure(detail: string): PlanFailure {
  const known = KNOWN_FAILURES.find((f) => f.test.test(detail));
  if (known) return { key: known.key };
  const text = detail.trim().replace(/[.\s]+$/, "");
  return text ? { key: "plan.fail.other", detail: text } : { key: "plan.fail.network" };
}

/**
 * The detail of one failed uninstall step, when it is fit for the merchant: a
 * sentence stays, a bare code ("invalid", "not_found") does not.
 */
export function uninstallFailureDetail(detail: string): string | null {
  const text = detail.trim();
  if (!text || /^[A-Za-z0-9_.:-]+$/.test(text)) return null;
  return text;
}
