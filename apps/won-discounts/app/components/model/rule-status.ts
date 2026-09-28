// Is a rule actually running? (§11d state legible at rest, §17c never claim more
// than is true, §12.) Green "Běží" only when ALL hold:
//   - it is switched on (and a code rule has a code),
//   - checkout can evaluate it (no segment targeting yet — core unsupportedInFunction),
//   - today (shop-local day) is inside its schedule — the engine's own day gate
//     (core ruleScheduleState on function-payload shopLocalDates),
//   - THIS version of it is in Shopify — the real sync fact per rule
//     (RuleSyncMap, app/lib/integration/sync-status.server.ts); without it, the
//     shop's last sync must be ok (the v0 harness states).
// Everything else says what it is instead: Vypnuto / Neběží / Naplánováno od … /
// Skončilo … / Uloženo, zatím nepropsáno / Nepropsáno (synchronizace selhala).

import type { DiscountRule } from "@won/core/discounts/config";
import { formatDate, ruleScheduleState } from "@won/core/discounts/describe";
import { unsupportedInFunction } from "@won/core/discounts/plan";

import type { MessageKey, PluralBase, Translator } from "../../i18n";
import { ruleDays } from "./describe";
import type { RuleSyncMap, SyncView } from "./types";

export type RuleStatusKind =
  | "live"
  | "off"
  | "unsupported"
  | "no_code"
  | "scheduled"
  | "ended"
  | "not_synced"
  | "sync_failed"
  | "draft";

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
  /** Per-rule sync facts; when given, they decide (not the shop-wide sync line). */
  ruleSync?: RuleSyncMap;
  /** An editor draft that was never saved. */
  draft?: boolean;
}

export function ruleStatus(rule: DiscountRule, ctx: RuleStatusContext): RuleStatus {
  if (!rule.enabled) return { kind: "off" };
  if (unsupportedInFunction(rule).length > 0) return { kind: "unsupported" };
  if (rule.method === "code" && (rule.codes ?? []).length === 0) return { kind: "no_code" };
  const days = ruleDays(rule, ctx.timezone);
  const schedule = ruleScheduleState(days, ctx.today);
  if (schedule === "ended") return { kind: "ended", date: days.endsOn ?? undefined };
  if (schedule === "not_started") return { kind: "scheduled", date: days.startsOn ?? undefined };
  if (ctx.draft) return { kind: "draft" };
  if (ctx.ruleSync) {
    const fact = ctx.ruleSync[rule.id];
    if (fact === "synced") return { kind: "live" };
    return { kind: fact === "failed" ? "sync_failed" : "not_synced" };
  }
  // No per-rule facts (harness v0 states): "ok" means the last run wrote the current config.
  if (ctx.sync.state !== "ok") return { kind: ctx.sync.state === "error" ? "sync_failed" : "not_synced" };
  return { kind: "live" };
}

/** States that need the merchant's attention (red, §11a): the rule cannot run as set up, or did not reach Shopify. */
export function needsAttention(status: RuleStatus): boolean {
  return status.kind === "unsupported" || status.kind === "no_code" || status.kind === "sync_failed";
}

const LABELS: Record<RuleStatusKind, MessageKey> = {
  live: "status.live",
  off: "status.off",
  unsupported: "status.unsupported",
  no_code: "status.unsupported",
  scheduled: "status.scheduled",
  ended: "status.ended",
  not_synced: "status.notSynced",
  sync_failed: "status.syncFailed",
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
    case "no_code":
      return tr.t("status.noCodeText");
    case "sync_failed":
      return tr.t("status.syncFailedText");
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
  ["sync_failed", "count.syncFailed"],
  ["unsupported", "count.unsupported"],
  ["ended", "count.ended"],
  ["off", "count.off"],
];

/** Kinds counted together in the summary ("neběží" = unsupported or without a code). */
const COUNT_AS: Partial<Record<RuleStatusKind, RuleStatusKind>> = { no_code: "unsupported" };

/** "5 slev · 1 běží · 1 naplánovaná · 2 čekají na propsání · 1 vypnutá" — only the states present. */
export function ruleStatusSummary(statuses: readonly RuleStatus[], tr: Translator): string {
  const counts = new Map<RuleStatusKind, number>();
  for (const s of statuses) {
    const kind = COUNT_AS[s.kind] ?? s.kind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const out = [tr.tp("count.discount", statuses.length)];
  for (const [kind, base] of COUNT_BASES) {
    const n = counts.get(kind) ?? 0;
    if (n > 0) out.push(tr.tp(base, n));
  }
  return out.join(" · ");
}
