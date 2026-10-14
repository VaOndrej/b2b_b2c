// "Sčítá se s" (docs/won-discounts/navrh-kombinace-2026-10-13.md; the rule is @won/core combine.ts): the list of
// types a discount adds up with — on a rule in its editor, on Množstevní slevy, Milníky and Výprodej once a
// module, and the list a new discount starts with in Nastavení — and, on Pro, a rule's exceptions. One set of
// labels, one reader of the posted form (the server parses it again, SEC-1) and one state sentence for all of
// them. Pure; tests/ui/combine.test.ts.

import { COMBINE_TYPES, normalizeCombineTypes, type CombineType } from "@won/core/discounts/combine";
import { COMBINE_OFFERED } from "@won/core/discounts/combine-config";

import type { MessageKey, Translator } from "../../i18n";
import type { FormDataLike } from "./rule-form";

export { COMBINE_OFFERED, COMBINE_TYPES, type CombineType };

/** Whose list it is: a rule of one of the three types, or one of the three modules. */
export type CombineOwner = keyof typeof COMBINE_OFFERED;

/** Form fields of the list: one checkbox per type, and a marker that the list was in the form at all (so "none ticked" is told from "not posted"). */
export const COMBINE_FIELD = {
  types: "combineTypes",
  posted: "combinePosted",
  /** A rule's exceptions (Pro): one checkbox per other rule. */
  rules: "combineRules",
} as const;

/** Where a module's page posts its list (Množstevní slevy, Milníky, Výprodej: shell/ModuleCombine). */
export const COMBINE_ACTION = "/app/combine";

/** The module's list form: `intent=save`, the module, the list (COMBINE_FIELD), the stored version. */
export const MODULE_COMBINE_FIELD = { intent: "intent", module: "combineModule", configVersion: "configVersion" } as const;
export const MODULE_COMBINE_INTENT = { save: "save" } as const;
export const COMBINE_MODULES = ["tiers", "rewards", "outlet"] as const;
export type CombineModule = (typeof COMBINE_MODULES)[number];

/** The module a form names; null for anything else. */
export function readCombineModule(form: FormDataLike): CombineModule | null {
  const value = form.get(MODULE_COMBINE_FIELD.module);
  return COMBINE_MODULES.find((m) => m === value) ?? null;
}

/** The checkbox label of a type ("Automatické slevy"). */
export function combineTypeLabel(type: CombineType, tr: Translator): string {
  return tr.t(`combine.type.${type}` as MessageKey);
}

/** The type inside the state sentence ("automatickými slevami"). */
function combineTypeWith(type: CombineType, tr: Translator): string {
  return tr.t(`combine.with.${type}` as MessageKey);
}

/** The list as posted, in the checkboxes' order, only what this owner is offered; null when the form has no list. */
export function readCombineTypes(form: FormDataLike, owner: CombineOwner): CombineType[] | null {
  if (form.get(COMBINE_FIELD.posted) === null) return null;
  const offered = COMBINE_OFFERED[owner];
  return normalizeCombineTypes(form.getAll(COMBINE_FIELD.types).filter((v): v is string => typeof v === "string")).filter((type) => offered.includes(type));
}

/**
 * The state sentence: "sčítá se s automatickými slevami a dopravou zdarma · výjimka: NEWSLETTER", or that it
 * adds up with no other discount. `exceptions`: the names of the rules named as exceptions.
 */
export function combineSummary(types: readonly CombineType[], tr: Translator, exceptions: readonly string[] = []): string {
  const listed = COMBINE_TYPES.filter((type) => types.includes(type)).map((type) => combineTypeWith(type, tr));
  const head = listed.length > 0 ? tr.t("combine.summary", { list: tr.list(listed) }) : tr.t("combine.summary.none");
  if (exceptions.length === 0) return head;
  return `${head} · ${tr.t(exceptions.length === 1 ? "combine.summary.exception" : "combine.summary.exceptions", { names: tr.list([...exceptions]) })}`;
}
