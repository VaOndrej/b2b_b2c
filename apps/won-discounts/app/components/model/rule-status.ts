// Is a rule actually running? (§11d state legible at rest, §17c never claim more
// than is true, §12.) Green "Běží" only when ALL hold:
//   - it is switched on,
//   - checkout can evaluate it (no segment targeting yet — core unsupportedInFunction),
//   - today (shop-local day) is inside its schedule — the engine's own day gate
//     (core ruleScheduleState on function-payload shopLocalDates),
//   - it has been written to Shopify (sync).
// Everything else says what it is instead: Vypnuto / Neběží / Naplánováno od … /
// Skončilo … / Uloženo, zatím nepropsáno.

import type { DiscountRule } from "@won/core/discounts/config";
import { formatDate, ruleScheduleState } from "@won/core/discounts/describe";
import { unsupportedInFunction } from "@won/core/discounts/plan";

import type { MessageKey, PluralBase, Translator } from "../../i18n";
import { ruleDays } from "./describe";
import type { SyncView } from "./types";

export type RuleStatusKind = "live" | "off" | "unsupported" | "scheduled" | "ended" | "not_synced" | "draft";

export interface RuleStatus {
  kind: RuleStatusKind;
  /** Scheduled: first live day; ended: last live day (shop-local). */
  date?: string;
}

export interface RuleStatusContext {
  /** Shop-local today `YYYY-MM-DD`. */
  today: string | null;
  timezone: string | null;
  sync: SyncView;
  /** An editor draft that was never saved. */
  draft?: boolean;
}

export function ruleStatus(rule: DiscountRule, ctx: RuleStatusContext): RuleStatus {
  if (!rule.enabled) return { kind: "off" };
  if (unsupportedInFunction(rule).length > 0) return { kind: "unsupported" };
  const days = ruleDays(rule, ctx.timezone);
  const schedule = ruleScheduleState(days, ctx.today);
  if (schedule === "ended") return { kind: "ended", date: days.endsOn ?? undefined };
  if (schedule === "not_started") return { kind: "scheduled", date: days.startsOn ?? undefined };
  if (ctx.draft) return { kind: "draft" };
  // Until the sync is connected, nothing reaches Shopify; once it is, "ok" means the
  // last run wrote the current config.
  if (ctx.sync.state !== "ok") return { kind: "not_synced" };
  return { kind: "live" };
}

const LABELS: Record<RuleStatusKind, MessageKey> = {
  live: "status.live",
  off: "status.off",
  unsupported: "status.unsupported",
  scheduled: "status.scheduled",
  ended: "status.ended",
  not_synced: "status.notSynced",
  draft: "status.draft",
};

/** The pill word. */
export function statusLabel(status: RuleStatus, tr: Translator): string {
  return tr.t(LABELS[status.kind]);
}

/** The sentence under a rule when it is not simply live or off; null otherwise. */
export function statusText(status: RuleStatus, tr: Translator): string | null {
  switch (status.kind) {
    case "scheduled":
      return tr.t("status.scheduledText", { date: status.date ? formatDate(status.date, tr.locale) : "" });
    case "ended":
      return tr.t("status.endedText", { date: status.date ? formatDate(status.date, tr.locale) : "" });
    case "not_synced":
      return tr.t("status.notSyncedText");
    case "unsupported":
      return tr.t("status.unsupportedText");
    case "draft":
      return tr.t("status.draftText");
    default:
      return null;
  }
}

const COUNT_BASES: [RuleStatusKind, PluralBase][] = [
  ["live", "count.live"],
  ["scheduled", "count.scheduled"],
  ["not_synced", "count.notSynced"],
  ["unsupported", "count.unsupported"],
  ["ended", "count.ended"],
  ["off", "count.off"],
];

/** "5 slev · 1 běží · 1 naplánovaná · 2 čekají na propsání · 1 vypnutá" — only the states present. */
export function ruleStatusSummary(statuses: readonly RuleStatus[], tr: Translator): string {
  const counts = new Map<RuleStatusKind, number>();
  for (const s of statuses) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const out = [tr.tp("count.discount", statuses.length)];
  for (const [kind, base] of COUNT_BASES) {
    const n = counts.get(kind) ?? 0;
    if (n > 0) out.push(tr.tp(base, n));
  }
  return out.join(" · ");
}
