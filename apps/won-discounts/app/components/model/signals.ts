// Store-status wording (Přehled, onboarding): each signal state → one honest
// sentence (§11d state at rest, §12 never claims more than is known).

import { formatDate } from "@won/core/discounts/describe";

import type { MessageKey, Translator } from "../../i18n";
import type { AdminSignals, EmbedState, NativeView, SyncView, TargetingView } from "./types";

/** What the app shows while sync / native detection / checkout checks are not connected yet. */
export const NOT_WIRED_SIGNALS: AdminSignals = {
  embed: { state: "unknown", activateUrl: null },
  checkout: { state: "not_wired" },
  sync: { state: "not_wired" },
  native: { state: "not_wired" },
};

/** "2026-09-28T16:20:00…" → "28. 9. 2026 16:20" (the time as written, shop-local from the sync). */
export function formatDateTime(iso: string, locale: "cs" | "en"): string {
  const time = /T(\d{2}:\d{2})/.exec(iso)?.[1];
  const date = formatDate(iso.slice(0, 10), locale);
  return time ? `${date} ${time}` : date;
}

const EMBED_KEYS: Record<EmbedState, MessageKey> = {
  on: "overview.embed.on",
  off: "overview.embed.off",
  draft_only: "overview.embed.draftOnly",
  unknown: "overview.embed.unknown",
  no_scope: "overview.embed.noScope",
};

export function embedText(state: EmbedState, tr: Translator): string {
  return tr.t(EMBED_KEYS[state]);
}

export function syncText(view: SyncView, tr: Translator): string {
  switch (view.state) {
    case "ok":
      return tr.t("overview.sync.ok", { date: formatDateTime(view.at, tr.locale) });
    case "pending":
      return tr.t("overview.sync.pending");
    case "running":
      return view.products ? tr.t("overview.sync.runningProducts", { n: view.products }) : tr.t("overview.sync.running");
    case "never":
      return tr.t("overview.sync.never");
    case "error":
      return tr.t("overview.sync.error", { date: formatDateTime(view.at, tr.locale) });
    case "blocked":
      return tr.t(view.reason === "unreadable_config" ? "overview.sync.blocked.unreadable" : "overview.sync.blocked.newer");
    case "not_wired":
    default:
      return tr.t("overview.sync.notWired");
  }
}

/** The sync line has a "Synchronizovat znovu" (a failed or waiting sync, or Won not running although synced; never while one runs). */
export function syncNeedsRetry(view: SyncView): boolean {
  return view.state === "error" || view.state === "pending" || (view.state === "ok" && (view.attention ?? []).length > 0);
}

/** The targeting line (item 2): fresh as of when, or being refreshed. */
export function targetingText(view: TargetingView, tr: Translator): string {
  switch (view.state) {
    case "refreshing":
      if (view.products) return tr.t("overview.targeting.writing", { n: view.products });
      return view.since ? tr.t("overview.targeting.refreshingSince", { date: formatDateTime(view.since, tr.locale) }) : tr.t("overview.targeting.refreshing");
    case "fresh":
      return view.at ? tr.t("overview.targeting.fresh", { date: formatDateTime(view.at, tr.locale) }) : tr.t("overview.targeting.unknown");
    case "none":
    default:
      return "";
  }
}

/** Sync is fine for the "Stav v obchodě" summary: written (and Won running), or nothing to write yet. */
export function syncSettled(view: SyncView): boolean {
  return (view.state === "ok" && (view.attention ?? []).length === 0) || view.state === "never";
}

/**
 * The "Stav v obchodě" state line. Only what the app really checks counts (B10): the website
 * (theme embed) and the sync. Checkout verification is not built, so it is neither shown nor counted.
 */
/** Everything the store needs is in place (the theme shows the discounts, Shopify has the current settings): the section's green pill. */
export function statusAllGood(signals: AdminSignals): boolean {
  return signals.embed.state === "on" && syncSettled(signals.sync);
}

export function statusSummary(signals: AdminSignals, tr: Translator): string {
  const { embed, sync } = signals;
  if (embed.state === "off" || embed.state === "draft_only" || embed.state === "no_scope") {
    return tr.t("overview.status.embedOff");
  }
  const open = [embed.state !== "on", !syncSettled(sync)].filter(Boolean).length;
  return open === 0 ? tr.t("overview.status.allGood") : tr.t("overview.status.unverified", { n: open });
}

/**
 * Is there anything to do about discounts outside Won (P2)? Native discounts exist, a move can be
 * undone (or did not finish), a discount fights a Won one, or the detection failed (then with a retry).
 * "Not checked", "still loading" and "none" have neither content nor an action: the section is not shown.
 */
export function nativeNeedsSection(native: NativeView | undefined): boolean {
  if (!native || native.state === "not_wired") return false;
  if (native.state === "error") return true;
  if ((native.moved ?? []).length > 0) return true;
  if (native.state === "loading") return false;
  return native.discounts.length > 0 || (native.conflicts ?? []).length > 0;
}

/** Shopify discounts still outside Won (the margin card says protection does not see them). */
export function nativeOutsideCount(native: NativeView | undefined): number {
  return native && native.state === "ok" ? native.discounts.length : 0;
}

/** `gid://shopify/DiscountCodeNode/1001` → the discount's page in Shopify admin (App Bridge follows `shopify://admin`). */
export function nativeAdminUrl(id: string): string | null {
  const numeric = /\/(\d{1,20})$/.exec(id)?.[1];
  return numeric ? `shopify://admin/discounts/${numeric}` : null;
}
