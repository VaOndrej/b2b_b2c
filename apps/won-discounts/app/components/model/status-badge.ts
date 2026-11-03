// What a status badge says and in which tone (audit 2026-11-03 D1): one table for every state the admin labels —
// a module (Aktivní / Vyžaduje pozornost / Neaktivní), a discount (Aktivní, Neuplatní se, Vypnuto, Naplánováno…), a
// switch, a piece in the theme, a card's thing (a sale, a campaign). The badge (shell/StatusBadge.tsx) only draws it.

import type { Translator } from "../../i18n";
import { moduleStateLabel, type ModuleState } from "./module-status";
import { needsAttention, statusLabel, type RuleStatus } from "./rule-status";

export type BadgeTone = "live" | "attention" | "warning" | "scheduled" | "neutral";

export interface Badge {
  tone: BadgeTone;
  label: string;
}

/** A state a dot can say ("locked" is said by the Pro marker). */
export type DotState = Exclude<ModuleState, "locked">;

/** The tone of a module's state: the badge and the dot read the same table, so they cannot drift (§11b). */
export const STATE_TONE: Readonly<Record<DotState, BadgeTone>> = { active: "live", attention: "attention", inactive: "neutral" };

/** A module or a section of it; null for "locked" (the Pro marker says it). */
export function moduleBadge(state: ModuleState, tr: Translator): Badge | null {
  if (state === "locked") return null;
  return { tone: STATE_TONE[state], label: moduleStateLabel(state, tr) };
}

/** A discount: green only when it runs, red when it needs fixing, light orange when scheduled, grey otherwise. */
export function ruleBadge(status: RuleStatus, tr: Translator): Badge {
  const tone: BadgeTone = status.kind === "live" ? "live" : needsAttention(status) ? "attention" : status.kind === "scheduled" ? "scheduled" : "neutral";
  return { tone, label: statusLabel(status, tr) };
}

/** A switch-like thing: Aktivní / Vypnuto. */
export function switchBadge(on: boolean, tr: Translator): Badge {
  return { tone: on ? "live" : "neutral", label: tr.t(on ? "common.live" : "common.off") };
}

export type PlacementState = "in_theme" | "missing" | "unknown";

/** A piece in the live theme: green in the theme, orange in a spot a customer misses, red missing, grey not verified. */
export function placementBadge(placement: PlacementState, move: boolean, tr: Translator): Badge & { marker: string } {
  const misplaced = placement === "in_theme" && move;
  if (misplaced) return { tone: "warning", label: tr.t("placement.misplaced"), marker: "misplaced" };
  if (placement === "in_theme") return { tone: "live", label: tr.t("placement.inTheme"), marker: placement };
  if (placement === "missing") return { tone: "attention", label: tr.t("placement.missing"), marker: placement };
  return { tone: "neutral", label: tr.t("placement.unknown"), marker: placement };
}
