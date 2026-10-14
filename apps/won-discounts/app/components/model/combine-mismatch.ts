// A mismatch of "Sčítá se s" (docs/won-discounts/navrh-kombinace-2026-10-13.md, "Neshoda"): one discount allows
// others which do not allow it back, so at checkout they never add up. One finding a discount, from the config
// alone (mismatchViews, pure: the pages, the rule editor and the dev harness), with the two ways to set it straight in one save.

import { combineMismatches, combineMismatchGroups, fixCombineMismatch, type CombineEntity } from "@won/core/discounts/combine-config";
import type { ReadonlyDeep, WonDiscountsConfig } from "@won/core/discounts/config";
import { gateConfigForPlan, type ShopPlan } from "@won/core/discounts/plan-gate";

import type { MessageKey, Translator } from "../../i18n";

/** Who a side of the mismatch is: a discount by its name, or a module's discount. */
export interface CombineSideView {
  /** A rule id, or one of COMBINE_ENTITY. */
  id: string;
  kind: "rule" | "tiers" | "gift" | "shipping" | "milestone" | "outlet";
  /** The discount's name (a rule, a milestone discount); "" for a module's. */
  name: string;
}

export interface CombineMismatchView {
  /** The discount that allows (a rule id, or one of COMBINE_ENTITY). */
  id: string;
  who: CombineSideView;
  refusing: CombineSideView[];
  /** Where the allowing side's list is set. */
  href: string;
  /** New mismatches the button would make (a type changes for every discount of it); 0 = only this one goes. */
  allowNew: number;
  denyNew: number;
}

/** The form of the two buttons (posted to /app/combine). */
export const MISMATCH_FIELD = { intent: "intent", id: "mismatchId", mode: "mismatchMode" } as const;
export const MISMATCH_INTENT = "fix" as const;

export function sideName(side: CombineSideView, tr: Translator): string {
  return side.kind === "rule" || side.kind === "milestone" ? `„${side.name || tr.t("combine.side.unnamed")}“` : tr.t(`combine.side.${side.kind}` as MessageKey);
}

/** The mismatches a discount is in, either side. */
export function mismatchesOf(all: readonly CombineMismatchView[], id: string): CombineMismatchView[] {
  return all.filter((m) => m.id === id || m.refusing.some((r) => r.id === id));
}

/** "Sčítání dovoluje jen jedna strana: „X“ ano, „A“ a „B“ ne. …" */
export function mismatchText(m: CombineMismatchView, tr: Translator): string {
  return tr.t("combine.mismatch.what", { who: sideName(m.who, tr), others: tr.list(m.refusing.map((r) => sideName(r, tr))) });
}

function sideOf(entity: CombineEntity): CombineSideView {
  const id = entity.id;
  if (entity.owner === "rule") return { id, kind: "rule", name: entity.rule?.name ?? "" };
  if (entity.reward === "discount") return { id, kind: "milestone", name: entity.rule?.name ?? "" };
  if (entity.reward === "gift") return { id, kind: "gift", name: "" };
  if (entity.reward === "shipping") return { id, kind: "shipping", name: "" };
  return { id, kind: entity.owner === "tiers" ? "tiers" : "outlet", name: "" };
}

function hrefOf(entity: CombineEntity): string {
  if (entity.owner === "rule") return `/app/discounts/${encodeURIComponent(entity.id)}#pro`;
  return `/app/${entity.owner}#combine-types`;
}

/** The mismatches from the config the plan runs (on Free no exception counts), one a discount that allows, each with what a button does. */
export function mismatchViews(config: ReadonlyDeep<WonDiscountsConfig>, plan: ShopPlan): CombineMismatchView[] {
  const runs = gateConfigForPlan(config, plan).config as WonDiscountsConfig;
  const before = combineMismatches(runs).length;
  const exceptions = plan === "pro";
  return combineMismatchGroups(runs).map(({ allowing, refusing }) => {
    // What else a button changes: the mismatches it would leave besides this one's going away.
    const made = (mode: "allow" | "deny") => Math.max(0, combineMismatches(fixCombineMismatch(runs, allowing.id, mode, { exceptions })).length - (before - refusing.length));
    return { id: allowing.id, who: sideOf(allowing), refusing: refusing.map(sideOf), href: hrefOf(allowing), allowNew: made("allow"), denyNew: made("deny") };
  });
}
