// Human copy for native discounts, Czech + English by admin language (A10).
// Doctrine §4c: no enum key ever reaches the merchant; §14c: the move dialog
// says what is lost BEFORE the click. Short sentences, no filler.
// Pure module: the admin UI (T5) imports it directly.

import type { ConflictKind, MovePlan, NativeLocale, NotMovableReason } from "./types.ts";

type Copy = Record<NativeLocale, string>;
const pick = (copy: Copy, locale: NativeLocale): string => copy[locale] ?? copy.cs;

function intlLocale(locale: NativeLocale): string {
  return locale === "en" ? "en-US" : "cs-CZ";
}

/** Instant in the shop's zone, e.g. "1. 10. 2026 14:00". */
export function formatShopTime(iso: string, timeZone: string, locale: NativeLocale): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { timeZone, dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

const quote = (text: string, locale: NativeLocale) => (locale === "en" ? `“${text}”` : `„${text}“`);

function list(items: string[], locale: NativeLocale, max = 3): string {
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const joined = shown.join(", ");
  if (rest <= 0) return joined;
  return locale === "en" ? `${joined} and ${rest} more` : `${joined} a ${rest} dalších`;
}

// --- Why a discount stays in Shopify ----------------------------------------------

export function notMovableReasonText(reason: NotMovableReason, locale: NativeLocale): string {
  switch (reason.code) {
    case "bxgy":
      return pick(
        {
          cs: "Won Discounts nemá Kup X, dostaneš Y. Pokryjí to množstevní slevy.",
          en: "Won Discounts has no Buy X, get Y. Quantity discounts cover it.",
        },
        locale,
      );
    case "other_app":
      return reason.appTitle
        ? pick(
            {
              cs: `Slevu počítá aplikace ${reason.appTitle}. Won ji převzít nemůže.`,
              en: `The app ${reason.appTitle} calculates this discount. Won cannot take it over.`,
            },
            locale,
          )
        : pick(
            {
              cs: "Slevu počítá jiná aplikace. Won ji převzít nemůže.",
              en: "Another app calculates this discount. Won cannot take it over.",
            },
            locale,
          );
    case "specific_buyers":
      return pick(
        {
          cs: "Platí jen pro vybrané zákazníky nebo segmenty. To Won zatím neumí převzít.",
          en: "It is limited to selected customers or segments. Won cannot take that over yet.",
        },
        locale,
      );
    case "subscription_only":
      return pick(
        {
          cs: "Platí jen na předplatné. Won předplatné zvlášť nerozlišuje.",
          en: "It applies to subscriptions only. Won does not treat subscriptions separately.",
        },
        locale,
      );
    case "fixed_once_per_order":
      return pick(
        {
          cs: "Pevná částka se odečítá jednou za objednávku. Won ji umí jen z každého kusu.",
          en: "The fixed amount comes off once per order. Won can only take it off each item.",
        },
        locale,
      );
    case "fixed_each_item_on_order":
      return pick(
        {
          cs: "Pevná částka se odečítá z každého kusu v celé objednávce. Won ji na celou objednávku umí jen jednou.",
          en: "The fixed amount comes off each item of the whole order. On a whole order Won takes it off only once.",
        },
        locale,
      );
    case "shipping_countries":
      return pick(
        {
          cs: "Doprava zdarma platí jen do vybraných zemí. To Won zatím neumí.",
          en: "Free shipping is limited to selected countries. Won cannot do that yet.",
        },
        locale,
      );
    case "shipping_price_cap":
      return pick(
        {
          cs: "Doprava zdarma má horní limit ceny dopravy. To Won zatím neumí.",
          en: "Free shipping has a maximum shipping price. Won cannot do that yet.",
        },
        locale,
      );
    case "too_many_items":
      return pick(
        {
          cs: `Míří na víc než ${reason.limit} produktů nebo kolekcí. Víc Won pravidlo nepojme.`,
          en: `It targets more than ${reason.limit} products or collections. A Won rule holds no more.`,
        },
        locale,
      );
    case "too_many_codes_to_back_up":
      return reason.atLeast
        ? pick(
            {
              cs: `Má aspoň ${reason.count} kódů a Shopify neřekne kolik přesně. Won zálohuje jen slevu, kterou přečte celou.`,
              en: `It has at least ${reason.count} codes and Shopify does not say exactly how many. Won backs up only a discount it can read in full.`,
            },
            locale,
          )
        : pick(
            {
              cs: `Má ${reason.count} kódů. Won jich umí zálohovat nejvýš ${reason.limit}.`,
              en: `It has ${reason.count} codes. Won can back up at most ${reason.limit}.`,
            },
            locale,
          );
    case "code_too_long":
      return pick(
        {
          cs: `Má kód delší než ${reason.max} znaků. Tak dlouhý kód Won nepodporuje.`,
          en: `It has a code longer than ${reason.max} characters. Won does not support codes that long.`,
        },
        locale,
      );
    case "no_codes":
      return pick(
        { cs: "Sleva nemá žádný kód. Není co přesouvat.", en: "The discount has no code. There is nothing to move." },
        locale,
      );
    case "incomplete_read":
      return pick(
        {
          cs: "Slevu se nepodařilo načíst celou, záloha by nebyla úplná. Nechali jsme ji v Shopify.",
          en: "The discount could not be read in full, so the backup would be incomplete. It stays in Shopify.",
        },
        locale,
      );
    case "usage_exhausted":
      return pick(
        {
          cs: `Limit použití je vyčerpaný (${reason.used} z ${reason.limit}). Není co přesouvat.`,
          en: `The usage limit is used up (${reason.used} of ${reason.limit}). There is nothing to move.`,
        },
        locale,
      );
    case "expired":
      return pick(
        { cs: "Sleva už skončila. Není co přesouvat.", en: "The discount has ended. There is nothing to move." },
        locale,
      );
    case "unsupported_value":
      return pick(
        {
          cs: "Tenhle druh slevy Won nezná. Nechali jsme ji v Shopify.",
          en: "Won does not know this kind of discount. It stays in Shopify.",
        },
        locale,
      );
    case "unknown_type":
      return pick(
        {
          cs: "Tenhle typ slevy Won nezná. Nechali jsme ji v Shopify.",
          en: "Won does not know this discount type. It stays in Shopify.",
        },
        locale,
      );
  }
}

// --- What the move costs (dialog, before the click) -----------------------------------

export type LossItem =
  | { code: "usage_history"; used: number; method?: "code" | "automatic" }
  | { code: "once_per_customer" }
  | { code: "codes_over_limit"; count: number; limit: number }
  | { code: "subscription_cycles"; cycles: number };

export function lossText(item: LossItem, locale: NativeLocale): string {
  switch (item.code) {
    case "usage_history":
      // The count lives on the Shopify discount, which the move deletes (orders keep their code).
      if (item.method === "automatic") {
        // No code, and Won keeps no usage count for an automatic rule.
        return pick(
          {
            cs: `Počítadlo použití (zatím ${item.used}×) se smazáním slevy v Shopify ztratí. Objednávky slevu dál ukazují.`,
            en: `The usage count (${item.used} so far) goes with the deleted Shopify discount. Orders still show the discount.`,
          },
          locale,
        );
      }
      return item.used > 0
        ? pick(
            {
              cs: `Počítadlo použití (zatím ${item.used}×) se smazáním slevy v Shopify ztratí. Won počítá od nuly. Objednávky kód dál ukazují.`,
              en: `The usage count (${item.used} so far) goes with the deleted Shopify discount. Won counts from zero. Orders still show the code.`,
            },
            locale,
          )
        : pick(
            {
              cs: "Počítadlo použití se smazáním slevy v Shopify ztratí. Won počítá od nuly.",
              en: "The usage count goes with the deleted Shopify discount. Won counts from zero.",
            },
            locale,
          );
    case "once_per_customer":
      return pick(
        {
          cs: "Limit „1× na zákazníka“ začne znovu. Kdo kód už použil, může ho použít ještě jednou.",
          en: "“Once per customer” starts over. A customer who already used the code can use it once more.",
        },
        locale,
      );
    case "codes_over_limit":
      return pick(
        {
          cs: `Sleva má ${item.count} kódů, Won pravidlo pojme ${item.limit}. Zbylých ${item.count - item.limit} po přesunu přestane platit.`,
          en: `The discount has ${item.count} codes, a Won rule holds ${item.limit}. The other ${item.count - item.limit} stop working after the move.`,
        },
        locale,
      );
    case "subscription_cycles":
      return pick(
        {
          cs: `Na předplatné platila jen na prvních ${item.cycles} objednávek. Won počet opakování nehlídá, bude platit na každou. Vrácení zpět limit obnoví.`,
          en: `On subscriptions it applied to the first ${item.cycles} orders only. Won does not track repeats, so it applies to every one. Undo restores the limit.`,
        },
        locale,
      );
  }
}

export type CombinationCategory = "product" | "order" | "shipping";

export type WarningItem =
  | { code: "other_currencies"; shopCurrency: string; missing: string[] }
  | { code: "other_currencies_unknown"; shopCurrency: string }
  | { code: "usage_limit_remaining"; used: number; limit: number; remaining: number }
  | { code: "combination_differs"; category: CombinationCategory; native: boolean; won: boolean }
  | { code: "starts_by_day"; at: string; timeZone: string }
  | { code: "ends_by_day"; at: string; timeZone: string }
  | { code: "subscriptions_included" }
  /** F4: remaining Shopify discounts that did not stack with this one and will now. */
  | { code: "stacks_with_native"; titles: string[] }
  /** F4: remaining Shopify discounts that do not combine with this one's class: Shopify applies one of them. */
  | { code: "blocked_by_native"; titles: string[] };

const CATEGORY_WITH: Record<CombinationCategory, Copy> = {
  product: { cs: "s produktovými slevami", en: "with product discounts" },
  order: { cs: "se slevami na objednávku", en: "with order discounts" },
  shipping: { cs: "se slevami na dopravu", en: "with shipping discounts" },
};

export function warningText(item: WarningItem, locale: NativeLocale): string {
  switch (item.code) {
    case "other_currencies":
      return pick(
        {
          cs: `Částka je jen v ${item.shopCurrency}. Doplň ji pro ${list(item.missing, locale)}, jinak se tam sleva nenabídne. Won nikdy nepřepočítává kurzem.`,
          en: `The amount is in ${item.shopCurrency} only. Add it for ${list(item.missing, locale)}, or the discount is not offered there. Won never converts by exchange rate.`,
        },
        locale,
      );
    case "other_currencies_unknown":
      return pick(
        {
          cs: `Částka je jen v ${item.shopCurrency}. Prodáváš-li i v jiné měně, doplň ji pro ni. Won nikdy nepřepočítává kurzem.`,
          en: `The amount is in ${item.shopCurrency} only. If you sell in other currencies, add it for them. Won never converts by exchange rate.`,
        },
        locale,
      );
    case "usage_limit_remaining":
      return pick(
        {
          cs: `Shopify eviduje přibližně ${item.used} z ${item.limit} použití (počítá se zpožděním). Ve Won nastavíme limit na zbývajících ${item.remaining}.`,
          en: `Shopify counts about ${item.used} of ${item.limit} uses (an approximate, delayed count). In Won the limit is set to the remaining ${item.remaining}.`,
        },
        locale,
      );
    case "stacks_with_native": {
      const titles = list(item.titles.map((t) => quote(t, locale)), locale);
      return pick(
        {
          cs: `V Shopify se nesčítala s ${titles}. Po přesunu se sečtou: Won sleva se kombinuje se vším, rozhoduje už jen nastavení té druhé slevy.`,
          en: `In Shopify it did not add up with ${titles}. After the move they add up: the Won discount combines with everything, only the other discount's setting decides.`,
        },
        locale,
      );
    }
    case "blocked_by_native": {
      const titles = list(item.titles.map((t) => quote(t, locale)), locale);
      return pick(
        {
          cs: `${titles} se s touhle slevou nekombinuje. Když půjdou uplatnit obě, Shopify použije jen jednu z nich, stejně jako dřív. Won nastavení kombinování na tom nic nezmění.`,
          en: `${titles} does not combine with this discount. When both could apply, Shopify uses only one of them, as before. Won's combination settings do not change that.`,
        },
        locale,
      );
    }
    case "combination_differs": {
      const category = pick(CATEGORY_WITH[item.category], locale);
      return locale === "en"
        ? `In Shopify it ${item.native ? "combined" : "did not combine"} ${category}. In Won it ${item.won ? "combines" : "does not combine"}, by the Won combination settings.`
        : `V Shopify se ${item.native ? "kombinovala" : "nekombinovala"} ${category}. Ve Won se podle nastavení kombinování ${item.won ? "kombinuje" : "nekombinuje"}.`;
    }
    case "starts_by_day":
      return pick(
        {
          cs: `Začíná ${formatShopTime(item.at, item.timeZone, locale)}. Automatické slevy Won zapíná po celých dnech, zapne ji už od půlnoci.`,
          en: `It starts ${formatShopTime(item.at, item.timeZone, locale)}. Won switches automatic discounts by whole days, so it starts at midnight.`,
        },
        locale,
      );
    case "ends_by_day":
      return pick(
        {
          cs: `Končí ${formatShopTime(item.at, item.timeZone, locale)}. Automatické slevy Won vypíná po celých dnech, poběží do konce toho dne.`,
          en: `It ends ${formatShopTime(item.at, item.timeZone, locale)}. Won switches automatic discounts by whole days, so it runs to the end of that day.`,
        },
        locale,
      );
    case "subscriptions_included":
      return pick(
        {
          cs: "Prodáváš-li předplatné: v Shopify na něj sleva neplatila. Won předplatné nerozlišuje, bude platit i na něj.",
          en: "If you sell subscriptions: in Shopify the discount did not apply to them. Won does not tell subscriptions apart, so it applies to them too.",
        },
        locale,
      );
  }
}

// --- Dialog -------------------------------------------------------------------------

export interface MoveDialogCopy {
  heading: string;
  intro: string;
  lossesHeading: string;
  losses: string[];
  warningsHeading: string;
  warnings: string[];
  confirm: string;
  cancel: string;
}

/** Everything the "Přesunout" dialog shows (§13 one button, §14c losses first). */
export function moveDialogCopy(title: string, plan: Pick<MovePlan, "losses" | "warnings">, locale: NativeLocale): MoveDialogCopy {
  return {
    heading: pick({ cs: `Přesunout ${quote(title, "cs")} do Won?`, en: `Move ${quote(title, "en")} into Won?` }, locale),
    intro: pick(
      {
        cs: "Won slevu zazálohuje. Automatickou nejdřív vytvoří ve Won a pak v Shopify smaže, chvíli mohou platit obě. Slevu s kódem nejdřív smaže (Shopify nepustí stejný kód ke dvěma slevám), chvíli pak neplatí. Přesun jde vrátit ze zálohy.",
        en: "Won backs the discount up. An automatic one is first created in Won, then deleted in Shopify; for a moment both may apply. A code discount is deleted first (Shopify never lets two discounts share a code), so for a moment it does not apply. Undo restores it from the backup.",
      },
      locale,
    ),
    lossesHeading: pick({ cs: "Co se ztratí", en: "What you lose" }, locale),
    losses: plan.losses,
    warningsHeading: pick({ cs: "Na co myslet", en: "Keep in mind" }, locale),
    warnings: plan.warnings,
    confirm: pick({ cs: "Přesunout", en: "Move" }, locale),
    cancel: pick({ cs: "Zrušit", en: "Cancel" }, locale),
  };
}

/** Onboarding / Přehled question: one button that does it (§13). */
export function moveAllPrompt(count: number, locale: NativeLocale): { question: string; confirm: string } {
  if (locale === "en") {
    return {
      question: count === 1 ? "You have 1 discount in Shopify. Move it into Won?" : `You have ${count} discounts in Shopify. Move them into Won?`,
      confirm: count === 1 ? "Move it" : `Move ${count} discounts`,
    };
  }
  const noun = count === 1 ? "slevu" : count >= 2 && count <= 4 ? "slevy" : "slev";
  return {
    question: `Máš ${count} ${noun} v Shopify. Přesunout do Won?`,
    confirm: count === 1 ? "Přesunout" : `Přesunout ${count} ${noun}`,
  };
}

// --- Conflicts (Přehled) -----------------------------------------------------------

export function conflictText(
  kind: ConflictKind,
  nativeTitle: string,
  ruleName: string,
  locale: NativeLocale,
  codes: string[] = [],
  /** False for a discount Won cannot take over (BXGY, another app's): suggest changing the code instead. */
  movable = true,
): string {
  const n = quote(nativeTitle, locale);
  const r = quote(ruleName, locale);
  switch (kind) {
    case "same_code":
      return movable
        ? pick(
            {
              cs: `Kód ${list(codes, "cs")} má Shopify sleva ${n} i Won pravidlo ${r}. Shopify nedovolí jeden kód u dvou slev, Won pravidlo s ním nepůjde zapnout. Přesuň slevu do Won.`,
              en: `The code ${list(codes, "en")} is on the Shopify discount ${n} and the Won rule ${r}. Shopify allows a code on one discount only, so the Won rule cannot go live. Move the discount into Won.`,
            },
            locale,
          )
        : pick(
            {
              cs: `Kód ${list(codes, "cs")} má Shopify sleva ${n} i Won pravidlo ${r}. Shopify nedovolí jeden kód u dvou slev, Won pravidlo s ním nepůjde zapnout. Změň kód ve Won pravidle.`,
              en: `The code ${list(codes, "en")} is on the Shopify discount ${n} and the Won rule ${r}. Shopify allows a code on one discount only, so the Won rule cannot go live. Change the code of the Won rule.`,
            },
            locale,
          );
    case "same_products":
      return pick(
        {
          cs: `Shopify sleva ${n} a Won pravidlo ${r} míří na stejné produkty. Won o Shopify slevě neví a nehlídá, která se uplatní. Přesuň ji do Won.`,
          en: `The Shopify discount ${n} and the Won rule ${r} target the same products. Won does not see the Shopify discount and cannot decide which applies. Move it into Won.`,
        },
        locale,
      );
    case "same_collections":
      return pick(
        {
          cs: `Shopify sleva ${n} a Won pravidlo ${r} míří na stejné kolekce. Won o Shopify slevě neví a nehlídá, která se uplatní. Přesuň ji do Won.`,
          en: `The Shopify discount ${n} and the Won rule ${r} target the same collections. Won does not see the Shopify discount and cannot decide which applies. Move it into Won.`,
        },
        locale,
      );
    case "both_order":
      return pick(
        {
          cs: `Shopify sleva ${n} i Won pravidlo ${r} jsou slevy na celou objednávku. Won o Shopify slevě neví a nehlídá, jestli se sečtou. Přesuň ji do Won.`,
          en: `The Shopify discount ${n} and the Won rule ${r} are both order discounts. Won does not see the Shopify discount and cannot tell whether they add up. Move it into Won.`,
        },
        locale,
      );
    case "both_shipping":
      return pick(
        {
          cs: `Shopify sleva ${n} i Won pravidlo ${r} dávají slevu na dopravu. Won o Shopify slevě neví. Přesuň ji do Won.`,
          en: `The Shopify discount ${n} and the Won rule ${r} both discount shipping. Won does not see the Shopify discount. Move it into Won.`,
        },
        locale,
      );
  }
}

// --- Results of move / undo ------------------------------------------------------------

/**
 * Where the discount is after a failed move (drives the second half of the
 * message, and the UI): never "nothing changed" once the native was deleted.
 */
export type MoveState =
  | "unchanged" //       nothing changed in Shopify
  | "restored" //        deleted, then put back in full
  | "restored_partly" // put back, some codes still missing or importing
  | "in_backup" //       not in Shopify now; undo puts it back from the backup
  | "rule_stuck" //      the Won rule could not be removed, so it was NOT put back (no double discount)
  | "rule_unverified" // could not check that Shopify stopped running the Won rule, so it was NOT put back
  | "restore_unknown" // the restore may or may not have landed (answer lost, look-up failed)
  | "unknown" //         the delete may or may not have happened
  | "still_there" //     no answer to the delete, but the re-checks still see the discount (backup kept)
  | "rolled_back_unknown" // automatic, create-first: the delete got no answer, so the Won rule was taken out again
  | "both_live" //       automatic, create-first: the native stayed and its Won rule could not be taken out
  | "in_progress"; //    another move or undo of it is running

export type MoveErrorItem =
  | { code: "not_found" }
  | { code: "not_movable"; reason: string }
  | { code: "read_failed"; detail: string }
  | { code: "config_read_only" }
  | { code: "code_taken"; codes: string[]; ruleName: string }
  | { code: "code_rule_limit"; count: number; limit: number }
  | { code: "backup_failed" }
  | { code: "delete_failed"; detail: string }
  | { code: "outcome_unknown"; detail: string }
  | { code: "in_progress" }
  | { code: "sync_failed"; detail: string }
  | { code: "config_unreadable" }
  | { code: "code_hash_collision"; codes: string[][] }
  | { code: "config_budget"; bytes: number; budget: number }
  | { code: "config_too_large" }
  | { code: "internal_error"; detail: string }
  /** F8: an earlier attempt already put the discount back into Shopify. */
  | { code: "restored_earlier" }
  /** "Přesunout vše" stopped after a limit refusal: this one was not tried. */
  | { code: "skipped_after_limit" };

/** Refusals that the next discounts of "Přesunout vše" would hit too (the circuit breaker stops there). */
export const LIMIT_REFUSALS: ReadonlySet<MoveErrorItem["code"]> = new Set(["code_rule_limit", "config_budget", "config_too_large"]);

/** Why it failed, and what to do about it (the state sentence goes between them). */
function moveErrorParts(item: MoveErrorItem, locale: NativeLocale): { what: string; next?: string } {
  switch (item.code) {
    case "not_found":
      return {
        what: pick({ cs: "Tahle sleva už v Shopify není.", en: "This discount is no longer in Shopify." }, locale),
        next: pick({ cs: "Obnov seznam slev.", en: "Refresh the list." }, locale),
      };
    case "not_movable":
      return { what: item.reason };
    case "read_failed":
      return {
        what: pick(
          { cs: `Slevu se nepodařilo načíst ze Shopify (${item.detail}).`, en: `Could not read the discount from Shopify (${item.detail}).` },
          locale,
        ),
        next: pick({ cs: "Zkus to znovu.", en: "Try again." }, locale),
      };
    case "config_read_only":
      return {
        what: pick(
          { cs: "Nastavení právě uložila novější verze aplikace.", en: "A newer version of the app just saved the settings." },
          locale,
        ),
        next: pick({ cs: "Zkus to za pár minut.", en: "Try again in a few minutes." }, locale),
      };
    case "code_taken":
      return {
        what: pick(
          {
            cs: `Kód ${list(item.codes, "cs")} už má Won pravidlo ${quote(item.ruleName, "cs")}.`,
            en: `The Won rule ${quote(item.ruleName, "en")} already has the code ${list(item.codes, "en")}.`,
          },
          locale,
        ),
        next: pick({ cs: "Změň kód ve Won a zkus to znovu.", en: "Change the code in Won and try again." }, locale),
      };
    case "code_rule_limit":
      return {
        what: pick(
          {
            cs: `Won už má ${item.count} kódových pravidel a víc než ${item.limit} Shopify nedovolí.`,
            en: `Won already has ${item.count} code rules and Shopify allows no more than ${item.limit}.`,
          },
          locale,
        ),
        next: pick({ cs: "Vypni nějaké kódové pravidlo a zkus to znovu.", en: "Turn off a code rule and try again." }, locale),
      };
    case "backup_failed":
      return {
        what: pick({ cs: "Zálohu se nepodařilo uložit.", en: "The backup could not be saved." }, locale),
        next: pick({ cs: "Zkus to znovu.", en: "Try again." }, locale),
      };
    case "delete_failed":
      return {
        what: pick({ cs: `Shopify slevu nesmazal (${item.detail}).`, en: `Shopify did not delete the discount (${item.detail}).` }, locale),
      };
    case "outcome_unknown":
      return {
        what: pick({ cs: `Spojení se Shopify selhalo (${item.detail}).`, en: `The connection to Shopify failed (${item.detail}).` }, locale),
      };
    case "in_progress":
      return {
        what: pick(
          { cs: "Tuhle slevu právě přesouvá nebo vrací jiné okno.", en: "Another window is moving or restoring this discount right now." },
          locale,
        ),
        next: pick({ cs: "Počkej chvíli a obnov stránku.", en: "Wait a moment and refresh the page." }, locale),
      };
    case "sync_failed":
      return { what: pick({ cs: `Přesun se nepovedl (${item.detail}).`, en: `The move failed (${item.detail}).` }, locale) };
    case "config_unreadable":
      return {
        what: pick(
          {
            cs: "Uložené nastavení Won se nedá přečíst, přesun by ho přepsal.",
            en: "The saved Won settings cannot be read; a move would overwrite them.",
          },
          locale,
        ),
        next: pick({ cs: "Otevři nastavení a ulož ho znovu, pak slevu přesuň.", en: "Open the settings, save them again, then move the discount." }, locale),
      };
    case "code_hash_collision":
      return {
        what: pick(
          {
            cs: `Kódy ${list(item.codes.map((group) => group.join(" a ")), "cs")} nejde použít zároveň, pokladna je nerozliší.`,
            en: `The codes ${list(item.codes.map((group) => group.join(" and ")), "en")} cannot be used together, checkout cannot tell them apart.`,
          },
          locale,
        ),
        next: pick(
          { cs: "Změň jeden z nich, třeba přidej znak, a zkus to znovu.", en: "Change one of them, e.g. add a character, and try again." },
          locale,
        ),
      };
    case "config_budget":
      return {
        what: pick(
          {
            cs: `Won pravidla by se s touhle slevou nevešla do limitu Shopify (${item.bytes} z ${item.budget} B).`,
            en: `With this discount the Won rules would not fit Shopify's limit (${item.bytes} of ${item.budget} B).`,
          },
          locale,
        ),
        next: pick({ cs: "Uber kódy nebo pravidla ve Won, pak ji přesuň.", en: "Remove codes or rules in Won, then move it." }, locale),
      };
    case "config_too_large":
      return {
        what: pick({ cs: "Nastavení Won by s touhle slevou bylo příliš velké.", en: "With this discount the Won settings would be too large." }, locale),
        next: pick({ cs: "Uber pravidla ve Won, pak ji přesuň.", en: "Remove rules in Won, then move it." }, locale),
      };
    case "internal_error":
      return { what: pick({ cs: `Přesun se přerušil (${item.detail}).`, en: `The move was interrupted (${item.detail}).` }, locale) };
    case "restored_earlier":
      return {
        what: pick(
          { cs: "Předchozí pokus o přesun už slevu vrátil do Shopify.", en: "An earlier attempt to move it already put the discount back into Shopify." },
          locale,
        ),
        next: pick({ cs: "Obnov seznam slev a přesuň ji znovu.", en: "Refresh the list and move it again." }, locale),
      };
    case "skipped_after_limit":
      return {
        what: pick(
          {
            cs: "Nepřesunuli jsme ji: předchozí sleva narazila na limit Won a tahle by na něj narazila taky.",
            en: "Not moved: the previous discount hit Won's limit and this one would hit it too.",
          },
          locale,
        ),
      };
  }
}

/** What a restore changed (F1: it is a new discount, never "as before"). */
export interface RestoreFacts {
  /** The usage limit the restored discount got (what was left), or null without a limit. */
  remaining?: number | null;
  oncePerCustomer?: boolean;
}

function restoreChanges(facts: RestoreFacts, locale: NativeLocale): string {
  const cs = ["Je to nová sleva s novým ID.", "Počítadlo použití začíná od nuly"];
  const en = ["It is a new discount with a new ID.", "The usage count starts from zero"];
  if (typeof facts.remaining === "number") {
    cs[1] += `, limit jsme nastavili na zbývajících ${facts.remaining}`;
    en[1] += `, the limit is set to the remaining ${facts.remaining}`;
  }
  cs[1] += ".";
  en[1] += ".";
  if (facts.oncePerCustomer) {
    cs.push("Limit „1× na zákazníka“ začíná znovu.");
    en.push("“Once per customer” starts over.");
  }
  return pick({ cs: cs.join(" "), en: en.join(" ") }, locale);
}

export interface MoveStateDetails extends RestoreFacts {
  missing?: number;
  pending?: boolean;
}

function stateText(state: MoveState, locale: NativeLocale, codes: MoveStateDetails): string | null {
  switch (state) {
    case "unchanged":
      return pick({ cs: "Nic se nezměnilo.", en: "Nothing changed." }, locale);
    case "restored":
      return `${pick({ cs: "Slevu jsme hned vrátili do Shopify.", en: "The discount is back in Shopify." }, locale)} ${restoreChanges(codes, locale)}`;
    case "restored_partly": {
      const n = codes.missing ?? 0;
      const changes = restoreChanges(codes, locale);
      return `${codes.pending
        ? pick(
            {
              cs: `Slevu jsme vrátili do Shopify, ${n} kódů ale Shopify ještě nahrává. Klikni za chvíli na „Vrátit zpět“, zkontrolujeme je.`,
              en: `The discount is back in Shopify, but Shopify is still importing ${n} codes. Click “Undo” in a moment and we check them.`,
            },
            locale,
          )
        : pick(
            {
              cs: `Slevu jsme vrátili do Shopify, ale ${n} kódů se nepodařilo vrátit. Klikni na „Vrátit zpět“, doplníme je ze zálohy.`,
              en: `The discount is back in Shopify, but ${n} codes could not be put back. Click “Undo” and we add them from the backup.`,
            },
            locale,
          )} ${changes}`;
    }
    case "in_backup":
      return pick(
        {
          cs: "Slevu se nepodařilo vrátit do Shopify. Je v záloze, klikni na „Vrátit zpět“.",
          en: "The discount could not be put back into Shopify. It is in the backup, click “Undo”.",
        },
        locale,
      );
    case "rule_stuck":
      return pick(
        {
          cs: "Won pravidlo se nepodařilo odebrat, proto jsme slevu do Shopify nevrátili (platila by dvakrát). Je v záloze, klikni na „Vrátit zpět“.",
          en: "The Won rule could not be removed, so the discount was not put back into Shopify (it would apply twice). It is in the backup, click “Undo”.",
        },
        locale,
      );
    case "rule_unverified":
      return pick(
        {
          cs: "Nepodařilo se ověřit, že Shopify Won pravidlo už nepoužívá, proto jsme slevu do Shopify nevrátili (mohla by platit dvakrát). Je v záloze, klikni na „Vrátit zpět“.",
          en: "We could not check that Shopify stopped running the Won rule, so the discount was not put back into Shopify (it could apply twice). It is in the backup, click “Undo”.",
        },
        locale,
      );
    case "restore_unknown":
      return pick(
        {
          cs: "Nevíme, jestli se sleva do Shopify vrátila (Shopify neodpověděl). Je v záloze: klikni na „Vrátit zpět“, nejdřív zkontrolujeme Shopify, ať nevznikne dvakrát.",
          en: "We do not know whether the discount is back in Shopify (no answer). It is in the backup: click “Undo”, we check Shopify first so it is never created twice.",
        },
        locale,
      );
    case "unknown":
      return pick(
        {
          cs: "Nevíme, jestli Shopify slevu smazal. Záloha je uložená: klikni znovu na „Přesunout“, nebo ji vrať přes „Vrátit zpět“.",
          en: "We do not know whether Shopify deleted the discount. The backup is saved: click “Move” again, or put it back with “Undo”.",
        },
        locale,
      );
    case "rolled_back_unknown":
      return pick(
        {
          cs: "Nevíme, jestli Shopify slevu smazal. Won pravidlo jsme zase odebrali, ať sleva neplatí dvakrát. Záloha je uložená: klikni znovu na „Přesunout“, nebo ji vrať přes „Vrátit zpět“.",
          en: "We do not know whether Shopify deleted the discount. The Won rule was taken out again so it never applies twice. The backup is saved: click “Move” again, or put it back with “Undo”.",
        },
        locale,
      );
    case "both_live":
      return pick(
        {
          cs: "Původní sleva v Shopify zůstala a Won pravidlo se nepodařilo odebrat, můžou teď platit obě. Klikni hned na „Vrátit zpět“.",
          en: "The original discount stayed in Shopify and the Won rule could not be taken out, so both may apply now. Click “Undo” right away.",
        },
        locale,
      );
    case "still_there":
      return pick(
        {
          cs: "Sleva v Shopify i po několika kontrolách pořád je. Zálohu necháváme v Přehledu: kdyby sleva přesto zmizela, vrátíš ji tlačítkem „Vrátit zpět“. Přesunout ji můžeš znovu.",
          en: "After several checks the discount is still in Shopify. The backup stays on Overview: should the discount disappear after all, “Undo” puts it back. You can move it again.",
        },
        locale,
      );
    case "in_progress":
      return null;
  }
}

/** The merchant's sentence for a failed move: why, where the discount is now, what to do. */
export function moveErrorText(
  item: MoveErrorItem,
  locale: NativeLocale,
  state: MoveState = "unchanged",
  codes: MoveStateDetails = {},
): string {
  const { what, next } = moveErrorParts(item, locale);
  return [what, stateText(state, locale, codes), next].filter(Boolean).join(" ");
}

/** What a stale claim's sweep found (F7, N1). */
export type StaleNote = "interrupted" | "unverified" | "both_live";

/** A move or undo whose process died (stale claim, settled by the Přehled sweep from what Shopify runs). */
export function staleClaimText(locale: NativeLocale, kind: StaleNote = "interrupted"): string {
  switch (kind) {
    case "both_live":
      return pick(
        {
          cs: "Přesun se přerušil a Won pravidlo se nepodařilo odebrat. Původní sleva i Won pravidlo teď můžou platit obě. Klikni hned na „Vrátit zpět“.",
          en: "The move was interrupted and the Won rule could not be taken out. The original discount and the Won rule may both apply now. Click “Undo” right away.",
        },
        locale,
      );
    case "unverified":
      return pick(
        {
          cs: "Přesun nebo vrácení se přerušilo a nepodařilo se ověřit, co teď Shopify používá. Klikni na „Vrátit zpět“, nejdřív to zkontrolujeme.",
          en: "A move or undo was interrupted and we could not check what Shopify runs now. Click “Undo”, we check first.",
        },
        locale,
      );
    case "interrupted":
      return pick(
        {
          cs: "Přesun nebo vrácení se přerušilo (aplikace se mezitím restartovala). Záloha je uložená: klikni na „Vrátit zpět“, nebo slevu přesuň znovu.",
          en: "A move or undo was interrupted (the app restarted meanwhile). The backup is saved: click “Undo”, or move the discount again.",
        },
        locale,
      );
  }
}

export type UndoErrorItem =
  | { code: "backup_not_found" }
  | { code: "backup_unreadable" }
  | { code: "config_read_only" }
  | { code: "in_progress" }
  | { code: "check_failed"; detail: string }
  | { code: "remove_rule_failed"; detail: string }
  | { code: "restore_failed_rule_back"; detail: string }
  | { code: "restore_failed_nowhere"; detail: string }
  /** F9: the rule could not be removed, and putting it back was not confirmed either. */
  | { code: "remove_rule_failed_unverified"; detail: string }
  /** The native is in Shopify, and the Won rule could not be removed: both may apply. */
  | { code: "remove_rule_failed_both"; detail: string }
  /** F2: Shopify still runs the Won rule (a resync did not clear it): nothing restored. */
  | { code: "rule_still_live"; detail: string }
  /** F8: the restore may have landed (no answer, look-up failed): nothing more created. */
  | { code: "restore_unknown"; detail: string }
  | { code: "internal_error"; detail: string };

export function undoErrorText(item: UndoErrorItem, locale: NativeLocale): string {
  switch (item.code) {
    case "backup_not_found":
      return pick({ cs: "Záloha nenalezena.", en: "Backup not found." }, locale);
    case "backup_unreadable":
      return pick(
        {
          cs: "Zálohu se nepodařilo přečíst. Nic se nezměnilo, napiš nám na podporu.",
          en: "The backup could not be read. Nothing changed, please contact support.",
        },
        locale,
      );
    case "config_read_only":
      return moveErrorText({ code: "config_read_only" }, locale);
    case "in_progress":
      return moveErrorText({ code: "in_progress" }, locale, "in_progress");
    case "check_failed":
      return pick(
        {
          cs: `Nepodařilo se ověřit slevu v Shopify (${item.detail}). Nic se nezměnilo, zkus to znovu.`,
          en: `Could not check the discount in Shopify (${item.detail}). Nothing changed, try again.`,
        },
        locale,
      );
    case "remove_rule_failed":
      return pick(
        {
          cs: `Won pravidlo se nepodařilo odebrat (${item.detail}). Nic se nezměnilo, sleva dál platí přes Won.`,
          en: `Could not remove the Won rule (${item.detail}). Nothing changed, the discount still runs through Won.`,
        },
        locale,
      );
    case "restore_failed_rule_back":
      return pick(
        {
          cs: `Slevu se nepodařilo vrátit do Shopify (${item.detail}). Won pravidlo jsme obnovili, sleva dál platí přes Won.`,
          en: `Could not put the discount back into Shopify (${item.detail}). The Won rule is back, the discount still runs through Won.`,
        },
        locale,
      );
    case "restore_failed_nowhere":
      return pick(
        {
          cs: `Slevu se nepodařilo vrátit do Shopify (${item.detail}) ani obnovit ve Won. Je v záloze, zkus „Vrátit zpět“ znovu.`,
          en: `Could not put the discount back into Shopify (${item.detail}) or back into Won. It is in the backup, try “Undo” again.`,
        },
        locale,
      );
    case "remove_rule_failed_unverified":
      return pick(
        {
          cs: `Won pravidlo se nepodařilo odebrat (${item.detail}) a nepodařilo se ani ověřit, že dál platí. Sleva je v záloze, klikni znovu na „Vrátit zpět“.`,
          en: `Could not remove the Won rule (${item.detail}), nor confirm that it still runs. The discount is in the backup, click “Undo” again.`,
        },
        locale,
      );
    case "remove_rule_failed_both":
      return pick(
        {
          cs: `Sleva v Shopify je, ale Won pravidlo se nepodařilo odebrat (${item.detail}). Může platit dvakrát: klikni hned znovu na „Vrátit zpět“.`,
          en: `The discount is in Shopify, but the Won rule could not be removed (${item.detail}). It may apply twice: click “Undo” again now.`,
        },
        locale,
      );
    case "rule_still_live":
      return pick(
        {
          cs: `Shopify pořád používá Won pravidlo (${item.detail}), proto jsme slevu nevrátili (platila by dvakrát). Je v záloze, zkus „Vrátit zpět“ za chvíli.`,
          en: `Shopify still runs the Won rule (${item.detail}), so the discount was not put back (it would apply twice). It is in the backup, try “Undo” in a moment.`,
        },
        locale,
      );
    case "restore_unknown":
      return pick(
        {
          cs: `Nevíme, jestli se sleva do Shopify vrátila (${item.detail}). Won pravidlo jsme nevraceli, ať neplatí dvakrát. Klikni za chvíli znovu na „Vrátit zpět“, nejdřív Shopify zkontrolujeme.`,
          en: `We do not know whether the discount is back in Shopify (${item.detail}). The Won rule was not put back, so it never applies twice. Click “Undo” again in a moment, we check Shopify first.`,
        },
        locale,
      );
    case "internal_error":
      return pick(
        {
          cs: `Vrácení se přerušilo (${item.detail}). Sleva je v záloze, klikni znovu na „Vrátit zpět“.`,
          en: `The undo was interrupted (${item.detail}). The discount is in the backup, click “Undo” again.`,
        },
        locale,
      );
  }
}

export type NotRestoredItem =
  | { code: "usage_count" }
  | { code: "once_per_customer" }
  /** F1: the restored limit is what was left; `wonUses` null when the uses through Won could not be read. */
  | { code: "usage_limit_remaining"; limit: number; remaining: number; wonUses: number | null }
  /** Every use was spent through Won: the discount came back already ended. */
  | { code: "usage_limit_spent"; limit: number }
  | { code: "new_id" }
  | { code: "codes_failed"; count: number }
  | { code: "codes_pending"; count: number };

/** Where a backup's discount may be, as far as the row knows (drives what its undo will do). */
export type UndoSituation =
  /** Moved (or only in the backup): the undo recreates the discount. */
  | { kind: "recreate" }
  /** The move stopped part-way: the native may still be live; the undo checks first. */
  | { kind: "maybe_live" }
  /** Back in Shopify with codes missing: the undo only adds them. */
  | { kind: "add_codes"; missing: number };

/**
 * What an undo will change, shown BEFORE the merchant confirms it (F11, §14c).
 * `native` is the discount as backed up.
 */
export function undoCostTexts(
  native: { method: "code" | "automatic"; usageLimit: number | null; oncePerCustomer: boolean },
  locale: NativeLocale,
  situation: UndoSituation = { kind: "recreate" },
): string[] {
  if (situation.kind === "add_codes") {
    return [
      pick(
        {
          cs: `Doplníme ${situation.missing} chybějící kódy ze zálohy. Nic jiného se nezmění.`,
          en: `We add the ${situation.missing} missing codes from the backup. Nothing else changes.`,
        },
        locale,
      ),
    ];
  }
  const recreate = [
    pick({ cs: "Sleva vznikne v Shopify znovu ze zálohy, s novým ID.", en: "The discount is created again in Shopify from the backup, with a new ID." }, locale),
    pick({ cs: "Počítadlo použití v Shopify začne od nuly.", en: "The usage count in Shopify starts from zero." }, locale),
  ];
  if (native.method === "code" && native.usageLimit !== null) {
    recreate.push(
      pick(
        {
          cs: "Limit použití nastavíme na to, co z něj zbývá (odečteme použití před přesunem i přes Won).",
          en: "The usage limit is set to what is left of it (uses before the move and through Won are subtracted).",
        },
        locale,
      ),
    );
  }
  if (native.oncePerCustomer) recreate.push(notRestoredText({ code: "once_per_customer" }, locale));
  if (situation.kind === "maybe_live") {
    return [
      pick(
        {
          cs: "Nejdřív ověříme, jestli původní sleva v Shopify pořád je. Když ano, jen odebereme Won pravidlo a nic dalšího se nezmění.",
          en: "First we check whether the original discount is still in Shopify. If it is, we only take out the Won rule and nothing else changes.",
        },
        locale,
      ),
      pick({ cs: "Když v Shopify není:", en: "If it is not in Shopify:" }, locale),
      ...recreate,
    ];
  }
  recreate.push(
    pick(
      {
        cs: "Úpravy Won pravidla od přesunu se ztratí: sleva se vrátí tak, jak byla v záloze.",
        en: "Changes made to the Won rule since the move are lost: the discount comes back as it was backed up.",
      },
      locale,
    ),
  );
  return recreate;
}

/** What an undo cannot bring back (shown after the undo). */
export function notRestoredText(item: NotRestoredItem, locale: NativeLocale): string {
  switch (item.code) {
    case "usage_count":
      return pick(
        { cs: "Počítadlo použití v Shopify začíná od nuly.", en: "The usage count in Shopify starts from zero." },
        locale,
      );
    case "new_id":
      return pick({ cs: "Sleva má v Shopify nové ID.", en: "The discount has a new ID in Shopify." }, locale);
    case "once_per_customer":
      return pick(
        {
          cs: "Limit „1× na zákazníka“ začne znovu.",
          en: "“Once per customer” starts over.",
        },
        locale,
      );
    case "usage_limit_remaining":
      return item.wonUses === null
        ? pick(
            {
              cs: `Limit jsme nastavili na zbývajících ${item.remaining} z ${item.limit}. Použití přes Won se nepodařilo přečíst, odečetli jsme jen ta před přesunem.`,
              en: `The limit is set to the remaining ${item.remaining} of ${item.limit}. The uses through Won could not be read, only those before the move are subtracted.`,
            },
            locale,
          )
        : pick(
            {
              cs: `Limit jsme nastavili na zbývajících ${item.remaining} z ${item.limit} (použití před přesunem i přes Won jsou odečtená).`,
              en: `The limit is set to the remaining ${item.remaining} of ${item.limit} (uses before the move and through Won are subtracted).`,
            },
            locale,
          );
    case "usage_limit_spent":
      return pick(
        {
          cs: `Limit ${item.limit} použití se přes Won vyčerpal. Slevu jsme vrátili jako ukončenou.`,
          en: `The limit of ${item.limit} uses was spent through Won. The discount is back as ended.`,
        },
        locale,
      );
    case "codes_failed":
      return pick(
        {
          cs: `${item.count} kódů se nepodařilo vrátit. Klikni znovu na „Vrátit zpět“, doplníme je ze zálohy.`,
          en: `${item.count} codes could not be put back. Click “Undo” again and we add them from the backup.`,
        },
        locale,
      );
    case "codes_pending":
      return pick(
        {
          cs: `${item.count} kódů Shopify ještě nahrává. Klikni za chvíli znovu na „Vrátit zpět“, zkontrolujeme je.`,
          en: `Shopify is still importing ${item.count} codes. Click “Undo” again in a moment and we check them.`,
        },
        locale,
      );
  }
}
