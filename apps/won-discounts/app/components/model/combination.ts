// Nastavení → Kombinování slev (13 Oct 2026): the list of types a NEW discount starts with
// (`engine.combineDefault`; the four category switches of before are gone — every discount and module has its
// own list now, model/combine.ts), and "a customer from a country in no market". Read from the form the same way
// on the server (SEC-1) and for the live state line (§17b). Pure; tests/ui/combination-switches.test.ts.

import { UNKNOWN_MARKET_KINDS, type UnknownMarketKind } from "@won/core/discounts/config";

import type { Translator } from "../../i18n";
import type { FormDataLike } from "./rule-form";
import { combineSummary, readCombineTypes, type CombineType } from "./combine";

/** Form fields the Nastavení action posts (app/lib/integration/settings.server.ts). */
export const COMBINATION_FIELD = {
  intent: "intent",
  configVersion: "configVersion",
  replaceUnreadable: "replaceUnreadable",
  /** Nastavení → "Zákazník ze země mimo vaše trhy" (engine.unknownMarketLowest): the lowest amount of the currency's markets. */
  unknownMarketLowest: "unknownMarketLowest",
  /** + a kind of amount (UNKNOWN_MARKET_KINDS): "lowest" or "highest" of the markets' amounts for that kind (engine.unknownMarketHighest). */
  unknownMarketPick: "unknownMarketPick.",
} as const;

/** The two choices of one kind of amount, the default first. */
export const UNKNOWN_MARKET_PICKS = ["lowest", "highest"] as const;
export { UNKNOWN_MARKET_KINDS, type UnknownMarketKind };

export const COMBINATION_INTENT = { save: "save" } as const;

/** Where the Nastavení form posts. */
export const SETTINGS_ACTION = "/app/settings";

function checked(raw: FormDataEntryValue | null): boolean {
  return typeof raw === "string" && ["on", "true", "1"].includes(raw.trim().toLowerCase());
}

/** The default list as posted (the checkboxes a discount without a code is offered); null when the form has none. */
export function readCombineDefaultForm(form: FormDataLike): CombineType[] | null {
  return readCombineTypes(form, "automatic");
}

/** The "customer from a country in no market" switch as posted (not checked = not in the form = off). */
export function readUnknownMarketForm(form: FormDataLike): boolean {
  return checked(form.get(COMBINATION_FIELD.unknownMarketLowest));
}

/** The kinds of amount posted as "highest"; undefined when the form posts no choice at all (the stored ones stay). */
export function readUnknownMarketHighestForm(form: FormDataLike): UnknownMarketKind[] | undefined {
  const posted = UNKNOWN_MARKET_KINDS.map((kind) => [kind, form.get(`${COMBINATION_FIELD.unknownMarketPick}${kind}`)] as const);
  if (posted.every(([, raw]) => raw === null)) return undefined;
  return posted.filter(([, raw]) => raw === "highest").map(([kind]) => kind);
}

/** The section's state line: "Nová sleva: sčítá se s dopravou zdarma a Milníky". */
export function combineDefaultSummary(types: readonly CombineType[], tr: Translator): string {
  return tr.t("settings.combination.summary", { summary: combineSummary(types, tr) });
}
