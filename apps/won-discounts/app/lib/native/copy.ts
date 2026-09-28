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
  | { code: "usage_history"; used: number }
  | { code: "once_per_customer" }
  | { code: "codes_over_limit"; count: number; limit: number }
  | { code: "subscription_cycles"; cycles: number };

export function lossText(item: LossItem, locale: NativeLocale): string {
  switch (item.code) {
    case "usage_history":
      return item.used > 0
        ? pick(
            {
              cs: `Historie použití zůstane v Shopify (zatím ${item.used}×). Won počítá od nuly.`,
              en: `The usage history stays in Shopify (${item.used} so far). Won counts from zero.`,
            },
            locale,
          )
        : pick(
            {
              cs: "Historie použití zůstane v Shopify. Won počítá od nuly.",
              en: "The usage history stays in Shopify. Won counts from zero.",
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
  | { code: "subscriptions_included" };

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
          cs: `Shopify eviduje ${item.used} z ${item.limit} použití. Ve Won nastavíme limit na zbývajících ${item.remaining}.`,
          en: `Shopify counts ${item.used} of ${item.limit} uses. In Won the limit is set to the remaining ${item.remaining}.`,
        },
        locale,
      );
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
        cs: "Won vytvoří stejné pravidlo a slevu v Shopify smaže. Zálohu si nechá, přesun jde vrátit jedním kliknutím.",
        en: "Won creates the same rule and deletes the discount in Shopify. It keeps a backup, so one click undoes the move.",
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
  | "unknown" //         the delete may or may not have happened
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
  | { code: "sync_failed"; detail: string };

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
  }
}

function stateText(state: MoveState, locale: NativeLocale, codes: { missing?: number; pending?: boolean }): string | null {
  switch (state) {
    case "unchanged":
      return pick({ cs: "Nic se nezměnilo.", en: "Nothing changed." }, locale);
    case "restored":
      return pick(
        { cs: "Slevu jsme hned vrátili do Shopify, funguje jako dřív.", en: "The discount is back in Shopify and works as before." },
        locale,
      );
    case "restored_partly": {
      const n = codes.missing ?? 0;
      return codes.pending
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
          );
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
    case "unknown":
      return pick(
        {
          cs: "Nevíme, jestli Shopify slevu smazal. Záloha je uložená: klikni znovu na „Přesunout“, nebo ji vrať přes „Vrátit zpět“.",
          en: "We do not know whether Shopify deleted the discount. The backup is saved: click “Move” again, or put it back with “Undo”.",
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
  codes: { missing?: number; pending?: boolean } = {},
): string {
  const { what, next } = moveErrorParts(item, locale);
  return [what, stateText(state, locale, codes), next].filter(Boolean).join(" ");
}

export type UndoErrorItem =
  | { code: "backup_not_found" }
  | { code: "backup_unreadable" }
  | { code: "config_read_only" }
  | { code: "in_progress" }
  | { code: "check_failed"; detail: string }
  | { code: "remove_rule_failed"; detail: string }
  | { code: "restore_failed_rule_back"; detail: string }
  | { code: "restore_failed_nowhere"; detail: string };

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
  }
}

export type NotRestoredItem =
  | { code: "usage_count" }
  | { code: "once_per_customer" }
  | { code: "usage_limit_full"; limit: number }
  | { code: "codes_failed"; count: number }
  | { code: "codes_pending"; count: number };

/** What an undo cannot bring back (shown after the undo). */
export function notRestoredText(item: NotRestoredItem, locale: NativeLocale): string {
  switch (item.code) {
    case "usage_count":
      return pick(
        { cs: "Počet použití se nevrátí. Shopify počítá od nuly.", en: "The usage count does not come back. Shopify counts from zero." },
        locale,
      );
    case "once_per_customer":
      return pick(
        {
          cs: "Limit „1× na zákazníka“ začne znovu.",
          en: "“Once per customer” starts over.",
        },
        locale,
      );
    case "usage_limit_full":
      return pick(
        {
          cs: `Limit ${item.limit} použití platí znovu celý.`,
          en: `The limit of ${item.limit} uses applies in full again.`,
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
