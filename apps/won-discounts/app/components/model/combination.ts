// Nastavení → Kombinování slev (MVP 3, the MVP 1 debt; decision A1): the Free
// per-category switches of engine.combination, one sentence per switch and
// position saying what it does at checkout (§4c: never an engine key on screen),
// read from the form the same way on the server (SEC-1) and for the live state
// line (§17b). Product-with-product is fixed ("the better one wins", A1) and is
// said, not switched. Pure; tests/ui/combination-switches.test.ts.

import { UNKNOWN_MARKET_KINDS, type UnknownMarketKind } from "@won/core/discounts/config";

import type { MessageKey, Translator } from "../../i18n";
import type { FormDataLike } from "./rule-form";
import type { CombinationView } from "./types";

/** The four switches, in the engine's own names (engine.combination). */
export const COMBINATION_KEYS = ["outletWithAnything", "productWithOrder", "productWithShipping", "orderWithShipping"] as const;
export type CombinationKey = (typeof COMBINATION_KEYS)[number];

/** Form fields the Nastavení action posts (app/lib/integration/settings.server.ts). */
export const COMBINATION_FIELD = {
  intent: "intent",
  configVersion: "configVersion",
  replaceUnreadable: "replaceUnreadable",
  outletWithAnything: "outletWithAnything",
  productWithOrder: "productWithOrder",
  productWithShipping: "productWithShipping",
  orderWithShipping: "orderWithShipping",
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

/** The switches as posted: a switch that is not checked is not in the form = off. */
export function readCombinationForm(form: FormDataLike): CombinationView {
  return {
    outletWithAnything: checked(form.get(COMBINATION_FIELD.outletWithAnything)),
    productWithOrder: checked(form.get(COMBINATION_FIELD.productWithOrder)),
    productWithShipping: checked(form.get(COMBINATION_FIELD.productWithShipping)),
    orderWithShipping: checked(form.get(COMBINATION_FIELD.orderWithShipping)),
  };
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

export function combinationLabel(key: CombinationKey, tr: Translator): string {
  return tr.t(`combination.${key}.label` as MessageKey);
}

/** What checkout does with the switch in this position. */
export function combinationSentence(key: CombinationKey, on: boolean, tr: Translator): string {
  return tr.t(`combination.${key}.${on ? "on" : "off"}` as MessageKey);
}

/** The section's state line: which categories add up ("Sčítá se: produkty s objednávkou, …"). */
export function combinationSummary(view: CombinationView, tr: Translator): string {
  const on = COMBINATION_KEYS.filter((key) => view[key]).map((key) => tr.t(`combination.${key}.short` as MessageKey));
  return on.length === 0 ? tr.t("settings.combination.summary.none") : tr.t("settings.combination.summary", { list: tr.list(on) });
}
