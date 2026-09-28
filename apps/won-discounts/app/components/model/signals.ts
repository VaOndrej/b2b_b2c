// Store-status wording (Přehled, onboarding): each signal state → one honest
// sentence (§11d state at rest, §12 never claims more than is known).

import { formatDate } from "@won/core/discounts/describe";

import type { MessageKey, Translator } from "../../i18n";
import type { AdminSignals, CheckoutView, EmbedState, SyncView } from "./types";

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

export function checkoutText(view: CheckoutView, tr: Translator): string {
  switch (view.state) {
    case "verified":
      return tr.t("overview.checkout.verified", { date: formatDateTime(view.at, tr.locale) });
    case "failing":
      return tr.t("overview.checkout.failing", { date: formatDateTime(view.at, tr.locale) });
    case "not_wired":
    default:
      return tr.t("overview.checkout.notWired");
  }
}

export function syncText(view: SyncView, tr: Translator): string {
  switch (view.state) {
    case "ok":
      return tr.t("overview.sync.ok", { date: formatDateTime(view.at, tr.locale) });
    case "pending":
      return tr.t("overview.sync.pending");
    case "error":
      return tr.t("overview.sync.error", { date: formatDateTime(view.at, tr.locale) });
    case "not_wired":
    default:
      return tr.t("overview.sync.notWired");
  }
}

/** The "Stav v obchodě" state line. */
export function statusSummary(signals: AdminSignals, tr: Translator): string {
  const { embed, checkout, sync } = signals;
  if (embed.state === "off" || embed.state === "draft_only" || embed.state === "no_scope") {
    return tr.t("overview.status.embedOff");
  }
  const open = [embed.state !== "on", checkout.state !== "verified", sync.state !== "ok"].filter(Boolean).length;
  return open === 0 ? tr.t("overview.status.allGood") : tr.t("overview.status.unverified", { n: open });
}
